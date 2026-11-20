/* Static paint solver: facets on the LED's target-side hemisphere, each focused on an aim point chosen by an
 * equal-flux split of the painted cells. No tracing. */
const kdStatic = {
  id: 'bench-haiku55-cp-high--kd-facet', name: 'Static facets, equal-flux aim', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'focal', label: 'Max bowl focal length (mm; smaller if the cap will not fit)', type: 'number', min: 1, step: 0.5, default: 30 },
    { key: 'fill', label: 'Tile size (share of spacing)', type: 'range', min: 0.5, max: 1, step: 0.05, default: 0.9 },
    { key: 'cone', label: 'Emission cone used (deg from LED axis)', type: 'range', min: 20, max: 89, step: 1, default: 80 },
  ],
  solve(input, settings) {
    const V = RF.V, env = input.envelope, L = input.source.pos.slice(), ax = V.norm(input.source.axis);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.targetFrame(input.target), res = input.paint.res, paint = input.paint.cells;
    const C = T.C, eT = V.norm(V.sub(C, L));
    const N = Math.max(1, input.limits.maxFacets | 0), R = input.limits.reflectivity;
    const cosCone = Math.cos(settings.cone * Math.PI / 180);
    const shrunk = { shape: env.shape, center: env.center, half: env.half.map((x) => x - 1.5) };
    const inside = (p) => RF.Geo.envInside(shrunk, p, 0);

    const M = 4000, dirs = [];
    for (let i = 0; i < M; i++) {
      const z = 1 - 2 * (i + 0.5) / M, r = Math.sqrt(1 - z * z), phi = i * 2.399963229728653;
      const u = [r * Math.cos(phi), r * Math.sin(phi), z];
      if (V.dot(u, ax) >= cosCone && V.dot(u, eT) > 0.05) dirs.push(u);
    }
    if (!dirs.length) return { surfaces: [], intent: [], notes: ['no emission direction reaches the target side'] };
    const candAt = (f) => {
      const out = [];
      for (const u of dirs) {
        const r = 2 * f / (1 - V.dot(u, eT)), P = V.madd(L, u, r);
        if (inside(P) && V.dist(P, L) >= keep + 0.5) out.push({ u, r, P });
      }
      return out;
    };
    let cand = [], focal = settings.focal;
    for (let f = settings.focal; f >= 1; f -= 0.5) {
      const c = candAt(f);
      if (c.length > cand.length) { cand = c; focal = f; }
      if (cand.length >= N) break;
    }
    const n0 = Math.min(N, cand.length), omega = cand.length / M * 4 * Math.PI / Math.max(1, n0);
    const pick = [];
    for (let k = 0; k < n0; k++) pick.push(cand[Math.floor(k * cand.length / n0)]);

    const frame = (n) => {
      const h = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const e1 = V.norm(V.cross(n, h));
      return [e1, V.cross(n, e1)];
    };
    const normalFor = (P, Z) => V.norm(V.add(V.norm(V.sub(L, P)), V.norm(V.sub(Z, P))));
    const corners = (P, n, h) => {
      const [e1, e2] = frame(n);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => V.add(P, V.add(V.mul(e1, a * h), V.mul(e2, b * h))));
    };
    const fits = (cs) => cs.every((c) => inside(c) && V.dist(c, L) >= keep + 0.5);
    const fitTile = (P, n, h) => {
      let cc = corners(P, n, h);
      for (let t = 0; t < 20 && !fits(cc); t++) { h *= 0.9; cc = corners(P, n, h); }
      return fits(cc) ? { h, cc } : null;
    };

    const sites = [];
    for (const { u, r, P } of pick) {
      const n = normalFor(P, C), cosI = V.dot(n, V.norm(V.sub(L, P)));
      if (!(cosI > 0.05)) continue;
      const fit = fitTile(P, n, 0.5 * settings.fill * r * Math.sqrt(omega / cosI));
      if (!fit) continue;
      sites.push({ P, h: fit.h, flux: Math.max(1e-9, V.dot(u, ax)) * (2 * fit.h) ** 2 * cosI / (r * r) });
    }

    const cells = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = paint[j * res + i];
      if (w > 0) { const [u, v] = RF.Engine.cellCenter(T, i, j); cells.push({ k: j * res + i, w, u, v }); }
    }
    const centroid = (cs) => {
      let W = 0, u = 0, v = 0;
      for (const c of cs) { W += c.w; u += c.w * c.u; v += c.w * c.v; }
      return W > 0 ? { u: u / W, v: v / W } : { u: 0, v: 0 };
    };
    const aim = new Array(sites.length);
    const part = (fs, cs) => {
      if (!fs.length) return;
      if (fs.length === 1 || cs.length <= 1) {
        const c = centroid(cs);
        for (const k of fs) aim[k] = { u: c.u, v: c.v, cells: cs };
        return;
      }
      const half = fs.length >> 1, fl = fs.slice(0, half), fr = fs.slice(half);
      const fluxL = fl.reduce((a, k) => a + sites[k].flux, 0), fluxAll = fs.reduce((a, k) => a + sites[k].flux, 0);
      const us = cs.map((c) => c.u), vs = cs.map((c) => c.v);
      const byU = Math.max(...us) - Math.min(...us) >= Math.max(...vs) - Math.min(...vs);
      const sorted = cs.slice().sort((a, b) => (byU ? a.u - b.u : a.v - b.v));
      const W = sorted.reduce((a, c) => a + c.w, 0), target = (fluxL / fluxAll) * W;
      let acc = 0, cut = 0;
      while (cut < sorted.length - 1 && acc + sorted[cut].w / 2 < target) { acc += sorted[cut].w; cut++; }
      if (cut === 0) cut = 1;
      part(fl, sorted.slice(0, cut));
      part(fr, sorted.slice(cut));
    };
    part(sites.map((_, k) => k), cells);

    const surfaces = [], intent = [], notes = [];
    sites.forEach((s, k) => {
      const Z = RF.Engine.targetUVtoWorld(T, aim[k].u, aim[k].v);
      const fit = fitTile(s.P, normalFor(s.P, Z), s.h);
      if (!fit) return;
      const id = 'F' + surfaces.length;
      surfaces.push({ type: 'facet', id, P: s.P, S0: L.slice(), Z, flat: false, di: V.dist(Z, s.P),
        clip: { kind: 'poly', pts3: fit.cc }, optics: { interaction: 'reflect', reflectivity: R, twoSided: false } });
      intent.push({ facet: id, cells: aim[k].cells.map((c) => [c.k, c.w]) });
    });
    notes.push(surfaces.length + ' facets placed (cap ' + N + '), bowl focal ' + focal + ' mm, ' + (sites.length - surfaces.length) + ' dropped at tile fit');
    return { surfaces, intent, notes };
  },
};
RF.Solvers.register(kdStatic);

RF.Solvers.register({
  id: 'bench-haiku55-cp-high--kd-facet-auto', name: 'Tuned static facets (goal-driven)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [
      { value: 'faithful', label: 'Faithful: maximise fidelity' },
      { value: 'throw', label: 'Throw: brightest peak within 90% of best fidelity' },
      { value: 'efficient', label: 'Efficient: most light on paint within 90% of best fidelity' },
    ] },
  ],
  solve(input, settings, tools) {
    const num = (x) => (Number.isFinite(x) ? x : 0);
    const rows = [];
    for (const focal of [10, 14, 20, 26, 30]) for (const fill of [0.8, 0.9, 1.0]) {
      const s = { minDistance: settings.minDistance, focal, fill, cone: 80 }, out = kdStatic.solve(input, s);
      const t = tools.trace(out.surfaces, { rays: 200000, seed: input.seed });
      rows.push({ s, out, f: num(t.fidelity.fidelity), on: num(t.fidelity.onPaint), peak: num(t.peakCd) });
    }
    const bestF = Math.max(...rows.map((r) => r.f));
    const pool = settings.goal === 'faithful' ? rows : rows.filter((r) => r.f >= 0.9 * bestF);
    const key = settings.goal === 'throw' ? (r) => r.peak : settings.goal === 'efficient' ? (r) => r.on : (r) => r.f;
    let pick = pool[0];
    for (const r of pool) if (key(r) > key(pick)) pick = r;
    const notes = pick.out.notes.concat(['tuner (' + settings.goal + '): focal ' + pick.s.focal + ' mm, fill ' + pick.s.fill +
      ', fidelity ' + (100 * pick.f).toFixed(1) + '% at 200,000 rays, from ' + rows.length + ' candidates']);
    return { surfaces: pick.out.surfaces, intent: pick.out.intent, notes };
  },
});
