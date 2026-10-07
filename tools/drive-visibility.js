// How visible are people and deer under each design?  node tools/drive-visibility.js outdir name=scene.json [name=scene.json …] [--rays 8e6]
// Traces each design, then (1) prints the chest-height luminance of a dark / light / hi-vis pedestrian at 30, 60 and 100 m and the deer's body
// and eyeshine, from the same beam lookup the Drive view uses, and (2) writes contact sheets (road, forest, intersection, high beam with traffic).
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load.js'); const RF = load(); const lib = require('./drive-lib.js'); const D = RF.Drive;
const out = process.argv[2], N = (() => { const i = process.argv.indexOf('--rays'); return i > 0 ? +process.argv[i + 1] : 8e6; })();
const designs = process.argv.slice(3).filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => { const [name, file] = a.split('='); return { name, file }; });
fs.mkdirSync(out, { recursive: true });
const rows = [], pics = {};
for (const d of designs) {
  const sc = RF.State.deserialize(fs.readFileSync(d.file, 'utf8')), tr = lib.traceScene(RF, sc, N), L = lib.lookupOf(RF, sc, tr, 0.5, 0.15);
  // standard targets on a straight road: three pedestrians per distance in three lateral slots, a deer at 60 and 100 m
  const eR = -L.lane / 2, eL = 1.5 * L.lane, W = 1920, H = 1080, tanH = Math.tan(30 * Math.PI / 180), tanV = tanH * H / W, eye = [-2, 0.37, 1.2];
  const slots = { dark: eR - 1.5, light: eL + 1.5, hivis: eL + 5.0 };
  const T = []; for (const s of [30, 60, 100]) for (const kind of ['dark', 'light', 'hivis']) T.push({ kind, s, off: slots[kind] });
  const probeScene = D.buildScene('targets', { Lw: L.lane, us: L.us, targets: T, deer: [60, 100] }, { people: false, animals: false, signs: false });
  const res = D.render({ w: W, h: H, hfov: 60, eye, lamps: L.lamps, lut: L.lut, conv: L.conv, arc: null, lane: L.lane, scene: probeScene, look: { RL: 0.2 } });
  const at = (X, Y, Z) => { const dx = X - eye[0], dy = Y - eye[1], dz = Z - eye[2], u = -dy / dx / tanH, v = dz / dx / tanV; return D.probe(res, (u + 1) / 2 * W, (1 - v) / 2 * H); };
  const row = { design: d.name, I: {}, verdict: tr.ev.verdict + ' ' + JSON.stringify(tr.ev.n) };
  for (const t of T) { const p = at(t.s, t.off, t.kind === 'hivis' ? 1.29 : 1.2); row.I[t.kind + '@' + t.s] = p.L; }   // hi-vis: the tape band (z 1.26–1.32), which is what makes it visible
  for (const s of [30, 60, 100]) row.I['road@' + s] = at(s, 0, 0).L;
  for (const s of [60, 100]) { const off = eL + 3.5, p = at(s, off, 0.95); row.I['deer@' + s] = p.L; }
  rows.push(row); fs.appendFileSync(path.join(out, 'visibility.jsonl'), JSON.stringify(row) + '\n');
  pics[d.name] = {
    road: lib.picture(RF, L, 'road', 'straight', {}), forest: lib.picture(RF, L, 'forest', 'straight', {}),
    inter: lib.picture(RF, L, 'intersection', 'straight', {}), traffic: lib.picture(RF, L, 'road', 'straight', { oncoming: { dist: 110, kcd: 30 }, preceding: { dist: 55 } }),
  };
  console.log('done ' + d.name + ' (' + row.verdict + ')');
}
const f = (x) => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x >= 0.01 ? x.toFixed(3) : x.toExponential(0));
console.log('\nluminance at chest height, cd/m² (diffuse surface; hi-vis = vest + tape) — and bare asphalt in the lane centre:');
const keys = ['dark@30', 'dark@60', 'dark@100', 'light@30', 'light@60', 'light@100', 'hivis@30', 'hivis@60', 'hivis@100', 'deer@60', 'deer@100', 'road@30', 'road@60', 'road@100'];
console.log(['design'.padEnd(26)].concat(keys.map((k) => k.padStart(9))).join(' '));
for (const r of rows) console.log([r.design.padEnd(26)].concat(keys.map((k) => f(r.I[k]).padStart(9))).join(' '));
for (const [tag, key, cols] of [['low-road', 'road', 2], ['low-intersection', 'inter', 2], ['low-forest', 'forest', 2]]) {
  const set = designs.filter((d) => !/ub2|drive/i.test(d.name)).map((d) => pics[d.name][key]); if (set.length) { const sh = lib.sheet(set, cols); fs.writeFileSync(path.join(out, 'sheet-' + tag + '.png'), lib.png(sh.w, sh.h, sh.px)); }
}
for (const [tag, key, cols] of [['high-road', 'road', 2], ['high-traffic', 'traffic', 2], ['high-intersection', 'inter', 2]]) {
  const set = designs.filter((d) => /ub2|drive/i.test(d.name)).map((d) => pics[d.name][key]); if (set.length) { const sh = lib.sheet(set, cols); fs.writeFileSync(path.join(out, 'sheet-' + tag + '.png'), lib.png(sh.w, sh.h, sh.px)); }
}
