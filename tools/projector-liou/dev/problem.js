/* problem.js — the solve's world: the spec as pixel bands, the ideal-beam grid, the source's samples and intensity, the model's grid.  Spec mode only so far. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, F = P3.fwd;
  const DEFAULTS = { step: 0.05, margin: 1.2, floorMargin: 1.2, gd: 0.34, peakCap: 300000, washCap: 12000, fluxFrac: 0.85, nSrc: 128, nDirs: 4000 };
  function problem(input, S, tools) {
    const src = input.source, env = input.envelope, spec = input.spec;
    if (!spec) throw new Error('projector-v3 needs Spec mode (paint mode is not built yet)');
    const conv = spec.conv || 'A', dd = spec.measure && +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;    // the host's JSON copy turns the far field (Infinity) into null
    const P = { S, input, src, env, E: P3.envBounds(env), keep: env.keepOut || 0, refl: input.limits.reflectivity, spec, conv, dist, win: spec.window.slice(), maxF: Math.max(1, input.limits.maxFacets | 0), Lp: src.pos.slice(), t0: Date.now(), notes: [], tools };
    P.g = T.grid(P.win, S.step, conv); P.B = T.bands(spec, P.g, { lo: S.floorMargin, hi: S.margin });
    P.grid = F.gridOf(P.win, S.step, conv, dist, P.Lp); P.S_ = F.sourceSamples(src, S.nSrc); P.gridA = F.gridOf(P.win, 0.1, conv, dist, P.Lp); P.gridB = F.gridOf(P.win, 0.5, conv, dist, P.Lp);
    P.cut = T.cutOf(spec, { slope: 1.0, lift: 0 });                          // null when the spec has no cut-off row
    P.I = (d) => { let s = 0; for (let b = 0; b < P.S_.n; b++) s += P.S_.q[b] * F.emitTo(P.S_, b, d[0], d[1], d[2]); return s; };      // lm per sr toward the unit vector d
    P.ledW = Math.max(src.w || 2, src.h || 2, 2 * (src.radius || 1), src.length || 0);
    P.lap = (s) => { if (S.verbose) console.log(`[${((Date.now() - P.t0) / 1000).toFixed(1)}s] ${s}`); };
    return P;
  }
  P3.problem = problem; P3.DEFAULTS = DEFAULTS;
})();
