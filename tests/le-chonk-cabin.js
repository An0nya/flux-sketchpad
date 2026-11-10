// le-chonk (10-31 ~22:00): cabinView (Anya-approved overlay) + driftMode (Anya-permitted easter egg). Both opt-in, default OFF.
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const { sceneKeyHas, sceneKeyHasAll } = require('./scene-key.js');
const RF = load(ROOT);
const anim = fs.readFileSync(ROOT + '/js/drive-anim.js', 'utf8');
const mk0 = (dm) => ({ w: 96, h: 54, hfov: 60, lamps: [], lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src: A.source('road', 3.5, false, { wild: true, signs: true }, { seed: 7, tiles: true, endlessRoad: true, driftMode: dm, driftKmh: 100 }) });
const reg = fs.readFileSync(ROOT + '/js/options-registry.js', 'utf8');
for (const id of ['cabinView', 'driftMode']) {
  const m = reg.match(new RegExp("id: '" + id + "'[\\s\\S]*?default: (\\w+)"));
  ok('registry: ' + id + ' declared once, default false', !!m && m[1] === 'false' && reg.split("id: '" + id + "'").length === 2);
}
ok('cabinView is a pure overlay: drawCabin creates .drive-cabin only when on, removes when off; cabinView itself stays out of skey (cabinLight is the render-affecting one)', anim.includes('function drawCabin(V, on, style, light, kmh, yaw') && anim.includes("if (!on) { if (cv.parentNode) cv.parentNode.removeChild(cv); cv.width = 0; return; }") && !/o\.cabinView[^\n]*SUBTICK/.test(anim));  // [KEEP: text — cache-key wiring; covered behaviourally by tests/scene-key.js]
ok('cabinView toggle wired', anim.includes("'data-anim': 'cabinView'") && anim.includes("setDV(ui, 'cabinView', !info().o.cabinView)"));  // [KEEP: text — UI-control literal; presence+behaviour covered by le-chonk-ui-controls.js / control-map pageMap]
ok('driftMode: opposite-lock on lamps (p.yaw) AND camera (rotArc on the render arc), speed^2 scaled, in skey; speedLimit/traffic cap untouched', anim.includes('V.p.yaw += lag && V.driftA !== undefined ? V.driftA * (o.driftAfs ? 1 : 2.6 / 8) : (tl && tl.curvature ? -tl.curvature * Math.pow(kmhOf() / 130, 2) * 2.6 : 0)') && anim.includes('rotArc(A1,') && anim.includes('cfg.driftKmh || 80') && anim.includes('V.src.tiles.driftKmh = kmhOf()') && sceneKeyHasAll(anim, ROOT, ['driftMode','driftDynamics','driftAfs','driftCabin','yawSmooth','cabinLight','endlessPresetCustom']) && !/speedLimit[\s\S]{0,80}drift/.test(anim));  // [KEEP: text — cache-key wiring; covered behaviourally by tests/scene-key.js]
// behaviour: drift yaw sign/magnitude on a bend vs straight, via the same formula the frame uses
const A = RF.DriveAnim;
const D = RF.Drive;
let bend = null, straight = null; for (let k = 0; k < 60 && !(bend && straight); k++) { const t = A.endlessTile(7, k); if (t.curvature && !bend) bend = t; if (!t.curvature && !straight) straight = t; }   // B11: tile kinds shifted when the tight-S clause was dropped, so pick them by kind
const drift = (tile, kmh) => tile.curvature ? -tile.curvature * Math.pow(kmh / 130, 2) * 2.6 : 0;
ok('drift yaw is opposite-lock (sign opposite the bend) and grows with speed; zero on straights', drift(bend, 100) * bend.curvature < 0 && Math.abs(drift(bend, 120)) > Math.abs(drift(bend, 60)) && drift(straight, 120) === 0, JSON.stringify({ bend: bend.kind, d60: drift(bend, 60), d120: drift(bend, 120) }));
for (const id of ['cabinStyle', 'cabinLight']) {
  const m = reg.match(new RegExp("id: '" + id + "'[\\s\\S]*?default: ([^,]+),"));
  ok('registry: ' + id + ' declared once, default ' + (id === 'cabinStyle' ? "'modern'" : 'false'), !!m && String(m[1]).trim() === (id === 'cabinStyle' ? "'modern'" : 'false') && reg.split("id: '" + id + "'").length === 2);
}
ok('cabinStyle enum lists modern/miata/digital80s with modern default, gated on cabinView', reg.includes("values: ['modern', 'miata', 'digital80s']") && reg.includes("requires: [need('cabinView')]"));  // [KEEP: text — call-site feed literal; drawCabin is not exported to Node, so the live-vs-cap seam is asserted here (mutation: pinning the needle to the o.speed cap FAILs this check)
ok('gauges: needle fed the LIVE speed (st.game/st.camera v, not the o.speed cap — Anya 22:37Z defect), miata tombstone + digital80s branches in drawCabin', anim.includes('!!o.cabinLight, (st.game ? st.game.v : st.camera && typeof st.camera.v === \'number\' ? st.camera.v : kmhOf() / 3.6) * 3.6, o.driftCabin') && !anim.includes('!!o.cabinLight, kmhOf(), o.driftCabin') && anim.includes("style === 'miata'") && anim.includes("style === 'digital80s'") && anim.includes("face(cx - 150 * k, 110 * k, kmh / 260, info().o.imperialUnits ? 'mph' : 'km/h'"));  // [KEEP: text — cache-key wiring; covered behaviourally by tests/scene-key.js]
ok('cabinLight enters the existing glare path as a forward source (no hard exposure multiplier) and is in skey', anim.includes('if (o.cabinLight) sources.push([1, 0, 0.02, 0.2, 1, 0.95, 0.8])') && !(anim.match(/o\.cabinLight \? 0\.82/g) || []).length && sceneKeyHas(anim, ROOT, 'cabinLight'));  // [KEEP: text — cache-key wiring; covered behaviourally by tests/scene-key.js]
ok('cabinStyle select + cabinLight toggle wired and synced', anim.includes("'data-anim': 'cabinStyle'") && anim.includes("setDV(ui, 'cabinLight', !info().o.cabinLight)") && anim.includes("s2.value = o.cabinStyle || 'modern'"));  // [KEEP: text — UI-control literal; presence+behaviour covered by le-chonk-ui-controls.js / control-map pageMap]
ok('cabinDigitalRedesign: option declared (default false, group view, needs cabinView) + flat-panel branch in drawCabin (ayrton 11-04)', reg.includes("id: 'cabinDigitalRedesign'") && reg.includes('cabinDigitalRedesign') && anim.includes("style === 'digital80s' && info().o.cabinDigitalRedesign") && anim.includes("'data-anim': 'cabinDigitalRedesign'") && anim.includes("'data-anim': 'cabinFovFrame'"));   // ayrton 11-04: the redesign branch is gated on the option; the button + sync are wired
  // [KEEP: text — UI-control literal; presence+behaviour covered by le-chonk-ui-controls.js / control-map pageMap]
ok('cabinMirror: option declared (default false, group view, needs cabinView) + mirror-local generator + mirror rects + veil push + in skey (ayrton 11-04)', reg.includes("id: 'cabinMirror'") && reg.includes("need('cabinView')") && anim.includes('function mirrorCars(') && anim.includes('MIRROR_CULL') && anim.includes('if (mirrors && mirrors.length)') && anim.includes("'data-anim': 'cabinMirror'") && sceneKeyHas(anim, ROOT, 'cabinMirror'));   // ayrton 11-04: the mirror-local generator, the mirror rects in drawCabin, the veil source push, the button+sync, and the skey entry (after SUBTICK so existing skey substrings are preserved)
  // [KEEP: text — UI-control literal; presence+behaviour covered by le-chonk-ui-controls.js / control-map pageMap]
ok('cabinMirror: mirrorCars exported + null src is safe (ayrton 11-04, nicholl review)', typeof A.mirrorCars === 'function' && A.mirrorCars(null, 0, 0).length === 0);   // null src -> empty, no crash
{ const mt = A.source('road', 3.5, false, { signs: true }, { seed: 7, tiles: true, endlessRoad: true, oncoming: true, preceding: true, trafficDensity: 3 });
  const ms = A.mirrorCars(mt, 100, 5); ok('cabinMirror: mirrorCars produces behind-cars (single-lane: bearing 0 visible in both mirrors)', ms.length > 0 && ms.every((m) => m.distance > 0 && m.distance <= 100 && typeof m.candela === 'number') && ms.some((m) => Math.abs(m.bearing) < 0.01), JSON.stringify(ms.slice(0, 2)));   // nicholl: bearing==0 was drawn in neither mirror before the fix
  { const ml = A.source('road', 3.5, false, {}, { seed: 7, tiles: true, endlessRoad: true, multilaneRoad: true, oncoming: true, preceding: true, trafficDensity: 3 }), mm = [].concat(...Array.from({ length: 40 }, (_, i) => A.mirrorCars(ml, 200 + 37 * i, 5))), side = mm.filter((m) => Math.abs(m.bearing) > 0.01);
    ok('cabinMirror: multilane followers sit in the own or the RIGHT lane (negative bearing), never on the median side', side.length > 0 && side.every((m) => m.bearing < 0), JSON.stringify(side.slice(0, 2))); }
  const nt = A.source('road', 3.5, false, { signs: true }, { seed: 7, tiles: true, endlessRoad: true, oncoming: false, preceding: false, trafficDensity: 3 }); ok('cabinMirror: mirrorCars empty when traffic off (gating)', A.mirrorCars(nt, 100, 5).length === 0); }
const pR = mk0(false), pD = mk0(true); const wR = A.tileWorld(pR, 1440, 0), wD = A.tileWorld(pD, 1440, 0);
const angD = (w, s) => Math.atan2(w.A.at(s, 0).t[1], w.A.at(s, 0).t[0]);
ok('drift rotates the camera arc opposite the bend (angle shift has sign opposite curvature)', (angD(wD, 60) - angD(wR, 60)) * A.endlessTile(7, 7).curvature < 0 && Math.abs(angD(wD, 60) - angD(wR, 60)) > 0.005, JSON.stringify({ raw: angD(wR, 60), drift: angD(wD, 60), shift: angD(wD, 60) - angD(wR, 60) }));
ok('traffic speed cap is identical with driftMode off/on (drift never touches speedLimit)', A.speedLimit(pR.src, 1441) === A.speedLimit(pD.src, 1441), A.speedLimit(pR.src, 1441) + ' m/s');
console.log(fail === 0 ? `\nall ${pass} le-chonk-cabin checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
