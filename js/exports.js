/* exports.js — pure photometry / display-geometry writers, shared by the page and CLI.
 * Coordinates, format references and missing-data policy: docs/EXPORTS.md. */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, rad = Math.PI / 180;
  const num = (x) => { if (!Number.isFinite(x)) throw new Error('Non-finite export value'); return String(+x.toPrecision(10)); };
  const line = (a) => a.map(num).join(' ');
  const wrap = (a) => ((a % 360) + 360) % 360;
  // Type C: gamma=0 is world -z, C=0 is +x, C=90 is +y (lamp left).
  function direction(C, g) { const s = Math.sin(g * rad); return [s * Math.cos(C * rad), s * Math.sin(C * rad), -Math.cos(g * rad)]; }
  function angles(d) { return [wrap(Math.atan2(d[1], d[0]) / rad), Math.acos(Math.max(-1, Math.min(1, d[2] / -Math.hypot(...d)))) / rad]; }
  function sample(G, h, v) {
    const x = (h - G.h0) / G.step - 0.5, y = (v - G.v0) / G.step - 0.5;
    if (!Number.isFinite(x + y) || x < -0.5 - 1e-8 || y < -0.5 - 1e-8 || x > G.nh - 0.5 + 1e-8 || y > G.nv - 0.5 + 1e-8) return 0;
    const a = Math.max(0, Math.min(G.nh - 1, x)), b = Math.max(0, Math.min(G.nv - 1, y)), i = Math.floor(a), j = Math.floor(b), u = a - i, t = b - j;
    const cd = (i, j) => { const q = j * G.nh + i; return G.E[q] / G.Om[q]; }, ii = Math.min(i + 1, G.nh - 1), jj = Math.min(j + 1, G.nv - 1);
    return (1 - t) * ((1 - u) * cd(i, j) + u * cd(ii, j)) + t * ((1 - u) * cd(i, jj) + u * cd(ii, jj));
  }
  const unique = (a) => [...new Set(a.map((v) => +v.toFixed(8)))].sort((a, b) => a - b);
  // Non-uniform angle lists keep the fine forward window, with zero guard planes outside it.
  // A maps exactly at bin centres. B/S are resampled at half the native angular step.
  function photometry(G) {
    if (G.distance !== Infinity) throw new Error('Photometric export needs the far field at infinity');
    if (!(G.nh > 0 && G.nv > 0 && G.step > 0) || G.E.length !== G.nh * G.nv || G.Om.length !== G.E.length) throw new Error('Invalid far-field grid');
    let hs = [], vs = [];
    if (G.conv === 'A') {
      for (let i = -1; i <= G.nh; i++) hs.push(G.h0 + (i + 0.5) * G.step);
      for (let j = -1; j <= G.nv; j++) vs.push(G.v0 + (j + 0.5) * G.step);
    } else {
      const hh = [], vv = [];
      for (const h of [G.h0, 0, G.h0 + G.nh * G.step]) for (const v of [G.v0, 0, G.v0 + G.nv * G.step]) {
        const a = RF.FarField.hvOf(RF.FarField.dirOf(h, v, G.conv), 'A'); hh.push(a[0]); vv.push(a[1]);
      }
      const s = G.step / 2;
      for (let i = Math.floor(Math.min(...hh) / s) - 1; i <= Math.ceil(Math.max(...hh) / s) + 1; i++) hs.push(i * s);
      for (let j = Math.floor(Math.min(...vv) / s) - 1; j <= Math.ceil(Math.max(...vv) / s) + 1; j++) vs.push(j * s);
    }
    const C = unique([0, ...hs.map((h) => wrap(-h)), 360]), gamma = unique([0, ...vs.filter((v) => v > -90 && v < 90).map((v) => 90 + v), 180]);
    if (C.length * gamma.length > 8000000) throw new Error('Export grid exceeds 8M samples; increase the Spec bin size');
    const cd = C.map((c) => gamma.map((g) => { const hv = RF.FarField.hvOf(direction(c, g), G.conv); return sample(G, hv[0], hv[1]); }));
    let down = 0;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) if (RF.FarField.dirOf(G.h0 + (i + 0.5) * G.step, G.v0 + (j + 0.5) * G.step, G.conv)[2] <= 0) down += G.E[j * G.nh + i];
    return { C, gamma, cd, lumens: G.lmWindow, exitLumens: G.lmExit, down, conv: G.conv, step: G.step, window: [G.h0, G.h0 + G.nh * G.step, G.v0, G.v0 + G.nv * G.step] };
  }
  function ies(G, opts) {
    const p = photometry(G), legacy = opts && opts.legacy;
    const head = [legacy ? 'IESNA:LM-63-2002' : 'IES:LM-63-2019', '[TEST] FLUX-SIMULATION', '[TESTLAB] FLUX ray tracer', '[MANUFAC] FLUX sketchpad', '[ISSUEDATE] ' + new Date().toISOString().slice(0, 10),
      '[LUMINAIRE] Simulated windowed far field; no symmetry', '[FILEGENINFO] Computer simulation; raw bin cd, bilinear resampling, no re-aim',
      '[_AXES] C0=world +x, C90=world +y (left), gamma0=world -z (down)',
      '[_WINDOW] ' + p.conv + ' H/V degrees: ' + line(p.window), '[_LUMENS] Window=' + num(p.lumens) + '; all exits=' + num(p.exitLumens),
      '[OTHER] Outside traced window is zero (unmeasured); not a full-sphere measurement', 'TILT=NONE', '1 -1 1 ' + p.gamma.length + ' ' + p.C.length + ' 1 2 0 0 0', legacy ? '1 1 0' : '1 1.00010 0'];
    // Short lines also work in older readers with fixed input-line buffers.
    const rows = (a) => { for (let i = 0; i < a.length; i += 8) head.push(line(a.slice(i, i + 8))); };
    rows(p.gamma); rows(p.C); p.cd.forEach(rows); return head.join('\r\n') + '\r\n';
  }
  function ldt(G) {
    const p = photometry(G), C = p.C.slice(0, -1), flux = p.lumens;
    if (!(flux > 0)) throw new Error('LDT needs positive traced-window lumens for cd/klm normalisation');
    // Absolute luminaire (-1 lamp count), window-output lumens, LOR=100%; table is cd/klm.
    // Required ancillary fields use explicit zero placeholders, not measurements; see docs.
    const a = ['FLUX EULUMDAT; unmeasured outside window=0; see docs/EXPORTS.md', '3', '0', C.length, '0', p.gamma.length, '0', 'FLUX-SIM; dimensions/W/direct ratios unavailable (0)',
      'Windowed far field; C0=+x C90=+y gamma0=-z; no re-aim', 'FLUX', 'flux.ldt', new Date().toISOString().slice(0, 10),
      0, 0, 0, 0, 0, 0, 0, 0, 0, 100 * p.down / flux, 100, 1, 0, 1, -1, 'Simulated window output', flux, 'unknown', 'n/a', 0,
      ...new Array(10).fill(0), ...C, ...p.gamma];
    for (let i = 0; i < C.length; i++) for (const cd of p.cd[i]) a.push(num(cd * 1000 / flux));
    return a.map((v) => typeof v === 'number' ? num(v) : v).join('\r\n') + '\r\n';
  }
  function gltf(scene) {
    const surfaces = RF.State.allSurfaces(scene); if (!surfaces.length) throw new Error('No enabled surfaces to export');
    const G = RF.Geo.compile(surfaces), parts = [], nodes = [], meshes = [], accessors = [], bufferViews = [], groups = new Map(); let offset = 0;
    const add = (values, bounds) => {
      const f = new Float32Array(values), bytes = new Uint8Array(f.length * 4), dv = new DataView(bytes.buffer);
      for (let i = 0; i < f.length; i++) { if (!Number.isFinite(f[i])) throw new Error('Non-finite mesh vertex'); dv.setFloat32(i * 4, f[i], true); }
      const vi = bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 }) - 1;
      const acc = { bufferView: vi, componentType: 5126, count: f.length / 3, type: 'VEC3' };
      if (bounds) { acc.min = [Infinity, Infinity, Infinity]; acc.max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < f.length; i++) { const k = i % 3; acc.min[k] = Math.min(acc.min[k], f[i]); acc.max[k] = Math.max(acc.max[k], f[i]); } }
      parts.push(bytes); offset += bytes.length; return accessors.push(acc) - 1;
    };
    // Rotation (x,y,z) -> (x,z,-y), determinant +1: preserve winding, glTF +y up.
    const rotate = (p, scale) => [p[0] * scale, p[2] * scale, -p[1] * scale];
    for (let k = 0; k < G.n; k++) {
      const pos = [], normals = [], meta = G.metas[k], group = meta.group || 'M', name = group + '/' + (meta.id || 'surface-' + k);
      for (const poly of RF.Geo.mesh(G, k)) for (let j = 1; j + 1 < poly.length; j++) {
        const tri = [poly[0], poly[j], poly[j + 1]], n = V.cross(V.sub(tri[1], tri[0]), V.sub(tri[2], tri[0])); if (V.len(n) < 1e-12) continue;
        const normal = rotate(V.norm(n), 1); for (const p of tri) { pos.push(...rotate(p, 0.001)); normals.push(...normal); }
      }
      if (!pos.length) continue;
      const mesh = meshes.push({ name, primitives: [{ attributes: { POSITION: add(pos, true), NORMAL: add(normals, false) }, mode: 4, material: 0 }] }) - 1;
      const node = nodes.push({ name, mesh }) - 1; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(node);
    }
    if (!meshes.length) throw new Error('No non-degenerate surface triangles to export');
    const roots = []; for (const [name, children] of groups) roots.push(nodes.push({ name, children }) - 1);
    const bytes = new Uint8Array(offset); let at = 0; for (const b of parts) { bytes.set(b, at); at += b.length; }
    let b64; if (typeof Buffer !== 'undefined') b64 = Buffer.from(bytes).toString('base64'); else { const chunks = []; for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768))); b64 = btoa(chunks.join('')); }
    return JSON.stringify({ asset: { version: '2.0', generator: 'FLUX RF.Geo.mesh; mm to m; (x,y,z) to (x,z,-y)' }, scene: 0, scenes: [{ nodes: roots }], nodes, meshes,
      materials: [{ name: 'Surface', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.7, 0.72, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.5 } }],
      buffers: [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + b64 }], bufferViews, accessors });
  }
  RF.Exports = { direction, angles, sample, photometry, ies, ldt, gltf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
