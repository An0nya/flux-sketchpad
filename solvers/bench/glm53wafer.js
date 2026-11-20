/* Shell solver — collimated (or gently defocused) mirror tiles on the envelope's back wall.
 *
 * Where facets go and why: a facet catches LED light inside the cone of directions it covers,
 * so it must sit where the LED shines; and it delivers an image of the LED whose least size is
 * LEDsize × throw / distance (étendue), so it should sit as FAR from the LED as the envelope
 * allows.  Both say: far shell.  We tile the envelope's back-facing boundary (the wall the
 * beam leaves the envelope through) with one small exact quadric per LED-direction tube:
 * a tile there is the outermost thing in its tube, so no tile shadows another (measured 12-20%
 * shadowed for every other placement I tried) and none blocks another's reflected beam
 * (measured up to 84% blocked for coplanar tiles along the beam).
 *
 * Where each tile aims and how big it is: the scorer's own `achievableKernel` says how sharp
 * the paint could possibly be reproduced; we take that blurred paint D as the deliverable
 * profile, split its mass into equal-mass clusters (balanced kd splits), aim one tile per
 * cluster, and fit tile AREAS by relative least squares (multiplicative updates, projected
 * onto each tile's slot area cap) against a per-tile kernel model: aperture image ⊕ LED
 * étendue blur, a trapezoid per target axis.  Flux caught per mm² is luminance × LED emitting
 * area × cos(θ from the LED axis) × cos(bisector · LED dir) / r² (the LED's own projected
 * area matters: tiles that see it edge-on catch almost nothing — calibrated against
 * single-tile traces).  Tiles whose spot would be sharper than the aim lattice are defocused
 * (exact ellipsoid, di < ∞) until the aperture image covers the lattice: sharp spots leave
 * dark cells between aims (speckle), and a two-curvature vg facet that would spread only the
 * sharp axis comats badly at these grazing incidences (measured).
 *
 * No ray tracing anywhere in solve(): everything above is closed-form geometry plus a
 * deterministic least-squares.  ~0.4 s at 100 facets, ∝ budget^0.96.
 */
function shellSolve(input, settings) {
  const V = RF.V, Eng = RF.Engine, Phot = RF.Photometry;
  const env = input.envelope, src = input.source, refl = input.limits.reflectivity;
  const maxN = Math.max(1, input.limits.maxFacets | 0);
  const keep = Math.max(env.keepOut || 0, settings.minDistance == null ? 0 : +settings.minDistance || 0);
  const shellSpan = Math.min(80, Math.max(30, settings.shellSpan == null ? 60 : +settings.shellSpan));
  const kernelScale = Math.min(1.6, Math.max(0.6, settings.kernelScale == null ? 1 : +settings.kernelScale));
  const lattice = Math.min(2, Math.max(1, settings.lattice == null ? 1.4 : +settings.lattice));
  const fill = Math.min(1, Math.max(0.2, settings.fill == null ? 0.9 : +settings.fill));
  const T = Eng.targetFrame(input.target);
  const R = input.paint.res, cells = input.paint.cells, n2 = R * R;
  const notes = [];
  // ---- painted cells; if none, nothing to do
  let np = 0, paintTot = 0;
  for (let k = 0; k < n2; k++) if (cells[k] > 0) { np++; paintTot += cells[k]; }
  if (!np) return { surfaces: [], intent: [], notes: ['nothing painted'] };
  // ---- the deliverable profile: the paint blurred by the smallest LED image this envelope can make
  const ker = Phot.achievableKernel({ source: src, envelope: env, target: input.target });
  const D = Phot.boxBlur(Float64Array.from(cells), R, ker.cells);
  let mass = 0; const dcells = [];
  for (let k = 0; k < n2; k++) if (D[k] > 0) { dcells.push(k); mass += D[k]; }
  if (!(mass > 0)) return { surfaces: [], intent: [], notes: ['degenerate paint'] };
  notes.push('kernel ' + ker.mm.toFixed(1) + ' mm (' + ker.cells.toFixed(2) + ' cells) at r=' + ker.r.toFixed(1) + ' mm');

  // ---- shell tiles: one tile per LED-direction tube, on the envelope's far boundary shell.
  // A tile at LED + d·r_f(d) (r_f = the last envelope point along d) is the outermost thing in
  // its tube: no other tile sits between it and the LED (no shadowing) nor between it and
  // the target along the beam (no blocking), and r_f is the largest usable distance —
  // which is exactly what minimises the LED-image blur.
  const LED = src.pos.slice(), fr = RF.Source.frame(src), a = fr.a;
  const Aed = Math.max(1e-9, RF.Source.emittingArea(src));   // the LED's emitting area: what its intensity is made of
  const emitters = (input.sources || [src]).map((x) => x.pos);   // every emitter has its own clearance
  const beam = V.norm(V.sub(T.C, LED));
  const cdir = V.norm(V.add(V.mul(beam, -0.75), V.mul(a, 0.75)));   // shell centre: back–up bisector
  const faceN = (B) => {                                     // outward normal of the envelope face at B
    const c = env.center, h = env.half, dB = V.sub(B, c);
    if (env.shape === 'box') { let ax = 0, bt = -1;
      for (let i = 0; i < 3; i++) { const r = Math.abs(dB[i]) / Math.max(1e-9, h[i]); if (r > bt) { bt = r; ax = i; } }
      const n = [0, 0, 0]; n[ax] = Math.sign(dB[ax]) || 1; return n; }
    if (env.shape === 'ellipsoid') return V.norm([dB[0] / h[0] ** 2, dB[1] / h[1] ** 2, dB[2] / h[2] ** 2]);
    const A = env.axis === undefined ? 2 : env.axis, i = (A + 1) % 3, j = (A + 2) % 3;
    if (Math.abs(dB[A]) >= h[A] * 0.999) { const n = [0, 0, 0]; n[A] = Math.sign(dB[A]) || 1; return n; }
    const n = [0, 0, 0]; n[i] = dB[i] / (h[i] * h[i]); n[j] = dB[j] / (h[j] * h[j]); return V.norm(n); };
  const s1 = V.norm(V.inPlane(cdir, Math.abs(cdir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), s2 = V.cross(cdir, s1);
  // pass 1: probe directions on a coarse tangent grid, keep the viable ones, get their extent
  const span = Math.tan(shellSpan * Math.PI / 180);
  // one shell-slot candidate for a LED→tile direction d (unit), else null
  const slotAt = (ta, tb) => {
    const d = V.norm(V.add(cdir, V.add(V.mul(s1, ta), V.mul(s2, tb))));
    if (V.dot(d, a) < 0.32) return null;                   // too edge-on: no flux, and an unreliable kernel
    if (V.dot(d, beam) > Math.cos(50 * Math.PI / 180)) return null;   // too near the beam: bisector degenerates
    const iv = RF.Geo.envInterval(env, LED, d), rf = iv[1] - 1.0;
    if (!(rf > keep + 1)) return null;
    const B = V.add(LED, V.mul(d, rf + 1.0));              // boundary point along d
    const nf = faceN(B);
    if (!nf || V.dot(nf, beam) > -0.35) return null;        // back-facing walls only: others stand in the beams
    const f1 = V.norm(V.inPlane(nf, s1)), f2 = V.cross(nf, f1);
    return { d, rf, nf, f1, f2, B };
  };
  // probe pass: the viable extent in tangent coordinates
  const probe = [];
  const NP = 64;
  for (let j = 0; j <= NP; j++) for (let i = 0; i <= NP; i++) {
    const ta = (2 * i / NP - 1) * span, tb = (2 * j / NP - 1) * span;
    if (slotAt(ta, tb)) probe.push([ta, tb]);
  }
  if (!probe.length) return { surfaces: [], intent: [], notes: ['no viable shell tiles (clearance ' + keep + ' mm)'] };
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [ta, tb] of probe) { a0 = Math.min(a0, ta); a1 = Math.max(a1, ta); b0 = Math.min(b0, tb); b1 = Math.max(b1, tb); }
  // tile grid over that extent
  const wa = Math.max(1e-6, a1 - a0), wb = Math.max(1e-6, b1 - b0);
  const over = 2.2;                                          // oversample: filters drop cells, keep the best maxN
  let ngA = Math.max(1, Math.round(Math.sqrt(maxN * over * wa / wb)));
  let ngB = Math.max(1, Math.round(maxN * over / ngA));
  // probe every grid cell first (some are dropped by the filters), then size each tile from the
  // PHYSICAL distance to its nearest kept neighbours on each axis — the tangent-units pitch is
  // unreliable, and tiles wider than their pitch overlap and shadow each other (found: 12% shadowed).
  const cellQ = new Map();
  for (let j = 0; j < ngB; j++) for (let i = 0; i < ngA; i++) {
    const ta = a0 + wa * (i + 0.5) / ngA, tb = b0 + wb * (j + 0.5) / ngB;
    const q = slotAt(ta, tb);
    if (!q) continue;
    const lum = Phot.luminance(src, q.d);
    if (!(lum > 0) || !isFinite(lum)) continue;
    cellQ.set(i + ',' + j, { q, lum, u: ta, v: tb });
  }
  const rawSlots = [];
  let maxSag = 0;
  for (const [key, r] of cellQ) {
    const [i, j] = key.split(',').map(Number);
    const pitch = (di, dj) => { const n2 = cellQ.get((i + di) + ',' + (j + dj)); return n2 ? V.dist(n2.q.B, r.q.B) : Infinity; };
    const hu = Math.min(Math.min(pitch(1, 0), pitch(-1, 0)) * 0.42, 10);   // (isolated slots: 10 mm)
    const hv = Math.min(Math.min(pitch(0, 1), pitch(0, -1)) * 0.42, 10);
    const asf = Math.max(-0.98, -V.dot(r.q.d, beam)), fo = Math.max(3, r.q.rf * (1 + asf) / 2);
    maxSag = Math.max(maxSag, (hu * hu + hv * hv) / (4 * fo));
    rawSlots.push({ q: r.q, lum: r.lum, hu, hv, u: r.u, v: r.v });
  }
  // ONE inset per solve: tiles on the same wall must be exactly coplanar, or shallow ones
  // sit in front of deep ones and shadow them (measured 12% shadowed with per-slot insets).
  const inset = 1.0 + 1.6 * maxSag + 0.3;
  const slots = [];
  for (const r of rawSlots) {
    const P = V.sub(r.q.B, V.mul(r.q.nf, inset));
    if (!RF.Geo.envInside(env, P, 0)) continue;
    if (V.dist(P, LED) < keep * 1.02 + 0.5) continue;
    if (emitters.some((S2) => V.dist(P, S2) < keep * 1.02 + 0.5)) continue;   // every emitter has its own clearance
    slots.push({ P, f1: r.q.f1, f2: r.q.f2, hu: r.hu, hv: r.hv, lum: r.lum, u: r.u, v: r.v });
  }
  if (!slots.length) return { surfaces: [], intent: [], notes: ['no viable shell tiles (clearance ' + keep + ' mm)'] };
  slots.sort((p, q) => (p.u - q.u) || (p.v - q.v));
  if (slots.length > maxN) {                                 // too many: drop the least luminous (most edge-on)
    slots.sort((p, q) => q.lum * q.hu * q.hv - p.lum * p.hu * p.hv);
    slots.length = maxN;
    slots.sort((p, q) => (p.u - q.u) || (p.v - q.v));
  }
  const slotArea = slots.reduce((s2, q) => s2 + 4 * q.hu * q.hv, 0);
  notes.push('shell ' + slots.length + ' tiles, r ' + slots.map((q) => V.dist(q.P, LED)).reduce((x, y) => Math.min(x, y), 1e9).toFixed(0) + '–' +
    slots.map((q) => V.dist(q.P, LED)).reduce((x, y) => Math.max(x, y), 0).toFixed(0) + ' mm from the LED');

  // ---- equal-mass clusters of the deliverable profile (balanced kd splits)
  const M = Math.min(slots.length, dcells.length);
  const cellUV = dcells.map((k) => [k % R, (k / R) | 0, D[k]]);
  let leaves = [{ cs: cellUV, m: mass }];
  while (leaves.length < M) {
    let bi = -1; for (let i = 0; i < leaves.length; i++) if (leaves[i].cs.length > 1 && (bi < 0 || leaves[i].m > leaves[bi].m + 1e-12)) bi = i;
    if (bi < 0) break;
    const L = leaves[bi], cs = L.cs;
    let su = 0, sv = 0; for (const c of cs) { su += c[0]; sv += c[1]; } su /= cs.length; sv /= cs.length;
    let eu = 0, ev = 0; for (const c of cs) { eu += (c[0] - su) ** 2; ev += (c[1] - sv) ** 2; }
    const dim = eu >= ev ? 0 : 1;
    const sorted = cs.slice().sort((p, q) => p[dim] - q[dim]);
    let acc = 0, cut = 0; for (let i = 0; i < sorted.length; i++) { acc += sorted[i][2]; if (acc >= L.m / 2 && i + 1 < sorted.length) { cut = i + 1; break; } }
    if (cut <= 0 || cut >= sorted.length) { cut = Math.floor(sorted.length / 2) || 1; }
    const A = sorted.slice(0, cut), B = sorted.slice(cut);
    let ma = 0, mb = 0; for (const c of A) ma += c[2]; for (const c of B) mb += c[2];
    leaves.splice(bi, 1, { cs: A, m: ma }, { cs: B, m: mb });
  }
  // clusters: centroid (paint-grid u,v) and mass; drop empty
  const clusters = [];
  for (const L of leaves) { if (!(L.m > 0) || !L.cs.length) continue;
    let cu = 0, cv = 0; for (const c of L.cs) { cu += c[0] * c[2]; cv += c[1] * c[2]; } cu /= L.m; cv /= L.m;
    clusters.push({ cs: L.cs, m: L.m, u: cu, v: cv }); }
  if (!clusters.length) return { surfaces: [], intent: [], notes: ['no clusters'] };

  // ---- aim shrink: pull every aim toward the paint's centre of mass, so spots that blur
  // outward past the paint's edge spill less into the gaps (edge cells may match the blurred
  // paint anyway — that is the scorer's own concession)
  const shrink = settings.shrink == null ? 0.9 : Math.min(1, Math.max(0.5, +settings.shrink));
  let gu = 0, gv = 0;
  for (const c of clusters) { gu += c.u * c.m; gv += c.v * c.m; }
  gu /= Math.max(1e-12, clusters.reduce((x, c) => x + c.m, 0)); gv /= Math.max(1e-12, clusters.reduce((x, c) => x + c.m, 0));
  for (const c of clusters) { c.u = gu + shrink * (c.u - gu); c.v = gv + shrink * (c.v - gv); }
  // ---- pair clusters with slots (deterministic orderings), then size tiles: area ∝ mass / (luminance·cos)
  clusters.sort((p, q) => (p.u - q.u) || (p.v - q.v));
  slots.sort((p, q) => (p.u - q.u) || (p.v - q.v));
  const NC = Math.min(clusters.length, slots.length);
  const pair = []; for (let i = 0; i < NC; i++) pair.push([clusters[i], slots[i]]);
  // luminance and projection factor per tile (at its cluster's aim)
  let scaleSum = 0;
  for (const [c, s] of pair) {
    const Z = Eng.targetUVtoWorld(T, c.u * (2 * T.half / R) - T.half, c.v * (2 * T.half / R) - T.half);
    s.Z = Z;
    const sh = V.norm(V.sub(LED, s.P)), ah = V.norm(V.sub(Z, s.P));
    const nrm = V.norm(V.add(sh, ah));
    const d = V.norm(V.sub(s.P, LED)), r = Math.max(1e-6, V.dist(s.P, LED));
    // flux caught per mm² of tile = I(θ) · Ω = luminance(d) · A_led,⊥(d) · cos(bisector·LED dir) / r²
    s.cap = (s.lum > 0 && isFinite(s.lum) ? s.lum : 0) * Aed * Math.max(0, V.dot(d, a)) * Math.max(0, V.dot(nrm, sh)) / (r * r);
    scaleSum += c.m / Math.max(1e-12, s.cap);
  }
  if (!(scaleSum > 0)) return { surfaces: [], intent: [], notes: ['no luminous tiles'] };
  // ---- fit the tile areas to the deliverable profile by a kernel model (relative / multiplicative LS).
  // Tile i paints a spot ≈ (LED image ⊕ aperture image) around its aim.  Its size has two terms:
  // the LED's étendue blur (LED extent × throw / distance, both across and along the beam — each
  // LED point collimates at its own tilt) and the aperture, which a defocused facet (di < ∞) maps
  // at (L − di)/di.  We defocus each tile until its spot is ~1.4× the aim lattice spacing, so the
  // delivered sum is smooth (no speckle between aims) AND its size is set by exact aperture
  // geometry rather than by the LED's angular weighting — a far more predictable kernel to fit.
  const cwmm = 2 * T.half / R;
  const ledMin = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h))
    : src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
  const ledMax = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.max(src.w, src.h))
    : src.shape === 'cylinder' ? Math.max(2 * src.radius, src.length) : 2 * src.radius;
  const NT = pair.length, cellsI = dcells;
  const spacing = Math.sqrt(Math.max(1, np) / Math.max(1, NT)) * lattice;   // aim lattice spacing, cells
  const K = new Float64Array(NT * cellsI.length), diV = new Array(NT).fill(1e300);
  pair.forEach(([c, s], i) => {
    const r = Math.max(1, V.dist(s.P, LED)), L = Math.max(1, V.dist(s.Z, s.P));
    // étendue blur, in cells, per target axis: across the beam the LED's cross-beam extent maps
    // at throw/distance; along the beam the (flat) LED is edge-on, so only aperture and coma act.
    const wuE = Math.max(0.6, 0.8 * kernelScale * ledMax * L / r / cwmm);
    const wvE = Math.max(0.6, wuE);
    const ap = 2 * Math.sqrt(Math.max(1e-6, s.hu * s.hv));              // aperture diameter, mm
    // Defocus (di < ∞): the exact ellipsoid with foci S0 and I images the aperture at
    // (L − di)/di around the aim.  We defocus until the spot covers the aim lattice —
    // sharp spots leave dark cells between aims (speckle).  (A vg two-curvature facet that
    // would spread v alone comats badly at these grazing incidences — measured, not guessed.)
    const dfv = settings.defocusFrac == null ? 0.7 : Math.min(1, Math.max(0, +settings.defocusFrac));
    const want = Math.max(wuE, wvE + dfv * Math.max(0, spacing - wvE));  // wanted half-width, cells
    const sImg = Math.sqrt(Math.max(0, want * want - wuE * wuE)) * cwmm; // aperture image needed, mm
    const di = sImg > 1e-6 ? L * (s.hu + s.hv) / 2 / (sImg + (s.hu + s.hv) / 2) : 1e300;
    diV[i] = isFinite(di) && di > 0.5 ? di : 1e300;
    s.wu = Math.max(wuE, sImg / cwmm + wuE * 0.5, want);                  // kernel: aperture image ⊕ étendue
    s.wv = Math.max(wvE, sImg / cwmm, want * 0.7);
    s.su = wuE; s.sv = Math.max(0.4, wvE);                               // trapezoid edges = the blur itself
  });
  // kernel per tile = image of its aperture ⊕ the LED's étendue blur: a trapezoid per axis
  // (flat over the aperture image, falling over the blur).  su/sv = the blur edge.
  cellsI.forEach((k, ci) => {
    const iu = k % R + 0.5, iv = Math.floor(k / R) + 0.5;
    for (let i = 0; i < NT; i++) {
      const c = pair[i][0], s = pair[i][1];
      const tu = Math.max(0, Math.min(1, (s.wu - Math.abs(iu - c.u)) / Math.max(0.3, s.su)));
      const tv = Math.max(0, Math.min(1, (s.wv - Math.abs(iv - c.v)) / Math.max(0.3, s.sv)));
      if (tu > 0 && tv > 0) K[i * cellsI.length + ci] = tu * tv;
    }
  });
  // areas: a projected (slot-capped) RLS fit.  An UNcapped fit hands huge areas to tiles that
  // see the LED edge-on (tiny flux per mm²); clamping those at emission under-delivers exactly
  // there (found: the left third of the test blob at 0.25× its model).  So fit WITH the caps,
  // at a target scale that uses the whole plane: bright but honest.
  const capv = pair.map(([, s]) => Math.max(1e-12, s.cap));
  const capMax = pair.map(([, s]) => s.hu * s.hv * 4);
  const target = fill * slotArea;
  const fitAt = (c) => {                                     // multiplicative RLS, projected onto [0, capMax]
    const A = capMax.map((x) => x * 0.5);
    for (let it = 0; it < 40; it++) {
      let conv = true;
      const num = new Float64Array(NT), den = new Float64Array(NT);
      for (let ci = 0; ci < cellsI.length; ci++) {
        const k = cellsI[ci];
        let model = 0; for (let i = 0; i < NT; i++) model += A[i] * capv[i] * K[i * cellsI.length + ci];
        for (let i = 0; i < NT; i++) { const kv = K[i * cellsI.length + ci]; if (kv > 0) { num[i] += c * D[k] * kv; den[i] += model * kv; } }
      }
      for (let i = 0; i < NT; i++) {
        if (num[i] > 0 && den[i] > 0) {
          const a2 = Math.min(capMax[i], Math.max(1e-6, A[i] * num[i] / den[i]));
          if (Math.abs(a2 - A[i]) > 0.004 * Math.max(1e-9, A[i])) conv = false;
          A[i] = a2;
        } else A[i] = Math.min(A[i], 1e-6);
      }
      if (conv) break;
    }
    return A;
  };
  let lo = 1e-4, hi = 1e4;                                   // bisect the target scale: used area ≈ fill × plane
  for (let b = 0; b < 22; b++) {
    const mid = Math.sqrt(lo * hi), A = fitAt(mid);
    if (A.reduce((x, y) => x + y, 0) < target) lo = mid; else hi = mid;
  }
  const areas = fitAt(Math.sqrt(lo * hi));
  // ---- emit, verifying each tile against the envelope and the clearance on its REAL surface
  const surfaces = [], intent = [];
  const tileOK = (rec) => {                                    // compile one tile, test its outline
    let G; try { G = RF.Geo.compile([rec]); } catch (e) { return false; }
    for (let k = 0; k < G.n; k++) for (const poly of RF.Geo.outline(G, k)) for (const p of poly) {
      if (!RF.Geo.envInside(env, p, -0.001) || V.dist(p, LED) < keep) return false; }
    return true; };
  pair.forEach(([c, s], i) => {
    const A = Math.min(s.hu * s.hv * 4, Math.max(0.05, areas[i]));
    const f0 = Math.sqrt(A / (4 * s.hu * s.hv));
    let rec = null;
    for (const f of [f0, 0.8 * f0, 0.6 * f0, 0.4 * f0]) {
      const hx = Math.max(0.02, s.hu * f), hy = Math.max(0.02, s.hv * f);
      const c4 = [V.add(s.P, V.add(V.mul(s.f1, -hx), V.mul(s.f2, -hy))), V.add(s.P, V.add(V.mul(s.f1, hx), V.mul(s.f2, -hy))),
                  V.add(s.P, V.add(V.mul(s.f1, hx), V.mul(s.f2, hy))), V.add(s.P, V.add(V.mul(s.f1, -hx), V.mul(s.f2, hy)))];
      if (!c4.every((p) => RF.Geo.envInside(env, p, -0.001) && V.dist(p, LED) >= keep)) continue;
      const id = 'T' + i;
      const r2 = { type: 'facet', id, P: s.P.slice(), S0: LED.slice(), Z: s.Z.slice(), flat: false, di: diV[i],
        clip: { kind: 'poly', pts3: c4.map((p) => p.slice()) },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      if (!tileOK(r2)) continue;
      rec = r2; break;
    }
    if (!rec) { notes.push('tile ' + i + ' would leave the envelope: dropped'); return; }
    surfaces.push(rec);
    // cc = [col, row, weight]: paint cell index k = row*R + col, intent weight = painted level
    intent.push({ facet: rec.id, cells: c.cs.map((cc) => [cc[1] * R + cc[0], Math.max(1e-6, cells[cc[1] * R + cc[0]])]) });
  });
  const used = surfaces.reduce((s2, f2) => { const hx = V.len(V.sub(f2.clip.pts3[1], f2.clip.pts3[0])) / 2, hy = V.len(V.sub(f2.clip.pts3[3], f2.clip.pts3[0])) / 2; return s2 + 4 * hx * hy; }, 0);
  notes.push(surfaces.length + ' collimated tiles, total mirror ' + used.toFixed(0) + ' mm² of ' + slotArea.toFixed(0) + ' mm² plane');
  return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-glm53wafer--canopy', name: 'Canopy (collimated tiles)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },   // required
    { key: 'shellSpan', label: 'Shell span (deg)', type: 'range', min: 30, max: 80, step: 5, default: 60 },
    { key: 'fill', label: 'Plane fill', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.9 },
    { key: 'kernelScale', label: 'Kernel scale', type: 'range', min: 0.6, max: 1.6, step: 0.1, default: 1 },
    { key: 'lattice', label: 'Aim lattice', type: 'range', min: 1, max: 2, step: 0.1, default: 1.4 },
    { key: 'defocusFrac', label: 'Defocus fraction', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'shrink', label: 'Aim shrink', type: 'range', min: 0.5, max: 1, step: 0.05, default: 0.9 },
  ],
  solve(input, settings) { return shellSolve(input, settings); },
});

/* Tuner: the same static algorithm, with the real tracer choosing its knobs.
 * Registered under an id ending in -auto, so it may trace inside solve(): it sweeps the
 * two knobs that trade painted coverage against gap spill (aim shrink, defocus fraction),
 * traces every candidate on the SAME seed, and keeps the winner for the goal.
 */
RF.Solvers.register({
  id: 'bench-glm53wafer--canopy-auto', name: 'Canopy tuner (traced sweep)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },   // required
    { key: 'goal', label: 'Goal', type: 'select', default: 'faithful',
      options: [{ value: 'faithful', label: 'Faithful (fidelity first)' }, { value: 'throw', label: 'Throw (light onto the paint)' }, { value: 'efficient', label: 'Efficient (fidelity + yield)' }] },
    { key: 'tunerRays', label: 'Rays per candidate', type: 'number', min: 20000, max: 500000, step: 25000, default: 300000 },
  ],
  solve(input, settings, tools) {
    const goal = settings.goal === 'throw' || settings.goal === 'efficient' ? settings.goal : 'faithful';
    const want = Math.max(20000, Math.min(500000, +settings.tunerRays || 150000));
    const grid = [];
    for (const shrink of [0.8, 0.9, 1.0]) for (const df of [0.15, 0.5, 0.85]) grid.push({ shrink, defocusFrac: df });
    const cap = (tools && tools.budget && tools.budget.rays) || 4e6;
    const rays = Math.max(20000, Math.min(want, Math.floor(cap / (grid.length + 1))));
    const score = (r, ref) => {                       // the scorer's own shape; reference = best candidate's yield
      const f = r && r.fidelity; if (!f) return 0;
      const light = ref > 0 ? Math.min(1, f.onPaint / (0.1 * ref)) : 0;
      const F = f.fidelity * light;
      if (goal === 'throw') return f.onPaint;
      if (goal === 'efficient') return F + 0.3 * (ref > 0 ? f.onPaint / ref : 0);
      return F;
    };
    const cands = [];
    for (const g of grid) {                           // same seed every call: candidates differ by geometry, not dice
      let out; try { out = shellSolve(input, Object.assign({}, settings, g)); } catch (e) { continue; }
      if (!out.surfaces.length) continue;
      let res = null; try { res = tools.trace(out.surfaces, { rays }); } catch (e) { break; }   // budget spent
      cands.push({ g, out, res });
    }
    const ref = cands.reduce((m, c) => Math.max(m, c.res && c.res.fidelity ? c.res.fidelity.onPaint : 0), 0);
    let best = null, bestS = -Infinity;
    for (const c of cands) { const sc2 = score(c.res, ref); if (sc2 > bestS + 1e-12) { bestS = sc2; best = c; } }
    if (!best) {                                     // tracing unavailable or every candidate failed: tuned defaults
      const out = shellSolve(input, settings);
      return { surfaces: out.surfaces, intent: out.intent, notes: (out.notes || []).concat(['tuner: no traced candidates, static defaults']) };
    }
    const f = best.res.fidelity || {};
    if (tools && tools.preview) { try { tools.preview(best.out.surfaces, { trace: best.res }); } catch (e) {} }
    return {
      surfaces: best.out.surfaces, intent: best.out.intent,
      notes: (best.out.notes || []).concat([
        'tuner: goal ' + goal + ', traced ' + cands.length + ' candidates x ' + rays + ' rays (same seed)',
        'tuner: best shrink=' + best.g.shrink + ' defocusFrac=' + best.g.defocusFrac +
          ' -> fidelity ' + (100 * (f.fidelity || 0)).toFixed(1) + '%, on-paint ' + (100 * (f.onPaint || 0)).toFixed(1) +
          '% (noise ceiling ' + (100 * (f.noiseCeiling || 0)).toFixed(1) + '%)',
      ]),
    };
  },
});
