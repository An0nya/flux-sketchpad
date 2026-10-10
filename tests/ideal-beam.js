// Ideal-beam goals (headless): node tests/ideal-beam.js — exits 1 on failure.
// One synthetic beam built to meet every default goal, then broken one way at a time: exactly that goal must fail.
const { load } = require('./load.js'); const RF = load(); const B = RF.IdealBeam;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
// a flat-topped blob (super-Gaussian): level c, centre (h0, v0), half-sizes sh × sv
const pl = (c, h0, v0, sh, sv, p = 8) => (h, v) => c * Math.exp(-Math.pow(Math.abs((h - h0) / sh), p) - Math.pow(Math.abs((v - v0) / sv), p));
const parts = {   // combined by MAX, not sum, so each part sets its own level (peak = the hotspot's 40 kcd)
  hot: pl(40000, 2.5, -1.45, 2.7, 0.75),                                  // hotspot pool, 0…5° R, top ≈ 0.7° D
  left: pl(30000, -1.5, -1.1, 1.6, 0.5),                                  // 3L → 0 fill under the line
  wash: pl(15000, 0, -2.4, 13, 1.6, 6),                                   // wash ±13°, 0.8–4° D (the tests set washW 12; the box is 0.75–2.25° D, below the streak)
  nearL: pl(4000, -16.5, -1.9, 3, 0.7),                                   // the IIHS left edge at ~15 m
  streak: pl(13000, 9, -0.75, 6.3, 0.8),                                  // the right-side streak along the horizon, 2.5–15° R
};
const beam = (over) => { const p = Object.assign({}, parts, over); return (h, v) => Math.max(...Object.values(p).map((f) => f(h, v))); };
const md = { preset: 'ece-r112-b', ideal: { washW: 12 } };
const mdOf = (ideal) => ({ preset: 'ece-r112-b', ideal: Object.assign({ washW: 12 }, ideal) });
const run = (I, m) => B.check(I, m || md, RF.Road.model({ road: RF.Road.defaults(), preset: 'ece-r112-b', I }));
const failed = (r) => r.goals.filter((g) => !g.met).map((g) => g.key);

const base = run(beam({}));
ok('the built beam meets every default goal', base.met === base.n && base.n === 10, base.met + '/' + base.n + ' ' + failed(base).join(',') + ' | ' + base.goals.map((g) => g.key + '=' + g.value).join(' '));
const cases = [
  [['hotTop'], 'hotspot dropped 1.25° lower', { hot: pl(40000, 2.5, -2.7, 2.7, 0.75) }],
  [['hotContrast'], 'hotspot flattened into the wash (a flat band)', { hot: pl(17000, 2.5, -1.45, 2.7, 0.75), left: pl(16000, -1.5, -1.1, 1.6, 0.5) }],
  [['wash', 'washHoles'], 'wash dimmed to a third (a dim wash is also a holey one)', { wash: pl(5000, 0, -2.4, 13, 1.6, 6) }],
  [['washHoles'], 'wash cut into strips (40 % dark)', { wash: (h, v) => pl(20000, 0, -2.4, 13, 1.6, 6)(h, v) * (Math.cos(Math.PI * h / 2) > -0.3 ? 1 : 0) }],
  [['fill3L'], 'no light toward 3L', { left: () => 0 }],
  [['foreground'], 'a big foreground flood below 4° D', { fg: pl(15000, 0, -7, 15, 2.5, 4) }],
  [['strayLow'], 'a lobe at 10° L 6° D as bright as the hotspot', { stray: pl(40000, -10, -6, 1, 1, 2) }],
  [[], 'a lobe at 10° L 2.5° D (in the band): info only, no goal fails', { stray: pl(40000, -10, -2.5, 1, 0.6, 2) }],
  [['nearLeft'], 'no light at the near-left edge', { nearL: () => 0 }],
  [['streak'], 'no streak along the right horizon', { streak: () => 0 }],
  [['hotPos'], 'a brighter knot at 4.75° R 1° D, up the 15° rise (where SQM\'s peaks went)', { knot: pl(46000, 4.75, -1.0, 0.6, 0.4) }],
];
for (const [keys, what, over] of cases) {
  const r = run(beam(over)), f = failed(r);
  ok(what + ' → ' + (keys.length ? 'only ' + keys.join(' + ') + ' fail' : 'nothing fails'), f.length === keys.length && keys.every((k) => f.includes(k)), 'failed: ' + (f.join(', ') || 'none'));
}
// graded wash holes: full credit at ≤ 30 %, none from 60 %, linear between
{ const strips = run(beam({ wash: (h, v) => pl(20000, 0, -2.4, 13, 1.6, 6)(h, v) * (Math.cos(Math.PI * h / 2) > -0.3 ? 1 : 0) })), g = strips.goals.find((x) => x.key === 'washHoles');
  const want = Math.max(0, Math.min(1, (0.6 - g.value) / 0.3));   // g.value is rounded to 0.01 → ≤ 0.017 of credit
  ok('wash holes credit is graded between 30 % and 60 %', Math.abs(g.credit - want) < 0.02 && g.credit > 0 && g.credit < 1, 'holes ' + g.value + ' → credit ' + g.credit);
  ok('score = Σ credit', Math.abs(strips.score - strips.goals.reduce((a, x) => a + x.credit, 0)) < 0.01, 'score ' + strips.score); }
{ const r = run(beam({ stray: pl(40000, -10, -2.5, 1, 0.6, 2) })), i = r.info.find((x) => x.key === 'strayBand');
  ok('a band side lobe shows up as info', i && i.value > 0.8, i ? i.text : 'missing'); }
// knobs reach the check: switching a goal off removes it; a looser cap passes the flood
{ const r = run(beam({ nearL: () => 0 }), mdOf({ nearLeft: 0 }));
  ok('nearLeft 0 = no near-left goal', !r.goals.some((g) => g.key === 'nearLeft') && r.met === r.n, r.met + '/' + r.n); }
{ const I = beam({ fg: pl(15000, 0, -7, 15, 2.5, 4) }), r0 = run(I), cap = r0.goals.find((g) => g.key === 'foreground').value, r = run(I, mdOf({ fgCap: cap + 0.01 }));
  ok('raising fgCap above the flood passes it', r.goals.find((g) => g.key === 'foreground').met, 'share ' + cap); }
// reach goals appear only when set
{ const r = run(beam({}), mdOf({ reachR: 500 })); const g = r.goals.find((x) => x.key === 'reachR');
  ok('reachR 500 m → a failing right-reach goal', g && !g.met, g ? g.text : 'missing'); }

if (require.main === module) { console.log(fails ? fails + ' FAILED' : 'all passed'); process.exitCode = fails ? 1 : 0; }
