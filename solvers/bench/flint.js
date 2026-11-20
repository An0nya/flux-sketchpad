/* Flux solver v1 — static facet design (curved collimating facets).
 *
 * For every brightness level of the painting, the painted cells of that level are split into 8-connected
 * components; each component becomes one curved mirror facet (an ellipsoid with the design source point and
 * the component's aim point as foci) that delivers a flux proportional to the component's painted weight.
 */
RF.Solvers.register({
  id: 'bench-flint--flux-v1', name: 'Flux v1 (static)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
  ],
  solve(input, settings) {
    const V = RF.V, E = RF.Engine, G = RF.Geo, Src = RF.Source, PF = RF.Photometry;
    const env = input.envelope, src = input.source;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = E.targetFrame(input.target);
    const res = input.paint.res, cells = input.paint.cells;
    const half = T.half, cell = (2 * half) / T.res;
    const painted = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = cells[j * res + i];
      if (!(w > 0)) continue;
      painted.push({ k: j * res + i, i, j, u: -half + (i + 0.5) * cell, v: -half + (j + 0.5) * cell, w });
    }
    const surfaces = [], intent = [], notes = [];
    const maxF = input.limits.maxFacets;
    const tolE = 1e-6 * Math.max(...env.half);
    const inEnv = (p) => G.envInside(env, p, tolE);
    const byK = new Map(); for (let p = 0; p < painted.length; p++) byK.set(painted[p].k, p);
    const R = input.limits.reflectivity;
    const A = Src.emittingArea(src) || 1;
    const L = PF.luminance(src, Src.frame(src).a);
    let paintSum = 0; for (const p of painted) paintSum += p.w;
    const deliveredDesign = (R * L * A * A) / Math.pow(keep + 2, 2) * 38.5;
    const sc = deliveredDesign / Math.max(paintSum, 1e-9);
    const ws = [...new Set(painted.map((p) => +p.w.toFixed(4)))].sort((a, b) => b - a);
    for (const w of ws) {
      const seen = new Uint8Array(painted.length);
      const idxs = [];
      for (let p = 0; p < painted.length; p++) if (+painted[p].w.toFixed(4) === w) idxs.push(p);
      for (const s of idxs) {
        if (seen[s]) continue;
        const comp = [], stack = [s]; seen[s] = 1;
        while (stack.length) {
          const c = stack.pop(); comp.push(c);
          const pc = painted[c];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const ii = pc.i + di, jj = pc.j + dj;
            if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue;
            const q = byK.get(jj * res + ii);
            if (q === undefined || seen[q] || +painted[q].w.toFixed(4) !== w) continue;
            seen[q] = 1; stack.push(q);
          }
        }
        if (surfaces.length >= maxF) { notes.push('facet budget reached before brightness ' + w); break; }
        let uC = 0, vC = 0, wSum = 0;
        for (const c of comp) { uC += painted[c].u * painted[c].w; vC += painted[c].v * painted[c].w; wSum += painted[c].w; }
        uC /= wSum; vC /= wSum;
        const Z = E.targetUVtoWorld(T, uC, vC);
        let Rg = 0;
        for (const c of comp) { const d = Math.hypot(painted[c].u - uC, painted[c].v - vC); if (d > Rg) Rg = d; }
        const Tdist = V.dist(src.pos, Z);
        const wantDiam = Math.max(2 * Rg, 1e-3);
        const F = Math.max(sc * (w) * comp.length, 1e-9);
        const C = Math.max(1e-9, 4 * Rg * Rg);
        let rSafe = Math.sqrt((R * L * A * C) / F);
        const dirEm = V.norm(src.axis || [0, 0, 1]);
        const iv = G.envInterval(env, src.pos, dirEm);
        rSafe = Math.min(Math.max(rSafe, keep + 2), Math.max(1e-3, (iv ? iv[1] : 0) - 1));
        const P = V.add(src.pos, V.mul(dirEm, rSafe));
        const n = V.norm(V.add(V.sub(src.pos, P), V.sub(Z, P)));
        const ex = V.inPlane(n, [1, 0, 0]);
        const ey = V.norm(V.cross(n, ex));
        let hx = Rg * 1.05, hy = Rg * 1.05;
        {
          const cE = env.center, hh = env.half;
          const s0 = Math.max(1e-9, hx), t0 = Math.max(1e-9, hy);
          let f = 1;
          for (const a of [0, 1, 2]) {
            const cap = hh[a] - Math.abs(P[a] - cE[a]);
            const e1 = Math.abs(ex[a]), e2 = Math.abs(ey[a]);
            const need = s0 * e1 + t0 * e2;
            if (need > cap && need > 1e-12) f = Math.min(f, cap / need);
          }
          hx *= f; hy *= f;
        }
        const corners = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push(V.add(P, V.add(V.mul(ex, sx * hx), V.mul(ey, sy * hy))));
        const ok = inEnv(P) && corners.every(inEnv);
        if (!ok) { notes.push('component at weight ' + w + ' rejected'); continue; }
        const id = 'F' + surfaces.length;
        surfaces.push({ type: 'facet', id, group: 'A', P, S0: src.pos.slice(), Z: Z.slice(), flat: false, di: V.dist(Z, P),
          clip: { kind: 'rect', hx, hy, ref: [1, 0, 0] }, optics: { interaction: 'reflect', reflectivity: R, twoSided: false } });
        intent.push({ facet: id, cells: comp.map((c) => [painted[c].k, painted[c].w]) });
        notes.push('f ' + id + ' w=' + w + ' F=' + F.toFixed(4) + ' r=' + rSafe.toFixed(3) + ' di=' + V.dist(Z, P).toFixed(1) + ' hx=' + hx.toFixed(2) + ' n=' + comp.length + ' sc=' + sc.toFixed(5));
      }
    }
    notes.push(surfaces.length + ' curved facets for ' + painted.length + ' painted cells');
    return { surfaces, intent, notes };
  },
});
