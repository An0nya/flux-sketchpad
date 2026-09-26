/* Constellation: a built-in DEMONSTRATION OF A POOR SOLUTION (and the benchmark's "simple design" reference).
 * N tiny curved facets, each focusing a sharp image of the LED onto ONE painted cell; cells are spread evenly over
 * the painting.  Facets sit on a regular grid of directions within 60° of the LED axis, at `reach` of the way to
 * the envelope wall, `fill` of their grid spacing wide.  The target looks like a constellation of stamps: it catches
 * little of the LED's light, the facets block each other, and it can only light as many cells as it has facets.
 */
(function (root) {
  'use strict';
  const RF = root.RF;   // wrapped like the other environment files: workers load these before their own `const RF`
RF.Solvers.register({
  id: 'constellation', name: 'Constellation (demo: a poor solution)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'fill', label: 'Facet width ÷ grid spacing', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.5 },
    { key: 'reach', label: 'Distance out toward the wall', type: 'range', min: 0.3, max: 0.95, step: 0.05, default: 0.8 },
  ],
  solve(input, settings) {
    const V = RF.V, env = input.envelope, S0 = input.source.pos, N = input.limits.maxFacets, fr = RF.Source.frame(input.source);
    const T = RF.Engine.designFrame(input.target), res = input.paint.res, cw = 2 * T.half / res;
    const painted = []; input.paint.cells.forEach((w, k) => { if (w > 0) painted.push(k); });
    if (!painted.length) return { surfaces: [], intent: [], notes: ['nothing painted'] };
    const pick = Array.from({ length: N }, (_, m) => painted[Math.floor((m + 0.5) * painted.length / N) % painted.length]);   // evenly spread
    const aim = (k) => V.add(T.C, V.add(V.mul(T.tu, -T.half + (k % res + 0.5) * cw), V.mul(T.tv, -T.half + (Math.floor(k / res) + 0.5) * cw)));
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), th = Math.tan(60 * Math.PI / 180);
    const side = Math.ceil(Math.sqrt(N / 0.8)), step = 2 * th / side;              // a few spare grid points: some won't fit
    const surfaces = [], intent = [];
    for (let a = 0; a < side && surfaces.length < N; a++) for (let b = 0; b < side && surfaces.length < N; b++) {
      const x = -th + (a + 0.5) * step, y = -th + (b + 0.5) * step, d = V.norm(V.add(fr.a, V.add(V.mul(fr.u, x), V.mul(fr.v, y))));
      let wall = keep; while (RF.Geo.envInside(env, V.add(S0, V.mul(d, wall + 0.25)), 0) && wall < 1e4) wall += 0.25;
      const r = Math.max(keep + 1, settings.reach * wall), P = V.add(S0, V.mul(d, r));
      if (!RF.Geo.envInside(env, P, 0) || r > wall) continue;
      const k = pick[surfaces.length], Z = aim(k), n = V.norm(V.add(V.norm(V.sub(S0, P)), V.norm(V.sub(Z, P))));
      const e1 = V.norm(V.cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = V.cross(n, e1), s = 0.5 * settings.fill * r * step / Math.sqrt(1 + x * x + y * y);
      const pts3 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => V.add(P, V.add(V.mul(e1, p * s), V.mul(e2, q * s))));
      if (!pts3.every((p) => RF.Geo.envInside(env, p, 0) && V.dist(p, S0) > keep + 0.5)) continue;
      const id = 'C' + surfaces.length;
      surfaces.push({ type: 'facet', id, group: 'A', P, S0: S0.slice(), Z, flat: false, di: V.dist(Z, P), clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } });
      intent.push({ facet: id, cells: [[k, 1]] });
    }
    return { surfaces, intent, notes: [surfaces.length + ' tiny facets, one LED image per painted cell'] };
  },
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
