// Model observations, not measurements of a real eye/lamp. node tests/bench/QOL1-optics.js
const RF = require('../load.js').load(), D = RF.Drive, A = RF.DriveAnim, rows = [];
for (const dist of [400, 200, 100, 80, 50, 35, 20]) {
  const sc = D.buildScene('road', { Lw: 3.5 }, { people: false, animals: false, signs: false, oncoming: { dist, kcd: 30 } });
  D.Headlamp.apply(sc.objects, { mode: 'high' });
  const src = D.glareSources(sc.objects, A.EYE), veil = D.veilAt([1, 0, 0], src), eyeLux = src.reduce((a, q) => a + q[3], 0);
  rows.push({ carCentreM: dist, eyeLux, anglesDeg: src.map(q => Math.acos(q[0]) * 180 / Math.PI), veilCdM2: veil, fixedWhiteEv1: 5, adaptWhiteEv1: 5 + veil, exposureDrop: (5 + veil) / 5, dryLowDrop: (5 + .5 * veil) / 5 });
}
const materials = ['car-paint', 'win-dark', 'tyre', 'plate', 'reflector-red'].map(k => ({ key: k, ...D.MAT_DEF[k] }));
const cutoff = [];
for (const mountH of [.65, .75]) for (const slope of [0, -.004, -.01]) for (const distance of [20, 35, 50]) cutoff.push({ mountH, slopePct: slope * 100, distance, heightM: mountH + slope * distance });
console.log(JSON.stringify({ rows, glarePresets: Object.fromEntries(Object.keys(D.GLARE).map(k => [k, { bloom: D.glareStrength(k), veil: D.veilStrength(k) }])), materials, cutoff }, null, 2));
