/* sealed-beam-v1.js — a SEALED-BEAM headlamp: a paraboloid reflector plus a fluted ("prismatic") cover lens (experimental).
 *
 * The classic 1940s–1980s US lamp: a pressed-glass paraboloid, the filament at (or, for the low beam, beside) the focus, and a
 * cover lens whose inner face carries flutes, small prisms that bend the parallel-ish reflected light into the beam pattern.
 *   1. Reflector: ONE rev surface, an exact paraboloid (k = −1, R = 2f), vertex set so the focus sits at the lamp's focus point F.
 *      The solver cannot move the filament (input.source.pos), so the focus is placed from it: high beam F = filament;
 *      low beam F = filament − (fwd, left, up) offset, i.e. the filament sits above / beside the focus (US4180755: all filaments
 *      lie in the focal plane; only the high-beam one is AT the focus).
 *   2. Lens (setting `lens`): `fluted` = a flat outer face + an inner face of rectangular CELLS (flute, plane patch) in a grid, each
 *      a tilted plane through the cell centre; `plain` = flat cover glass, no flutes (the baseline); `none` = open.
 *      Each cell's tilt is solved EXACTLY (vector Snell at both faces) so the ray arriving at the cell centre from the filament via
 *      the paraboloid leaves toward the cell's target direction (h, v).  Target directions come from the flute pattern parameters:
 *        columns (vertical flutes)   → horizontal spread  hSpread, centred on hBias (+ a left / right half bias)
 *        rows (horizontal flutes)    → vertical spread    vSpread, centred on vCentre
 *        kick-down zone              → rows below `kickZ` (a fraction of the radius, −1…1) get an extra kick of `kick` degrees down
 *      A golden-ratio scatter assigns each column / row a value in [−1, 1] (so neighbours differ: the sub-beams overlap, which
 *      is what the real flutes do), shaped by `peak` (an exponent: > 1 piles the light near the centre of the spread).
 *   3. Shield (setting `shield`): an absorbing disc in front of the filament sized to block the direct (unreflected) cone to the rim,
 *      the sealed beam's stray-light cap.  It also shadows a small central part of the reflector.
 *   4. Tuner (setting `tune`, needs Spec mode and tools.trace): a coordinate search over the flute parameters, judged by
 *      tools.trace({ spec: true }) at few rays (expected fails first, soft score second), common random numbers.
 * Limits of the model (stated, not hidden): flutes are plane cells with NO riser faces (steps between cells), so rays that graze a step
 * are not traced; one tilt per cell (a real flute is curved); the glass is a solid slab with a flat outer face; ior 1.50 is an
 * assumption (soda-lime / borosilicate); the reflector is a perfect paraboloid (a pressed-glass one has shrinkage, US4180755).
 * needs.bounces = 3 (reflector, lens inner face, lens outer face).  Deterministic (fixed seeds, no clocks).                      */
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
  ];
  const TUNABLE = ['hSpread', 'hBias', 'hBiasL', 'vSpread', 'vCentre', 'kick', 'kickZ', 'peak'];
  const settings = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused: the reflector is one paraboloid' },
    { key: 'lamp', label: 'Lamp', type: 'select', options: [['7', LAMPS['7'].label], ['5.75', LAMPS['5.75'].label]], default: '7' },
    { key: 'beam', label: 'Filament', type: 'select', options: [['low', 'Low beam (filament beside the focus)'], ['high', 'High beam (filament at the focus)']], default: 'low' },
    { key: 'lens', label: 'Cover lens', type: 'select', options: [['fluted', 'Fluted (prismatic)'], ['plain', 'Plain flat glass'], ['none', 'None (bare paraboloid)']], default: 'fluted' },
    { key: 'focal', label: 'Focal length (mm, 0 = lamp default)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'lowUp', label: 'Low filament above focus (mm)', type: 'number', min: -10, step: 0.25, default: 2.5, help: 'low beam only; assumed (no published offset found)' },
    { key: 'lowLeft', label: 'Low filament left of focus (mm)', type: 'number', min: -10, step: 0.25, default: 1.5, help: 'low beam only; left = +y, sends light right' },
    { key: 'lowFwd', label: 'Low filament ahead of focus (mm)', type: 'number', min: -10, step: 0.25, default: 0, help: 'low beam only; 0 = in the focal plane (US4180755)' },
    { key: 'cell', label: 'Flute cell size (mm)', type: 'number', min: 4, step: 0.5, default: 10 },
    { key: 'ior', label: 'Glass index', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.5, help: 'assumed, not a sealed-beam datum' },
    { key: 'shield', label: 'Filament shield (direct-light cap)', type: 'checkbox', default: true },
    { key: 'shieldDist', label: 'Shield distance ahead of filament (mm)', type: 'number', min: 6, step: 0.5, default: 6.5 },
  ].concat(KNOBS.map((k) => ({ key: k[0], label: k[1], type: 'number', min: k[2], max: k[3], step: k[4], default: k[5], help: k[7] + ' (default shown is the low beam’s; high beam uses its own when left unset by the tuner)' })),
    [{ key: 'tune', label: 'Tune the flute pattern against the spec', type: 'checkbox', default: true, help: 'Spec mode only: coordinate search with tools.trace({spec:true})' },
     { key: 'tuneRays', label: 'Tuner rays per trace', type: 'number', min: 20000, max: 400000, step: 10000, default: 60000 },
     { key: 'tunePasses', label: 'Tuner passes', type: 'range', min: 0, max: 8, step: 1, default: 3 },
     { key: 'tuneSeconds', label: 'Tuner time limit (s, 0 = none)', type: 'number', min: 0, step: 5, default: 40, help: 'a wall-clock cap; the result then depends on machine speed. 0 = deterministic' }]);

  // ---------------------------------------------------------------- geometry helpers
  const glassOf = (ior) => ({ interaction: 'refract', reflectivity: 0.9, ior, fresnelT: 0.96, twoSided: false });
  function golden(i) { const x = (i * 0.6180339887498949 + 0.31) % 1; return 2 * x - 1; }      // scatter in [−1, 1)
  const shape = (u, p) => Math.sign(u) * Math.pow(Math.abs(u), p);

  // The lamp's geometry from the problem and the settings (the reflector and the places the lens sits).
  function layout(input, s) {
    const lamp = LAMPS[s.lamp] || LAMPS['7'], src = input.source, S = src.pos.slice();
    const low = s.beam === 'low', f = s.focal > 0 ? s.focal : lamp.f;
    const F = low ? [S[0] - s.lowFwd, S[1] - s.lowLeft, S[2] - s.lowUp] : S.slice();          // the paraboloid's focus (x forward, y left, z up)
    const a = lamp.r, vx = F[0] - f, depth = a * a / (4 * f), xin = vx + depth;
    return { lamp, f, F, S, a, vx, depth, xin, low };
  }
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

  /* The lens for flute parameters p.  Returns { surfaces, cells, tMax }.  conv: the angle convention (RF.FarField.dirOf). */
  function lensSurfaces(L, s, p, conv) {
    const ior = s.ior, out = [], cw = Math.max(3, s.cell), R = L.a, Rl = R + cw, glass = glassOf(ior);
    const n = Math.ceil(Rl / cw), cells = [];
    let sagMax = 0;
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const yc = (i + 0.5) * cw + L.F[1], zc = (j + 0.5) * cw + L.F[2];
      if (Math.hypot(yc - L.F[1], zc - L.F[2]) > R + 0.3 * cw) continue;
      cells.push({ i, j, yc, zc });
    }
    for (const c of cells) {
      const u = (c.zc - L.F[2]) / R;                                                         // height on the lens, −1…1
      // targets (degrees): columns spread sideways, rows spread vertically, the low zone is kicked down
      const hs = p.hSpread * shape(golden(c.i + 17), p.peak) + p.hBias + (c.yc > L.F[1] ? p.hBiasL : 0);
      const vs = p.vCentre + p.vSpread * shape(golden(c.j * 3 + 5), p.peak) - (u < p.kickZ ? p.kick : 0);
      const d = arrival(L, c.yc, c.zc), e = RF.FarField.dirOf(hs, vs, conv);
      c.d = d; c.h = hs; c.v = vs;
      c.N = d ? cellNormal(d, e, ior) : null;
    }
    // inner face
    for (const c of cells) {
      if (!c.N) continue;
      const N = c.N, sx = (dy, dz) => -(N[1] * dy + N[2] * dz) / N[0];                       // plane x offset at (dy, dz) from the cell centre
      const h = cw / 2, corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dy, dz]) => { sagMax = Math.max(sagMax, Math.abs(sx(dy, dz))); return [L.xin + sx(dy, dz), c.yc + dy, c.zc + dz]; });
      out.push({ type: 'plane', id: 'sb_f' + c.i + '_' + c.j, P: [L.xin, c.yc, c.zc], n: N, clip: { kind: 'poly', pts3: corners }, optics: glass });
    }
    return { surfaces: out, cells, sagMax, Rl, glass };
  }
  function build(input, s, p, conv) {
    const L = layout(input, s), surf = [paraboloid(L, input.limits.reflectivity)], notes = [];
    let lens = null;
    if (s.lens !== 'none') {
      const glass = glassOf(s.ior), cw = Math.max(3, s.cell), Rl = L.a + cw;
      let xout, inner = [];
      if (s.lens === 'fluted') {
        lens = lensSurfaces(L, s, p, conv); inner = lens.surfaces; xout = L.xin + 2 * lens.sagMax + 3;
      } else { xout = L.xin + 3; inner = [{ type: 'plane', id: 'sb_inner', P: [L.xin, L.F[1], L.F[2]], n: [-1, 0, 0], clip: { kind: 'disc', r: Rl }, optics: glass }]; }
      surf.push(...inner);
      surf.push({ type: 'plane', id: 'sb_outer', P: [xout, L.F[1], L.F[2]], n: [1, 0, 0], clip: { kind: 'disc', r: Rl }, optics: glass });
      surf.push({ type: 'rev', id: 'sb_rim', O: [L.xin - 5, L.F[1], L.F[2]], W: [1, 0, 0], ref: [0, 1, 0], seg: { kind: 'line', z0: 0, r0: Rl, z1: xout - L.xin + 10, r1: Rl }, front: 1, optics: ABSORB });
    }
    if (s.shield) {
      const sd = Math.max(s.shieldDist, 0), xs = L.S[0] + sd, rs = Math.max(2, sd * (L.a + 2) / Math.max(1, L.xin - L.S[0]));
      surf.push({ type: 'plane', id: 'sb_shield', P: [xs, L.S[1], L.S[2]], n: [-1, 0, 0], clip: { kind: 'disc', r: rs }, optics: ABSORB });
      notes.push('shield Ø' + (2 * rs).toFixed(1) + ' mm, ' + sd + ' mm ahead of the filament');
    }
    return { surfaces: surf, layout: L, lens, notes };
  }

  // ---------------------------------------------------------------- the tuner
  function paramsOf(s, defaults) { const p = {}; for (const k of TUNABLE) p[k] = s[k]; return p; }
  function objective(res) { const sp = res && res.spec; return sp ? [sp.expFails !== undefined ? sp.expFails : sp.n.fail + 0.5 * sp.n.unsure, -sp.score] : [1e9, 0]; }
  const better = (a, b) => a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9);

  function solve(input, s, tools) {
    const conv = (input.spec && input.spec.conv) || 'A', notes = [];
    // the high beam has its own defaults for the knobs the user hasn't moved off the low-beam defaults
    s = Object.assign({}, s);
    if (s.beam === 'high') for (const k of KNOBS) if (s[k[0]] === k[5]) s[k[0]] = k[6];
    let p = paramsOf(s), b = build(input, s, p, conv), best = null;
    const canTune = s.tune && s.lens === 'fluted' && input.spec && tools && tools.trace && s.tunePasses > 0;
    if (canTune) {
      const T = (pp) => objective(tools.trace(build(input, s, pp, conv).surfaces, { rays: s.tuneRays, seed: 7, spec: true, guided: false, bounces: 3 }));
      const t0 = Date.now(), over = () => s.tuneSeconds > 0 && Date.now() - t0 > s.tuneSeconds * 1000;
      best = T(p); let evals = 1;
      const step = {}; for (const k of KNOBS) step[k[0]] = Math.max(k[4], (k[3] - k[2]) / 12);
      scan: for (let pass = 0; pass < s.tunePasses; pass++) {
        let moved = false;
        for (const k of KNOBS) {
          for (const dir of [1, -1]) {
            const q = Object.assign({}, p), key = k[0]; q[key] = Math.min(k[3], Math.max(k[2], +(p[key] + dir * step[key]).toFixed(4)));
            if (q[key] === p[key]) continue;
            const o = T(q); evals++;
            if (better(o, best)) { best = o; p = q; moved = true; break; }
            if (over()) break scan;
          }
          if (tools.progress) tools.progress((pass + (KNOBS.indexOf(k) + 1) / KNOBS.length) / s.tunePasses);
        }
        for (const key in step) step[key] /= 2;
        if (!moved && pass > 0) break;
      }
      b = build(input, s, p, conv);
      notes.push('tuner: ' + evals + ' traces at ' + s.tuneRays + ' rays, expected fails ' + best[0].toFixed(2) + ', soft score ' + (-best[1]).toFixed(3) + (over() ? ' (time limit hit)' : ''));
      notes.push('tuned: ' + TUNABLE.map((k) => k + ' ' + p[k]).join(', '));
    }
    if (tools && tools.preview) tools.preview(b.surfaces, { label: 'sealed beam', needs: { bounces: 3 } });
    notes.push(b.layout.lamp.label + ', f ' + b.layout.f + ' mm, depth ' + b.layout.depth.toFixed(1) + ' mm, ' + (s.beam === 'low' ? 'low' : 'high') + ' beam, lens ' + s.lens + (b.lens ? ', ' + b.lens.cells.length + ' flutes' : '') + '; ' + b.notes.join('; '));
    return { surfaces: b.surfaces, needs: { bounces: 3 }, notes };
  }

  RF.Solvers.register({ id: 'sealed-beam-v1', name: 'Sealed beam (paraboloid + fluted lens), experimental', version: '0.1', modes: ['paint'], settings, solve });
  RF.SealedBeam = { LAMPS, KNOBS, TUNABLE, layout, build, arrival, cellNormal };
})(typeof globalThis !== 'undefined' ? globalThis : this);
