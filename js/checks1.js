/* checks1.js — verification suite, part 1 (checks 1–8).  Each check builds its own scene, runs
 * the REAL engine (probeRay / runSync share the production per-ray code path) and returns
 * { pass, detail, metrics }.  Tolerances are fixed up front from first principles and stated in
 * each check; they are never tuned to make a result pass.  Runs in-page and headless.        */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const D2R = Math.PI / 180;
  const list = [];
  const add = (id, name, fn, opts) => list.push(Object.assign({ id, name, fn }, opts || {}));

  // ---------------------------------------------------------------- helpers
  function bare(o) {
    const sc = RF.State.testScene();
    sc.source = Object.assign(sc.source, { kind: 'point', pos: [0, 0, 0], axis: [0, 0, 1], dist: 'isotropic' });
    sc.envelope = { shape: 'box', center: [0, 0, 0], half: [500, 500, 500], axis: 2, keepOut: 0 };
    sc.modeA.minDistance = sc.modeB.minDistance = 0;   // this scene sets its own keep-out (pre-split meaning): no extra min distance
    sc.modeA.paint.fill(0);
    for (const k of Object.keys(sc.groups)) sc.groups[k].surfaces = [];
    return Object.assign(sc, o || {});
  }
  function prep(sc, surfaces) { return RF.Engine.prepare(sc, surfaces || RF.State.allSurfaces(sc)); }
  const plane = (id, P, n, r, optics) => ({ type: 'plane', id, P, n: V.norm(n), clip: { kind: 'disc', r }, optics: Object.assign({ interaction: 'reflect', reflectivity: 0.9 }, optics || {}) });
  function firstEvent(P, o, d, type) {
    const pr = RF.Engine.probeRay(P, o, d);
    return pr.events.find((e) => e.type === type) || null;
  }
  const fmt = RF.U.fmt;

  // ---------------------------------------------------------------- 1. tilt doubling
  add(1, 'Tilt doubling: rotating a flat mirror by θ rotates the beam by exactly 2θ', () => {
    const sc = bare(), n0 = V.norm([-1, 0, -1]);
    const out = (th) => {
      const n = V.rotate(n0, [0, 1, 0], th * D2R);
      const P = prep(sc, [plane('m', [0, 0, 50], n, 40)]);
      const e = firstEvent(P, [0, 0, 0], [0, 0, 1], 'reflect');
      return e && e.dOut;
    };
    const base = out(0);
    let worst = 0; const rows = [];
    for (const th of [0.5, 3, 10, 20, -7]) {
      const d = out(th);
      const got = Math.atan2(V.dot(V.cross(base, d), [0, 1, 0]), V.dot(base, d));   // signed about +y
      const err = Math.abs(Math.abs(got) - 2 * Math.abs(th) * D2R);
      worst = Math.max(worst, err); rows.push(th + '° → ' + (got / D2R).toFixed(12) + '°');
    }
    // tolerance: 1e-12 rad — double precision after ~50 flops, not a physics allowance
    return { pass: worst < 1e-12, detail: rows.join('; ') + '. Max |error| = ' + worst.toExponential(2) + ' rad (tol 1e-12).', metrics: { worst } };
  });

  // ---------------------------------------------------------------- 2. bisector aim
  add(2, 'Bisector aim: the centre ray lands on the target point to floating-point precision', () => {
    const rng = new RF.rng.Rng(12345);
    const sc = bare();
    let worst = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      sc.target.tiltX = (rng.next() - 0.5) * 40; sc.target.tiltY = (rng.next() - 0.5) * 40;
      const T = RF.Engine.targetFrame(sc.target);
      const S0 = [(rng.next() - 0.5) * 4, (rng.next() - 0.5) * 4, (rng.next() - 0.5) * 4];
      const dir = V.norm([-(0.2 + rng.next()), (rng.next() - 0.5), (rng.next() - 0.5) * 2]);
      const Pf = V.madd(S0, dir, 20 + 60 * rng.next());
      const Z = RF.Engine.targetUVtoWorld(T, (rng.next() - 0.5) * 600, (rng.next() - 0.5) * 600);
      const curved = i % 2 === 1;
      const f = { type: 'facet', id: 'f' + i, P: Pf, S0, Z, flat: !curved, di: curved ? V.dist(Pf, Z) * (0.3 + 2 * rng.next()) : null, clip: { kind: 'rect', hx: 3, hy: 3 }, optics: { interaction: 'reflect', reflectivity: 0.9 } };
      const P = prep(sc, [f]);
      const e = firstEvent(P, S0, V.sub(Pf, S0), 'target');
      if (!e) continue;
      n++;
      worst = Math.max(worst, V.dist(e.point, Z) / V.dist(Pf, Z));
    }
    // 1e-12 relative: fp precision over a ~1 m path (≈ 1e-9 mm), far below any physical scale
    return { pass: n >= 50 && worst < 1e-12, detail: n + ' random facets (flat & curved, tilted targets): worst miss / path length = ' + worst.toExponential(2) + ' (tol 1e-12).', metrics: { worst, n } };
  });

  // ---------------------------------------------------------------- 3. law of reflection
  add(3, 'Law of reflection: angle in = angle out, coplanar (flat and curved surfaces)', () => {
    const rng = new RF.rng.Rng(777);
    const sc = bare();
    let worstA = 0, worstC = 0, n = 0;
    for (let i = 0; i < 80; i++) {
      const nrm = V.norm([rng.next() - 0.5, rng.next() - 0.5, -0.3 - rng.next()]);
      const surf = i % 2 ? plane('m', [0, 0, 60], nrm, 50)
        : { type: 'rev', id: 's', O: [0, 0, 60 + 40], W: [0, 0, 1], seg: { kind: 'arc', zc: 0, R: 40 + 20 * rng.next(), z0: -60, z1: -5 }, front: 1, optics: { interaction: 'reflect', reflectivity: 0.9 } };
      const P = prep(sc, [surf]);
      const d = V.norm([(rng.next() - 0.5) * 0.4, (rng.next() - 0.5) * 0.4, 1]);
      const e = firstEvent(P, [0, 0, 0], d, 'reflect');
      if (!e) continue;
      n++;
      const ai = V.angle(V.neg(e.dIn), e.normal), ao = V.angle(e.dOut, e.normal);
      worstA = Math.max(worstA, Math.abs(ai - ao));
      worstC = Math.max(worstC, Math.abs(V.dot(V.cross(e.dIn, e.normal), e.dOut)));
    }
    return { pass: n >= 60 && worstA < 1e-12 && worstC < 1e-12, detail: n + ' reflections: max |θin − θout| = ' + worstA.toExponential(2) + ' rad, max coplanarity residual = ' + worstC.toExponential(2) + ' (tol 1e-12).', metrics: { worstA, worstC } };
  });

  // ---------------------------------------------------------------- 4. Snell + TIR
  add(4, "Snell's law, and total internal reflection beyond the critical angle", () => {
    const sc = bare();
    const n2 = 1.5, crit = Math.asin(1 / n2);
    // glass occupies z > 50 (front = air side, facing −z)
    const glass = plane('g', [0, 0, 50], [0, 0, -1], 400, { interaction: 'refract', ior: n2, fresnelT: 0.96 });
    const P = prep(sc, [glass]);
    let worstS = 0, rows = [];
    for (const deg of [0, 10, 30, 50, 70, 85]) {
      const d = [Math.sin(deg * D2R), 0, Math.cos(deg * D2R)];
      const e = firstEvent(P, V.madd([0, 0, 50], d, -40), d, 'refract');
      const t = V.angle(e.dOut, [0, 0, 1]);
      worstS = Math.max(worstS, Math.abs(Math.sin(deg * D2R) - n2 * Math.sin(t)));
    }
    rows.push('air→glass max |n₁sinθ₁ − n₂sinθ₂| = ' + worstS.toExponential(2));
    // from inside the glass (ray travels −z toward the interface, from z = 90)
    let worstS2 = 0, tirOk = true, edgeOk = true, energyOk = true;
    for (const deg of [5, 20, 35, 40]) {
      const d = [Math.sin(deg * D2R), 0, -Math.cos(deg * D2R)];
      const e = firstEvent(P, V.madd([0, 0, 50], d, -40), d, 'refract');
      if (!e) { tirOk = false; continue; }
      worstS2 = Math.max(worstS2, Math.abs(n2 * Math.sin(deg * D2R) - Math.sin(V.angle(e.dOut, [0, 0, -1]))));
    }
    for (const deg of [45, 60, 80]) {
      const d = [Math.sin(deg * D2R), 0, -Math.cos(deg * D2R)];
      const pr = RF.Engine.probeRay(P, V.madd([0, 0, 50], d, -40), d, 1);
      const e = pr.events.find((x) => x.type === 'tir');
      if (!e) { tirOk = false; continue; }
      if (Math.abs(V.angle(V.neg(e.dIn), e.normal) - V.angle(e.dOut, e.normal)) > 1e-12) tirOk = false;
      if (e.E !== 1) energyOk = false;                          // TIR is lossless
    }
    // straddle the critical angle by ±1e-6 rad
    const straddle = (a) => { const d = [Math.sin(a), 0, -Math.cos(a)]; return RF.Engine.probeRay(P, V.madd([0, 0, 50], d, -40), d, 1).events[0].type; };
    const below = straddle(crit - 1e-6), above = straddle(crit + 1e-6);
    edgeOk = below === 'refract' && above === 'tir';
    rows.push('glass→air max residual = ' + worstS2.toExponential(2));
    rows.push('critical angle ' + (crit / D2R).toFixed(4) + '°: −1e-6 rad → ' + below + ', +1e-6 rad → ' + above);
    rows.push('TIR at 45/60/80° reflects by the law of reflection with no energy loss: ' + (tirOk && energyOk));
    return { pass: worstS < 1e-12 && worstS2 < 1e-12 && tirOk && edgeOk && energyOk, detail: rows.join('; ') + ' (tol 1e-12).', metrics: { worstS, worstS2 } };
  });

  // ---------------------------------------------------------------- 5. occlusion
  add(5, 'Occlusion: a surface directly behind another receives no light (with control)', () => {
    const sc = bare();
    sc.source.dist = 'cone'; sc.source.halfAngle = 8;
    const A = plane('A', [0, 0, 50], [0.3, 0, -1], 20), B = plane('B', [0, 0, 80], [0.3, 0, -1], 20);
    const run = (surfs) => { const P = prep(sc, surfs); const c = RF.Engine.runSync(P, 20000); return { c, P }; };
    const both = run([A, B]), ctrl = run([B]);
    const kA = both.P.G.metas.findIndex((m) => m.id === 'A'), kB = both.P.G.metas.findIndex((m) => m.id === 'B');
    const inB = both.c.surfIn[kB], inA = both.c.surfIn[kA], inBc = ctrl.c.surfIn[0];
    const pass = inB === 0 && inA > 0 && inBc > 0;
    return { pass, detail: 'With A in front: energy reaching A = ' + fmt(inA) + ', reaching B = ' + inB + '. Control (A removed): B receives ' + fmt(inBc) + '.', metrics: { inA, inB, inBc } };
  });

  // ---------------------------------------------------------------- 6. back face
  add(6, 'Back face: a ray striking the back of a mirror does not reflect to the target', () => {
    const sc = bare();
    sc.source.dist = 'cone'; sc.source.halfAngle = 5;
    const P0 = [0, 0, 50], Z = [1000, 0, 0];
    const facet = (flipBack, two) => ({ type: 'plane', id: 'm', P: P0, n: flipBack ? V.neg(V.norm(V.add(V.norm(V.sub([0, 0, 0], P0)), V.norm(V.sub(Z, P0))))) : V.norm(V.add(V.norm(V.sub([0, 0, 0], P0)), V.norm(V.sub(Z, P0)))), clip: { kind: 'disc', r: 15 }, optics: { interaction: 'reflect', reflectivity: 0.9, twoSided: !!two } });
    const r = (f) => RF.Engine.runSync(prep(sc, [f]), 20000).E;
    const front = r(facet(false)), back = r(facet(true)), two = r(facet(true, true));
    const pass = back.reflected === 0 && back.backface > 0 && front.reflected > 0 && two.reflected > 0;
    return { pass, detail: 'Front-facing: reflected to target ' + fmt(front.reflected) + '. Back-facing (one-sided): reflected ' + back.reflected + ', absorbed at back face ' + fmt(back.backface) + '. Same mirror flagged two-sided: reflected ' + fmt(two.reflected) + '.', metrics: { back: back.reflected } };
  });

  // ---------------------------------------------------------------- 7. energy conservation
  add(7, 'Energy conservation: accumulated + absorbed + escaped (+ cut) = emitted, R < 1, multiple bounces', () => {
    const store = RF.Controller.createStore(RF.State.testScene());
    RF.Controller.regenerateA(store);
    const sc = store.scene;
    sc.sim.bounces = 6; sc.sim.floor = 0.01;
    sc.lenses = [{ id: 'l1', kind: 'tir', params: RF.Lenses.defaults('tir') }];
    sc.lenses[0].params.axisMode = 'z';
    sc.groups.L.surfaces = RF.Lenses.buildAll(sc).surfaces;
    sc.groups.M.surfaces = [plane('abs', [-20, 0, 55], [0, 0, -1], 15, { interaction: 'absorb' }), plane('two', [10, 30, 20], [0, -1, 0], 12, { interaction: 'reflect', reflectivity: 0.7, twoSided: true })];
    const P = prep(sc);
    const c = RF.Engine.runSync(P, 50000);
    const E = c.E;
    const sum = E.direct + E.reflected + E.absorbed + E.backface + E.interfaceLoss + E.escaped + E.targetBack + E.truncated;
    const rel = Math.abs(sum - E.emitted) / E.emitted;
    const gridSum = RF.Engine.gridTotal(c).reduce((a, b) => a + b, 0);
    const gridRel = Math.abs(gridSum - (E.direct + E.reflected)) / E.emitted;
    const parts = ['on target (direct) ' + fmt(E.direct), 'on target (via surfaces) ' + fmt(E.reflected), 'absorbed ' + fmt(E.absorbed), 'back faces ' + fmt(E.backface), 'Fresnel loss ' + fmt(E.interfaceLoss), 'escaped ' + fmt(E.escaped + E.targetBack), 'cut (cap/floor) ' + fmt(E.truncated)];
    // 1e-9 relative: summation rounding over 50k rays × few terms (~1e-12 expected)
    return { pass: rel < 1e-9 && gridRel < 1e-9 && E.tir > 0 && E.absorbed > 0, detail: parts.join(', ') + ' — sum ' + fmt(sum) + ' vs emitted ' + fmt(E.emitted) + ' (|Δ|/E = ' + rel.toExponential(2) + '; grid total matches tallies to ' + gridRel.toExponential(2) + '). ' + P.G.n + ' surfaces, bounce cap ' + P.cap + '.', metrics: { rel } };
  });

  // ---------------------------------------------------------------- 8. determinism
  add(8, 'Determinism: identical runs give byte-identical grids (hash); progressive = one-shot', () => {
    const store = RF.Controller.createStore(RF.State.testScene());
    RF.Controller.regenerateA(store);
    const sc = store.scene;
    const P = prep(sc), N = 20000;
    const h1 = RF.Engine.gridHash(RF.Engine.runSync(P, N));
    const h2 = RF.Engine.gridHash(RF.Engine.runSync(prep(sc), N));
    // progressive: tiny time slices, arbitrary chunk boundaries
    const ctx = RF.Engine.newCtx(P, N, 0);
    let guard = 0; while (!RF.Engine.step(ctx, 0.05) && guard++ < 1e6);
    const h3 = RF.Engine.gridHash(ctx);
    // regenerate the design from scratch: solver determinism too
    const store2 = RF.Controller.createStore(RF.State.testScene());
    RF.Controller.regenerateA(store2);
    const h4 = RF.Engine.gridHash(RF.Engine.runSync(prep(store2.scene), N));
    const sc5 = RF.U.deepCopy(sc); sc5.sim.seed = 2;
    const h5 = RF.Engine.gridHash(RF.Engine.runSync(prep(sc5), N));
    const pass = h1 === h2 && h1 === h3 && h1 === h4 && h5 !== h1;
    return { pass, detail: 'run A ' + h1 + ', run B ' + h2 + ', progressive ' + h3 + ' (' + guard + ' slices), re-solved design ' + h4 + '; control with seed 2: ' + h5 + ' (must differ).', metrics: { h1, h2, h3, h4, h5 } };
  });

  RF.Checks = { list, add, helpers: { bare, prep, plane, firstEvent } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
