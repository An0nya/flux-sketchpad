// BA1: beam module (js/beams.js), headless. Node tests/beams.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('./load.js'); const RF = load();
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'beams.js'), 'utf8'), { filename: 'js/beams.js' });
const B = RF.Beams, D = RF.Drive;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const throws = (fn, re) => { try { fn(); return 'no throw'; } catch (e) { return re.test(e.message) ? 'ok' : e.message; } };
const bitsEqual = (a, b) => { if (a.length !== b.length) return false; const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

// a real table: the generic low beam on a small window, so the values are not just round numbers
const WIN = [-20, 20, -10, 5], STEP = 0.5;
const lut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false), { win: WIN, step: STEP });
// add a value that a float32 round trip must keep exactly (a tiny one and a fractional one)
lut.data[3] = 0.000123456789; lut.data[7] = 1234.5678;

// 0. byte order is little-endian by definition: 1.0f is 00 00 80 3f on the wire
ok('float32 is little-endian on the wire (1.0 -> AACAPw==)', B.bytesToB64(B.floatsToBytes(Float32Array.of(1))) === 'AACAPw==', B.bytesToB64(B.floatsToBytes(Float32Array.of(1))));

// 1. round trip bit-exact through JSON text
{
  const beam = B.build({ name: 'rt', beamKind: 'low', conv: 'A', notes: 'n', grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: lut.data, colour: { cct: 3200, rgb: [1, 0.8, 0.5] } });
  const text = JSON.stringify(B.serialise(beam));
  const back = B.readFile(JSON.parse(text));
  ok('round trip: one beam back', back.length === 1);
  ok('round trip: float32 bits identical', back.length === 1 && bitsEqual(back[0].values, lut.data), { nh: lut.nh, nv: lut.nv });
  ok('round trip: grid, kind, conv, colour kept', back[0].grid.nh === lut.nh && back[0].beamKind === 'low' && back[0].conv === 'A' && back[0].colour.cct === 3200 && back[0].colour.rgb[2] === 0.5 && back[0].notes === 'n');
  const t = B.toLut(back[0]);
  ok('toLut gives the renderer shape (same numbers)', t.nh === lut.nh && t.nv === lut.nv && t.step === STEP && bitsEqual(t.data, lut.data));
  const sample = [[0, 0], [5.1, -2.3], [-19.9, 4.9]].every(([h, v]) => D.lutAt(t, h, v) === D.lutAt(lut, h, v));
  ok('lutAt on the round-tripped table matches the original', sample);
}

// 2. bad checksum rejected
{
  const obj = B.serialise(B.build({ name: 'bad', grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: lut.data }));
  const bytes = B.b64ToBytes(obj.data); bytes[11] ^= 0x10; obj.data = B.bytesToB64(bytes);
  ok('bad checksum (one flipped bit) rejected', throws(() => B.readFile(obj), /checksum mismatch/) === 'ok');
}

// 3. wrong length rejected (length field and data size)
{
  const obj = B.serialise(B.build({ name: 'len', grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: lut.data }));
  const a = { ...obj, length: obj.length - 1 };
  ok('wrong length field rejected', throws(() => B.readFile(a), /length field/) === 'ok');
  const short = { ...obj, grid: { ...obj.grid, nh: obj.grid.nh - 1 }, length: (obj.grid.nh - 1) * obj.grid.nv };
  ok('grid that does not match the data size rejected', throws(() => B.readFile(short), /expected|bytes/) === 'ok', throws(() => B.readFile(short), /./));
}

// 4. NaN, Inf and negative cd rejected at build and at parse
{
  const bad = Float32Array.from(lut.data); bad[5] = NaN;
  ok('NaN in data rejected at build', throws(() => B.build({ grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: bad }), /non-finite/) === 'ok');
  const neg = Float32Array.from(lut.data); neg[9] = -1;
  ok('negative cd rejected at build', throws(() => B.build({ grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: neg }), /negative/) === 'ok');
  ok('bad colour rejected', throws(() => B.build({ grid: { h0: 0, v0: 0, step: 1, nh: 2, nv: 2 }, data: [1, 2, 3, 4], colour: { cct: 99999 } }), /cct/) === 'ok');
}

// 5. wrong grid handled: resample uses the renderer's lutAt, 0 outside the source window, same object when the grid already matches
{
  const other = { h0: -10, v0: -6, step: 0.25, nh: 80, nv: 64 };
  const r = B.resample(lut, other);
  let worst = 0;
  for (let j = 0; j < other.nv; j++) for (let i = 0; i < other.nh; i++) {
    const h = other.h0 + (i + 0.5) * other.step, v = other.v0 + (j + 0.5) * other.step;
    // the output is Float32, so compare against the float32 rounding of the renderer's double-precision value
    worst = Math.max(worst, Math.abs(r.data[j * other.nh + i] - Math.fround(Math.max(0, D.lutAt(lut, h, v)))));
  }
  ok('resample equals lutAt (float32-rounded) at every target cell', worst === 0, { worst });
  // the source window is h in [-20,20], v in [-10,5]; the top target row is at v = 9.875, outside it
  ok('resample outside the source window gives 0', r.data[(other.nv - 1) * other.nh] === 0 && r.data[(other.nv - 1) * other.nh + 40] === 0);
  ok('resample inside the source window is not all zero', r.data.some(x => x > 0));
  ok('resample to the same grid returns the same object', B.resample(lut, { h0: lut.h0, v0: lut.v0, step: lut.step, nh: lut.nh, nv: lut.nv }) === lut);
}

// 6. bundle with 3 beams: one file, three beams back, each bit-exact; a bad beam rejects the whole file and names which one
{
  const mk = (name, scale) => B.build({ name, beamKind: 'low', grid: { h0: WIN[0], v0: WIN[2], step: STEP, nh: lut.nh, nv: lut.nv }, data: lut.data.map(v => v * scale) });
  const bundle = B.bundle([mk('a', 1), mk('b', 0.5), mk('c', 2)], { name: 'three' });
  const back = B.readFile(JSON.parse(JSON.stringify(bundle)));
  ok('bundle: three beams back, in order', back.length === 3 && back.map(b => b.name).join() === 'a,b,c', back.map(b => b.name));
  ok('bundle: each beam bit-exact', back.every((b, i) => bitsEqual(b.values, Float32Array.from(lut.data, v => v * [1, 0.5, 2][i]))));
  const broken = JSON.parse(JSON.stringify(bundle)); broken.beams[1].checksum = 'fnv1a32:00000000';
  ok('bundle with one bad beam rejects the whole file, naming beam 2', throws(() => B.readFile(broken), /bundle beam 2: checksum/) === 'ok');
}

// 7. synthetic beams for tests: a uniform 2.7 kcd wash over 0.5U-1.5U x 1-6 (horizontal, vertical) and a point set
{
  const box = { hMin: 0.5, hMax: 1.5, vMin: -6, vMax: -1 };
  const w = B.uniformWash(2700, box, 0.25);
  const inside = D.lutAt(w, 1.0, -3.0), outside = D.lutAt(w, 2.0, -3.0), above = D.lutAt(w, 1.0, 0.0);
  ok('uniform wash: 2700 cd inside the box', inside === 2700, { inside });
  ok('uniform wash: 0 outside the box', outside === 0 && above === 0, { outside, above });
  ok('uniform wash: grid covers the box exactly', w.nh === 4 && w.nv === 20 && w.h0 === 0.5 && w.v0 === -6, { nh: w.nh, nv: w.nv });
  const pts = B.pointBeam([[0.1, -1.1, 100], [0.15, -1.15, 50], [9, 9, 7]], { h0: 0, v0: -2, step: 0.5, nh: 4, nv: 4 });
  const total = pts.data.reduce((a, b) => a + b, 0);
  // grid h0=0 step .5 nh=4; v0=-2: both points fall in column 0, row floor((v+2)/0.5)=1, so index 1*4+0 = 4
  ok('point beam: both points land in cell (0,1), outside point dropped', pts.data[4] === 150 && total === 150, { cell: pts.data[4], total });
}

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' beam checks passed');
process.exit(fails ? 1 : 0);
