// le-chonk (10-30): node test for the two options this change adds — driveScrub (backlog 6-L, time scrubber,
// drive-anim.js drive bar) and wetVeil (backlog 4-N, wet-road mirror sources in the glare veil, drive.js
// glareSources). OFF must behave exactly as before. Run: node tests/le-chonk-scrub-veil.js — exits 1 on failure.
const { load } = require('./load.js'); const RF = load(); const O = RF.Options, D = RF.Drive;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); if (!cond) fails++; };

// ---- registry: declared once, default OFF, in DV_DEF ----
for (const id of ['driveScrub', 'wetVeil']) {
  const hits = O.OPTIONS.filter((e) => e.id === id);
  ok(id + ' declared exactly once', hits.length === 1, hits.length);
  ok(id + ' is a profile bool default false', hits.length === 1 && hits[0].kind === 'profile' && hits[0].type === 'bool' && hits[0].default === false, hits[0] && { kind: hits[0].kind, type: hits[0].type, def: hits[0].default });
  ok(id + ' in defaults() as false', O.defaults()[id] === false, O.defaults()[id]);
  ok(id + ' control declared once', hits.length === 1 && typeof hits[0].control === 'string', hits[0] && hits[0].control);   // control string normalized to [data-dv=...] by the 10-30 RN landing; the drive-bar slider itself stays [data-anim="scrub"] in drive-anim.js bars()
}
ok('wetVeil requires wet + wetSheen (rule names exist)', (O.byId.wetVeil.requires || []).every((r) => O.RULES[r.rule]), (O.byId.wetVeil.requires || []).map((r) => r.rule));

// ---- glareSources: OFF = direct only; ON = mirrored road sources appended ----
const eye = [-2, 0.37, 1.2];
const car = { x: 98, y: 0.5, z: 0.7, nx: -1, ny: 0, nz: 0, headlamp: true, emit: [20000, 19000, 18000], r: 0.3, emitPow: 1 };
const high = { x: 60, y: 0, z: 8, nx: -1, ny: 0, nz: 0, headlamp: true, emit: [50000, 50000, 50000], r: 0.4, emitPow: 1 };   // a lamp 8 m up: its mirror lands well below the horizon
const objs = [car, high], opts = { lights: [] };
const off = D.glareSources(objs, eye, [], opts);
const on = D.glareSources(objs, eye, [], Object.assign({ wetVeil: true, wetness: 1, wetSheen: true }, opts));
ok('OFF: two direct sources, both above/near the horizon', off.length === 2 && off.every((q) => q[2] > -0.05), off.map((q) => +q[2].toFixed(3)));
ok('ON: more sources than OFF (mirrors added)', on.length === off.length * 2, { off: off.length, on: on.length });
const mirrors = on.filter((q) => q[2] < -0.05);
ok('ON: the high lamp\'s mirror points below the horizon (road plane reflection)', mirrors.length >= 1 && mirrors.some((q) => q[2] < -0.08), mirrors.map((q) => +q[2].toFixed(3)));
ok('ON: every direct source is still present', off.every((q) => on.some((p) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9 && Math.abs(p[3] - q[3]) < 1e-12)), { off: off.length });
ok('ON: mirror weight scales with wetness (damp 0.4 < wet 1), Fresnel in (0,1)', (() => {
  const damp = D.glareSources(objs, eye, [], Object.assign({ wetVeil: true, wetness: 0.4, wetSheen: true }, opts));
  const mw = on.filter((q) => q[2] < -0.05).reduce((a, q) => a + q[3], 0), dw = damp.filter((q) => q[2] < -0.05).reduce((a, q) => a + q[3], 0);
  return mw > 0 && dw > 0 && Math.abs(dw / mw - 0.4) < 0.02;
})(), {});
ok('ON: cap still 32 (mirrors compete with faint direct sources, sorted by weight)', on.length <= 32, on.length);
ok('wetVeil without wetSheen adds nothing (OFF-identical)', D.glareSources(objs, eye, [], Object.assign({ wetVeil: true, wetness: 1, wetSheen: false }, opts)).length === off.length, {});

// ---- veil math consumes the mirrors unchanged (veilAt sums strengths; no shader/CPU change needed) ----
const down = [Math.cos(-20 * Math.PI / 180), 0, Math.sin(-20 * Math.PI / 180)];   // 20 deg below horizon, road ahead
const vOff = D.veilAt(down, off), vOn = D.veilAt(down, on);
ok('veilAt below horizon grows with wetVeil on (the wet streak glow)', vOn > vOff, { off: +vOff.toFixed(5), on: +vOn.toFixed(5) });

process.exit(fails ? 1 : 0);
