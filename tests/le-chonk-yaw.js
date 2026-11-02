// le-chonk (10-31 ~22:30): yawSmooth — opt-in lookahead-averaged tangent arc; OFF = the shipped arc untouched.
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, A = RF.DriveAnim;
const anim = fs.readFileSync(ROOT + '/js/drive-anim.js', 'utf8');
const reg = fs.readFileSync(ROOT + '/js/options-registry.js', 'utf8');
const m = reg.match(/id: 'yawSmooth'[\s\S]*?default: (\w+)/);
ok('registry: yawSmooth declared once, default false', !!m && m[1] === 'false' && reg.split("id: 'yawSmooth'").length === 2);
ok('smoothArc wraps the arc (Object.create delegation) and averages tangents over [-8, +36]', anim.includes('function smoothArc(A, look = 36, back = 8)') && anim.includes('Object.create(A)') && anim.includes('for (let d = -back; d <= look; d += 4)'));
ok('OFF: A = A1 unchanged (no wrapper)', anim.includes('A = cfg.yawSmooth ? smoothArc(A1) : A1'));
ok('wiring: src.tiles.yawSmooth, skey, tkey, toggle, aria sync', anim.includes('yawSmooth: !!o.yawSmooth,') && anim.includes('!!o.driftMode, !!o.driftDynamics, !!o.driftAfs, !!o.driftCabin, !!o.yawSmooth, !!o.cabinLight, o.tiles ? o.endlessPresetCustom || \'\' : \'\', SUBTICK') && anim.includes("'data-anim': 'yawSmooth'") && anim.includes("q('[data-anim=\"yawSmooth\"]')"));
// behaviour: seed 7, the 150R bend in tile k=7 starts ~40 m into the tile (abs s ~1440); at the join the raw tangent
// snaps, the smoothed one is averaged over [-8, +36] so right after the join it lies strictly between 0 and raw.
const mk = (ys) => { const src = A.source('road', 3.5, false, { wild: true, signs: true }, { seed: 7, tiles: true, endlessRoad: true, yawSmooth: ys }); return { w: 96, h: 54, hfov: 60, lamps: [], lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src }; };
const wRaw = A.tileWorld(mk(false), 1400, 0), wSm = A.tileWorld(mk(true), 1400, 0);
const ang = (w, s) => Math.atan2(w.A.at(s, 0).t[1], w.A.at(s, 0).t[0]);
const rawJoin = ang(wRaw, 55), smJoin = ang(wSm, 55), rawDeep = ang(wRaw, 120), smDeep = ang(wSm, 120), rawStraight = ang(wRaw, -40), smStraight = ang(wSm, -40);
ok('smoothed tangent at s == raw tangent ~14 m ahead (window midpoint): the camera starts turning before the join', Math.abs(smJoin - ang(wRaw, 69)) < 0.01 && rawJoin < -0.02, JSON.stringify({ rawJoin, smJoin, raw69: ang(wRaw, 69) }));
ok('deep in the bend smoothed == raw at window midpoint (same shift)', Math.abs(smDeep - ang(wRaw, 134)) < 0.01, JSON.stringify({ rawDeep, smDeep, raw134: ang(wRaw, 134) }));
ok('on the straight before the join both are ~0 (no change on straights)', Math.abs(rawStraight) < 1e-9 && Math.abs(smStraight) < 1e-6, JSON.stringify({ rawStraight, smStraight }));
ok('delegation: wrapper proxies tiles/frame to the real arc', Array.isArray(wSm.A.tiles) && typeof wSm.A.frame === 'function' && Object.getPrototypeOf(wSm.A) !== Object.prototype && wSm.A.at !== wRaw.A.at);
console.log(fail === 0 ? `\nall ${pass} le-chonk-yaw checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
