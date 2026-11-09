// cabin-miata.js: the photo NA Miata cabin (cabinStyle 'miata', Anya 11-08). drive-anim.js drawCabin calls draw() once the photo has
// loaded; until then (and in Node) the vector tombstone stays. The photo is img/cabin/miata-wide.png (keyed panoramic):
// windshield, side windows, five gauge faces and three mirror glasses transparent (tools/cabin-miata/bake.py). Everything that lives
// in a hole is drawn UNDER the photo, so the wheel rim, stalks and window posts occlude it with no masks here.
// Lighting: one curve, level(lux), maps the cabin's illuminance to a multiplier on the daylit photo (a stand-in for exposure, not a
// photometric model). Inputs: the ambient option (0 / 0.2 / 5 lx), the dome light (cabinLight) and the oncoming headlamps' illuminance
// at the eye, which drive-anim.js takes from the same D.glareSources the veil uses (headlamps only).
// The pure maths (dial angles, gear, rpm, level, dash glow) is exported for tests/cabin-miata.js. No DOM is touched at load time.
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});
  // The image descriptor: everything the overlay knows about the photo, in photo px. Swapping the image means a new PNG and a new
  // descriptor, no code. tools/cabin-miata/bake.py reads this same object (as JSON) to cut the holes, so the two cannot drift.
  //   eye        the driver's point of view (behind the wheel): it lands on the GL canvas centre (the render's horizon point) unless the image runs out
  //   windshield bbox of the transparent windshield [x0, y0, x1, y1] (the framing zooms on its width)
  //   mirrors    glass outlines (poly) and their bbox; side = which mirrorCars rule applies. posts = x spans of opaque posts in front
  //   gauges     [cx, cy, r] faces (r reaches the inside of the bezel ring); hub = nothing of a face is cut below this y
  //   dashTop    polygon of the dash top (oncoming glow); rim = the wheel's upper arc; radio [x, y, w, h]; hazard [x, y, r]; dome = lamp point
  //   trim       mean edge colours (bottom, side) for any letterbox outside the GL canvas; belt = the door line (side trim only below it)
  //   cut        polygons made transparent at draw time: it is a convertible, so nothing above the windshield header (roof rails,
  //              side-window frames) is drawn; the header, A-pillars and mirrors stay
  //   openTop    the image is transparent along its whole top edge (roof keyed away), so that edge may come into view: no top clamp
  // DESCS holds every image; DESC is the one in use. Gauge drawing is sized from the descriptor's radii (designed at r = 52).
  const DESCS = {};
  // the wide panoramic image (keyed: roof, windows and mirror glass already transparent; tools/cabin-miata/bake.py cuts the gauge faces)
  DESCS['miata-wide'] = {
    src: 'img/cabin/miata-wide.png', w: 2000, h: 668, openTop: true,
    eye: [697, 240],   // x: the steering-wheel centre (measured); y: CHOSEN (no visible horizon): puts the windshield base ~0.58 of the canvas height
    windshield: [483, 59, 1517, 293],   // the transparent component through the image centre
    mirrors: [
      { side: 'rear', box: [894, 98, 1100, 144], poly: [[895, 117], [901, 109], [911, 104], [932, 101], [962, 99], [995, 98], [1027, 99], [1057, 101], [1077, 104], [1090, 109], [1098, 117], [1100, 130], [1098, 139], [1090, 143], [995, 144], [902, 143], [895, 138], [894, 128]] },   // 11-09: moved (-8, -10) to match the re-edited photo
      { side: 'left', box: [123, 261, 288, 351], poly: [[288, 306], [287, 326], [282, 335], [275, 342], [264, 347], [250, 350], [228, 351], [193, 351], [173, 348], [156, 343], [142, 336], [131, 327], [125, 316], [123, 304], [126, 292], [134, 282], [146, 274], [161, 267], [179, 263], [199, 261], [236, 261], [255, 263], [268, 266], [277, 272], [284, 279], [287, 289]] },
      { side: 'right', box: [1710, 263, 1878, 353], poly: [[1878, 308], [1876, 320], [1868, 330], [1857, 339], [1842, 346], [1824, 350], [1804, 353], [1767, 353], [1746, 351], [1732, 348], [1722, 343], [1715, 336], [1711, 326], [1710, 301], [1712, 286], [1717, 277], [1725, 271], [1736, 267], [1751, 264], [1775, 263], [1810, 264], [1829, 267], [1846, 272], [1860, 279], [1871, 288], [1877, 299]] },
    ],
    gauges: { tach: [652, 344, 33], speedo: [745, 344, 33], small: { fuel: [604, 357, 15], oil: [696, 321, 13], temp: [794, 356, 15] }, hub: 370 },
    dashTop: [[855, 262], [1100, 268], [1300, 278], [1470, 290], [1500, 318], [1460, 330], [1100, 330], [870, 325], [852, 300]],
    rim: { cx: 697, cy: 414, r: 146, a0: 1.13 * Math.PI, a1: 1.87 * Math.PI },
    radio: [948, 482, 55, 14], hazard: [975, 373, 8], dome: [1040, 40],
    trim: { bottom: [26, 28, 30], side: [50, 52, 59] }, belt: 455,
    cut: [],
  };
  const DESC = DESCS['miata-wide'];
  const SRC = DESC.src, PW = DESC.w, PH = DESC.h;
  const GAUGES = Object.assign({ tach: DESC.gauges.tach, speedo: DESC.gauges.speedo }, DESC.gauges.small);
  const DASH = DESC.dashTop, RIM = DESC.rim, RADIO = DESC.radio, HAZARD = DESC.hazard, TRIM = DESC.trim;   // (GAUGE_BOX, GLOW_BOX, SPILL_BOX are derived below)
  const bbox = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const GAUGE_BOX = (() => { const c = Object.values(GAUGES), x0 = Math.min(...c.map((g) => g[0] - g[2])) - 4, y0 = Math.min(...c.map((g) => g[1] - g[2])) - 4, x1 = Math.max(...c.map((g) => g[0] + g[2])) + 4, y1 = Math.max(...c.map((g) => g[1] + g[2])) + 4; return [x0, y0, x1 - x0, y1 - y0]; })();   // x, y, w, h of the cached gauge faces
  const GLOW_BOX = (() => { const b = bbox(DASH.concat([[RIM.cx - RIM.r - 12, RIM.cy - RIM.r - 12], [RIM.cx + RIM.r + 12, RIM.cy - RIM.r * 0.6]])), x0 = Math.max(0, b[0] - 20), y0 = Math.max(0, b[1] - 20); return [x0, y0, Math.min(PW, b[2] + 20) - x0, Math.min(PH, b[3] + 20) - y0]; })();   // x, y, w, h of the dash-glow layer
  // framing: at the reference view angle the windshield fills FRAME.fill of the canvas width, centred on the eye point; a wider view angle zooms
  // out, a narrower one in (like a lens: tan(ref/2)/tan(hfov/2)), and cabinZoom multiplies that (debug). driftCabin pans by the yaw. The image
  // edge never shows on the GL canvas. Vertically the eye must stay on the horizon (shifting it would put the dash over the road), so the scale
  // that covers the canvas with the eye centred vertically is a floor on the zoom; horizontally the image just stops: the offset is clamped.
  const FRAME = { refFov: 60, fill: 0.87 };
  // off = [x, y]: cabinOffsetX/Y, a hand shift as a fraction of the canvas size (Anya's fine-tuning), added before the clamp
  function frameFor(d, gx, gy, gw, gh, hfov, yaw, zoom, off) {
    const [ex, ey] = d.eye, ws = d.windshield[2] - d.windshield[0], hf = (+hfov > 0 ? +hfov : FRAME.refFov) * Math.PI / 360, fz = Math.tan(FRAME.refFov * Math.PI / 360) / Math.tan(hf);
    const sTarget = FRAME.fill * gw / ws * fz * (+zoom > 0 ? +zoom : 1), sCover = Math.max(gw / d.w, d.openTop ? 0 : gh / 2 / ey, gh / 2 / (d.h - ey)), s = Math.max(sTarget, sCover);
    const pan = -Math.tan(+yaw || 0) * (gw / 2) / Math.tan(hf);   // screen px: a positive yaw (the overlay's old rotate(-yaw) sense) moves the cockpit left
    const ox0 = gx + gw / 2 + pan + (off ? +off[0] || 0 : 0) * gw - ex * s, oy0 = gy + gh / 2 + (off ? +off[1] || 0 : 0) * gh - ey * s;
    const ox = Math.min(gx, Math.max(gx + gw - d.w * s, ox0)), oy = Math.max(gy + gh - d.h * s, d.openTop ? oy0 : Math.min(gy, oy0));
    const req = [off ? +off[0] || 0 : 0, off ? +off[1] || 0 : 0], offset = [req[0] + (ox - ox0) / gw, req[1] + (oy - oy0) / gh];   // offset: the shift that actually shows after the clamp (write this back, not the request)
    return { s, ox, oy, sTarget, sCover, zoomClamped: sCover > sTarget, panClamped: Math.abs(ox - ox0) > 1e-9, windshieldFrac: ws * s / gw, pan, offset };
  }

  // ---- pure maths
  // level(lux): photo multiplier. Floored (0 lx is nearly black, not black) and log-shaped; 0.2 lx ~0.36, 5 lx ~0.91. Monotonic.
  const LEVEL = { floor: 0.14, e0: 0.1, eMax: 8, dome: 3, dashK: 0.06 };   // dome: cabinLight's lux on the interior; dashK: share of the eye illuminance that the dash top catches (grazing). Tuning values, Anya's to judge by eye
  function level(lux) { const e = Math.max(0, +lux || 0); return Math.min(1, LEVEL.floor + (1 - LEVEL.floor) * Math.log10(1 + e / LEVEL.e0) / Math.log10(1 + LEVEL.eMax / LEVEL.e0)); }
  // extra brightness on the dash top from oncoming headlamps: level(amb + k E) - level(amb). Zero with no oncoming light, grows with E.
  function dashGlow(ambientLux, eyeLux) { const e = Math.max(0, +eyeLux || 0); return e > 0 ? level(ambientLux + LEVEL.dashK * e) - level(ambientLux) : 0; }
  // dials sweep 270 deg clockwise from lower left (canvas angles: 0 = +x, y down)
  const DIAL = { start: 0.75 * Math.PI, sweep: 1.5 * Math.PI };
  const dialAngle = (frac) => DIAL.start + Math.max(0, Math.min(1, +frac || 0)) * DIAL.sweep;
  // speedometer: full scale 140 MPH (225 km/h) as on the NA cluster; the needle position depends on the speed only, not on the unit
  const SPEEDO = { mph: 140 };
  const speedFrac = (kmh) => Math.max(0, kmh) * 0.621371 / SPEEDO.mph;
  const SMALL = { a0: -0.82 * Math.PI, a1: -0.18 * Math.PI };   // the small gauges' upper arc (low end left, high end right), pivot a little below the face centre
  // NA 1.6 5-speed (assumed: ratios 3.136/1.888/1.330/1.000/0.814, final 4.300, 185/60R14 = 1.815 m circumference). The 'driver' picks the
  // lowest gear that keeps the engine at or under 3000 rpm: a function of speed alone, so a cruise speed always shows the same gear.
  const NA = { gears: [3.136, 1.888, 1.330, 1.000, 0.814], final: 4.3, circ: 1.815, idle: 850, shift: 3000, redline: 7000, max: 8000 };
  const engineRpm = (kmh, g) => Math.max(0, kmh) / 3.6 / NA.circ * 60 * NA.gears[g] * NA.final;
  function gearFor(kmh) { if (!(kmh > 0)) return 0; for (let g = 0; g < NA.gears.length; g++) if (engineRpm(kmh, g) <= NA.shift) return g + 1; return NA.gears.length; }
  function rpmFor(kmh) { const g = gearFor(kmh); return g ? Math.max(NA.idle, Math.min(NA.max, engineRpm(kmh, g - 1))) : NA.idle; }
  const oilFrac = (rpm) => Math.min(0.9, 0.25 + 0.6 * rpm / NA.redline);   // oil pressure rises with rpm; temp and fuel are fixed stand-ins (no signal for them)
  // backlight (cabinGaugeLight): strength of the self-lit markings, needles, radio LCD and hazard button
  const BACKLIGHT = { off: 0, dim: 0.15, normal: 0.3, bright: 0.55 };   // kept low (Anya 11-08: brighter read as a floating HUD over the dark photo)
  const backlight = (v) => BACKLIGHT[v] || 0;
  const LIT = [150, 255, 165], NEEDLE_LIT = [225, 255, 220], NEEDLE = [255, 88, 30], PAINT = [232, 232, 226];   // backlight pale green (the NA at night), needles lit pale white-green, needle paint orange-red, marking paint white
  const rgb = (c, k, a) => 'rgba(' + c.map((v) => Math.round(Math.min(255, v * k))).join(',') + ',' + (a === undefined ? 1 : a) + ')';

  // ---- the photo and the caches
  const C = { img: null, ok: false, failed: false, waiters: [], dark: null, darkKey: '', gauge: null, gaugeKey: '', glow: null };
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // true once the photo has loaded; the first call starts the load and onReady runs once it is there (to repaint a paused frame)
  function ready(onReady) {
    if (C.ok) return true;
    if (C.failed || typeof Image === 'undefined') return false;
    if (onReady && !C.waiters.includes(onReady)) C.waiters.push(onReady);
    if (!C.img) {
      C.img = new Image();
      C.img.onload = () => { C.ok = true; const w = C.waiters; C.waiters = []; for (const f of w) f(); };
      C.img.onerror = () => { C.failed = true; C.waiters = []; };   // the vector tombstone stays
      C.img.src = SRC;
    }
    return false;
  }
  const path = (x, pts) => { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.closePath(); };
  // the photo darkened to the cabin level (and warmed by the dome light): black over the opaque pixels only (source-atop keeps the holes)
  function darkPhoto(lv, dome) {
    const key = lv.toFixed(4) + '|' + dome;
    if (C.dark && C.darkKey === key) return C.dark;
    const c = C.dark || (C.dark = canvas(PW, PH)), x = c.getContext('2d');
    x.globalCompositeOperation = 'copy'; x.drawImage(C.img, 0, 0);
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; for (const poly of DESC.cut || []) { path(x, poly); x.fill(); }   // convertible: no roof rails or side-window frames
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(0,0,0,' + (1 - lv) + ')'; x.fillRect(0, 0, PW, PH);
    if (dome) { const g = x.createRadialGradient(DESC.dome[0], DESC.dome[1], 0, DESC.dome[0], DESC.dome[1], 900); g.addColorStop(0, 'rgba(255,200,130,0.10)'); g.addColorStop(1, 'rgba(255,200,130,0.02)'); x.fillStyle = g; x.fillRect(0, 0, PW, PH); }
    x.globalCompositeOperation = 'source-over'; C.darkKey = key;
    return c;
  }
  // the undarkened dash top and upper wheel rim, feathered: added with 'lighter' when oncoming headlamps shine in (built once)
  function glowLayer() {
    if (C.glow) return C.glow;
    const [bx, by, bw, bh] = GLOW_BOX, m = canvas(bw, bh), mx = m.getContext('2d'), off = 4000;
    mx.translate(-bx - off, -by); mx.shadowOffsetX = off; mx.shadowColor = 'rgba(0,0,0,1)'; mx.shadowBlur = 24;   // shadow trick: a blurred mask without ctx.filter (Safari)
    path(mx, DASH); mx.fillStyle = '#000'; mx.fill();
    mx.shadowColor = 'rgba(0,0,0,0.55)'; mx.shadowBlur = 8; mx.lineWidth = 16; mx.beginPath(); mx.arc(RIM.cx, RIM.cy, RIM.r, RIM.a0, RIM.a1); mx.stroke();
    const c = canvas(bw, bh), x = c.getContext('2d');
    x.drawImage(C.img, bx, by, bw, bh, 0, 0, bw, bh);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0);
    return (C.glow = c);
  }
  // the gauges' backlight spilling onto the photo around them (bezels, the binnacle hood): the undarkened photo, faded out from each gauge, warmed (built once)
  const SPILL_BOX = (() => { const [x0, y0, w, h] = GAUGE_BOX, a = Math.max(0, x0 - 50), b = Math.max(0, y0 - 50); return [a, b, Math.min(PW, x0 + w + 50) - a, Math.min(PH, y0 + h + 30) - b]; })();
  function spillLayer() {
    if (C.spill) return C.spill;
    const [bx, by, bw, bh] = SPILL_BOX, m = canvas(bw, bh), mx = m.getContext('2d');
    mx.translate(-bx, -by); mx.globalCompositeOperation = 'lighter';
    for (const [cx, cy, r] of Object.values(GAUGES)) { const g = mx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2); g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)'); mx.fillStyle = g; mx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4); }
    const c = canvas(bw, bh), x = c.getContext('2d');
    x.drawImage(C.img, bx, by, bw, bh, 0, 0, bw, bh);
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(150,255,165,0.3)'; x.fillRect(0, 0, bw, bh);   // pale green, like the backlight
    x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0);
    return (C.spill = c);
  }
  // the gauge faces, after Anya's own NA cluster at night: black faces, numerals and ticks backlit pale green, chrome trim rings, a fine
  // hatched redline band. Unlit (backlight off) the white paint shows only by the cabin level. Cached at 2x; the needles are live.
  // Speedometer: the outer ring is the app's unit (km/h 0-220 by 20 metric, MPH 0-140 by 20 imperial), the inner small ring the other one,
  // so the needle sits in the same place for the same speed either way.
  function gaugeFaces(lv, bl, imperial) {
    const key = lv.toFixed(4) + '|' + bl + '|' + !!imperial;
    if (C.gauge && C.gaugeKey === key) return C.gauge;
    const S = 2, [bx, by, bw, bh] = GAUGE_BOX, c = C.gauge || (C.gauge = canvas(bw * S, bh * S)), x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.setTransform(S, 0, 0, S, -bx * S, -by * S);
    const ink = (k) => { const m = k === undefined ? 1 : k; return 'rgba(' + PAINT.map((v, i) => Math.round(Math.min(255, (v * lv * 0.8 + LIT[i] * bl * 0.8) * m))).join(',') + ',1)'; };
    const face = (cx, cy, r) => {
      const g = x.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy, r);
      g.addColorStop(0, rgb([24, 25, 24], lv + bl * 0.4)); g.addColorStop(1, rgb([8, 9, 8], lv + bl * 0.25));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
      x.strokeStyle = 'rgba(' + [150, 154, 158].map((v, i) => Math.round(Math.min(255, v * lv * 0.9 + LIT[i] * bl * 0.35))).join(',') + ',1)'; x.lineWidth = 1.3; x.beginPath(); x.arc(cx, cy, r - 0.7, 0, 7); x.stroke();   // chrome trim ring catching the glow
    };
    const tick = (cx, cy, a, r0, l, w, col) => { x.strokeStyle = col || ink(); x.lineWidth = w; x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (r0 - l), cy + Math.sin(a) * (r0 - l)); x.stroke(); };
    const label = (t, px, X, Y, k) => { x.fillStyle = ink(k); x.font = '600 ' + px + 'px Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, X, Y); };
    const at = (cx, cy, f, r, t, px, k) => { const a = dialAngle(f); label(t, px, cx + Math.cos(a) * r, cy + Math.sin(a) * r, k); };
    const big = (g) => { const [gx0, gy0, rr] = GAUGES[g]; x.save(); x.translate(gx0, gy0); x.scale(rr / 52, rr / 52); };   // the dials are designed at r = 52 and scaled to the descriptor's face
    { big('tach'); const cx = 0, cy = 0, r = 52; face(cx, cy, r);   // tachometer 0-8 x1000 rpm, hatched band 7-8 on the outer edge
      for (let i = 0; i <= 32; i++) tick(cx, cy, dialAngle(i / 32), r - 3, i % 4 ? 3.5 : 7, i % 4 ? 1 : 2);
      const red = 'rgba(' + [225, 70, 50].map((v) => Math.round(Math.min(255, v * lv * 0.9 + v * bl * 0.6))).join(',') + ',1)';
      for (let i = 0; i <= 20; i++) tick(cx, cy, dialAngle((NA.redline + (NA.max - NA.redline) * i / 20) / NA.max), r - 2.5, 5 + 3 * i / 20, 0.6, red);
      for (let i = 0; i <= 8; i++) at(cx, cy, i / 8, r - 17, String(i), 11);
      label('X1000 RPM', 5, cx + 4, cy + 21); x.restore(); }
    { big('speedo'); const cx = 0, cy = 0, r = 52, full = SPEEDO.mph / 0.621371, fM = (mph) => mph / SPEEDO.mph, fK = (kmh) => kmh / full; face(cx, cy, r);   // speedometer
      const outer = imperial ? { f: fM, top: 140, minor: 10 } : { f: fK, top: 220, minor: 10 }, inner = imperial ? { f: fK, top: 220 } : { f: fM, top: 140 };
      for (let v = 0; v <= outer.top; v += outer.minor) tick(cx, cy, dialAngle(outer.f(v)), r - 3, v % 20 ? 3.5 : 7, v % 20 ? 1 : 2);
      for (let v = 0; v <= outer.top; v += 20) at(cx, cy, outer.f(v), r - 17, String(v), imperial ? 10 : 8.5);
      for (let v = 20; v <= inner.top; v += 20) at(cx, cy, inner.f(v), r - 30, String(v), 4.2, 0.85);
      x.fillStyle = rgb([4, 4, 4], 1); x.fillRect(cx - 15, cy - 15, 30, 7); x.fillRect(cx - 9, cy + 8, 18, 6);   // odometer and trip windows (generic digits)
      x.font = '500 5px Helvetica, Arial, sans-serif'; x.fillStyle = ink(0.9); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('0 0 0 0 0 0', cx, cy - 11.5); x.fillText('0 0 0 0', cx, cy + 11);
      label(imperial ? 'km/h' : 'MPH', 3.6, cx, cy + 20, 0.85); label(imperial ? 'MPH' : 'km/h', 6, cx, cy + 25.5); label('UNLEADED FUEL ONLY', 3.4, cx, cy + 31, 0.9); x.restore(); }
    const small = (g, lo, hi, icon, mids) => { const [cx, cy, r] = GAUGES[g], py = cy + r * 0.22, a0 = SMALL.a0, a1 = SMALL.a1; face(cx, cy, r);
      for (let i = 0; i <= 6; i++) tick(cx, py, a0 + (a1 - a0) * i / 6, r * 0.86, i % 3 ? r * 0.1 : r * 0.2, i % 3 ? 0.8 : 1.4);
      const lab = (t, f, k) => { const a = a0 + (a1 - a0) * f; label(t, Math.max(4.5, r * 0.24), cx + Math.cos(a) * r * 0.56, py + Math.sin(a) * r * 0.56, k); };
      lab(lo, 0); lab(hi, 1); if (mids) mids.forEach(([t, f]) => { const a = a0 + (a1 - a0) * f; label(t, Math.max(3.5, r * 0.18), cx + Math.cos(a) * r * 0.6, py + Math.sin(a) * r * 0.6); });   // the oil scale's 30 / 60, smaller
      x.strokeStyle = ink(); x.fillStyle = ink(); x.lineWidth = 0.8; const u = r * 0.07, ix = cx, iy = py - r * 0.42 + (mids ? r * 0.14 : 0);   // the icon under the scale
      if (icon === 'pump') { x.strokeRect(ix - 1.5 * u, iy - 2 * u, 3 * u, 4 * u); x.beginPath(); x.moveTo(ix + 1.5 * u, iy - u); x.lineTo(ix + 2.6 * u, iy); x.lineTo(ix + 2.6 * u, iy + 2 * u); x.stroke(); }
      if (icon === 'can') { x.beginPath(); x.ellipse(ix - u, iy, 2.2 * u, 1.2 * u, 0, 0, 7); x.stroke(); x.beginPath(); x.moveTo(ix + u, iy - 0.4 * u); x.lineTo(ix + 3.2 * u, iy - 1.4 * u); x.stroke(); }
      if (icon === 'therm') { x.beginPath(); x.moveTo(ix, iy - 2.2 * u); x.lineTo(ix, iy + 0.8 * u); x.stroke(); x.beginPath(); x.arc(ix, iy + 1.4 * u, 0.9 * u, 0, 7); x.fill(); for (const d of [-1, 1]) { x.beginPath(); x.moveTo(ix - 2.6 * u, iy + d * 0.8 * u + 1.8 * u); x.lineTo(ix + 2.6 * u, iy + d * 0.8 * u + 1.8 * u); x.stroke(); } }
      if (g === 'oil') label('lb/in²', Math.max(3.5, r * 0.15), cx, cy + r * 0.6); };
    small('fuel', 'E', 'F', 'pump');
    small('oil', '0', '90', 'can', [['30', 1 / 3], ['60', 2 / 3]]);
    small('temp', 'C', 'H', 'therm');
    C.gaugeKey = key;
    return c;
  }
  // a needle: painted orange-red (seen by the cabin level), lit pale white-green from the hub by the backlight; brighter than anything on the face
  function needle(x, cx, cy, a, len, tail, w, lv, bl) {
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca, col = (k) => 'rgba(' + NEEDLE.map((v, i) => Math.round(Math.min(255, (v * lv * 0.95 + NEEDLE_LIT[i] * bl * 1.8) * k))).join(',') + ',1)';
    const g = x.createLinearGradient(cx, cy, cx + ca * len, cy + sa * len); g.addColorStop(0, col(1.15)); g.addColorStop(1, col(0.8));
    x.fillStyle = g; x.beginPath();
    x.moveTo(cx - ca * tail + nx * w, cy - sa * tail + ny * w); x.lineTo(cx + ca * len, cy + sa * len); x.lineTo(cx - ca * tail - nx * w, cy - sa * tail - ny * w); x.closePath(); x.fill();
  }
  const cap = (x, cx, cy, r, lv) => { x.fillStyle = rgb([16, 16, 17], lv + 0.2); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.strokeStyle = rgb([90, 90, 92], lv); x.lineWidth = 1; x.stroke(); };
  // mirror glass: a dark night view, plus the following cars' headlamps (drive-anim.js mirrorCars) when cabinMirror is on
  function mirror(x, m, cars, kcd, lv) {
    const side = m.side, pts = m.poly, [x0, y0, x1, y1] = m.box, w = x1 - x0, h = y1 - y0;
    const sky = 0.25 + 0.75 * (lv - LEVEL.floor) / (1 - LEVEL.floor), g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, rgb([22, 26, 34], sky)); g.addColorStop(0.45, rgb([12, 14, 18], sky)); g.addColorStop(0.5, rgb([7, 8, 10], sky)); g.addColorStop(1, rgb([4, 4, 5], sky));
    x.save(); path(x, pts); x.fillStyle = g; x.fill(); x.strokeStyle = g; x.lineWidth = 4; x.stroke();   // the stroke runs 2 px under the housing: no seam at the hole's edge
    x.clip();
    if (cars && cars.length) {
      x.globalCompositeOperation = 'lighter';
      for (const mc of cars) {
        if (side === 'left' && mc.bearing < 0) continue;    // the same side rule as the vector mirrors: bearing 0 shows in all three
        if (side === 'right' && mc.bearing > 0) continue;
        const glow = Math.min(1, mc.candela / kcd), near = Math.min(1, 12 / mc.distance);
        let cx = side === 'rear' ? x0 + w * (0.5 + mc.bearing / 40) : side === 'left' ? x0 + w * (0.78 - Math.abs(mc.bearing) / 60) : x0 + w * (0.22 + Math.abs(mc.bearing) / 60);   // side mirrors: straight behind sits near the inner edge
        const sc = side === 'rear' ? 1 : 0.55, cy = y0 + h * (0.5 + 0.25 * near), sep = 70 * sc * near + 1.2, r = Math.max(2, 26 * sc * near) + 3 * glow;
        for (const s of [-1, 1]) {
          const gx = cx + s * sep / 2, rg = x.createRadialGradient(gx, cy, 0, gx, cy, r);
          rg.addColorStop(0, 'rgba(255,245,220,' + (0.9 * glow) + ')'); rg.addColorStop(0.35, 'rgba(255,235,200,' + (0.35 * glow) + ')'); rg.addColorStop(1, 'rgba(255,235,200,0)');
          x.fillStyle = rg; x.fillRect(gx - r, cy - r, 2 * r, 2 * r);
        }
      }
      x.globalCompositeOperation = 'source-over';
    }
    x.restore();
  }
  // draw the cabin. o: { W, H (buffer px), gx, gy, gw, gh (the GL canvas inside the buffer), hfov (deg), yaw (driftCabin, rad), zoom (cabinZoom), ambient, dome, kmh, imperial, gaugeLight, mirrors, mirrorKcd, oncoming (lx at the eye) }
  function draw(x, o) {
    if (!C.ok) return false;
    const F = frameFor(DESC, o.gx, o.gy, o.gw, o.gh, o.hfov, o.yaw, o.zoom, o.offset), s = F.s, ox = F.ox, oy = F.oy;
    const amb = (+o.ambient || 0) + (o.dome ? LEVEL.dome : 0), lv = level(amb), bl = backlight(o.gaugeLight), kmh = Math.max(0, +o.kmh || 0), rpm = rpmFor(kmh), glow = dashGlow(amb, o.oncoming);
    M.last = { level: lv, backlight: bl, kmh, gear: gearFor(kmh), rpm, oncomingLux: +o.oncoming || 0, dashGlow: glow, frame: F };
    if (o.dome) {   // cabinLight's stray-light veil over the windshield (the vector styles draw the same), under the photo so it shows only through the glass
      const vg = x.createLinearGradient(0, 0, 0, o.H * 0.75); vg.addColorStop(0, 'rgba(255,244,214,0.10)'); vg.addColorStop(1, 'rgba(255,244,214,0.02)'); x.fillStyle = vg; x.fillRect(0, 0, o.W, o.H * 0.75);
    }
    x.save(); x.translate(ox, oy); x.scale(s, s);   // photo px from here on
    for (const m of DESC.mirrors) mirror(x, m, o.mirrors, o.mirrorKcd || 30, lv);
    const soft = 'filter' in x, [bx, by, bw, bh] = GAUGE_BOX;   // a slight blur matches the drawn gauges to the photo's softness
    if (soft) x.filter = 'blur(' + (0.7 * Math.max(0.5, s)).toFixed(2) + 'px)';
    x.drawImage(gaugeFaces(lv, bl, o.imperial), bx, by, bw, bh);
    if (soft) x.filter = 'blur(' + (0.4 * Math.max(0.5, s)).toFixed(2) + 'px)';
    { const [cx, cy, r] = GAUGES.tach, k = r / 52; needle(x, cx, cy, dialAngle(rpm / NA.max), 44 * k, 9 * k, 1.9 * k, lv, bl); cap(x, cx, cy, 6 * k, lv); }
    { const [cx, cy, r] = GAUGES.speedo, k = r / 52; needle(x, cx, cy, dialAngle(speedFrac(kmh)), 44 * k, 9 * k, 1.9 * k, lv, bl); cap(x, cx, cy, 6 * k, lv); }
    const smallNeedle = (g, f) => { const [cx, cy, r] = GAUGES[g], py = cy + r * 0.22; needle(x, cx, py, SMALL.a0 + (SMALL.a1 - SMALL.a0) * f, r * 0.74, 2, 1.2, lv, bl); cap(x, cx, py, Math.max(2.5, r * 0.14), lv); };
    smallNeedle('temp', 0.45); smallNeedle('fuel', 0.75); smallNeedle('oil', oilFrac(rpm));
    if (soft) x.filter = 'none';
    const dk = darkPhoto(lv, !!o.dome);
    x.drawImage(dk, 0, 0);
    // the overlay box can be larger than the photo's cover of the GL canvas (letterbox, the popout wrap): a flat trim colour there (stretched edge pixels streak)
    const L = -ox / s, T = -oy / s, R = (o.W - ox) / s, B = (o.H - oy) / s;
    x.fillStyle = rgb(TRIM.side, lv);   // below the door line only, and nothing above the photo: it is a convertible
    if (L < 0) x.fillRect(L - 1, DESC.belt, -L + 1.5, PH - DESC.belt);
    if (R > PW) x.fillRect(PW - 0.5, DESC.belt, R - PW + 1, PH - DESC.belt);
    x.fillStyle = rgb(TRIM.bottom, lv); if (B > PH) x.fillRect(Math.min(0, L) - 1, PH - 0.5, Math.max(R, PW) - Math.min(0, L) + 2, B - PH + 1);
    x.globalCompositeOperation = 'lighter';
    if (o.dome) { const [dx, dy] = DESC.dome, g = x.createRadialGradient(dx, dy, 0, dx, dy, 60); g.addColorStop(0, 'rgba(255,236,200,0.55)'); g.addColorStop(1, 'rgba(255,236,200,0)'); x.fillStyle = g; x.fillRect(dx - 60, dy - 60, 120, 120); }
    if (bl > 0) {   // the radio LCD and the hazard button glow faintly with the backlight
      const [sx, sy, sw, sh] = SPILL_BOX; x.globalAlpha = Math.min(1, 1.2 * bl); x.drawImage(spillLayer(), sx, sy, sw, sh); x.globalAlpha = 1;   // the gauges' spill on the bezels and the binnacle hood
      const [rx, ry, rw, rh] = RADIO; x.globalAlpha = 0.55 * bl; x.drawImage(C.img, rx, ry, rw, rh, rx, ry, rw, rh);
      x.globalAlpha = 1; x.fillStyle = 'rgba(150,255,140,' + (0.10 * bl) + ')'; x.fillRect(rx + 2, ry + 2, rw - 4, rh - 4);
      const [hx, hy, hr] = HAZARD, hg = x.createRadialGradient(hx, hy, 0, hx, hy, hr * 1.6); hg.addColorStop(0, 'rgba(255,60,40,' + (0.35 * bl) + ')'); hg.addColorStop(1, 'rgba(255,60,40,0)'); x.fillStyle = hg; x.fillRect(hx - hr * 2, hy - hr * 2, hr * 4, hr * 4);
    }
    if (glow > 0) { const [gx, gy, gw, gh] = GLOW_BOX; x.globalAlpha = Math.min(1, glow); x.drawImage(glowLayer(), gx, gy, gw, gh); x.globalAlpha = 1; }   // oncoming headlamps on the dash top and the wheel rim
    x.globalCompositeOperation = 'source-over';
    x.restore();
    return true;
  }

  const M = { DESCS, DESC, FRAME, frameFor, SRC, PW, PH, GAUGES, GAUGE_BOX, GLOW_BOX, LEVEL, NA, SPEEDO, SMALL, LIT, DIAL, BACKLIGHT, level, dashGlow, dialAngle, speedFrac, gearFor, rpmFor, oilFrac, backlight, ready, draw, last: null };
  RF.CabinMiata = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
