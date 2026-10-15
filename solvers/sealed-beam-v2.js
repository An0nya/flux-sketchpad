/* sealed-beam-v2.js — explicit source mounting, optional H4 assembly and a closed, sampled curved-flute lens.
 * R37 constraints and every assumed dimension: docs/sealed-beam-v2.md. No dependency on v1 in the worker.
 * Fixed mounting plans against the design source; changing the actual source never moves reflector/lens.
 * Flute strips and every riser/perimeter piece have convex clips. Same seed => same candidate sequence. */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, D2R = Math.PI / 180;
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  // lamp presets: nominal lens Ø (Wikipedia: 7" = 178 mm, 5¾" = 146 mm) less an assumed ~4 mm rim wall each side; focal length ASSUMED
  // (25 mm is the low end of the 25–35 mm the patents quote for headlamp paraboloids; 5¾" scaled with the aperture).
  const LAMPS = { '7': { r: 85, f: 25, label: '7" round (6014 / H6024 family)' }, '5.75': { r: 69.5, f: 20, label: '5¾" round (4000 family)' } };
  // flute pattern knobs: [min, max, step, default per beam].  Names are the setting keys.
  const KNOBS = [
    // key, label, min, max, step, defLow, defHigh, help
    ['hSpread', 'Horizontal spread ± (°)', 0, 30, 0.25, 9, 6, 'half-width of the columns’ sideways targets'],
    ['hBias', 'Horizontal centre (° right)', -10, 10, 0.25, 2.5, 0, 'where the columns’ spread is centred (right = +)'],
    ['hBiasL', 'Extra right bias, left half of lens (°)', -10, 10, 0.25, 1, 0, 'cells on the lamp’s left half aim this much further right'],
    ['vSpread', 'Vertical spread ± (°)', 0, 15, 0.25, 2.5, 3, 'half-width of the rows’ up/down targets'],
    ['vCentre', 'Vertical centre (° up)', -10, 5, 0.25, -2, 0, 'where the rows’ spread is centred (down = −)'],
    ['kick', 'Kick-down in the low zone (°)', 0, 15, 0.25, 2, 0, 'extra downward aim of the rows below the kick line'],
    ['kickZ', 'Kick line (fraction of radius, −1…1)', -1, 1, 0.05, 0, 0, 'rows below this height get the kick'],
    ['peak', 'Centre-weighting exponent', 0.4, 3, 0.1, 1.3, 1, '> 1 piles the sub-beams toward the centre of the spread'],
    ['leftDrop', 'Left side lowered (°)', 0, 6, 0.25, 1.5, 0, 'cells aimed left of straight ahead are aimed this much lower (the low beam’s cut-off step)'],
    ['hotR', 'Hot-spot zone radius (fraction of lens radius)', 0, 0.8, 0.05, 0.3, 0.4, 'the lens centre is aimed at one hot spot; 0 = no hot-spot zone'],
    ['hotH', 'Hot spot, ° right', -3, 6, 0.25, 2, 0, ''],
    ['hotV', 'Hot spot, ° up', -4, 1.5, 0.25, -1.5, 0, ''],
    ['hotSpread', 'Hot-spot scatter ± (°)', 0, 4, 0.25, 1, 1, ''],
    ['spillR', 'Spill zone starts at (fraction of lens radius)', 0.4, 1.05, 0.05, 0.9, 1.05, 'the lens rim is aimed wide; 1.05 = no spill zone'],
    ['spillAngle', 'Spill reach ± (°)', 5, 30, 0.5, 18, 12, ''],
    ['spillV', 'Spill, ° up', -8, 2, 0.25, -3, -2, ''],
  ];
  const SEARCH = KNOBS.concat([['curveSpread', '', 0, 8, 0.25], ['widthRatio', '', 0.4, 3, 0.1]]);
  const TUNABLE = SEARCH.map((k) => k[0]);
  const settings = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused: the reflector is one paraboloid' },
    { key: 'lamp', label: 'Lamp', type: 'select', options: [{ value: '7', label: LAMPS['7'].label }, { value: '5.75', label: LAMPS['5.75'].label }], default: '7' },
    { key: 'beam', label: 'Filament', type: 'select', options: [{ value: 'low', label: 'Low beam (filament beside the focus)' }, { value: 'high', label: 'High beam (filament at the focus)' }], default: 'low' },
    { key: 'lens', label: 'Cover lens', type: 'select', options: [{ value: 'fluted', label: 'Fluted (prismatic)' }, { value: 'plain', label: 'Plain flat glass' }, { value: 'none', label: 'None (bare paraboloid)' }], default: 'fluted' },
    { key: 'focal', label: 'Focal length (mm, 0 = lamp default)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'lowUp', label: 'Design low filament above focus (mm, ASSUMED)', type: 'number', min: -10, step: 0.25, default: 2.5, help: 'low beam only; assumed (no published offset found)' },
    { key: 'lowLeft', label: 'Design low filament left of focus (mm, ASSUMED)', type: 'number', min: -10, step: 0.25, default: 1.5, help: 'low beam only; left = +y, sends light right' },
    { key: 'lowFwd', label: 'Design low filament ahead of focus (mm, ASSUMED)', type: 'number', min: -10, step: 0.25, default: 0, help: 'low beam only; 0 = in the focal plane (US4180755)' },
    { key: 'mount', label: 'Source adjustment', type: 'select', options: [{ value: 'fixed', label: 'FIXED OPTICS — source edits only retrace' }, { value: 'follow', label: 'Rebuild optics relative to source (v1)' }], default: 'fixed' },
    { key: 'sourceModel', label: 'Source setup', type: 'select', options: [{ value: 'scene', label: 'Use scene source' }, { value: 'sealed', label: 'ASSUMED sealed-beam filament' }, { value: 'h4', label: 'H4 bulb assembly (axial)' }], default: 'scene', help: 'Preset change resets orientation; dimensions and assumptions: docs/sealed-beam-v2.md' },
    ...['X', 'Y', 'Z'].map((a) => ({ key: 'focus' + a, label: 'Fixed reflector focus ' + a + ' (mm)', type: 'number', min: -1000, max: 1000, step: 0.25, default: 0, adv: true })),
    ...[['Fwd', 'forward (+x)', 0], ['Left', 'left (+y; right is negative)', 1.5], ['Up', 'up (+z)', 2.5]].map(([k, label, d]) => ({ key: 'source' + k, label: 'Filament centre ' + label + ' from focus (mm)', type: 'number', min: -50, max: 50, step: 0.25, default: d })),
    ...[['Az', 'azimuth (0 = axial, 90 = transverse)', 90, -180, 180], ['El', 'elevation', 0, -90, 90], ['Roll', 'assembly roll', 0, -180, 180]].map(([k, label, d, min, max]) => ({ key: 'source' + k, label: 'Filament ' + label + ' (°)', type: 'number', min, max, step: 1, default: d })),
    { key: 'assembly', label: 'Bulb parts', type: 'select', options: [{ value: 'auto', label: 'Auto (H4 assembly presets only)' }, { value: 'none', label: 'None (bare filament)' }, { value: 'h4', label: 'H4 assembly' }], default: 'auto' },
    { key: 'bulbCup', label: 'H4 internal dipping cup', type: 'checkbox', default: true },
    { key: 'bulbTip', label: 'H4 opaque bulb tip', type: 'checkbox', default: true },
    { key: 'bulbGlass', label: 'H4 bulb glass', type: 'checkbox', default: true },
    { key: 'bulbRadius', label: 'H4 glass outer radius (mm, ASSUMED)', type: 'number', min: 4, max: 12, step: 0.25, default: 8.5, adv: true },
    { key: 'bulbWall', label: 'H4 glass wall (mm, ASSUMED)', type: 'number', min: 0.2, max: 2, step: 0.1, default: 0.7, adv: true },
    { key: 'bulbIor', label: 'H4 glass index (ASSUMED)', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.46, adv: true },
    { key: 'cupRadius', label: 'H4 cup radius (mm, ASSUMED)', type: 'number', min: 1.5, max: 4, step: 0.25, default: 3, adv: true },
    { key: 'profile', label: 'Flute profile', type: 'select', options: [{ value: 'curved', label: 'Curved (sampled parabolic profile)' }, { value: 'planar', label: 'Planar cells (v1 approximation)' }], default: 'curved' },
    { key: 'regions', label: 'Lens regions', type: 'select', options: [{ value: 'variable', label: 'Variable-width rectangles' }, { value: 'uniform', label: 'Uniform rectangles' }], default: 'variable' },
    { key: 'cellHeight', label: 'Flute region height (mm)', type: 'number', min: 4, max: 40, step: 0.5, default: 20 },
    { key: 'widthRatio', label: 'Rim / centre flute width', type: 'number', min: 0.4, max: 3, step: 0.1, default: 1.8, help: 'Changes region area and therefore collected flux, not ray weights' },
    { key: 'curveSpread', label: 'Within-flute horizontal spread ± (°)', type: 'number', min: 0, max: 8, step: 0.25, default: 2 },
    { key: 'curveSteps', label: 'Curved profile strips per flute', type: 'number', min: 2, max: 16, step: 1, default: 4, adv: true },
    { key: 'risers', label: 'Trace connecting and perimeter faces', type: 'checkbox', default: true, help: 'Off is the incomplete v1-style geometry, for comparison only' },
    { key: 'cell', label: 'Flute region centre width (mm)', type: 'number', min: 4, max: 40, step: 0.5, default: 10 },
    { key: 'ior', label: 'Glass index', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.5, help: 'assumed, not a sealed-beam datum' },
    { key: 'shield', label: 'Filament shield (direct-light cap)', type: 'checkbox', default: true },
    { key: 'shieldDist', label: 'Shield distance ahead of filament (mm)', type: 'number', min: 6, step: 0.5, default: 6.5 },
  ].concat(KNOBS.map((k) => ({ key: k[0], label: k[1], type: 'number', min: k[2], max: k[3], step: k[4], default: k[5], help: k[7] + ' (explicit pattern setting; high-beam examples provide their own starting values)' })),
    [{ key: 'tune', label: 'Tune the flute pattern against the spec', type: 'checkbox', default: true, help: 'Spec mode only: coordinate search with tools.trace({spec:true})' },
     { key: 'tuneRays', label: 'Tuner rays per trace', type: 'number', min: 20000, max: 400000, step: 10000, default: 60000 },
     { key: 'tuneEvals', label: 'Tuner candidates (0 = off)', type: 'number', min: 0, max: 2000, step: 10, default: 150 },
     { key: 'tuneAim', label: 'Tuner aim', type: 'select', options: ['scan', 'frozen'], default: 'frozen', help: 'scan: every trace finds the cut-off aim afresh (the slow part of a trace). frozen: candidates use the starting incumbent aim; full aim procedure once for the final verdict' },
     { key: 'tuneGpu', label: 'Tuner traces via tools.traceAsync (GPU when the GPU switch is on)', type: 'checkbox', default: true, help: 'same rays, f32; without a GPU the same CPU trace. Measured ~11x with the frozen aim on an M4' },
     { key: 'tuneSeed', label: 'Tuner random seed', type: 'number', min: 0, step: 1, default: 12345, help: 'the (1+1) search\u2019s own dice; another seed is another run of the same search' },
     { key: 'tuneSeconds', label: 'Tuner time limit (s, 0 = none)', type: 'number', min: 0, step: 5, default: 0, help: 'a wall-clock cap; the result then depends on machine speed. 0 = deterministic' }]);

  // ---------------------------------------------------------------- geometry helpers
  const glassOf = (ior) => ({ interaction: 'refract', reflectivity: 0.9, ior, fresnelT: 0.96, twoSided: false });
  function golden(i) { const x = i * 0.6180339887498949 + 0.31; return 2 * (x - Math.floor(x)) - 1; }      // scatter in [−1, 1)
  const shape = (u, p) => Math.sign(u) * Math.pow(Math.abs(u), p);

  // The lamp's geometry from the problem and the settings (the reflector and the places the lens sits).
  const layout = RF.SealedBeamSource.layout;
  function paraboloid(L, refl) {
    return { type: 'rev', id: 'sb_reflector', O: [L.vx, L.F[1], L.F[2]], W: [1, 0, 0], ref: [0, 1, 0], seg: { kind: 'conic', zv: 0, R: 2 * L.f, k: -1, r0: 0, r1: L.a }, front: -1, optics: { interaction: 'reflect', reflectivity: refl } };
  }
  // reflect a ray from the filament S off the paraboloid so that it passes the lens-plane point (yc, zc); returns its direction there
  function arrival(L, yc, zc) {
    let ty = yc, tz = zc, d = [1, 0, 0];
    for (let it = 0; it < 6; it++) {
      const ry = ty - L.F[1], rz = tz - L.F[2], xq = L.vx + (ry * ry + rz * rz) / (4 * L.f), q = [xq, ty, tz];
      const n = V.norm([1, -ry / (2 * L.f), -rz / (2 * L.f)]), w = V.norm(V.sub(q, L.S));
      d = V.sub(w, V.mul(n, 2 * V.dot(w, n)));
      if (!(d[0] > 0.05)) return null;
      const t = (L.xin - xq) / d[0];
      ty = yc - d[1] * t; tz = zc - d[2] * t;
    }
    return d;
  }
  // inner-face front normal that turns the air direction d into a beam leaving the flat outer face along e (unit, world)
  function cellNormal(d, e, ior) {
    const gt = [e[1] / ior, e[2] / ior], g2 = gt[0] * gt[0] + gt[1] * gt[1];
    if (!(g2 < 0.999) || !(e[0] > 0.05)) return null;
    const g = [Math.sqrt(1 - g2), gt[0], gt[1]], N = V.norm(V.sub(V.mul(g, ior), d));
    return N[0] > 0 ? V.mul(N, -1) : N;                                                      // front = the air side (−x)
  }

  function targetOf(c, L, p) {
    const u = (c.zc - L.F[2]) / L.a, rho = Math.hypot(c.yc - L.F[1], c.zc - L.F[2]) / L.a, k = c.i * 5 + c.j * 11;
    let h, v;
    if (rho < p.hotR) { h = p.hotH + p.hotSpread * golden(k + 1); v = p.hotV + 0.5 * p.hotSpread * golden(k + 4); }
    else if (rho >= p.spillR) { h = p.spillAngle * (0.35 + 0.65 * Math.abs(golden(k + 2))) * (golden(k + 3) < 0 ? -1 : 1); v = p.spillV + 0.1 * p.spillAngle * golden(k + 6); }
    else {
      h = p.hSpread * shape(golden(c.i + 17), p.peak) + p.hBias + (c.yc > L.F[1] ? p.hBiasL : 0);
      v = p.vCentre + p.vSpread * shape(golden(c.j * 3 + 5), p.peak) - (u < p.kickZ ? p.kick : 0) - (h < 0 ? p.leftDrop : 0);
    }
    return [h, v];
  }
  // Sutherland–Hodgman: a convex region clipped against the convex aperture, all in world (y,z).
  function clipPoly(poly, aperture) {
    for (let k = 0; k < aperture.length && poly.length; k++) {
      const a = aperture[k], b = aperture[(k + 1) % aperture.length], side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const out = [];
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length], sp = side(p), sq = side(q);
        if (sp >= -1e-9) out.push(p);
        if ((sp > 1e-9 && sq < -1e-9) || (sp < -1e-9 && sq > 1e-9)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
      poly = out;
    }
    return poly.filter((p, i) => Math.hypot(p[0] - poly[(i + 1) % poly.length][0], p[1] - poly[(i + 1) % poly.length][1]) > 1e-7);
  }
  function regionEdges(R, width, ratio) {
    const pos = [0]; let y = 0;
    while (y < R - 1e-8) { y = Math.min(R, y + width * (1 + (ratio - 1) * (y / R))); pos.push(y); }
    return pos.slice(1).reverse().map((x) => -x).concat(pos);
  }
  function lensSurfaces(L, s, p, conv) {
    const R = L.a + 2, glass = glassOf(s.ior), aperture = Array.from({ length: 48 }, (_, i) => [L.F[1] + R * Math.cos(2 * Math.PI * i / 48), L.F[2] + R * Math.sin(2 * Math.PI * i / 48)]);
    const ys = regionEdges(R, s.cell, s.regions === 'variable' ? p.widthRatio : 1), zs = regionEdges(R, s.cellHeight, 1), cells = [], strips = [];
    const steps = s.profile === 'curved' ? Math.round(s.curveSteps) : 1;
    let sagMax = 0;
    for (let i = 0; i + 1 < ys.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const y0 = ys[i] + L.F[1], y1 = ys[i + 1] + L.F[1], z0 = zs[j] + L.F[2], z1 = zs[j + 1] + L.F[2];
      if (!clipPoly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]], aperture).length) continue;
      const c = { i: i - Math.floor(ys.length / 2), j: j - Math.floor(zs.length / 2), yc: (y0 + y1) / 2, zc: (z0 + z1) / 2, width: y1 - y0, height: z1 - z0 };
      const [h, v] = targetOf(c, L, p), d = arrival(L, c.yc, c.zc) || [1, 0, 0], N = cellNormal(d, RF.FarField.dirOf(h, v, conv), s.ior) || [-1, 0, 0];
      c.h = h; c.v = v;
      const ay = -N[1] / N[0], az = -N[2] / N[0];
      // Boundary slopes send opposite sides of ONE flute to h ± curveSpread; integrate their difference as parabolic sag.
      const Nl = cellNormal(d, RF.FarField.dirOf(h - p.curveSpread, v, conv), s.ior), Nr = cellNormal(d, RF.FarField.dirOf(h + p.curveSpread, v, conv), s.ior);
      const ky = s.profile === 'curved' && Nl && Nr ? ((-Nr[1] / Nr[0]) - (-Nl[1] / Nl[0])) / c.width : 0;
      const sag = (y, z) => ay * (y - c.yc) + az * (z - c.zc) + 0.5 * ky * ((y - c.yc) ** 2 - c.width ** 2 / 12);
      cells.push(c);
      for (let k = 0; k < steps; k++) {
        const a = y0 + c.width * k / steps, b = y0 + c.width * (k + 1) / steps, slope = (sag(b, c.zc) - sag(a, c.zc)) / (b - a);
        const poly = clipPoly([[a, z0], [b, z0], [b, z1], [a, z1]], aperture); if (poly.length < 3) continue;
        const g = (y, z) => sag(a, c.zc) + slope * (y - a) + az * (z - c.zc);
        for (const [y, z] of poly) sagMax = Math.max(sagMax, Math.abs(g(y, z)));
        strips.push({ id: 'sb2_f' + c.i + '_' + c.j + '_' + k, poly, g });
      }
    }
    const room = L.env ? L.env.c0 + L.env.h0 - L.xin : Infinity;
    if (room < 3) throw new Error('sealed-beam-v2: envelope needs at least 3 mm ahead of the reflector rim for the cover');
    const scale = sagMax > 0 ? Math.min(1, Math.max(0, (room - 3) / 2) / sagMax) : 1;
    sagMax *= scale;
    const base = L.xin + sagMax + 0.5, xout = L.xin + 2 * sagMax + 3, surfaces = [], edges = new Map();
    const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
    for (const strip of strips) {
      const pts = strip.poly.map(([y, z]) => [base + scale * strip.g(y, z), y, z]);
      const N = V.norm(V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0])));
      surfaces.push({ type: 'plane', id: strip.id, P: pts[0], n: N[0] > 0 ? V.mul(N, -1) : N, clip: { kind: 'poly', pts3: pts }, optics: glass });
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length], ka = key([a[1], a[2]]), kb = key([b[1], b[2]]), ek = ka < kb ? ka + ':' + kb : kb + ':' + ka;
        const edge = { a, b };
        if (!edges.has(ek)) edges.set(ek, [edge]); else edges.get(ek).push(edge);
      }
    }
    let risers = 0, boundary = 0;
    // The height order can reverse along an edge. Split at that crossing before triangulating: no bow-tie/concave clips.
    const bridge = (a, b, c, d, id) => {
      const da = c[0] - a[0], db = d[0] - b[0];
      if (Math.abs(da) + Math.abs(db) < 1e-7) return;
      if (da * db < -1e-14) {
        const t = da / (da - db), mid = V.add(a, V.mul(V.sub(b, a), t));
        bridge(a, mid, c, mid, id + 'a'); bridge(mid, b, mid, d, id + 'b'); return;
      }
      const outward = [0, b[2] - a[2], a[1] - b[1]], dir = V.mul(outward, da + db > 0 ? 1 : -1);
      for (const [k, pts] of [[0, [a, b, d]], [1, [a, d, c]]]) {
        const n = V.cross(V.sub(pts[1], pts[0]), V.sub(pts[2], pts[0])); if (V.len(n) < 1e-8) continue;
        surfaces.push({ type: 'plane', id: id + '_' + k, P: pts[0], n: V.norm(V.dot(n, dir) < 0 ? V.mul(n, -1) : n), clip: { kind: 'poly', pts3: pts }, optics: glass }); risers++;
      }
    };
    let edgeN = 0;
    for (const es of edges.values()) {
      if (es.length > 2) throw new Error('sealed-beam-v2: more than two faces share a projected edge');
      const { a, b } = es[0];
      if (es.length === 2) { const e = es[1], same = Math.hypot(a[1] - e.a[1], a[2] - e.a[2]) < 1e-6; if (s.risers) bridge(a, b, same ? e.a : e.b, same ? e.b : e.a, 'sb2_riser' + edgeN); }
      else { boundary++; if (s.risers) bridge(a, b, [xout, a[1], a[2]], [xout, b[1], b[2]], 'sb2_edge' + edgeN); }
      edgeN++;
    }
    surfaces.push({ type: 'plane', id: 'sb2_outer', P: [xout, L.F[1], L.F[2]], n: [1, 0, 0], clip: { kind: 'poly', pts3: aperture.map(([y, z]) => [xout, y, z]) }, optics: glass });
    return { surfaces, cells, strips: strips.length, risers, boundary, sagMax, capped: scale < 1 ? cells.length : 0 };
  }

  function build(input, s, p, conv) {
    const L = layout(input, s), surfaces = [paraboloid(L, input.limits.reflectivity)], notes = [], bulb = RF.SealedBeamSource.bulbSurfaces(input.source, s);
    let lens = null;
    if (s.lens === 'fluted') { lens = lensSurfaces(L, s, p, conv); surfaces.push(...lens.surfaces); }
    else if (s.lens === 'plain') {
      const glass = glassOf(s.ior), R = L.a + 2;
      surfaces.push({ type: 'plane', id: 'sb2_inner', P: [L.xin + 0.5, L.F[1], L.F[2]], n: [-1, 0, 0], clip: { kind: 'disc', r: R }, optics: glass });
      surfaces.push({ type: 'plane', id: 'sb2_outer', P: [L.xin + 3, L.F[1], L.F[2]], n: [1, 0, 0], clip: { kind: 'disc', r: R }, optics: glass });
      surfaces.push({ type: 'rev', id: 'sb2_edge', O: [L.xin + 0.5, L.F[1], L.F[2]], W: [1, 0, 0], ref: [0, 1, 0], seg: { kind: 'line', z0: 0, r0: R, z1: 2.5, r1: R }, front: -1, optics: glass });
    }
    if (s.shield) {
      // Sealed-beam direct-light cap is fixed with the lamp; it is NOT the H4 cup or bulb tip.
      const sd = s.shieldDist, rs = Math.max(2, sd * (L.a + 2) / Math.max(1, L.xin - L.S[0]));
      surfaces.push({ type: 'plane', id: 'sb_shield', P: [L.S[0] + sd, L.S[1], L.S[2]], n: [-1, 0, 0], clip: { kind: 'disc', r: rs }, optics: ABSORB });
    }
    surfaces.push(...bulb);
    if (bulb.length) notes.push('H4 assembly: R37 filament/rim placement; cup form, tip, wall/index ASSUMED (docs/sealed-beam-v2.md)');
    notes.push(s.mount + ' mounting; actual source Δfocus ' + V.sub(input.source.pos, L.F).join(',') + ' mm; design Δfocus ' + V.sub(L.S, L.F).join(',') + ' mm');
    return { surfaces, layout: L, lens, notes, bounces: bulb.length && s.bulbGlass ? 12 : s.lens === 'none' ? 3 : 8 };
  }

  // ---------------------------------------------------------------- the tuner
  function paramsOf(s) { const p = {}; for (const k of TUNABLE) p[k] = s[k]; return p; }
  function objective(res) { const sp = res && res.spec; return sp ? [sp.expFails !== undefined ? sp.expFails : sp.n.fail + 0.5 * sp.n.unsure, -sp.score] : [1e9, 0]; }
  const better = (a, b) => a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9);

  function solve(input, s, tools) {
    const conv = (input.spec && input.spec.conv) || 'A', notes = [];
    s = Object.assign({}, s);
    let p = paramsOf(s), b = build(input, s, p, conv);
    const canTune = s.tune && s.lens === 'fluted' && input.spec && tools && tools.trace && s.tuneEvals > 0;
    // Hold the starting incumbent's aim for every candidate (including winners); full aim once on the final design.
    // tuneGpu uses traceAsync when the host provides it; CPU and GPU share this acceptance rule.
    const frozen = s.tuneAim === 'frozen', viaAsync = canTune && s.tuneGpu && typeof tools.traceAsync === 'function';
    const tune = (runTrace) => {      // runTrace(surfaces, o) → result or promise of it
      const base = { rays: s.tuneRays, seed: 7, spec: true, guided: false, bounces: b.bounces };
      // (1+1) evolution strategy: perturb 1–3 knobs by a Gaussian step (a fraction sigma of each knob's range), keep the child if the judge likes it
      // more; sigma grows on success, shrinks on failure.  Seeded, so the sequence of candidates is deterministic.
      let seed = s.tuneSeed | 0; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const t0 = Date.now(), over = () => s.tuneSeconds > 0 && Date.now() - t0 > s.tuneSeconds * 1000;
      const T = (pp, fz) => runTrace(build(input, s, pp, conv).surfaces, fz ? Object.assign({ frozen: fz }, base) : base);
      const finish = (best, evals, accepted) => {
        b = build(input, s, p, conv);
        notes.push('tuner: ' + evals + ' traces at ' + s.tuneRays + ' rays (' + accepted + ' accepted), expected fails ' + best[0].toFixed(2) + ', soft score ' + (-best[1]).toFixed(3) + (over() ? ' (time limit hit)' : ''));
        notes.push('tuned: ' + TUNABLE.map((k) => k + ' ' + p[k]).join(', '));
      };
      const mutate = (sigma) => {
        const q = Object.assign({}, p), m = 1 + Math.floor(rnd() * 3);
        for (let r = 0; r < m; r++) { const k = SEARCH[Math.floor(rnd() * SEARCH.length)]; q[k[0]] = Math.min(k[3], Math.max(k[2], +(Math.round((q[k[0]] + gauss() * sigma * (k[3] - k[2])) / k[4]) * k[4]).toFixed(4))); }
        return q;
      };
      return { T, over, mutate, finish };
    };
    if (canTune && !viaAsync) {
      const { T, over, mutate, finish } = tune((surf, o) => tools.trace(surf, o));
      const r0 = T(p); if (frozen && !(r0.spec && r0.spec.frozen)) throw new Error('sealed-beam-v2: frozen aim unavailable');
      let best = objective(r0), fz = frozen && r0.spec ? r0.spec.frozen : null, evals = 1, sigma = 0.2, accepted = 0;
      for (let it = 0; it < s.tuneEvals && !over(); it++) {
        const q = mutate(sigma), rq = T(q, fz), o = objective(rq); evals++;
        if (better(o, best)) {
          best = o;
          p = q; sigma = Math.min(0.5, sigma * 1.25); accepted++;
        } else sigma = Math.max(0.03, sigma * 0.96);
        if (tools.progress && it % 5 === 0) tools.progress(it / s.tuneEvals);
      }
      if (frozen) { const final = T(p); evals++; notes.push('final full-aim verdict: ' + JSON.stringify(final.spec && final.spec.n)); }
      finish(best, evals, accepted);
    }
    const out = () => {
    if (tools && tools.preview) tools.preview(b.surfaces, { label: 'sealed beam', needs: { bounces: b.bounces } });
    notes.push(b.layout.lamp.label + ', f ' + b.layout.f + ' mm, depth ' + b.layout.depth.toFixed(1) + ' mm, ' + (s.beam === 'low' ? 'low' : 'high') + ' beam, lens ' + s.lens + (b.lens ? ', ' + b.lens.cells.length + ' flutes' + (b.lens.capped ? ' (' + b.lens.capped + ' aimed less far to fit the envelope)' : '') : '') + '; ' + b.notes.join('; '));
    return { surfaces: b.surfaces, needs: { bounces: b.bounces }, notes };
    };
    if (viaAsync) {
      const { T, over, mutate, finish } = tune((surf, o) => tools.traceAsync(surf, o));
      return (async () => {
        const r0 = await T(p); if (frozen && !(r0.spec && r0.spec.frozen)) throw new Error('sealed-beam-v2: frozen aim unavailable');
        let best = objective(r0), fz = frozen && r0.spec ? r0.spec.frozen : null, evals = 1, sigma = 0.2, accepted = 0;
        for (let it = 0; it < s.tuneEvals && !over(); it++) {
          const q = mutate(sigma), rq = await T(q, fz), o = objective(rq); evals++;
          if (better(o, best)) {
            best = o;
            p = q; sigma = Math.min(0.5, sigma * 1.25); accepted++;
          } else sigma = Math.max(0.03, sigma * 0.96);
          if (tools.progress && it % 5 === 0) tools.progress(it / s.tuneEvals);
        }
        if (frozen) { const final = await T(p); evals++; notes.push('final full-aim verdict: ' + JSON.stringify(final.spec && final.spec.n)); }
        finish(best, evals, accepted); return out();
      })();
    }
    return out();
  }

  RF.Solvers.register({ id: 'sealed-beam-v2', name: 'Sealed beam v2 (fixed optics, H4 assembly, curved flutes)', version: '0.2', modes: ['paint'], settings, solve });
  RF.SealedBeamV2 = { LAMPS, KNOBS, TUNABLE, layout, build, arrival, cellNormal, paramsOf, lensSurfaces };
})(typeof globalThis !== 'undefined' ? globalThis : this);
