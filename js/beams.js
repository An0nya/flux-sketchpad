/* beams.js — saveable beams: a beam (one intensity table I(H, V) in cd, plus its colour) as portable JSON.
 *
 * Pure: no DOM, no storage. Loads in the page and in Node (tests/beams.js).
 *
 * File shape (format 1), one beam:
 *   { format: 1, kind: 'beam', name, beamKind: 'low'|'high', conv: 'A'|'B'|'S', notes,
 *     grid: { h0, v0, step, nh, nv },            degrees; data[j*nh+i] is the cd at (h0+(i+.5)*step, v0+(j+.5)*step)
 *     colour: { cct?, rgb? },                    kelvin and/or [r,g,b] lamp tint (both optional)
 *     length: nh*nv, checksum: 'fnv1a32:<8 hex>',
 *     data: <base64 of little-endian Float32, row-major> }
 * A bundle holds many beams in one file: { format: 1, kind: 'beam-bundle', name, beams: [beam, ...] }.
 * Lamp mount offsets and separation are NOT stored: they stay with the car model.
 *
 * Byte order is little-endian by definition (DataView with littleEndian=true), so the file reads the same on any host.
 * The checksum is FNV-1a 32-bit over the raw data bytes (little-endian), so it covers exactly the stored numbers.
 */
(function () {
  'use strict';
  const R = (typeof RF !== 'undefined' && RF) || (globalThis.RF = globalThis.RF || {});
  const FORMAT = 1, KINDS = ['low', 'high'], CONVS = ['A', 'B', 'S'];

  // ---- bytes <-> base64 (btoa/atob exist in browsers and in Node 16+; no Buffer)
  function bytesToB64(bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  // Float32 -> little-endian bytes. Writes the bits of each value, so NaN payloads survive, though validate() rejects NaN anyway.
  function floatsToBytes(data) {
    const bytes = new Uint8Array(data.length * 4), dv = new DataView(bytes.buffer);
    for (let i = 0; i < data.length; i++) dv.setFloat32(i * 4, data[i], true);
    return bytes;
  }
  function bytesToFloats(bytes, n) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  }
  // FNV-1a 32-bit over the bytes. Plain integer maths with Math.imul; the result is an unsigned 32-bit number.
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  const hex8 = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
  const checksumOf = (bytes) => 'fnv1a32:' + hex8(fnv1a(bytes));

  // ---- validation. Every failure throws an Error with a message a person can act on.
  function checkGrid(g) {
    if (!g || typeof g !== 'object') throw new Error('beam has no grid');
    for (const k of ['h0', 'v0', 'step']) if (!Number.isFinite(g[k])) throw new Error('grid.' + k + ' is not a finite number');
    if (!(g.step > 0)) throw new Error('grid.step must be > 0');
    for (const k of ['nh', 'nv']) if (!Number.isInteger(g[k]) || g[k] < 2) throw new Error('grid.' + k + ' must be an integer >= 2');
    if (g.nh * g.nv > 4e6) throw new Error('grid is too large (' + g.nh * g.nv + ' cells; limit 4e6)');
  }
  function checkColour(c) {
    if (c === undefined || c === null) return undefined;
    const out = {};
    if (c.cct !== undefined) {
      if (!Number.isFinite(c.cct) || c.cct < 1000 || c.cct > 20000) throw new Error('colour.cct must be 1000..20000 K');
      out.cct = c.cct;
    }
    if (c.rgb !== undefined) {
      if (!Array.isArray(c.rgb) || c.rgb.length !== 3 || !c.rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('colour.rgb must be three numbers in 0..1');
      out.rgb = c.rgb.slice();
    }
    return out;
  }
  // Checks the in-memory values a beam must hold before it can be written or used.
  function validateData(data, grid) {
    if (!(data instanceof Float32Array)) throw new Error('beam data must be a Float32Array');
    if (data.length !== grid.nh * grid.nv) throw new Error('beam data has ' + data.length + ' values; grid needs ' + grid.nh * grid.nv);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) throw new Error('beam data has a non-finite value at index ' + i);
      if (v < 0) throw new Error('beam data has a negative cd at index ' + i);
    }
  }

  // Builds a beam from in-memory values. Use this for a table you computed, or for the output of fromLut().
  function build(o) {
    if (!o || typeof o !== 'object') throw new Error('build needs an object');
    const kind = o.beamKind || 'low', conv = o.conv || 'A';
    if (!KINDS.includes(kind)) throw new Error('beamKind must be low or high');
    if (!CONVS.includes(conv)) throw new Error('conv must be A, B or S');
    if (!o.grid) throw new Error('build needs a grid');
    const grid = { h0: o.grid.h0, v0: o.grid.v0, step: o.grid.step, nh: o.grid.nh, nv: o.grid.nv };
    checkGrid(grid);
    const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
    validateData(data, grid);
    const beam = { format: FORMAT, kind: 'beam', name: String(o.name || 'untitled beam').slice(0, 80), beamKind: kind, conv, notes: String(o.notes || '').slice(0, 2000), grid };
    const colour = checkColour(o.colour); if (colour && (colour.cct !== undefined || colour.rgb !== undefined)) beam.colour = colour;
    beam.length = data.length; beam.checksum = checksumOf(floatsToBytes(data));
    beam.data = bytesToB64(floatsToBytes(data));
    return beam;
  }

  // Parses one beam object (as read from JSON) into an in-memory beam with a Float32Array `values`. Throws on any defect.
  function parse(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('not a beam object');
    if (obj.format !== FORMAT) throw new Error('unsupported beam format ' + obj.format + ' (this app reads format 1)');
    if (obj.kind !== 'beam') throw new Error('expected kind "beam", got "' + obj.kind + '"');
    if (!KINDS.includes(obj.beamKind)) throw new Error('beamKind must be low or high');
    if (!CONVS.includes(obj.conv)) throw new Error('conv must be A, B or S');
    checkGrid(obj.grid);
    const n = obj.grid.nh * obj.grid.nv;
    if (obj.length !== n) throw new Error('length field is ' + obj.length + '; grid needs ' + n);
    if (typeof obj.data !== 'string') throw new Error('beam data is missing');
    const bytes = b64ToBytes(obj.data);
    if (bytes.length !== n * 4) throw new Error('data is ' + bytes.length + ' bytes; expected ' + n * 4 + ' (Float32 x ' + n + ')');
    if (checksumOf(bytes) !== obj.checksum) throw new Error('checksum mismatch: file says ' + obj.checksum + ', data gives ' + checksumOf(bytes) + ' (file damaged or edited)');
    const values = bytesToFloats(bytes, n);
    validateData(values, obj.grid);
    const out = { format: FORMAT, kind: 'beam', name: String(obj.name || 'untitled beam'), beamKind: obj.beamKind, conv: obj.conv, notes: String(obj.notes || ''), grid: { ...obj.grid }, values };
    const colour = checkColour(obj.colour); if (colour && (colour.cct !== undefined || colour.rgb !== undefined)) out.colour = colour;
    return out;
  }

  // Serialises an in-memory beam (from parse() or build()) to a plain JSON object.
  function serialise(beam) {
    if (typeof beam.data === 'string') return JSON.parse(JSON.stringify(beam)); // build() already gives the file shape
    const values = beam.values || (beam.data instanceof Float32Array ? beam.data : null);
    if (!values) throw new Error('serialise needs in-memory values');
    const out = { format: FORMAT, kind: 'beam', name: beam.name, beamKind: beam.beamKind, conv: beam.conv, notes: beam.notes || '', grid: { ...beam.grid } };
    if (beam.colour) out.colour = { ...beam.colour, ...(beam.colour.rgb ? { rgb: beam.colour.rgb.slice() } : {}) };
    const bytes = floatsToBytes(values);
    out.length = values.length; out.checksum = checksumOf(bytes); out.data = bytesToB64(bytes);
    return out;
  }

  // One file holding many beams. Input and output are plain JSON objects.
  function bundle(beams, o) {
    if (!Array.isArray(beams) || !beams.length) throw new Error('a bundle needs at least one beam');
    return { format: FORMAT, kind: 'beam-bundle', name: String((o && o.name) || 'beam bundle').slice(0, 80), beams: beams.map(b => (b.kind === 'beam' ? b : serialise(b))) };
  }
  // Reads a file's JSON: a single beam or a bundle. Returns an array of parsed beams. A bad beam in a bundle rejects the whole file.
  function readFile(obj) {
    if (obj && obj.kind === 'beam-bundle') {
      if (obj.format !== FORMAT || !Array.isArray(obj.beams)) throw new Error('bundle is malformed');
      return obj.beams.map((b, i) => { try { return parse(b); } catch (e) { throw new Error('bundle beam ' + (i + 1) + ': ' + e.message); } });
    }
    return [parse(obj)];
  }

  // Makes an in-memory beam from a LUT in the shape lutFrom() returns, so an existing table can be saved.
  function fromLut(lut, meta) {
    return { format: FORMAT, kind: 'beam', name: (meta && meta.name) || 'untitled beam', beamKind: (meta && meta.beamKind) || 'low', conv: (meta && meta.conv) || 'A', notes: (meta && meta.notes) || '', colour: meta && meta.colour, grid: { h0: lut.h0, v0: lut.v0, step: lut.step, nh: lut.nh, nv: lut.nv }, values: Float32Array.from(lut.data) };
  }
  // The LUT shape the renderers use ({h0, v0, step, nh, nv, data}), for a parsed beam.
  function toLut(beam) {
    const values = beam.values || bytesToFloats(b64ToBytes(beam.data), beam.grid.nh * beam.grid.nv);
    return { h0: beam.grid.h0, v0: beam.grid.v0, step: beam.grid.step, nh: beam.grid.nh, nv: beam.grid.nv, data: values };
  }
  const sameGrid = (a, b) => a.h0 === b.h0 && a.v0 === b.v0 && a.step === b.step && a.nh === b.nh && a.nv === b.nv;

  // Puts a LUT onto another grid by sampling the source with the renderer's own lutAt (bilinear; 0 outside the source window),
  // so a resampled value is exactly what the renderer would have read. Returns the same object when the grid already matches.
  function resample(lut, grid) {
    if (sameGrid(lut, grid)) return lut;
    checkGrid(grid);
    const data = new Float32Array(grid.nh * grid.nv);
    for (let j = 0; j < grid.nv; j++) for (let i = 0; i < grid.nh; i++) {
      const v = (R.Drive && R.Drive.lutAt) ? R.Drive.lutAt(lut, grid.h0 + (i + 0.5) * grid.step, grid.v0 + (j + 0.5) * grid.step) : 0;
      data[j * grid.nh + i] = v > 0 ? v : 0;
    }
    return { h0: grid.h0, v0: grid.v0, step: grid.step, nh: grid.nh, nv: grid.nv, data };
  }

  // Synthetic beams for tests and fixtures (no reflector needed).
  // uniformWash: every cell inside the box {hMin,hMax,vMin,vMax} (degrees) gets `cd`; the grid covers exactly the box.
  function uniformWash(cd, box, step) {
    const s = step || 0.25, h0 = box.hMin, v0 = box.vMin;
    const nh = Math.round((box.hMax - box.hMin) / s), nv = Math.round((box.vMax - box.vMin) / s);
    const data = new Float32Array(nh * nv).fill(cd);
    return { h0, v0, step: s, nh, nv, data };
  }
  // pointBeam: each (h, v, cd) point deposits its cd into the grid cell containing it, so the cells sum to the total cd.
  // Cells sample the same way the renderer does (lutAt), so a point's cd is spread over cells, not placed exactly.
  function pointBeam(points, grid) {
    checkGrid(grid);
    const data = new Float32Array(grid.nh * grid.nv);
    for (const p of points) {
      const i = Math.floor((p[0] - grid.h0) / grid.step), j = Math.floor((p[1] - grid.v0) / grid.step);
      if (i < 0 || j < 0 || i >= grid.nh || j >= grid.nv) continue;
      data[j * grid.nh + i] += p[2];
    }
    return { h0: grid.h0, v0: grid.v0, step: grid.step, nh: grid.nh, nv: grid.nv, data };
  }

  R.Beams = { FORMAT, build, parse, serialise, bundle, readFile, fromLut, toLut, resample, sameGrid, uniformWash, pointBeam, checksumOf, fnv1a, bytesToB64, b64ToBytes, floatsToBytes, bytesToFloats };
  if (typeof module !== 'undefined' && module.exports) module.exports = R.Beams;
})();
