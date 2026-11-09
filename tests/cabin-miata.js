// claude (11-08, Anya: photo NA Miata cabin): cabinStyle 'miata' draws the NA photo (js/cabin-miata.js); cabinGaugeLight (new, default 'off') backlights its gauges.
// Checks: the registry entry and its plumbing, the module is Node-safe, and the pure maths: dial angles, speed -> needle, gear and rpm from
// speed, the lighting curve, and the dash glow (zero with no oncoming light, monotonic in the oncoming illuminance from D.glareSources).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const RF = load();
const D = RF.Drive, Opt = RF.Options;
const M = require(path.join(ROOT, 'js/cabin-miata.js'));
const pngOrWarn = (src) => { const p = path.join(ROOT, src); if (!fs.existsSync(p)) { console.log('[warn] asset missing: ' + src + ' — photo cabin falls back to the vector tombstone until the host commits it'); return null; } return fs.readFileSync(p); };
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8'), reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- the option
const e = Opt.OPTIONS.find((x) => x.id === 'cabinGaugeLight');
ok('registry: cabinGaugeLight declared once, enum off/dim/normal/bright, default off, group view', !!e && reg.split("id: 'cabinGaugeLight'").length === 2 && JSON.stringify(e.values) === '["off","dim","normal","bright"]' && e.default === 'off' && e.group === 'view' && e.kind === 'profile');
ok('registry: the cabin options are appended at the END of the list, in order (rule 13; the frenchie last-entry pins were re-pointed to cabinOffsetY)', Opt.OPTIONS.slice(-4).map((e) => e.id).join() === 'cabinGaugeLight,cabinZoom,cabinOffsetX,cabinOffsetY');
ok('registry: needs cabinView and the miata style', !!e && e.requires.length === 2 && /cabinView/.test(JSON.stringify(e.requires)) && /cabinStyle/.test(JSON.stringify(e.requires)));
ok('DV_DEF carries cabinGaugeLight: off', Opt.defaults().cabinGaugeLight === 'off');
ok('UI: select with a label per option, setDV on change, synced and disabled unless cabinView + miata', anim.includes("'data-anim': 'cabinGaugeLight'") && anim.includes("'gauge light: ' + v") && anim.includes("setDV(ui, 'cabinGaugeLight', cgl.value)") && anim.includes("s2.disabled = !o.cabinView || o.cabinStyle !== 'miata'"));
ok('index.html loads js/cabin-miata.js before drive-anim.js', html.indexOf('js/cabin-miata.js') > 0 && html.indexOf('js/cabin-miata.js') < html.indexOf('js/drive-anim.js'));
ok('gate: NODE registers this test and MAP routes js/cabin-miata.js to it', /'cabin-miata'\]/.test(gate) && gate.includes("[/^js\\/cabin-miata\\.js$/, ['node:cabin-miata'"));
ok('asset is a PNG under 1.5 MB when present (warn-and-pass while the host has not committed img/cabin/miata-wide.png — the photo cabin falls back to the vector tombstone by design)', (() => { const p = path.join(ROOT, M.SRC); if (!fs.existsSync(p)) { console.log('[warn] asset missing: ' + M.SRC + ' — photo cabin falls back to the vector tombstone until the host commits it'); return true; } const b = fs.readFileSync(p); return b.slice(1, 4).toString() === 'PNG' && b.length < 1.5e6; })());

// ---- wiring in drive-anim
const iSrc = anim.indexOf('const gOpts = glareOpts(o, placed)'), iCall = anim.indexOf("drawCabin(V, o.cabinView && (st.popout || ui.display === 'drive')");
ok('drawCabin runs after this frame\'s glare sources (the dash glow reads this frame\'s oncoming light)', iSrc > 0 && iCall > iSrc && anim.includes('_mc, _cabE);'));
ok('oncoming light = D.glareSources on headlamps only, no street lamps, no wet mirrors', anim.includes('.filter((ob) => ob.headlamp)') && anim.includes('{ lights: [], wetVeil: false }') && anim.includes('.reduce((e, q) => e + q[3], 0)'));
ok('photo path is gated on the miata style and falls back to the vector tombstone until loaded', anim.includes("photo = style === 'miata' && !!CM && CM.ready(") && anim.includes("face(cx - 150 * k, 110 * k, kmh / 260"));

// ---- Node safety: no DOM at load, not ready, draw refuses
ok('module loads in Node (no Image): ready() is false, draw() returns false', M.ready() === false && M.draw(null, {}) === false && RF.CabinMiata === M);

// ---- backlight: off is 0 (OFF = gauges lit only by the cabin level), the rest increase
ok('backlight: off/unknown = 0, dim < normal < bright <= 1', M.backlight('off') === 0 && M.backlight(undefined) === 0 && M.backlight('x') === 0 && M.backlight('dim') > 0 && M.backlight('dim') < M.backlight('normal') && M.backlight('normal') < M.backlight('bright') && M.backlight('bright') <= 1);

// ---- dials
const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-9);
ok('dial: 0 at lower left (135 deg), full at lower right (405 deg), clamped', near(M.dialAngle(0), 0.75 * Math.PI) && near(M.dialAngle(1), 2.25 * Math.PI) && near(M.dialAngle(-1), M.dialAngle(0)) && near(M.dialAngle(2), M.dialAngle(1)) && near(M.dialAngle(0.5), 1.5 * Math.PI));
ok('speedo: full scale 140 MPH (= 225.3 km/h) as on the NA cluster; 70 MPH at half', near(M.speedFrac(0), 0) && near(M.speedFrac(70 / 0.621371), 0.5, 1e-9) && near(M.speedFrac(140 / 0.621371), 1, 1e-9) && M.SPEEDO.mph === 140);
ok('speedo: the needle depends on the speed only (the unit setting swaps the rings, not the needle)', [30, 80, 130, 200].every((k) => M.speedFrac(k, true) === M.speedFrac(k, false)) && anim.includes('zoom: +o.cabinZoom || 1') && /imperial \? \{ f: fM, top: 140/.test(fs.readFileSync(path.join(ROOT, 'js/cabin-miata.js'), 'utf8')));
{ let mono = true, prev = -1; for (let k = 0; k <= 260; k += 1) { const f = M.dialAngle(M.speedFrac(k, false)); if (f < prev) mono = false; prev = f; } ok('speedo needle angle is monotonic in speed', mono); }

// ---- gears and rpm (hand formula, independent of the module's helper)
const hand = (kmh, g) => kmh / 3.6 / 1.815 * 60 * [3.136, 1.888, 1.330, 1.000, 0.814][g - 1] * 4.3;
ok('rpm: idle (850) when stopped, gear 0', M.rpmFor(0) === 850 && M.gearFor(0) === 0);
ok('rpm: 100 km/h in 5th = ' + Math.round(hand(100, 5)) + ' rpm (hand formula)', M.gearFor(100) === 5 && near(M.rpmFor(100), hand(100, 5), 1e-6));
ok('rpm: 50 km/h in 3rd, 20 km/h in 1st', M.gearFor(50) === 3 && M.gearFor(20) === 1 && near(M.rpmFor(50), hand(50, 3), 1e-6));
{ let mono = true, under = true, inRange = true, prevG = 0; for (let k = 1; k <= 250; k += 0.5) { const g = M.gearFor(k), r = M.rpmFor(k); if (g < prevG) mono = false; prevG = g; if (g < 5 && r > 3000 + 1e-9 && hand(k, g) > 3000) under = false; if (r < 850 || r > 8000) inRange = false; }
  ok('auto-shift: gear never goes down as speed rises; below top gear the engine stays at or under 3000 rpm; rpm stays within idle..8000', mono && under && inRange); }
ok('upshift drops the rpm (sawtooth), deterministic in speed', (() => { let drops = 0; for (let k = 1; k < 120; k += 0.25) if (M.gearFor(k + 0.25) > M.gearFor(k)) { drops++; if (!(M.rpmFor(k + 0.25) < M.rpmFor(k))) return false; } return drops === 4 && M.rpmFor(77.7) === M.rpmFor(77.7); })());

// ---- lighting curve
ok('level: 0 lx is dim but not black (0.1..0.2), 5 lx is close to the photo (> 0.85), never above 1', M.level(0) >= 0.1 && M.level(0) <= 0.2 && M.level(5) > 0.85 && M.level(1e6) <= 1, JSON.stringify([M.level(0), M.level(0.2), M.level(5)]));
{ let mono = true; for (let e = 0; e < 20; e += 0.01) if (M.level(e + 0.01) < M.level(e)) mono = false; ok('level is monotonic in lux; ambient 0 < 0.2 < 5', mono && M.level(0) < M.level(0.2) && M.level(0.2) < M.level(5)); }

// ---- dash glow: zero without oncoming light, monotonic in it
ok('dash glow: exactly 0 with no oncoming light, at every ambient (and with the dome)', [0, 0.2, 5, 3, 8].every((a) => M.dashGlow(a, 0) === 0));
{ let mono = true; for (const a of [0, 0.2, 5]) { let p = 0; for (let e = 0.01; e < 50; e *= 1.2) { const g = M.dashGlow(a, e); if (!(g >= p) || g < 0) mono = false; p = g; } } ok('dash glow: non-negative and monotonic in the oncoming illuminance', mono); }
// the illuminance itself, from the same glare path the frame uses: one oncoming car's headlamps closing in; a taillamp and a preceding car's headlamps add nothing
const head = (x, y, nx) => ({ k: 'disc', headlamp: true, x, y, z: 0.68, nx, ny: 0, r: 0.09, emitPow: 8, emit: [15000 / (Math.PI * 0.0081), 15000 / (Math.PI * 0.0081), 0.93 * 15000 / (Math.PI * 0.0081)] });
const eyeE = (objs) => D.glareSources(objs.filter((ob) => ob.headlamp), [-2, 0.37, 1.2], objs, { lights: [] }).reduce((s, q) => s + q[3], 0);
const Es = [200, 120, 80, 50, 30, 15].map((d) => eyeE([head(d, 3.5, -1), head(d, 2.3, -1)]));
ok('oncoming eye lux rises as the car closes (200 -> 15 m), and so does the dash glow', Es.every((v, i) => i === 0 || v > Es[i - 1]) && Es.every((v, i) => i === 0 || M.dashGlow(0, v) > M.dashGlow(0, Es[i - 1])), JSON.stringify(Es.map((v) => +v.toFixed(3))));
ok('no oncoming car: a preceding car (headlamps facing away) and a taillamp add 0 lx', eyeE([head(40, 0, 1), Object.assign(head(40, 0, -1), { headlamp: false, taillamp: true })]) === 0);

// ---- cabinZoom (debug) option
const z = Opt.OPTIONS.find((x) => x.id === 'cabinZoom');
ok('registry: cabinZoom declared once, number 0.5..2, default 1 (neutral)', !!z && reg.split("id: 'cabinZoom'").length === 2 && z.type === 'number' && z.values.min === 0.5 && z.values.max === 2 && z.default === 1 && Opt.defaults().cabinZoom === 1);
ok('UI: cabinZoom range with a label + value readout, setDV on change, synced and disabled unless cabinView + miata; passed to the photo as zoom', anim.includes("'data-anim': 'cabinZoom'") && anim.includes("'cabin zoom '") && anim.includes("setDV(ui, 'cabinZoom', +czr.value)") && anim.includes("r.disabled = !o.cabinView || o.cabinStyle !== 'miata'") && anim.includes('zoom: +o.cabinZoom || 1'));

// ---- the descriptor and the framing (frameFor)
const d = M.DESC;
ok('descriptor: src/w/h match the PNG header (skipped loudly while the PNG is host-pending), eye inside the image, windshield/mirrors/gauges/dashTop present', (() => { const b = pngOrWarn(d.src); return (b === null || (b.readUInt32BE(16) === d.w && b.readUInt32BE(20) === d.h)); })() && d.eye[0] > 0 && d.eye[0] < d.w && d.eye[1] > 0 && d.eye[1] < d.h && d.windshield.length === 4 && d.mirrors.length === 3 && d.mirrors.every((m) => m.poly.length > 3 && m.box.length === 4) && d.gauges.tach.length === 3 && d.dashTop.length > 3);
ok('descriptor: the eye is the driver\'s point of view, behind the wheel (x within 30 px of the rim centre)', Math.abs(d.eye[0] - d.rim.cx) <= 30);
const covers = (F, gx, gy, gw, gh, dd) => { const q = dd || d; return F.ox <= gx + 1e-6 && (q.openTop || F.oy <= gy + 1e-6) && F.ox + q.w * F.s >= gx + gw - 1e-6 && F.oy + q.h * F.s >= gy + gh - 1e-6; };
{ let all = true, bad = ''; for (const [gw, gh] of [[900, 506], [1920, 1080], [600, 600], [1600, 500]]) for (const fov of [30, 45, 60, 75, 90]) for (const yaw of [-0.3, -0.1, 0, 0.1, 0.3]) for (const zoom of [0.5, 1, 2]) { const F = M.frameFor(d, 10, 20, gw, gh, fov, yaw, zoom); if (!covers(F, 10, 20, gw, gh)) { all = false; bad = JSON.stringify({ gw, gh, fov, yaw, zoom, F }); } }
  ok('frame: the image covers the GL canvas at every size, view angle, yaw and zoom (the edge never shows)', all, bad); }
{ const F = M.frameFor(d, 0, 0, 900, 506, 60, 0, 1), eyeY = F.oy + d.eye[1] * F.s; ok('frame: vertically the eye sits on the canvas centre (the horizon)', Math.abs(eyeY - 253) < 1e-6, JSON.stringify(F)); }
{ const dc = Object.assign({}, d, { eye: [d.w / 2, d.h / 2] }), F = M.frameFor(dc, 0, 0, 900, 506, 30, 0, 1); ok('frame: with room on every side the eye lands exactly on the canvas centre and nothing is clamped', !F.panClamped && Math.abs(F.ox + dc.eye[0] * F.s - 450) < 1e-6 && Math.abs(F.oy + dc.eye[1] * F.s - 253) < 1e-6); }
{ let mono = true, prev = Infinity; for (let fov = 20; fov <= 100; fov += 1) { const s = M.frameFor(d, 0, 0, 900, 506, fov, 0, 1).s; if (s > prev + 1e-12) mono = false; prev = s; } ok('frame: the scale never grows as the view angle widens; narrower view angles zoom in', mono && M.frameFor(d, 0, 0, 900, 506, 30, 0, 1).s > M.frameFor(d, 0, 0, 900, 506, 60, 0, 1).s); }
{ const a = M.frameFor(d, 0, 0, 900, 506, 30, 0, 1), b = M.frameFor(d, 0, 0, 900, 506, 30, 0, 1.5), c = M.frameFor(d, 0, 0, 900, 506, 60, 0, 0.5); ok('frame: cabinZoom multiplies the view-angle zoom (1.5x at 30 deg), and zooming out stops at the cover floor', Math.abs(b.s / a.s - 1.5) < 1e-9 && Math.abs(c.s - c.sCover) < 1e-12 && c.zoomClamped); }
ok('frame: at 60 deg the windshield fills >= 85% of the canvas width (' + (M.frameFor(d, 0, 0, 900, 506, 60, 0, 1).windshieldFrac * 100).toFixed(0) + '% with this image: the cover floor binds)', M.frameFor(d, 0, 0, 900, 506, 60, 0, 1).windshieldFrac >= 0.85);
{ let mono = true, prev = Infinity; for (let y = -0.4; y <= 0.4; y += 0.01) { const ox = M.frameFor(d, 0, 0, 900, 506, 30, y, 1).ox; if (ox > prev + 1e-9) mono = false; prev = ox; } const L = M.frameFor(d, 0, 0, 900, 506, 30, 0.9, 1), R = M.frameFor(d, 0, 0, 900, 506, 30, -0.9, 1);
  ok('driftCabin pan: a positive yaw moves the cockpit left (old rotate(-yaw) sense), monotonic, and stops where the image runs out', mono && M.frameFor(d, 0, 0, 900, 506, 30, 0.05, 1).ox < M.frameFor(d, 0, 0, 900, 506, 30, 0, 1).ox && L.panClamped && R.panClamped); }
ok('drive-anim: the photo branches before the overlay rotate (pans, not rotates) and passes hfov + yaw', anim.indexOf('if (photo) {') > 0 && anim.indexOf('if (photo) {') < anim.indexOf('x.rotate(-yaw)') && anim.includes('hfov: V.p && V.p.hfov, yaw,'));
ok('css: the overlay sits below every UI layer (z 1, same as the render, later in the stage) and lets clicks through', /\.drive-cabin \{[^}]*pointer-events: none; z-index: 1;/.test(fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8')));

// ---- cabinOffsetX/Y: hand placement
for (const id of ['cabinOffsetX', 'cabinOffsetY']) { const e2 = Opt.OPTIONS.find((x) => x.id === id); ok('registry: ' + id + ' declared once, number -0.5..0.5, default 0, needs cabinView + miata', !!e2 && reg.split("id: '" + id + "'").length === 2 && e2.type === 'number' && e2.default === 0 && e2.values.min === -0.5 && e2.values.max === 0.5 && Opt.defaults()[id] === 0 && /cabinStyle/.test(JSON.stringify(e2.requires))); }
ok('UI: unlock toggle, -/+ nudges, reset and a readout; drag previews via V.cabinDrag and writes both options on release; pointer events only while unlocked', anim.includes("'data-anim': 'cabinDragUnlock'") && anim.includes("nudge('cabinOffsetX', -0.002") && anim.includes("nudge('cabinOffsetY', 0.002") && anim.includes("setDV(ui, 'cabinOffsetX', 0)") && anim.includes("V.cabin.style.pointerEvents = V.cabinUnlocked ? 'auto' : ''") && anim.includes("offset: [(+o.cabinOffsetX || 0) + (V.cabinDrag ? V.cabinDrag.dx : 0)"));
{ const F0 = M.frameFor(d, 0, 0, 900, 506, 30, 0, 1), F1 = M.frameFor(d, 0, 0, 900, 506, 30, 0, 1, [0.05, -0.02]), F2 = M.frameFor(d, 0, 0, 900, 506, 30, 0, 1, [0, 0]);
  ok('frame: the offset shifts the photo by that fraction of the canvas (0.05 x 900 = 45 px, -0.02 x 506 px), 0 changes nothing', Math.abs(F1.ox - F0.ox - 45) < 1e-9 && Math.abs(F1.oy - F0.oy + 0.02 * 506) < 1e-9 && F2.ox === F0.ox && F2.oy === F0.oy, JSON.stringify([F0.ox, F1.ox, F0.oy, F1.oy]));
  const Fb = M.frameFor(d, 0, 0, 900, 506, 60, 0, 1, [0.5, 0.5]); ok('frame: a large offset still never shows the image edge (the clamp applies after it)', covers(Fb, 0, 0, 900, 506)); }

{ // the readout/write-back is the offset the picture shows: request a clamped one, write back frame.offset, and the picture is the same
  let ok2 = true, bad = ''; for (const req of [[0.3, 0.2], [-0.076, -0.038], [0.004, -0.002], [-0.2, 0.1]]) for (const fov of [30, 60]) { const F = M.frameFor(d, 0, 0, 900, 506, fov, 0, 1, req), G = M.frameFor(d, 0, 0, 900, 506, fov, 0, 1, F.offset); if (Math.abs(F.ox - G.ox) > 1e-9 || Math.abs(F.oy - G.oy) > 1e-9 || Math.abs(G.offset[0] - F.offset[0]) > 1e-12) { ok2 = false; bad = JSON.stringify({ req, fov, F: F.offset, G: G.offset }); } }
  ok('frame: the effective offset round-trips (writing it back gives the same picture), so the readout never shows a value the picture ignores', ok2, bad);
  ok('UI: nudge and drag write the effective offset (frame.offset), clamped to +/-0.5; the unlock relocks when the photo style is off', anim.includes('putOff(k, eff(') && anim.includes("putOff('cabinOffsetX', eff(0, 'cabinOffsetX'))") && anim.includes('Math.max(-0.5, Math.min(0.5,') && anim.includes("if (V.cabinUnlocked && (!o.cabinView || o.cabinStyle !== 'miata'))")); }
// ---- every descriptor: asset matches, holes and framing hold (the narrow NA photo and the wide panoramic one)
for (const [name, dd] of Object.entries(M.DESCS)) {
  const b = pngOrWarn(dd.src); ok(name + ': PNG exists and its size matches the descriptor (skipped loudly while host-pending)', b === null || (b.readUInt32BE(16) === dd.w && b.readUInt32BE(20) === dd.h));
  ok(name + ': eye behind the wheel (within 30 px of the rim centre x)', Math.abs(dd.eye[0] - dd.rim.cx) <= 30);
  let all = true, bad = ''; for (const [gw, gh] of [[900, 506], [1920, 1080], [600, 600]]) for (const fov of [30, 60, 90]) for (const yaw of [-0.3, 0, 0.3]) { const F = M.frameFor(dd, 0, 0, gw, gh, fov, yaw, 1, [0.1, -0.1]); if (!covers(F, 0, 0, gw, gh, dd)) { all = false; bad = JSON.stringify({ gw, gh, fov, yaw }); } }
  ok(name + ': the image covers the canvas at every size/view angle/yaw (an openTop image may show its transparent top)', all, bad);
}
{ const W = M.DESCS['miata-wide'], F = M.frameFor(W, 0, 0, 900, 506, 60, 0, 1), F90 = M.frameFor(W, 0, 0, 900, 506, 90, 0, 1);
  ok('wide image: at 60 deg the windshield fills 87% of the canvas width with the eye exactly centred (no clamp binds)', Math.abs(F.windshieldFrac - 0.87) < 1e-9 && !F.zoomClamped && !F.panClamped && Math.abs(F.ox + W.eye[0] * F.s - 450) < 1e-9 && Math.abs(F.oy + W.eye[1] * F.s - 253) < 1e-9, JSON.stringify(F));
  ok('wide image: 90 deg zooms out (s ' + F90.s.toFixed(3) + ' < ' + F.s.toFixed(3) + ') until the bottom edge stops it', F90.s < F.s && F90.zoomClamped);
  ok('the wide image is the one in use', M.DESC === W && M.SRC === 'img/cabin/miata-wide.png'); }

console.log(fail === 0 ? `\nall ${pass} cabin-miata checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
