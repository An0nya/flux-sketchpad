/* gpu-page.js — the in-page half of tests/gpu.js: the same scenes traced by the CPU engine and by RF.GpuTrace, compared
 * ray by ray where the context records it (first surface per ray, hits) and in total everywhere else.  Loaded into a page
 * that has the app's engine files + js/gpu-trace.js (tests/gpu.js injects them).  window.GpuCompare.run(name) → report. */
(function () {
  'use strict';
  const RF = window.RF, E = RF.Engine;
  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const l1 = (a, b) => { let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - b[i]); s += Math.abs(a[i]); } return s > 0 ? d / s : d; };

  // ---- scenes
  function modeA() { const st = RF.Controller.createStore(RF.State.testScene()); RF.Controller.regenerateA(st); return { sc: st.scene, surfaces: RF.State.allSurfaces(st.scene) }; }
  function withSource(fn) { const s = modeA(); fn(s.sc.source, s.sc); return s; }
  function lens() {           // facets + an exact-Fresnel glass slab in front + an absorbing shield + a paraboloid dish (ring clip)
    const s = modeA(); s.sc.sim.bounces = 8;
    const T = s.sc.target, x0 = Math.min(60, T.distance * 0.2);
    s.surfaces = s.surfaces.concat([
      { type: 'plane', id: 'g1', P: [x0, 0, 0], n: [-1, 0, 0], clip: { kind: 'rect', hx: 60, hy: 60 }, optics: { interaction: 'refract', ior: 1.5, fresnel: 'exact' } },
      { type: 'plane', id: 'g2', P: [x0 + 6, 0, 0], n: [1, 0, 0], clip: { kind: 'rect', hx: 60, hy: 60 }, optics: { interaction: 'refract', ior: 1.5 } },
      { type: 'plane', id: 'sh', P: [x0 - 5, 0, 18], n: [-1, 0, 0], clip: { kind: 'disc', r: 6 }, optics: { interaction: 'absorb' } },
      { type: 'rev', id: 'dish', O: [0, 0, 0], W: [-1, 0, 0], seg: { kind: 'conic', zv: -12, R: 24, k: -1, r0: 40, r1: 55 }, front: -1, optics: { interaction: 'reflect', reflectivity: 0.85 } },
    ]);
    return s;
  }
  function spec(fix, preset) {
    const sc = RF.State.defaultScene(); sc.mode = 'D';
    RF.Spec.applyPreset(sc.modeD, preset || 'ece-r112-b'); RF.Spec.applyFixture(sc, fix || 'box');
    for (const g of ['A', 'B', 'C']) sc.groups[g].enabled = g === 'A';
    RF.SourcePresets.apply(sc.source, 'generic');
    sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc)); sc.modeA.paint = RF.Spec.seedPaint(sc);
    return sc;
  }
  async function specSolved(fix, preset, id, set) {
    const sc = spec(fix, preset); sc.solve = { id: id || 'auto' }; sc.solverSettings = { [sc.solve.id]: set || {} };
    const r = await RF.Solvers.runAsync(sc); return { sc, surfaces: r.output.surfaces, problem: problemOf(sc) };
  }
  function problemOf(sc) { const input = RF.Solvers.inputOf(sc); return Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } }); }

  // ---- one trace both ways
  async function both(sc, surfaces, N, opt) {
    opt = opt || {};
    const mk = () => { const P = E.prepare(sc, surfaces); P.recordHits = opt.hits !== false; if (opt.ff) { P.ffStreams = opt.ff; P.guideLearn = true; } return P; };
    const Pc = mk(), t0 = performance.now(), c = E.newCtx(Pc, N, opt.paths || 0); E.traceRange(c, 0, N); c.next = N; c.done = true; const cpuMs = performance.now() - t0;
    const Pg = mk(), g = E.newCtx(Pg, N, opt.paths || 0);
    await RF.GpuTrace.traceRange(g, 0, Math.min(N, 4096));                 // warm-up (pipeline, buffers) excluded from the timing
    const g2 = E.newCtx(mk(), N, opt.paths || 0), t1 = performance.now(); await RF.GpuTrace.traceRange(g2, 0, N); g2.next = N; g2.done = true; const gpuMs = performance.now() - t1;
    return { c, g: g2, cpuMs, gpuMs };
  }
  function compare(c, g) {
    const em = c.E.emitted, led = {};
    let worst = 0, worstK = '';
    for (const k of Object.keys(c.E)) { const d = Math.abs(g.E[k] - c.E[k]) / em; led[k] = d; if (d > worst) { worst = d; worstK = k; } }
    const out = { rays: c.N, ledgerWorst: worst, ledgerWorstKey: worstK, ledger: led,
      conservationCpu: E.stats(c).conservationError, conservationGpu: E.stats(g).conservationError,
      grid: l1(E.gridTotal(c), E.gridTotal(g)), surfIn: l1(c.surfIn, g.surfIn), out1K: l1(c.occ.out1K, g.occ.out1K), blockedK: l1(c.occ.blockedK, g.occ.blockedK) };
    if (c.rayK && g.rayK) { let diff = 0; for (let i = 0; i < c.N; i++) if (c.rayK[i] !== g.rayK[i]) diff++; out.rayKDiff = diff / c.N; out.hits = [c.nHits, g.nHits]; }
    if (c.hits && g.hits && c.nHits && g.nHits) {           // the same rays land: compare hit positions of rays both recorded (ray-indexed)
      const at = new Map(); for (let h = 0; h < c.nHits; h++) at.set(c.hitI[h], h);
      let n = 0, dE = 0, same = 0; const ds = [];
      for (let h = 0; h < g.nHits; h++) { const k = at.get(g.hitI[h]); if (k === undefined) continue; n++; const d = Math.hypot(g.hits[3 * h] - c.hits[3 * k], g.hits[3 * h + 1] - c.hits[3 * k + 1]); ds.push(d); if (d < 1e-2) same++; dE += Math.abs(g.hits[3 * h + 2] - c.hits[3 * k + 2]) / c.hits[3 * k + 2]; }
      ds.sort((a, b) => a - b); const cell = 2 * c.P.T.half / c.P.res, q = (p) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))] || 0;
      out.hitsMatched = n / Math.max(c.nHits, g.nHits); out.hitsSamePlace = same / Math.max(1, n); out.hitEnergyRel = dE / Math.max(1, n);
      out.hitShift = { cellMm: cell, p50: q(0.5), p99: q(0.99), p999: q(0.999), overCell: ds.filter((d) => d > cell).length / Math.max(1, n), distanceMm: c.P.T.C[0] };
    }
    if (c.ff) out.ff = c.ff.map((S, s) => ({ E: l1(S.E, g.ff[s].E), E2: l1(S.E2, g.ff[s].E2), lm: Math.abs(g.ff[s].lm - S.lm) / Math.max(1e-30, S.lm), rays: [S.rays, g.ff[s].rays] }));
    if (c.gl) out.gl = { Hn: l1(c.gl.Hn, g.gl.Hn), H: l1(c.gl.H, g.gl.H) };
    return out;
  }

  // the rays themselves: every source kind, GPU-sampled direction vs the CPU's (P.gpuEmitDump), in radians
  async function emission() {
    const st = RF.Controller.createStore(RF.State.testScene()); RF.Controller.regenerateA(st); const sc = st.scene, out = {};
    const kinds = { lambRect: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian' }, gaussDisc: { kind: 'planar', shape: 'disc', radius: 1.2, dist: 'gaussian', sigma: 40 },
      cone: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'cone', halfAngle: 70 }, point: { kind: 'point', dist: 'isotropic' }, ballGlow: { kind: 'volume', shape: 'sphere', radius: 1, dist: 'isotropic', emission: 'volume' },
      coil: { kind: 'volume', shape: 'cylinder', radius: 0.6, length: 4.5, dist: 'isotropic', emission: 'surface' }, ballSkin: { kind: 'volume', shape: 'sphere', radius: 1, dist: 'isotropic', emission: 'surface' }, dome: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian', dome: { r: 2.5, n: 1.41, z: 0 } } };
    for (const [name, src] of Object.entries(kinds)) {
      const s2 = Object.assign({}, sc, { source: Object.assign(RF.U.deepCopy(sc.source), { dome: null, emission: undefined }, src) }), N = 50000;
      const P = E.prepare(s2, RF.State.allSurfaces(s2)); P.gpuEmitDump = true; const g = E.newCtx(P, N, 0); await RF.GpuTrace.traceRange(g, 0, N);
      const F = g.emitDump, o = new Float64Array(3), d = new Float64Array(3), e = [];
      for (let i = 0; i < N; i++) { E.rayAt(P, i, o, d); e.push(Math.hypot(F[5 * i] - d[0], F[5 * i + 1] - d[1], F[5 * i + 2] - d[2])); }
      e.sort((a, b) => a - b); out[name] = { p50: e[N >> 1], p999: e[Math.floor(0.999 * N)], worst: e[N - 1], over: e.filter((x) => x > 1e-4).length / N };
    }
    return out;
  }

  const CASES = {
    emission,
    async modeA() { const s = modeA(); const r = await both(s.sc, s.surfaces, 400000, { paths: 240 }); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs, paths: [r.c.paths.length, r.g.paths.length] }); },
    async domeLed() { const s = withSource((src) => Object.assign(src, { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian', dome: { r: 2.5, n: 1.41, z: 0 } })); const r = await both(s.sc, s.surfaces, 300000); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs }); },
    async gaussianDisc() { const s = withSource((src) => Object.assign(src, { kind: 'planar', shape: 'disc', radius: 1.2, dist: 'gaussian', sigma: 40, dome: null })); const r = await both(s.sc, s.surfaces, 300000); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs }); },
    async filamentHB3() { const s = withSource((src) => RF.SourcePresets.apply(src, 'hb3')); const r = await both(s.sc, s.surfaces, 300000); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs, source: s.sc.source.kind + '/' + s.sc.source.shape + '/' + (s.sc.source.emission || '') }); },
    async multiEmitter() { const s = modeA(); s.sc.emitters = [Object.assign(RF.U.deepCopy(s.sc.source), { id: 'e2', enabled: true, pos: [0, 4, 0], power: s.sc.source.power * 0.5 })]; const r = await both(s.sc, s.surfaces, 300000); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs }); },
    async lensShieldDish() { const s = lens(); const r = await both(s.sc, s.surfaces, 300000); return Object.assign(compare(r.c, r.g), { cpuMs: r.cpuMs, gpuMs: r.gpuMs }); },
    // Spec mode: a solved design, the judge's own far-field streams + guided rounds, compared through RF.Solvers.trace vs traceAsync
    async specBox() {
      const s = await specSolved('box', 'ece-r112-b', 'auto');
      const o = { rays: 2e6, spec: true, road: true, ideal: true }, t0 = performance.now(), a = RF.Solvers.trace(s.problem, s.surfaces, o), cpuMs = performance.now() - t0;
      await RF.Solvers.traceAsync(s.problem, s.surfaces, { rays: 50000, spec: true, gpu: true });   // warm-up
      const t1 = performance.now(), b = await RF.Solvers.traceAsync(s.problem, s.surfaces, Object.assign({ gpu: true }, o)), gpuMs = performance.now() - t1;
      // guided rounds build their guide from the trace so far, and the guide weights dim cells by 1 / I: the few rays f32 moves across a
      // bin edge shift it by ~1 %, so later rounds are a different (equally valid) sample.  Compare as two independent estimates: Δ / (σ√2)
      const rows = a.spec.rows.map((r, i) => { const q = b.spec.rows[i]; return { name: r.name, cpu: r.value, gpu: q.value, sd: r.sd, z: r.sd > 0 ? (q.value - r.value) / (r.sd * Math.SQRT2) : 0, vc: r.verdict, vg: q.verdict }; });
      const zs = rows.map((r) => Math.abs(r.z)).filter(isFinite);
      // unguided at the CPU's aim: the same rays both ways, so the rows must agree far inside the noise
      const u = { rays: 1e6, spec: true, guided: false, frozen: a.spec.frozen }, uc = RF.Solvers.trace(s.problem, s.surfaces, u), ug = await RF.Solvers.traceAsync(s.problem, s.surfaces, Object.assign({ gpu: true }, u));
      const zf = uc.spec.rows.map((r, i) => (r.sd > 0 ? Math.abs((ug.spec.rows[i].value - r.value) / r.sd) : 0)).filter(isFinite);
      return { cpuMs, gpuMs, usedGpu: b.gpu && ug.gpu, surfaces: s.surfaces.length, verdict: [a.spec.verdict, b.spec.verdict], n: [a.spec.n, b.spec.n], aim: [a.spec.aim, b.spec.aim], lmWindow: [a.spec.lmWindow, b.spec.lmWindow],
        road: [a.road, b.road].map((r) => r && { right: r.right, left: r.left, glareMax: r.glareMax }), verdictFlips: rows.filter((r) => r.vc !== r.vg).map((r) => r.name + ' ' + r.vc + '→' + r.vg),
        zMax: Math.max(0, ...zs), zMean: zs.reduce((x, y) => x + y, 0) / Math.max(1, zs.length),
        zFrozenMax: Math.max(0, ...zf), zFrozenMean: zf.reduce((x, y) => x + y, 0) / Math.max(1, zf.length), frozenFlips: uc.spec.rows.filter((r, i) => r.verdict !== ug.spec.rows[i].verdict).map((r) => r.name), rows };
    },
    // throughput only: plain spec trace at the same ray count, CPU vs GPU
    async speed() {
      const s = await specSolved('box', 'ece-r112-b', 'auto'), out = [];
      for (const N of [250000, 1000000, 2000000]) {
        const t0 = performance.now(); RF.Solvers.trace(s.problem, s.surfaces, { rays: N, spec: true, guided: false }); const cpu = performance.now() - t0;
        await RF.Solvers.traceAsync(s.problem, s.surfaces, { rays: 20000, spec: true, guided: false, gpu: true });
        const t1 = performance.now(); await RF.Solvers.traceAsync(s.problem, s.surfaces, { rays: N, spec: true, guided: false, gpu: true }); const gpu = performance.now() - t1;
        out.push({ N, cpuMs: cpu, gpuMs: gpu, cpuMraysPerS: N / cpu / 1e3, gpuMraysPerS: N / gpu / 1e3 });
      }
      return { surfaces: s.surfaces.length, out };
    },
    // the same GPU trace twice: integer sums make it order-independent, so bit-identical
    async deterministic() { const s = modeA(); const mk = () => { const P = E.prepare(s.sc, s.surfaces); P.recordHits = true; return E.newCtx(P, 200000, 0); };
      const a = mk(), b = mk(); await RF.GpuTrace.traceRange(a, 0, 200000); await RF.GpuTrace.traceRange(b, 0, 100000); await RF.GpuTrace.traceRange(b, 100000, 200000);
      const ga = E.gridTotal(a), gb = E.gridTotal(b); let same = true; for (let i = 0; i < ga.length; i++) if (Math.abs(ga[i] - gb[i]) > 1e-12 * Math.abs(ga[i])) { same = false; break; }
      let rk = true; for (let i = 0; i < 200000; i++) if (a.rayK[i] !== b.rayK[i]) { rk = false; break; }
      return { oneShotVsChunked: same, rayK: rk, emitted: [a.E.emitted, b.E.emitted] }; },
  };
  window.GpuCompare = { CASES, run: async (name) => CASES[name](), init: () => { RF.GpuTrace.enable(true); return RF.GpuTrace.init(); }, info: () => ({ ready: RF.GpuTrace.ready(), info: RF.GpuTrace.info(), error: RF.GpuTrace.error() }) };
})();
