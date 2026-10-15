/* manufacturability.js — read-only measurements of the compiled optical patches, shared by page and CLI.
 * Exact quadric differential geometry; finite spatial sampling, not a closed-solid mould analysis. */
(function (root) {
  'use strict';
  const RF = root.RF, { V, Geo } = RF, cache = new WeakMap(), DEG = 180 / Math.PI;
  const SOURCE = 'https://www.protolabs.com/resources/design-tips/improving-part-moldability-with-draft/';
  const METRICS = {
    curvature: { label: 'Max |principal curvature|', unit: '1/mm' },
    gaussian: { label: 'Gaussian curvature K', unit: '1/mm²' },
    mean: { label: 'Mean curvature H', unit: '1/mm' },
    draft: { label: 'Minimum signed draft', unit: '°' },
    step: { label: 'Maximum seam step', unit: 'mm' },
    feature: { label: 'Minimum physical feature', unit: 'mm' },
  };
  const CONVENTIONS = {
    curvature: 'Exact implicit-quadric shape operator −Dn, using the optical FRONT normal. H=(k1+k2)/2, K=k1*k2; an outward sphere has k1=k2=−1/R. Values sampled at display-patch vertices and a projected centre; extrema are sampled, not guaranteed global extrema.',
    draft: 'asin(frontNormal · unitPull), degrees. 0° = wall parallel to pull, +90° = front normal along pull. Negative draft = local undercut for this one-sided pull, including two-sided optical surfaces. This does not test global trapping or model a closed mould.',
    feature: 'Minimum aperture width in the local tangent plane (rectangle short side, disc diameter, convex polygon minimum caliper width; revolved patch: min(profile length, maximum diameter)), also bounded by the smallest positive matched seam height. Display tessellation edges are not physical features. No wall thickness is present in the optical scene.',
    step: 'Estimated adjacent boundaries: same group and optical interaction, near-parallel edges overlapping in the pull plane with interiors on opposite sides, within 2% of the smaller aperture width (minimum tolerance 0.00001 mm). Boundary separation must be at most half that width; larger separations are treated as separate parts/unknown. Facet-shell neighbors use the known ring/sector topology and nominal unedited seam instead (the shell deliberately overlaps cell apertures). Step is maximum absolute separation along pull at seam ends and midpoint, using exact quadrics. Shell values compare the sheets at nominal seams, not added sidewalls. Unmatched boundaries are unknown, not zero. Coincident continuous seams are zero; gaps/overlaps beyond tolerance are not matched.',
    guideline: '2° default warning threshold, adjustable. Typical starting range 1–3°: Protolabs suggests 1–2° for most situations, 3° for light texture; material, depth and finish matter.',
    source: SOURCE,
    opticalFeature: 'The existing feasibility minimum-feature warning measures source-image blur in target cells, not physical facet width in mm.',
  };
  const range = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return lo <= hi ? [lo, hi] : [null, null]; };
  const local = (D, o, p) => { const d = V.sub(p, Array.from(D.subarray(o, o + 3))); return [0, 1, 2].map((i) => d[0] * D[o + 3 + 3 * i] + d[1] * D[o + 4 + 3 * i] + d[2] * D[o + 5 + 3 * i]); };
  const world = (D, o, p) => [0, 1, 2].map((i) => D[o + i] + p[0] * D[o + 3 + i] + p[1] * D[o + 6 + i] + p[2] * D[o + 9 + i]);
  const mulQ = (D, o, p) => [D[o + 12] * p[0] + D[o + 15] * p[1] + D[o + 16] * p[2], D[o + 15] * p[0] + D[o + 13] * p[1] + D[o + 17] * p[2], D[o + 16] * p[0] + D[o + 17] * p[1] + D[o + 14] * p[2]];
  function gradient(D, o, p) { const q = mulQ(D, o, p); return q.map((v, i) => 2 * v + D[o + 18 + i]); }
  function sample(G, k, point, project) {
    const D = G.D, o = k * Geo.STRIDE; let p = local(D, o, point);
    // Patch centres are chords of the display mesh. Lift them onto the exact sheet before measuring.
    if (project) for (let i = 0; i < 12; i++) {
      const g = gradient(D, o, p), g2 = V.dot(g, g), f = V.dot(p, mulQ(D, o, p)) + V.dot(p, Array.from(D.subarray(o + 18, o + 21))) + D[o + 21];
      if (g2 < 1e-24) break;
      p = V.madd(p, g, -f / g2); if (Math.abs(f) / Math.sqrt(g2) < 1e-10) break;
    }
    const g = gradient(D, o, p), len = V.len(g), sign = D[o + 33];
    if (!(len > 1e-12) || !p.every(Number.isFinite)) return null;
    const n = V.mul(g, sign / len), [u, v] = V.basis(n), h = (a, b) => -2 * sign * V.dot(a, mulQ(D, o, b)) / len;
    const a = h(u, u), b = h(u, v), c = h(v, v), H = (a + c) / 2, d = Math.hypot((a - c) / 2, b), nn = [0, 0, 0];
    Geo.frontNormal(D, k, p[0], p[1], p[2], nn);
    return { point: world(D, o, p), normal: nn, mean: H, gaussian: a * c - b * b, k1: H - d, k2: H + d, curvature: Math.max(Math.abs(H - d), Math.abs(H + d)) };
  }
  function width(G, k) {
    const D = G.D, o = k * Geo.STRIDE, ct = D[o + 22], m = G.metas[k];
    if (ct === Geo.CLIP.rect) return 2 * Math.min(D[o + 23], D[o + 24]);
    if (ct === Geo.CLIP.disc) return 2 * D[o + 23];
    if (ct === Geo.CLIP.poly) {
      const pts = m.poly2; let w = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-12) continue;
        const r = range(pts.map((p) => (dx * p[1] - dy * p[0]) / l)); w = Math.min(w, r[1] - r[0]);
      }
      return Number.isFinite(w) ? w : null;
    }
    let length = 0, rmax = 0;
    const prof = m.prof || (m.seg ? { zs: [m.seg.z0, m.seg.z1], rs: [m.seg.r0, m.seg.r1] } : null);
    if (prof) { for (let i = 0; i < prof.rs.length; i++) { rmax = Math.max(rmax, prof.rs[i]); if (i) length += Math.hypot(prof.rs[i] - prof.rs[i - 1], prof.zs[i] - prof.zs[i - 1]); } }
    else { const R = Math.sqrt(Math.max(0, -D[o + 21] + (D[o + 20] / 2) ** 2)), zc = -D[o + 20] / 2; length = R * Math.abs(Math.acos(RF.U.clamp((m.zlo - zc) / R, -1, 1)) - Math.acos(RF.U.clamp((m.zhi - zc) / R, -1, 1))); rmax = m.rmaxSeg || R; }
    return Number.isFinite(length) ? Math.min(length, 2 * rmax) : null;
  }
  function prepare(G, polys, scene) {
    let data = cache.get(G); if (data) return data;
    if (!polys) { polys = []; for (let k = 0; k < G.n; k++) for (const pts of Geo.mesh(G, k)) polys.push({ k, pts, id: G.metas[k].id }); }
    const groups = new Map(); for (const [g, entry] of Object.entries(scene.groups || {})) for (const s of entry.surfaces || []) groups.set(s.id, g);
    const rows = G.metas.map((m, k) => ({ id: m.id, group: m.group || groups.get(m.id) || '', kind: m.kind, apertureWidthMm: width(G, k), samples: [] }));
    const faces = polys.map((p) => {
      const c = V.mul(p.pts.reduce((s, q) => V.add(s, q), [0, 0, 0]), 1 / p.pts.length), samples = [sample(G, p.k, c, true), ...p.pts.map((q) => sample(G, p.k, q, false))].filter(Boolean);
      rows[p.k].samples.push(...samples); return { k: p.k, samples };
    });
    // Only physical boundary edges: cancel the internal edges of revolved display strips.
    const edges = [];
    for (let k = 0; k < G.n; k++) {
      const seen = new Map(), key = (p) => p.map((x) => x.toFixed(7)).join(',');
      for (const pts of Geo.outline(G, k)) for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]; if (V.dist(a, b) < 1e-9) continue;
        const ka = key(a), kb = key(b), id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (seen.has(id)) seen.delete(id); else seen.set(id, { k, a, b, inside: V.mul(pts.reduce((s, q) => V.add(s, q), [0, 0, 0]), 1 / pts.length) });
      }
      edges.push(...seen.values());
    }
    data = { G, polys, rows, faces, edges, result: null, key: '' }; cache.set(G, data); return data;
  }
  // Height of the exact sheet above a point, along pull; choose the root nearest the boundary seed.
  function height(G, k, seed, pull) {
    const D = G.D, o = k * Geo.STRIDE, p = local(D, o, seed), d = [0, 1, 2].map((i) => V.dot(pull, Array.from(D.subarray(o + 3 + 3 * i, o + 6 + 3 * i)))), L = Array.from(D.subarray(o + 18, o + 21));
    const roots = RF.U.quadRoots(V.dot(d, mulQ(D, o, d)), 2 * V.dot(p, mulQ(D, o, d)) + V.dot(L, d), V.dot(p, mulQ(D, o, p)) + V.dot(L, p) + D[o + 21]).filter(Number.isFinite);
    return roots.length ? roots.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b) : null;
  }
  function shellSeams(data, pull, scene) {
    if (!RF.Profile || !RF.Profile.shellOn(scene.modeC)) return [];
    const mc = scene.modeC, sh = mc.shell, fr = RF.Profile.axisFrame(scene, mc.axisMode), W = mc.reverseAxis ? V.neg(fr.W) : fr.W, e2 = mc.reverseAxis ? V.neg(fr.e2) : fr.e2;
    const ids = new Map(data.rows.map((r, k) => [r.id, k])), out = [];
    const at = (r, ph) => V.add(fr.O, V.add(V.mul(W, sh.zv + Geo.conicSag(sh.R, sh.k || 0, r)), V.add(V.mul(fr.e1, r * Math.cos(ph)), V.mul(e2, r * Math.sin(ph)))));
    const pair = (ka, kb, points) => {
      if (ka === undefined || kb === undefined) return;
      let step = 0;
      for (const p of points) {
        const a = height(data.G, ka, p, pull), b = height(data.G, kb, p, pull), reach = 2 * Math.max(data.rows[ka].apertureWidthMm || 0, data.rows[kb].apertureWidthMm || 0);
        if (a === null || b === null || Math.max(Math.abs(a), Math.abs(b)) > reach) return;
        step = Math.max(step, Math.abs(a - b));
      }
      out.push({ a: data.rows[ka].id, b: data.rows[kb].id, ka, kb, stepMm: step < 1e-8 ? 0 : step, toleranceMm: null, method: 'shell topology, nominal seam' });
    };
    for (let i = 0; i < sh.nRad; i++) for (let a = 0; a < sh.nAng; a++) {
      const k = ids.get('S' + i + '_' + a), ph = 2 * Math.PI * (a + 1) / sh.nAng;
      pair(k, ids.get('S' + i + '_' + ((a + 1) % sh.nAng)), [0, 0.5, 1].map((t) => at(sh.r1 * (i + t) / sh.nRad, ph)));
      if (i + 1 < sh.nRad) pair(k, ids.get('S' + (i + 1) + '_' + a), [0, 0.5, 1].map((t) => at(sh.r1 * (i + 1) / sh.nRad, 2 * Math.PI * (a + t) / sh.nAng)));
    }
    return out;
  }
  function seams(data, pull, scene) {
    const [u, v] = V.basis(pull), uv = (p) => [V.dot(p, u), V.dot(p, v)], pairs = new Map();
    const edges = data.edges.map((e) => { const a = uv(e.a), b = uv(e.b); return Object.assign({}, e, { a2: a, b2: b, lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) }); }).sort((a, b) => a.lo - b.lo);
    const maxTol = Math.max(0.00001, ...data.rows.map((r) => (r.apertureWidthMm || 0) * 0.02));
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i], dx = e.b2[0] - e.a2[0], dy = e.b2[1] - e.a2[1], len = Math.hypot(dx, dy); if (len < 1e-8) continue;
      const tx = dx / len, ty = dy / len;
      for (let j = i + 1; j < edges.length && edges[j].lo <= e.hi + maxTol; j++) {
        const f = edges[j]; if (e.k === f.k || data.rows[e.k].group !== data.rows[f.k].group || data.G.D[e.k * Geo.STRIDE + 28] !== data.G.D[f.k * Geo.STRIDE + 28]) continue;
        if (RF.Profile && RF.Profile.shellOn(scene.modeC) && /^S\d+_\d+$/.test(data.rows[e.k].id) && /^S\d+_\d+$/.test(data.rows[f.k].id)) continue;
        const tol = Math.max(0.00001, 0.02 * Math.min(data.rows[e.k].apertureWidthMm || 0, data.rows[f.k].apertureWidthMm || 0));
        const fx = f.b2[0] - f.a2[0], fy = f.b2[1] - f.a2[1], fl = Math.hypot(fx, fy);
        if (fl < 1e-8 || Math.abs(tx * fy - ty * fx) > 0.1 * fl) continue;
        const rel = (p) => [tx * (p[0] - e.a2[0]) + ty * (p[1] - e.a2[1]), -ty * (p[0] - e.a2[0]) + tx * (p[1] - e.a2[1])], a = rel(f.a2), b = rel(f.b2);
        if (Math.max(Math.abs(a[1]), Math.abs(b[1])) > tol) continue;
        if (rel(uv(e.inside))[1] * rel(uv(f.inside))[1] >= 0) continue;
        const lo = Math.max(0, Math.min(a[0], b[0])), hi = Math.min(len, Math.max(a[0], b[0])); if (hi - lo < Math.max(1e-7, Math.min(len, fl) * 0.05)) continue;
        const reach = 0.5 * Math.min(data.rows[e.k].apertureWidthMm || 0, data.rows[f.k].apertureWidthMm || 0);
        let step = 0, count = 0, far = false;
        for (const t of [lo, (lo + hi) / 2, hi]) {
          const seed = V.madd(e.a, V.sub(e.b, e.a), t / len), other = V.madd(f.a, V.sub(f.b, f.a), (t - a[0]) / (b[0] - a[0]));
          if (V.dist(seed, other) > reach + tol) { far = true; break; }
          const seed2 = V.madd(seed, pull, V.dot(V.sub(other, seed), pull)), h1 = height(data.G, e.k, seed, pull), h2 = height(data.G, f.k, seed2, pull);
          if (h1 !== null && h2 !== null) { step = Math.max(step, Math.abs(V.dot(V.sub(seed2, seed), pull) + h2 - h1)); count++; }
        }
        if (!count || far || step > reach + tol) continue;
        if (step < 1e-8) step = 0;
        const ka = Math.min(e.k, f.k), kb = Math.max(e.k, f.k), key = ka + ':' + kb, old = pairs.get(key);
        if (!old || old.stepMm < step) pairs.set(key, { a: data.rows[ka].id, b: data.rows[kb].id, ka, kb, stepMm: step, toleranceMm: tol, method: 'near boundary estimate' });
      }
    }
    return [...pairs.values(), ...shellSeams(data, pull, scene)];
  }
  function analyze(scene, opts) {
    opts = opts || {};
    const raw = opts.pull || scene.source.axis;
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(Number.isFinite) || V.len(raw) < 1e-12) throw new Error('Pull direction must be three finite numbers and non-zero.');
    const pull = V.norm(raw), draftMinDeg = opts.draftMinDeg === undefined ? 2 : opts.draftMinDeg;
    if (!Number.isFinite(draftMinDeg) || draftMinDeg < 0 || draftMinDeg > 90) throw new Error('Minimum draft must be between 0 and 90 degrees.');
    const G = opts.G || Geo.compile(RF.State.allSurfaces(scene)), data = prepare(G, opts.polys, scene), key = JSON.stringify([pull, draftMinDeg]);
    if (data.key === key) return data.result;
    const draft = (s) => Math.asin(RF.U.clamp(V.dot(s.normal, pull), -1, 1)) * DEG;
    const rows = data.rows.map((r) => {
      const ds = range(r.samples.map(draft)), ks = range(r.samples.flatMap((s) => [s.k1, s.k2]));
      return { id: r.id, group: r.group, kind: r.kind, samples: r.samples.length, apertureWidthMm: r.apertureWidthMm, featureMm: r.apertureWidthMm,
        principalPerMm: ks, meanPerMm: range(r.samples.map((s) => s.mean)), gaussianPerMm2: range(r.samples.map((s) => s.gaussian)), maxCurvaturePerMm: range(r.samples.map((s) => s.curvature))[1],
        draftDeg: ds, undercut: ds[0] !== null && ds[0] < -1e-7, belowDraft: ds[0] !== null && ds[0] < draftMinDeg, maxStepMm: null, minPositiveStepMm: null, neighbors: 0 };
    });
    const links = seams(data, pull, scene);
    for (const s of links) for (const k of [s.ka, s.kb]) {
      const r = rows[k]; r.neighbors++; r.maxStepMm = Math.max(r.maxStepMm || 0, s.stepMm);
      if (s.stepMm > 0) { r.minPositiveStepMm = r.minPositiveStepMm === null ? s.stepMm : Math.min(r.minPositiveStepMm, s.stepMm); r.featureMm = r.featureMm === null ? s.stepMm : Math.min(r.featureMm, s.stepMm); }
    }
    const faces = data.faces.map((f) => { const ds = range(f.samples.map(draft)); return { curvature: range(f.samples.map((s) => s.curvature))[1], gaussian: f.samples.length ? f.samples[0].gaussian : null, mean: f.samples.length ? f.samples[0].mean : null, draft: ds[0], step: rows[f.k].maxStepMm, feature: rows[f.k].featureMm, undercut: ds[0] !== null && ds[0] < -1e-7 }; });
    const scales = Object.fromEntries(Object.keys(METRICS).map((m) => [m, range(faces.map((f) => f[m]))]));
    data.key = key;
    data.result = { pull, draftMinDeg, summary: { surfaces: rows.length, sampledPoints: rows.reduce((n, r) => n + r.samples, 0), undercutSurfaces: rows.filter((r) => r.undercut).length, belowDraftSurfaces: rows.filter((r) => r.belowDraft).length,
      minDraftDeg: range(rows.map((r) => r.draftDeg[0]))[0], minFeatureMm: range(rows.map((r) => r.featureMm))[0], maxCurvaturePerMm: range(rows.map((r) => r.maxCurvaturePerMm))[1], maxStepMm: range(links.map((s) => s.stepMm))[1], matchedSeams: links.length, unmatchedSurfaces: rows.filter((r) => !r.neighbors).length },
      surfaces: rows, seams: links.map(({ a, b, stepMm, toleranceMm, method }) => ({ a, b, stepMm, toleranceMm, method })), conventions: CONVENTIONS, faces, scales };
    return data.result;
  }
  function value(row, metric) { return metric === 'draft' ? row.draftDeg[0] : metric === 'feature' ? row.featureMm : metric === 'step' ? row.maxStepMm : metric === 'mean' ? row.meanPerMm.reduce((a, b) => Math.abs(a || 0) > Math.abs(b || 0) ? a : b) : metric === 'gaussian' ? row.gaussianPerMm2.reduce((a, b) => Math.abs(a || 0) > Math.abs(b || 0) ? a : b) : row.maxCurvaturePerMm; }
  function worst(result, metric, n) {
    return result.surfaces.filter((r) => value(r, metric) !== null).slice().sort((a, b) => {
      const va = value(a, metric), vb = value(b, metric); return (metric === 'draft' || metric === 'feature' ? va - vb : Math.abs(vb) - Math.abs(va)) || String(a.id).localeCompare(String(b.id));
    }).slice(0, n === undefined ? 8 : n);
  }
  const CIV = [[0, 32, 77], [49, 68, 107], [102, 105, 112], [149, 143, 120], [203, 186, 105], [255, 234, 70]];
  function color(v, scale) {
    if (v === null || !Number.isFinite(v)) return [110, 120, 135];
    const t = scale[1] > scale[0] ? RF.U.clamp((v - scale[0]) / (scale[1] - scale[0]), 0, 1) : 0.5, x = t * (CIV.length - 1), i = Math.min(CIV.length - 2, Math.floor(x)), f = x - i;
    return CIV[i].map((c, k) => Math.round(c + (CIV[i + 1][k] - c) * f));
  }
  function style(overlay, index) {
    const f = overlay.result.faces[index], metric = overlay.metric, col = color(f[metric], overlay.result.scales[metric]);
    return { fill: col.concat(1), lam: [1, 0], edge: f.undercut ? [255, 255, 255, 1] : [25, 33, 45, 0.65], w: f.undercut ? 1.8 : 0.5 };
  }
  function json(result) { const { faces, scales, ...report } = result; return report; }
  RF.Manufacturability = { analyze, sample, METRICS, CONVENTIONS, worst, value, color, style, json };
})(typeof globalThis !== 'undefined' ? globalThis : this);
