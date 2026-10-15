/* compare.js — shared browser-worker / CLI comparison. Saved geometry, no solving, common measuring rules. */
(function (root) {
  'use strict';
  const RF = root.RF, PIN_BYTES = 256 * 1024;
  function snapshot(scene) { const s = Object.assign({}, scene); delete s.compareA; delete s.notices; return JSON.parse(RF.State.serialize(s)); }
  const pinSize = (s) => new TextEncoder().encode('{"version":1,"scene":' + RF.State.serialize(snapshot(s)) + '}').byteLength;
  function namesOf(b, names) { return names && names.length ? names : ['scene:' + (b.modeD.preset || 'custom')]; }
  function rules(b, name) {
    const md = RF.U.deepCopy(b.modeD || RF.Spec.defaults());
    if (!name.startsWith('scene:')) { if (!RF.Spec.PRESETS[name]) throw new Error('unknown spec ' + name); RF.Spec.applyPreset(md, name); }
    md.distance = 0; return md;
  }
  function setup(a, b, o) {
    o = o || {}; const N = o.rays === undefined ? 300000 : +o.rays;
    if (!Number.isInteger(N) || N < 100 || N > 20000000) throw new Error('compare rays must be an integer from 100 to 20000000');
    const names = namesOf(b, o.specs), mds = names.map((n) => rules(b, n)), win = mds.map(RF.Spec.windowOf).reduce((w, q) => [Math.min(w[0], q[0]), Math.max(w[1], q[1]), Math.min(w[2], q[2]), Math.max(w[3], q[3])]);
    if (mds.some((md) => (md.conv || 'A') !== (mds[0].conv || 'A'))) throw new Error('comparison presets must use the same angle convention; compare them separately');
    return { N, names, mds, win, step: Math.min(...mds.map((md) => md.step || 0.1)), seed: b.sim.seed | 0, bounces: Math.max(3, a.sim.bounces, b.sim.bounces) };
  }
  // Same pilot + guided rounds as tools/flux.js farTrace. Wide stream supplies reach and beam core.
  function trace(scene, cfg) {
    const sc = snapshot(scene); sc.sim.seed = cfg.seed; sc.sim.bounces = cfg.bounces; sc.modeD = RF.U.deepCopy(cfg.mds[0]);
    const fine = Object.assign(RF.Spec.gridOpts(sc, 0), { win: cfg.win, step: cfg.step }), wide = RF.Spec.wideOpts(sc, 0);
    wide.win = [Math.min(wide.win[0], cfg.win[0]), Math.max(wide.win[1], cfg.win[1]), Math.min(wide.win[2], cfg.win[2]), Math.max(wide.win[3], cfg.win[3])];
    const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [fine, wide]; P.guideLearn = true;
    const c = traceContext(P, cfg.N);
    return { sc, P, c, G: RF.FarField.build(c, fine), W: RF.FarField.build(c, wide) };
  }
  function traceContext(P, N) {
    const n0 = Math.min(N, Math.max(100000, Math.floor(N / 4)));
    let c = RF.Engine.newCtx(P, n0, 0); RF.Engine.traceRange(c, 0, n0); c.next = n0; c.done = true;
    while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
    return c;
  }
  function measure(t, cfg) {
    const { G, W, sc, P, c } = t, specs = {}, evs = [];
    cfg.names.forEach((name, i) => {
      const ev = RF.Spec.evaluate(G, cfg.mds[i]); evs.push(ev);
      specs[name] = { verdict: ev.verdict, pass: ev.n.pass, fail: ev.n.fail, unsure: ev.n.unsure, score: ev.score, aim: { note: ev.aim.note, shift: ev.shift }, rows: ev.rows.map((r) => ({ name: r.name, verdict: r.verdict, value: r.value, sd: r.sd, bound: r.bound, isMin: r.isMin })) };
    });
    const ev = evs[0], md = cfg.mds[0], road = RF.Road.resolve(md.road, md.preset), rd = RF.Road.analyse({ G, W, ev }, md, road, { quality: true });
    const k = md.kernel || 0.15, M = RF.FarField.map(G, k); let peakCd = 0;
    for (const v of M.cd) if (v > peakCd) peakCd = v;
    const fd = RF.Photometry.fidelity(sc, P, c), q = rd.quality, core = q && !q.empty && q.core['1/4'];
    const metrics = { lmWindow: G.lmWindow, peakCd, reachRightM: rd.iihs.right, reachLeftM: rd.iihs.left, coreWidthDeg: core ? core.width : null, coreHeightDeg: core ? core.height : null, fidelity: fd && Number.isFinite(fd.fidelity) ? fd.fidelity : null };
    // Display in the judge's frame. Both pictures sample the same axes, kernel and colour scale.
    const cd = new Float32Array(G.nh * G.nv), sh = ev.shift || [0, 0];
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) { const v = RF.FarField.intensityAt(G, G.h0 + (i + 0.5) * G.step + sh[0], G.v0 + (j + 0.5) * G.step + sh[1], k).cd; cd[j * G.nh + i] = v; }
    return { metrics, specs, map: { cd, nh: G.nh, nv: G.nv, h0: G.h0, v0: G.v0, step: G.step } };
  }
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  function diff(a, b) {
    const rows = [];
    for (const k of Object.keys(a.metrics)) { const A = a.metrics[k], B = b.metrics[k]; rows.push({ metric: k, a: A, b: B, delta: finite(A) && finite(B) ? B - A : null }); }
    for (const name of Object.keys(a.specs)) for (const k of ['verdict', 'pass', 'fail', 'unsure', 'score']) {
      const A = a.specs[name][k], B = b.specs[name][k]; rows.push({ metric: name + '.' + k, a: A, b: B, delta: finite(A) && finite(B) ? B - A : null });
    }
    return rows;
  }
  function run(a, b, o) {
    const cfg = setup(a, b, o), A = measure(trace(a, cfg), cfg), B = measure(trace(b, cfg), cfg), rows = diff(A, B);
    const result = { rays: cfg.N, seed: cfg.seed, bounces: cfg.bounces, specs: cfg.names, measuring: 'far field; B spec/road settings; each beam independently judged by the same aim procedure; fidelity against each design’s own paint', a: { metrics: A.metrics, specs: A.specs }, b: { metrics: B.metrics, specs: B.specs }, diff: rows };
    if (o && o.maps) { let top = 0; for (const m of [A.map, B.map]) for (const v of m.cd) if (v > top) top = v; result.maps = { a: A.map, b: B.map, top }; }
    return result;
  }
  RF.Compare = { snapshot, pinSize, PIN_BYTES, setup, trace, traceContext, measure, diff, run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
