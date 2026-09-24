/* checks2.js — verification suite, part 2 (checks 9–13, 15).  Check 14 and the extra relation
 * checks live in checks3.js.                                                                    */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const { add } = RF.Checks;
  const { bare, prep, plane } = RF.Checks.helpers;
  const D2R = Math.PI / 180;
  const fmt = RF.U.fmt;

  // weighted moments of a grid along u (i) and v (j), in mm; with SE of the variances
  function moments(grid, res, half) {
    const cell = 2 * half / res;
    let W = 0, mu = 0, mv = 0, hits = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const w = grid[j * res + i]; if (w > 0) { W += w; mu += w * i; mv += w * j; } }
    mu /= W; mv /= W;
    let vu = 0, vv = 0, ku = 0, kv = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = grid[j * res + i]; if (!(w > 0)) continue;
      const du = (i - mu) * cell, dv = (j - mv) * cell;
      vu += w * du * du; vv += w * dv * dv; ku += w * du ** 4; kv += w * dv ** 4;
    }
    vu /= W; vv /= W; ku /= W; kv /= W;
    return { W, mu: (mu + 0.5) * cell - half, mv: (mv + 0.5) * cell - half, vu, vv, ku, kv };
  }
  // number of equal-energy rays in a grid, given the per-ray energy
  const nRays = (W, e) => Math.round(W / e);

  // ---------------------------------------------------------------- 9. source-image scaling
  add(9, 'Source-image scaling: tiles grow with source size × magnification; tiny facets collapse to a cell', () => {
    const rows = []; let pass = true;
    const run = (s, ds, a, N, halfAngle, tgt) => {
      const sc = bare();
      Object.assign(sc.target, tgt || { size: 300, res: 100 });
      if (s > 0) Object.assign(sc.source, { kind: 'planar', shape: 'rect', w: s, h: s }); else sc.source.kind = 'point';
      sc.source.dist = 'cone'; sc.source.halfAngle = halfAngle;
      const P0 = [0, 0, ds], Z = [1000, 0, 0];
      const f = { type: 'facet', id: 'f', P: P0, S0: [0, 0, 0], Z, flat: true, di: null, clip: { kind: 'rect', hx: a / 2, hy: a / 2 }, optics: { interaction: 'reflect', reflectivity: 0.9 } };
      const P = prep(sc, [f]);
      const c = RF.Engine.runSync(P, N);
      return { m: moments(c.gridR, P.res, P.T.half), e: sc.source.power / N * 0.9, P, c, dt: V.dist(P0, Z), gam: Math.atan2(ds, 1000) };
    };
    // Part 1: Δσ² between an extended and a point source must equal (m·s)²/12 per axis
    // (m = d_t/d_s; v axis carries the target obliquity 1/cosγ).  Tolerance = 4·SE of the
    // Monte-Carlo variance difference + 1% for the neglected second-order terms ((s/d_s)² ≤ 0.7%).
    // (cone 6°: from the corner of the largest 4 mm die the facet edge sits at 3.8° off-axis, so
    // every source point sees the whole facet — the model's uniform-illumination premise)
    for (const ds of [50, 100]) {
      const N = 800000, base = run(0, ds, 1, N, 6);
      for (const s of [1, 2, 4]) {
        const r = run(s, ds, 1, N, 6);
        const m = r.dt / ds;
        const predU = (m * s) ** 2 / 12, predV = (m * s / Math.cos(r.gam)) ** 2 / 12;
        const nA = nRays(r.m.W, r.e), nB = nRays(base.m.W, base.e);
        const seU = Math.sqrt((r.m.ku - r.m.vu ** 2) / nA + (base.m.ku - base.m.vu ** 2) / nB);
        const seV = Math.sqrt((r.m.kv - r.m.vv ** 2) / nA + (base.m.kv - base.m.vv ** 2) / nB);
        const dU = r.m.vu - base.m.vu, dV = r.m.vv - base.m.vv;
        const okU = Math.abs(dU - predU) <= 4 * seU + 0.01 * predU, okV = Math.abs(dV - predV) <= 4 * seV + 0.01 * predV;
        pass = pass && okU && okV;
        rows.push('d_s=' + ds + ' s=' + s + 'mm (m=' + m.toFixed(2) + '): Δσ²u ' + dU.toFixed(1) + ' vs ' + predU.toFixed(1) + ' ±' + (4 * seU + 0.01 * predU).toFixed(1) + (okU ? ' ✓' : ' ✗') + ', Δσ²v ' + dV.toFixed(1) + ' vs ' + predV.toFixed(1) + (okV ? ' ✓' : ' ✗'));
      }
    }
    // Part 2: point source, shrinking facet → the tile's RMS width (measured on UNBINNED landing
    // points of 2000 engine-traced rays spread uniformly over the facet) falls monotonically, and
    // the smallest facet (footprint ≈ 0.5 cell) puts ≥ 95% of its energy in one 2×2 block.
    let prev = Infinity, mono = true; const widths = [];
    let last = null;
    for (const a of [16, 8, 4, 2, 1, 0.5]) {
      const r = run(0, 50, a, 400000, 15, { size: 1000, res: 50 });
      const rng = new RF.rng.Rng(4242);
      let n = 0, su = 0, sv = 0, suu = 0, svv = 0;
      for (let k = 0; k < 2000; k++) {
        const aim = V.add([0, 0, 50], V.add(V.mul(r.P.G.metas[0].frame.ex, (rng.next() - 0.5) * a), V.mul(r.P.G.metas[0].frame.ey, (rng.next() - 0.5) * a)));
        const e = RF.Checks.helpers.firstEvent(r.P, [0, 0, 0], aim, 'target');
        if (!e) continue;
        n++; su += e.u; sv += e.v; suu += e.u * e.u; svv += e.v * e.v;
      }
      const w = Math.sqrt(suu / n - (su / n) ** 2 + svv / n - (sv / n) ** 2) / 20;
      widths.push(a + 'mm→' + w.toFixed(3) + 'c');
      if (!(w < prev)) mono = false; prev = w; last = r;
    }
    const g = last.c.gridR, res = last.P.res; let best = 0, tot = 0;
    for (let k = 0; k < g.length; k++) tot += g[k];
    for (let j = 0; j + 1 < res; j++) for (let i = 0; i + 1 < res; i++) best = Math.max(best, g[j * res + i] + g[j * res + i + 1] + g[(j + 1) * res + i] + g[(j + 1) * res + i + 1]);
    const frac = best / tot;
    pass = pass && mono && frac >= 0.95;
    rows.push('shrinking facet RMS width: ' + widths.join(', ') + (mono ? ' (monotone ✓)' : ' (NOT monotone ✗)') + '; smallest facet: ' + (frac * 100).toFixed(1) + '% of its energy in one 2×2 block');
    return { pass, detail: rows.join(' · '), metrics: {} };
  });

  // ---------------------------------------------------------------- 10. collimation
  add(10, 'Collimation: revolved parabola with the source at its focus beats a flat array of equal aperture', () => {
    const mk = (kind, az) => {
      const store = RF.Controller.createStore(bare());
      const sc = store.scene; sc.mode = 'C';
      sc.modeC.axisMode = 'x';
      sc.modeC.preset = { kind, f: 10, rim: 30, n: 64, theta: 20, depth: 30 };
      if (az) sc.modeC.azSegments = az;
      RF.Controller.actions.applyPreset(store); store.commit();
      return store;
    };
    const par = mk('parabola'), flat = mk('flat', 12);
    const N = 100000;
    const sp = RF.Controller.simulate(par, N), sf = RF.Controller.simulate(flat, N);
    const T = sp.P.T, rms = (s) => { const m = moments(s.ctx.gridR, s.P.res, T.half); return Math.sqrt(m.vu + m.vv); };
    const rP = rms(sp), rF = rms(sf);
    // divergence of reflected rays traced from the focus, vs the chord bound
    const pts = par.scene.modeC.profile;
    let dpsi = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a0 = Math.atan2(pts[i][0], -pts[i][1]), a1 = Math.atan2(pts[i + 1][0], -pts[i + 1][1]);
      dpsi = Math.max(dpsi, Math.abs(a1 - a0));
    }
    let worst = 0, s2 = 0, n = 0;
    const rng = new RF.rng.Rng(99);
    for (let i = 0; i < 3000; i++) {
      const ct = 2 * rng.next() - 1, ph = 2 * Math.PI * rng.next(), st = Math.sqrt(1 - ct * ct);
      const d = [ct, st * Math.cos(ph), st * Math.sin(ph)];
      const e = RF.Checks.helpers.firstEvent(sp.P, [0, 0, 0], d, 'reflect');
      if (!e) continue;
      const ang = V.angle(e.dOut, [1, 0, 0]);
      worst = Math.max(worst, ang); s2 += ang * ang; n++;
    }
    const rmsDiv = Math.sqrt(s2 / n);
    // Bound (first principles): a chord's normal equals the parabola's at some interior point
    // (mean value theorem); along a segment the ideal normal turns by Δψ/2, so the reflected ray
    // errs by at most 2·Δψ/2 = Δψ, the largest angular step of the profile seen from the focus.
    const pass = worst <= dpsi && rP < rF;
    return {
      pass,
      detail: 'Parabola (f=10, rim 30, ' + (pts.length - 1) + ' rings): max divergence ' + (worst / D2R).toFixed(3) + '° (bound Δψ = ' + (dpsi / D2R).toFixed(3) + '°), RMS ' + (rmsDiv / D2R).toFixed(3) + '° over ' + n + ' rays; spot RMS radius ' + rP.toFixed(1) + ' mm. Flat array (12 flat facets, same 30 mm aperture): spot ' + rF.toFixed(1) + ' mm — ' + (rF / rP).toFixed(1) + '× larger.',
      metrics: { rP, rF, worst, dpsi },
    };
  });

  // ---------------------------------------------------------------- 11. scale invariance
  add(11, 'Scale invariance: every distance × k ⇒ identical normalised pattern (engine and solver)', () => {
    const store = RF.Controller.createStore(RF.State.defaultScene());
    RF.Controller.regenerateA(store);
    const sc = store.scene;
    sc.lenses = [{ id: 'l1', kind: 'fresnel', params: Object.assign(RF.Lenses.defaults('fresnel'), { axisMode: 'z', f: 25, a: 12 }) }];
    sc.groups.L.surfaces = RF.Lenses.buildAll(sc).surfaces;
    sc.sim.bounces = 3;
    const N = 30000;
    const norm = (c) => { const g = RF.Engine.gridTotal(c), s = g.reduce((a, b) => a + b, 0); return g.map((x) => x / s); };
    sc.modeB.stamps = [RF.ModeB.newStamp(sc, -250, 150, 120)];
    store.invalidate(['B']); store.commit();
    const ref = norm(RF.Engine.runSync(prep(sc), N));
    const rows = []; let pass = true;
    for (const k of [10, 0.1, 8]) {
      const s2 = RF.State.scaleScene(sc, k);
      const g = norm(RF.Engine.runSync(prep(s2), N));
      let md = 0, nd = 0; for (let i = 0; i < g.length; i++) { const d = Math.abs(g[i] - ref[i]); if (d > 0) nd++; md = Math.max(md, d); }
      // solver: scale only the INTENT, then re-solve every group (A, B stamps, lens) from it
      const st2 = RF.Controller.createStore(RF.State.scaleScene(sc, k));
      st2.invalidate(['A', 'B', 'C', 'L']); st2.commit({ forceA: true });
      const g2 = norm(RF.Engine.runSync(prep(st2.scene), N));
      let md2 = 0; for (let i = 0; i < g2.length; i++) md2 = Math.max(md2, Math.abs(g2[i] - ref[i]));
      // 1e-12: one ray moving cell would show up as ≥ 1/N ≈ 3e-5, so this demands no ray moves
      const ok = md <= 1e-12 && md2 <= 1e-12;
      pass = pass && ok;
      rows.push('×' + k + ': scaled scene max |Δ| ' + md.toExponential(1) + ' (' + nd + ' cells differ at all), re-solved design max |Δ| ' + md2.toExponential(1) + (ok ? ' ✓' : ' ✗'));
    }
    return { pass, detail: rows.join('; ') + '. Tolerance 1e-12 on the normalised grid.', metrics: {} };
  });

  // ---------------------------------------------------------------- 12. monotonicity
  add(12, 'Monotonicity: more envelope never lowers intercepted efficiency', () => {
    const rows = []; let pass = true;
    const seqs = [
      ['uniform growth', (sc, k) => { sc.envelope.half = sc.envelope.half.map((h) => h * k); }, [0.7, 0.85, 1, 1.2, 1.5]],
      ['wider coverage toward the target', (sc, k) => { const e = sc.envelope; const xmin = e.center[0] - e.half[0], xmax = e.center[0] + e.half[0] + k; e.center[0] = (xmin + xmax) / 2; e.half[0] = (xmax - xmin) / 2; }, [0, 10, 20, 35, 60]],
    ];
    const N = 60000;
    for (const [name, fn, ks] of seqs) {
      let prevE = -1, prevT = -1, prevN = 0; const vals = [];
      for (const k of ks) {
        const store = RF.Controller.createStore(RF.State.defaultScene());
        fn(store.scene, k);
        const rep = RF.Controller.regenerateA(store);
        const st = RF.Controller.simulate(store, N).stats;
        const ex = rep.capturedFraction, tr = st.effIntercepted;
        // exact (solid-angle) interception must not fall at all; traced value within 4 SE of MC noise
        const se = Math.sqrt((tr * (1 - tr) + prevT * (1 - prevT)) / N);
        const okE = ex >= prevE * (1 - 1e-12), okT = prevT < 0 || tr >= prevT - 4 * se;
        pass = pass && okE && okT;
        vals.push(k + ': ' + (ex * 100).toFixed(2) + '% / traced ' + (tr * 100).toFixed(2) + '%' + (okE && okT ? '' : ' ✗') + (rep.dropped ? ' (' + rep.dropped + ' dropped)' : ''));
        prevE = ex; prevT = tr; prevN = rep.placed;
      }
      rows.push(name + ' — ' + vals.join(', '));
    }
    return { pass, detail: rows.join(' · ') + '. Exact = solid-angle flux of placed facets (must be non-decreasing); traced must not fall by more than 4 standard errors.', metrics: {} };
  });

  // ---------------------------------------------------------------- 13. asymmetric envelope
  function asymScene() {
    const sc = RF.State.defaultScene();
    // tall deep box opening toward the target (+x); the source sits low on the z = 0 side wall,
    // deep in the box, facing across it (+z).
    sc.envelope = { shape: 'box', center: [-80, 0, 40], half: [80, 25, 40], axis: 2, keepOut: 6 };
    sc.source.pos = [-140, 0, 0.5]; sc.source.axis = [0, 0, 1];
    const res = sc.target.res; sc.modeA.paint = new Array(res * res).fill(0);
    const c = (res - 1) / 2;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) if ((i - c) ** 2 + (j - c) ** 2 <= 6.25) sc.modeA.paint[j * res + i] = 1;
    sc.modeA.budget = 60;
    return sc;
  }
  add(13, 'Asymmetric envelope: source low on a side wall of a tall deep box ⇒ stretched half-parabola, not a cap', () => {
    const store = RF.Controller.createStore(asymScene());
    const rep = RF.Controller.regenerateA(store);
    const sc = store.scene, S = sc.source.pos, fs = sc.groups.A.surfaces;
    const e = sc.envelope;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of fs) for (const p of f.clip.pts3) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    const spanX = (hi[0] - lo[0]) / (2 * e.half[0]), spanZ = (hi[2] - lo[2]) / (2 * e.half[2]);
    // shape test in the source frame: a paraboloid with focus S and axis toward the target has
    // r(1+cosψ)/2 = f constant (ψ from the vertex direction −x); a cap has r constant.
    const w = V.norm(V.sub(rep.frame.Zc, S));
    const cvs = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) / m; };
    const r = fs.map((f) => V.dist(f.P, S));
    const fpar = fs.map((f, k) => { const d = V.norm(V.sub(f.P, S)); return r[k] * (1 + V.dot(d, V.neg(w))) / 2; });
    const cvPar = cvs(fpar), cvSph = cvs(r), rr = Math.max(...r) / Math.min(...r);
    const pass = rep.ok && spanX >= 0.5 && spanZ >= 0.5 && rr >= 2.5 && cvPar < 0.5 * cvSph;
    return {
      pass,
      detail: rep.placed + ' facets span ' + (spanX * 100).toFixed(0) + '% of the box depth and ' + (spanZ * 100).toFixed(0) + '% of its height; facet distances from the source range ×' + rr.toFixed(1) + '. Coefficient of variation of the paraboloid parameter r(1+cosψ)/2: ' + cvPar.toFixed(3) + ' vs of a sphere\'s r: ' + cvSph.toFixed(3) + ' (paraboloid must fit ≥2× better). Spoke r0: ' + rep.spokes.filter((s) => s.r0).map((s) => s.r0.toFixed(1)).join(', ') + ' mm. Intercepted ' + (rep.capturedFraction * 100).toFixed(1) + '%.',
      metrics: { spanX, spanZ, rr, cvPar, cvSph },
    };
  });

  // ---------------------------------------------------------------- 15. infeasibility
  add(15, 'Infeasibility: unachievable targets are identified, with the binding constraint named', () => {
    const rows = []; let pass = true;
    const analyze = (sc) => { const st = RF.Controller.createStore(sc); const rep = RF.Controller.regenerateA(st); return RF.Feasibility.analyze(st.scene, { designReport: rep }); };
    const expect = (name, sc, key) => {
      const f = analyze(sc);
      const ok = key === null ? f.binding === null : f.binding === key;
      pass = pass && ok;
      const it = f.items.find((i) => i.key === (key || f.binding));
      rows.push(name + ' → ' + (f.binding ? f.summary : 'no binding') + (it ? ' [' + it.text + ']' : '') + (ok ? ' ✓' : ' ✗ expected ' + key));
    };
    // (a) 1-cell checkerboard with a 2 mm die ⇒ minimum feature size
    const a = RF.State.defaultScene(); { const st = RF.Controller.createStore(a); RF.Controller.actions.paintPreset(st, 'checker'); }
    expect('1-cell checkerboard', a, 'feature');
    // (b) 5 mm die in a 20 mm box, 10×10-cell spot ⇒ étendue
    const b = RF.State.defaultScene();
    b.source.w = b.source.h = 5; b.envelope = { shape: 'box', center: [-5, 0, 10], half: [10, 10, 10], axis: 2, keepOut: 5 };
    { const res = b.target.res, c = res / 2; b.modeA.paint = new Array(res * res).fill(0); for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) if (Math.abs(i - c + 0.5) < 5 && Math.abs(j - c + 0.5) < 5) b.modeA.paint[j * res + i] = 1; }
    expect('5 mm die, 20 mm envelope, 10×10 spot', b, 'etendue');
    // (c) ask for 95% of lamp flux from a shallow envelope ⇒ interceptable flux
    const c = RF.State.defaultScene(); c.modeA.requiredFlux = 95; c.envelope.half = [40, 45, 12]; c.envelope.center = [-20, 0, 12];
    expect('95% of lamp flux requested, shallow envelope', c, 'flux');
    // (d) control: the default design is achievable
    expect('control: default scene', RF.State.defaultScene(), null);
    return { pass, detail: rows.join(' · '), metrics: {} };
  });

  RF.Checks.helpers.moments = moments;
  RF.Checks.helpers.asymScene = asymScene;
})(typeof globalThis !== 'undefined' ? globalThis : this);
