/* Flux paint solver: single dish of curved facets aimed by paint weight.
 * Static: no tracing. Dish plane normal to the mean bisector near the wall
 * (far from LED => small LED image). Smooth space-filling assignment
 * (neighbour facets -> neighbour paint cells) so spots tile the painting
 * instead of clumping. Areas sized so flux tracks paint weight.
 */
(function (root) {
  const RF = root.RF;
  const V = RF.V;

  function targetPoint(T, half, size, res, i, j) {
    const u = -half + (i + 0.5) * (size / res);
    const v = -half + (j + 0.5) * (size / res);
    return [T.C[0] + T.tu[0] * u + T.tv[0] * v, T.C[1] + T.tu[1] * u + T.tv[1] * v, T.C[2] + T.tu[2] * u + T.tv[2] * v];
  }
  function fibSphere(n) {
    const pts = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < n; k++) {
      const z = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * k;
      pts.push([r * Math.cos(t), r * Math.sin(t), z]);
    }
    return pts;
  }
  // morton key for non-negative ints < 1024
  function morton(x, y) {
    let z = 0;
    for (let b = 0; b < 10; b++) z |= ((x >> b) & 1) << (2 * b) | ((y >> b) & 1) << (2 * b + 1);
    return z;
  }

  function starSolve(input, settings) {
    const env = input.envelope, L = input.source.pos, axis = V.norm(input.source.axis || [0, 0, 1]);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const inset = settings.inset !== undefined ? settings.inset : 4;
    let insetEff = inset;
    const sizeScale = settings.sizeScale !== undefined ? settings.sizeScale : 1.0;
    const capDeg = settings.capDeg !== undefined ? settings.capDeg : 32;
    const T = RF.Engine.targetFrame(input.target);
    const half = input.target.size / 2, size = input.target.size;
    const pres = input.paint.res, cells = input.paint.cells;

    const pc = [];
    let wsum = 0;
    for (let k = 0; k < pres * pres; k++) {
      const w = cells[k];
      if (w > 0) { const i = k % pres, j = Math.floor(k / pres); pc.push({ k, w, i, j, Z: targetPoint(T, half, size, pres, i, j) }); wsum += w; }
    }
    const surfaces = [], intent = [], notes = [];
    if (!pc.length || !(wsum > 0)) { notes.push('no paint'); return { surfaces, intent, notes }; }
    // spatial order for cells
    for (const c of pc) c.m = morton(c.i, c.j);
    const pcs = pc.slice().sort((a, b) => a.m - b.m || a.k - b.k);
    const cum = new Array(pcs.length);
    let acc = 0;
    for (let n = 0; n < pcs.length; n++) { acc += pcs[n].w; cum[n] = acc; }
    const pickCell = (x) => { let lo = 0, hi = pcs.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };

    const TC = T.C, aT = V.norm(V.sub(TC, L));
    const planar = input.source.kind === 'planar';
    const dishMode = settings.dishMode || 'quad';

    const cand = fibSphere(500);
    let d0 = null, best = -1, t0hit = 0;
    if (dishMode === 'quad') {
      const kk = settings.dishK !== undefined ? settings.dishK : 1;
      const cosPar = V.dot(axis, aT);
      if (cosPar > 0.87) {
        // LED looks straight at (or away from) the target: the lobe/flood diagonal
        // is degenerate, so lean sideways. Planar LEDs still need forward reach
        // (their lobe is forward); side-emitting volumes want pure side room.
        const side = V.inPlane(axis, aT);
        const useSide = V.len(side) > 1e-6 ? V.norm(side) : V.basis(axis)[0];
        if (planar) {
          const q = V.add(useSide, aT);
          d0 = V.len(q) > 1e-6 ? V.norm(q) : useSide.slice();
        } else {
          const [w1, w2] = V.basis(axis);
          const t1 = RF.Geo.envInterval(env, L, w1)[1], t2 = RF.Geo.envInterval(env, L, w2)[1];
          d0 = (t1 >= t2 ? w1 : w2).slice();
        }
      } else {
        const q = V.add(axis, V.mul(aT, kk));
        if (V.len(q) < 0.2) d0 = axis.slice();
        else d0 = V.norm(q);
      }
      if (planar && V.dot(d0, axis) <= 0.02) d0 = axis.slice();
      const iv = RF.Geo.envInterval(env, L, d0);
      t0hit = iv[1];
      if (!(t0hit > keep + 2 + inset)) {
        d0 = null;
      } else {
        const th = Math.acos(Math.max(-1, Math.min(1, V.dot(d0, axis))));
        if (planar && !(RF.Source.intensity(input.source, th) > 0)) d0 = null;
      }
    }
    if (!d0) {
    for (const p of cand) {
      const d = p;
      if (planar && V.dot(d, axis) <= 0.02) continue;
      const dAT = V.dot(d, aT);
      if (dAT > 0.85) continue;
      const iv = RF.Geo.envInterval(env, L, d);
      const tHit = iv[1];
      if (!(tHit > keep + 2 + inset)) continue;
      const th = Math.acos(Math.max(-1, Math.min(1, V.dot(d, axis))));
      const I = Math.max(0, RF.Source.intensity(input.source, th));
      if (!(I > 0)) continue;
      const cosA = Math.sqrt(Math.max(1e-6, (1 - dAT) / 2));
      const score = I * tHit * tHit * cosA;
      if (score > best) { best = score; d0 = d; t0hit = tHit; }
    }
    }
    if (!d0) { d0 = V.dot(axis, aT) < 0.85 ? axis.slice() : V.mul(aT, -1); t0hit = RF.Geo.envInterval(env, L, d0)[1]; notes.push('fallback dish centre'); }
    d0 = V.norm(d0);

    let Pc0, sh0, ah0, n0, R0, Dd;
    const placeDish = () => {
      Pc0 = [L[0] + d0[0] * (t0hit - insetEff), L[1] + d0[1] * (t0hit - insetEff), L[2] + d0[2] * (t0hit - insetEff)];
      sh0 = V.norm(V.sub(L, Pc0)); ah0 = V.norm(V.sub(TC, Pc0));
      n0 = V.norm(V.add(sh0, ah0));
      R0 = Math.max(keep + 2, t0hit - insetEff);
      Dd = R0 * V.dot(d0, n0);
    };
    placeDish();

    const rho = capDeg * Math.PI / 180;
    // painting shape drives the dish: sparse/gappy paintings with small features want
    // far, sharp facets (wide net, keep the farthest); broad paintings want the full
    // dish for coverage and flood shadowing.
    const paintedFrac = pc.length / (pres * pres);
    let hasGapEarly = false, meanDistEarly = 1e9;
    try {
      for (let k = 0; k < pres * pres && !hasGapEarly; k++) {
        if (cells[k] > 0) continue;
        const i = k % pres, j = Math.floor(k / pres);
        if ((i > 0 && cells[k - 1] > 0) || (i < pres - 1 && cells[k + 1] > 0) || (j > 0 && cells[k - pres] > 0) || (j < pres - 1 && cells[k + pres] > 0)) hasGapEarly = true;
      }
      const dE = new Float32Array(pres * pres);
      for (let k = 0; k < pres * pres; k++) dE[k] = cells[k] > 0 ? 1e9 : 0;
      for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
        const k = j * pres + i;
        if (i > 0) dE[k] = Math.min(dE[k], dE[k - 1] + 1);
        if (j > 0) dE[k] = Math.min(dE[k], dE[k - pres] + 1);
      }
      for (let j = pres - 1; j >= 0; j--) for (let i = pres - 1; i >= 0; i--) {
        const k = j * pres + i;
        if (i < pres - 1) dE[k] = Math.min(dE[k], dE[k + 1] + 1);
        if (j < pres - 1) dE[k] = Math.min(dE[k], dE[k + pres] + 1);
      }
      let sd = 0, sn = 0;
      for (let k = 0; k < pres * pres; k++) if (cells[k] > 0) { sd += dE[k]; sn++; }
      meanDistEarly = sn ? sd / sn : 1e9;
    } catch (e) { /* keep */ }
    const farFirst = (() => {
      if (!hasGapEarly) return false;
      try {
        const ap = RF.Source.apparent(input.source);
        let ls = 2;
        if (ap.kind === 'planar') ls = Math.sqrt(Math.max(0.04, ap.shape === 'disc' ? Math.PI * ap.radius * ap.radius : ap.w * ap.h));
        else if (ap.shape === 'cylinder') ls = Math.sqrt(Math.max(0.04, 2 * ap.radius * ap.length));
        else if (ap.shape === 'sphere' || ap.radius > 0) ls = Math.sqrt(Math.max(0.04, Math.PI * ap.radius * ap.radius));
        const Dd0 = V.dist(TC, L);
        const rTyp = Math.max(keep + 2, t0hit - inset);
        const spotEst = ls * Dd0 / Math.max(1e-6, rTyp);
        const thick = 2 * meanDistEarly * (size / pres);
        if (!(spotEst > 1.5 * thick)) return false;
        // direct-flood check: if unpainted target already receives much direct light,
        // dropping the near (flood-shadowing) facets would open a leak; stay normal.
        let fl = 0, pf = 0, tot = 0;
        for (let k = 0; k < pres * pres; k += 2) {
          const i = k % pres, j = Math.floor(k / pres);
          const u = -half + (i + 0.5) * (size / pres), v = -half + (j + 0.5) * (size / pres);
          if (Math.abs(u) > half || Math.abs(v) > half) continue;
          const cx = T.C[0] + T.tu[0] * u + T.tv[0] * v - L[0], cy = T.C[1] + T.tu[1] * u + T.tv[1] * v - L[1], cz = T.C[2] + T.tu[2] * u + T.tv[2] * v - L[2];
          const dd = Math.hypot(cx, cy, cz);
          if (!(dd > 1e-9)) continue;
          const ct = Math.max(0, (cx * -T.n[0] + cy * -T.n[1] + cz * -T.n[2]) / dd);
          if (ct <= 0) continue;
          const th = Math.acos(Math.max(-1, Math.min(1, (cx * axis[0] + cy * axis[1] + cz * axis[2]) / dd)));
          const I = Math.max(0, RF.Source.intensity(input.source, th));
          tot += I * ct / (dd * dd);
          if (cells[k] > 0) pf += I * ct / (dd * dd); else fl += I * ct / (dd * dd);
        }
        // sharp-first is safe when direct light is weak in absolute terms (it cannot
        // flood gaps by itself) — regardless of the flood/paint ratio.
        try {
          const It = Math.max(1e-9, RF.Source.totalIntegral(input.source));
          const cellA = (size / pres) * (size / pres);
          return (cellA * 2 * tot) / It < 0.05;
        } catch (e) { return false; }
      } catch (e) { return false; }
    })();
    // Sharp-first mode: 'plane' (roomy LED: far facets on the normal dish, full count)
    // or 'wall' (cramped LED: wall-hugging spread facets, fewer but unshadowed).
    // Broad/coverage-critical paintings stay on the normal flood-covering dish.
    // NOTE: the dish centre is always quad/auto (bright lobe + flood); only the
    // facet SELECTION changes (far-first), never the direction.
    const sharpMode = (() => {
      if (!farFirst) return '';
      const rTypF = Math.max(keep + 2, t0hit - insetEff);
      // face-on dishes (U-turn) are already optimal: no sharpness to gain.
      if (Math.abs(V.dot(n0, d0)) > 0.8) return '';
      if (rTypF > 40) return 'plane';
      if (meanDistEarly < 4) return 'wall';
      return '';
    })();
    if (sharpMode === 'wall') { insetEff = Math.max(inset, 8); placeDish(); }
    const rhoEff = sharpMode === 'wall' ? Math.max(rho, 90 * Math.PI / 180) : sharpMode ? Math.max(rho, 75 * Math.PI / 180) : rho * (0.62 + 0.38 * Math.min(1, paintedFrac / 0.2));
    const N = maxF;
    const [bu, bv] = V.basis(d0);
    const S0 = L.slice();
    const info = [];
    // flood-aware candidate filtering: a dir whose direct ray would hit an UNPAINTED
    // target cell is precious (it shadows a flood leak); keep those even at short range.
    // Other dirs must clear the wall by a margin (far facets = small sharp spots).
    const Tn = T.n, TCc = T.C;
    const floodOf = (d) => {
      const dnT = V.dot(d, Tn);
      if (!(Math.abs(dnT) > 1e-9)) return 0;
      const t = V.dot(V.sub(TCc, L), Tn) / dnT;
      if (!(t > 0)) return 0;
      const px = L[0] + d[0] * t - TCc[0], py = L[1] + d[1] * t - TCc[1], pz = L[2] + d[2] * t - TCc[2];
      const u = px * T.tu[0] + py * T.tu[1] + pz * T.tu[2], v = px * T.tv[0] + py * T.tv[1] + pz * T.tv[2];
      if (Math.abs(u) > half || Math.abs(v) > half) return 0;
      const i = Math.max(0, Math.min(pres - 1, Math.floor((u + half) / (2 * half) * pres)));
      const j = Math.max(0, Math.min(pres - 1, Math.floor((v + half) / (2 * half) * pres)));
      return cells[j * pres + i] > 0 ? 0 : 1;
    };
    const candN = Math.ceil(N * (sharpMode ? 6 : 2.5));
    const dropped = [];
    for (let f = 0; f < candN; f++) {
      const rr = rhoEff * Math.sqrt((f + 0.5) / candN), th = f * 2.39996323;
      let d = V.norm(V.add(V.mul(d0, Math.cos(rr)), V.mul(V.add(V.mul(bu, Math.cos(th)), V.mul(bv, Math.sin(th))), Math.sin(rr))));
      if (planar && V.dot(d, axis) <= 0.0) d = d0.slice();
      const iv = RF.Geo.envInterval(env, L, d);
      const tHit = iv[1];
      if (!(tHit > keep + 2 + insetEff)) continue;
      const thI = Math.acos(Math.max(-1, Math.min(1, V.dot(d, axis))));
      const I = Math.max(0, RF.Source.intensity(input.source, thI));
      if (!(I > 0)) continue;
      if (sharpMode === 'wall') {
        // sharp-first: hug the far wall (no dish plane); the r-sort keeps the best.
        // Skip very dim dirs: far + dark cannot be sized up enough to matter.
        if (I < 0.12) continue;
        const tt = tHit - insetEff;
        const P = [L[0] + d[0] * tt, L[1] + d[1] * tt, L[2] + d[2] * tt];
        info.push({ d, tHit, r: tt, P, flood: 0, score: tt * tt * I });
        continue;
      }
      const dn = V.dot(d, n0);
      if (Math.abs(dn) < 0.15) continue;
      const t = Dd / dn;
      if (!(t > 0)) continue;
      const flood = floodOf(d);
      let tt = t;
      if (t > tHit - 1.5) { if (!flood) { dropped.push({ d, tHit, r: tHit - 1.5, flood: 0 }); continue; } tt = tHit - 1.5; }
      if (tt < keep + 1.0) continue;
      const P = [L[0] + d[0] * tt, L[1] + d[1] * tt, L[2] + d[2] * tt];
      info.push({ d, tHit, r: tt, P, flood, score: tt * tt * I * (flood ? 2 : 1) });
    }
    if (!info.length) { notes.push('no facets feasible'); return { surfaces, intent, notes }; }
    // keep the best maxF. Sharp-first paintings (small gappy features): the farthest
    // facets (smallest spots). 'wall' also enforces angular spread (far-corner dirs
    // cluster: without it they stack radially and shadow to ~0). Otherwise flood
    // cover first, then far/bright.
    const meanDist = meanDistEarly;
    if (sharpMode === 'wall') {
      // sharp-first: drop anything close (near facets shadow the far ones and make
      // fat spots). Then enforce angular spread: far-corner dirs cluster, so greedily
      // keep facets angularly separated (else they stack radially and shadow to ~0).
      let rMax = 0;
      for (const e of info) if (e.r > rMax) rMax = e.r;
      const rCut = Math.max(keep + 2, 0.7 * rMax);
      const far = info.filter((e) => e.r >= rCut);
      if (far.length >= Math.min(12, info.length)) {
        info.length = 0;
        for (const e of far) info.push(e);
      }
      info.sort((a, b) => b.r - a.r);
      const estR = 3.5 * (settings.sizeScale || 1.1);
      const kept = [];
      for (const e of info) {
        if (kept.length >= maxF) break;
        const du = e.d;
        let ok = true;
        for (const a of kept) {
          const ang = Math.acos(Math.max(-1, Math.min(1, du[0] * a.d[0] + du[1] * a.d[1] + du[2] * a.d[2])));
          if (ang < (estR / e.r + estR / a.r) * 1.15) { ok = false; break; }
        }
        if (ok) kept.push(e);
      }
      if (kept.length >= 10) {
        info.length = 0;
        for (const e of kept) info.push(e);
      } else {
        while (info.length > maxF) info.pop();
      }
      notes.push('sharp-wall (meanDist ' + meanDist.toFixed(2) + ' frac ' + paintedFrac.toFixed(3) + ' rCut ' + rCut.toFixed(1) + ' kept ' + info.length + '): far facets only');
    } else if (sharpMode === 'plane') {
      info.sort((a, b) => b.r - a.r);
      while (info.length > maxF) info.pop();
      notes.push('sharp-plane: far facets on plane, ' + info.length);
    } else {
    info.sort((a, b) => (b.flood - a.flood) || (b.score - a.score));
    while (info.length > maxF) info.pop();
    if (info.length < maxF && (settings.fillUp !== undefined ? settings.fillUp : 1)) {
      dropped.sort((a, b) => (b.tHit - a.tHit));
      for (const c of dropped) {
        if (info.length >= maxF) break;
        if (c.r < keep + 1.0) continue;
        const P = [L[0] + c.d[0] * c.r, L[1] + c.d[1] * c.r, L[2] + c.d[2] * c.r];
        const thI = Math.acos(Math.max(-1, Math.min(1, V.dot(c.d, axis))));
        const I = Math.max(0, RF.Source.intensity(input.source, thI));
        if (!(I > 0)) continue;
        info.push({ d: c.d, tHit: c.tHit, r: c.r, P, flood: 0, score: c.r * c.r * I });
      }
    }
    } // end else (non-thin)

    // order facets along a space-filling curve of the dish, match to ordered paint
    const cu = V.inPlane(n0, d0), cv = V.cross(n0, cu);
    let minu = Infinity, maxu = -Infinity, minv = Infinity, maxv = -Infinity;
    for (const e of info) { e.pu = V.dot(V.sub(e.P, L), cu); e.pv = V.dot(V.sub(e.P, L), cv);
      if (e.pu < minu) minu = e.pu; if (e.pu > maxu) maxu = e.pu; if (e.pv < minv) minv = e.pv; if (e.pv > maxv) maxv = e.pv; }
    for (const e of info) {
      const qx = Math.max(0, Math.min(1023, Math.round((e.pu - minu) / Math.max(1e-9, maxu - minu) * 1023)));
      const qy = Math.max(0, Math.min(1023, Math.round((e.pv - minv) / Math.max(1e-9, maxv - minv) * 1023)));
      e.m = morton(qx, qy);
    }
    // TILE assignment (coverage guarantee): tile the paint bbox; facets per tile ~
    // tile weight (largest remainder); within a tile one aim per sub-cell (top-weight
    // painted cell there). Tiles are matched to facets in Morton order (locality).
    info.sort((a, b) => a.m - b.m);
    const M = info.length;
    let bi0 = pres, bi1 = -1, bj0 = pres, bj1 = -1;
    for (const c of pc) { if (c.i < bi0) bi0 = c.i; if (c.i > bi1) bi1 = c.i; if (c.j < bj0) bj0 = c.j; if (c.j > bj1) bj1 = c.j; }
    const bw = Math.max(1, bi1 - bi0 + 1), bh = Math.max(1, bj1 - bj0 + 1);
    const nx = Math.max(1, Math.round(Math.sqrt(M * bw / bh)));
    const ny = Math.max(1, Math.round(M / nx));
    const tileOf = (i, j) => [Math.min(nx - 1, Math.floor((i - bi0) / bw * nx)), Math.min(ny - 1, Math.floor((j - bj0) / bh * ny))];
    const tiles = new Map();
    for (const c of pc) {
      const [tx, ty] = tileOf(c.i, c.j), k = ty * nx + tx;
      let t = tiles.get(k);
      if (!t) { t = { tx, ty, w: 0, cells: [] }; tiles.set(k, t); }
      t.w += c.w; t.cells.push(c);
    }
    const tarr = [...tiles.values()];
    const tw = tarr.reduce((s, t) => s + t.w, 0) || 1;
    let assigned = 0;
    for (const t of tarr) { t.n = Math.floor(M * t.w / tw); assigned += t.n; }
    tarr.sort((a, b) => (M * b.w / tw - b.n) - (M * a.w / tw - a.n));
    for (let q = 0; q < M - assigned; q++) tarr[q % tarr.length].n++;
    let aims = [];
    if (settings.assignMode === 'quantile') {
      for (let f = 0; f < M; f++) aims.push(pcs[pickCell(Math.min(acc - 1e-9, Math.max(1e-9, (f + 0.5) / M * acc)))]);
    } else {
    tarr.sort((a, b) => morton(a.tx, a.ty) - morton(b.tx, b.ty) || a.ty - b.ty || a.tx - b.tx);
    for (const t of tarr) {
      if (!(t.n > 0)) continue;
      // sub-cells within the tile
      const skx = Math.max(1, Math.round(Math.sqrt(t.n * ((bi1 - bi0 + 1) / nx) / Math.max(1, (bj1 - bj0 + 1) / ny))));
      const sky = Math.max(1, Math.round(t.n / skx));
      const x0 = bi0 + (t.tx / nx) * bw, x1 = bi0 + ((t.tx + 1) / nx) * bw;
      const y0 = bj0 + (t.ty / ny) * bh, y1 = bj0 + ((t.ty + 1) / ny) * bh;
      const order = [];
      for (let sy = 0; sy < sky; sy++) for (let sx = 0; sx < skx; sx++) order.push([sx, sy]);
      // take first t.n sub-cells in Morton order for even spread
      order.sort((a, b) => morton(a[0], a[1]) - morton(b[0], b[1]));
      for (let q = 0; q < t.n; q++) {
        const [sx, sy] = order[q % order.length];
        const cx0 = x0 + (sx / skx) * (x1 - x0), cx1 = x0 + ((sx + 1) / skx) * (x1 - x0);
        const cy0 = y0 + (sy / sky) * (y1 - y0), cy1 = y0 + ((sy + 1) / sky) * (y1 - y0);
        let bestC = null;
        for (const c of t.cells) {
          if (c.i + 0.5 >= cx0 && c.i + 0.5 < cx1 && c.j + 0.5 >= cy0 && c.j + 0.5 < cy1) {
            if (!bestC || c.w > bestC.w) bestC = c;
          }
        }
        if (!bestC) { for (const c of t.cells) if (!bestC || c.w > bestC.w) bestC = c; }
        if (bestC) aims.push(bestC);
      }
    }
    while (aims.length < M) aims.push(aims[aims.length % Math.max(1, aims.length)] || pc[0]);
    } // end tile branch
    const assigns = aims.slice(0, M);
    const cnt = new Map();
    const cellIdx = new Map(pc.map((c, idx) => [c.k, idx]));
    const assignIdx = assigns.map((c) => cellIdx.get(c.k));
    for (const a of assignIdx) cnt.set(a, (cnt.get(a) || 0) + 1);
    // weighted paint centroid (aim target for concentrate > 0)
    const concBlend = settings.concentrate || 0;
    let Zcent = null;
    if (concBlend > 0) {
      let su = 0, sv = 0, sw = 0;
      for (const c of pc) { const u = -half + (c.i + 0.5) * (size / pres), v = -half + (c.j + 0.5) * (size / pres); su += u * c.w; sv += v * c.w; sw += c.w; }
      const Cu = su / Math.max(1e-9, sw), Cv = sv / Math.max(1e-9, sw);
      Zcent = [T.C[0] + T.tu[0] * Cu + T.tv[0] * Cv, T.C[1] + T.tu[1] * Cu + T.tv[1] * Cv, T.C[2] + T.tu[2] * Cu + T.tv[2] * Cv];
    }
    for (let f = 0; f < M; f++) {
      const cell = pc[assignIdx[f]];
      const e = info[f];
      e.cell = cell; e.share = cnt.get(assignIdx[f]);
      e.Z = cell.Z.slice();
      // concentration: blend every aim toward the paint's weighted centroid
    // (0 = tile the painting; 1 = single central spot for peak throw).
      if (concBlend > 0) e.Z = [e.Z[0] + (Zcent[0] - e.Z[0]) * concBlend, e.Z[1] + (Zcent[1] - e.Z[1]) * concBlend, e.Z[2] + (Zcent[2] - e.Z[2]) * concBlend];
      const sh = V.norm(V.sub(S0, e.P)), ah = V.norm(V.sub(e.Z, e.P));
      const bs = V.add(sh, ah), bl = V.len(bs);
      if (!(bl > 0.25)) { e.bad = true; continue; }
      e.n = V.mul(bs, 1 / bl);
      e.cosA = Math.max(0.05, V.dot(V.mul(e.d, -1), e.n));
      const th = Math.acos(Math.max(-1, Math.min(1, V.dot(e.d, axis))));
      e.I = Math.max(1e-3, RF.Source.intensity(input.source, th));
    }
    const cellMM = size / pres;
    let ledArea = 4;
    try {
      const ap = RF.Source.apparent(input.source);
      if (ap.kind === 'point') ledArea = 0.04;
      else if (ap.kind === 'planar') ledArea = ap.shape === 'disc' ? Math.PI * ap.radius * ap.radius : ap.w * ap.h;
      else if (ap.shape === 'cylinder') ledArea = 2 * (ap.radius || 0) * (ap.length || 0);
      else if (ap.shape === 'sphere' || ap.radius > 0) ledArea = Math.PI * ap.radius * ap.radius;
      if (!isFinite(ledArea)) ledArea = 4;
      ledArea = Math.max(0.04, ledArea);
    } catch (e) { /* keep default */ }
    const ledSize = Math.sqrt(ledArea);
    // coverage-driven FLAT facets: when the LED image is much smaller than the spot
    // needed to tile the paint (tiny die / point source), flat facets sized for
    // coverage give clean aperture spots; otherwise focused curved facets.
    let Rneed = 0;
    try {
      let hasGap2 = false;
      for (let k = 0; k < pres * pres && !hasGap2; k++) {
        if (cells[k] > 0) continue;
        const i = k % pres, j = Math.floor(k / pres);
        if ((i > 0 && cells[k - 1] > 0) || (i < pres - 1 && cells[k + 1] > 0) || (j > 0 && cells[k - pres] > 0) || (j < pres - 1 && cells[k + pres] > 0)) hasGap2 = true;
      }
      const covT = hasGap2 ? 2.0 : 6.0;
      Rneed = Math.sqrt(covT * Math.max(1e-9, pc.length * cellMM * cellMM) / (Math.max(1, info.length) * Math.PI));
      // gap-aware cap: spots much wider than the gap band cannot keep gaps dark;
      // tile with band-sized spots instead (partial credit both halves).
      if (hasGap2) {
        let rMx = 0;
        for (const e of info) if (e.r > rMx) rMx = e.r;
        if (!(rMx > 0)) rMx = Math.max(keep + 2, t0hit - insetEff);
        const kEst = ledSize * V.dist(TC, L) / Math.max(1e-9, rMx * cellMM);
        const bandMM = (kEst + 2) * cellMM;
        Rneed = Math.min(Rneed, Math.max(cellMM * 0.75, bandMM * 0.45));
      }
    } catch (e) { Rneed = 0; }
    const good = info.filter((e) => !e.bad && e.cell);
    if (!good.length) { notes.push('all degenerate'); return { surfaces, intent, notes }; }
    // per-facet spot model (flat facets paint Rneed discs, curved paint LED images).
    // One population only (decided by the median): mixed spot sizes ripple.
    let medRled = 0;
    try {
      const rs = good.map((e) => { const Dz = V.dist(e.Z, e.P); return ledSize * Dz / Math.max(1e-6, e.r) / 2; }).sort((a, b) => a - b);
      medRled = rs[Math.floor(rs.length / 2)] || 0;
    } catch (e) { medRled = 0; }
    const allFlat = Rneed > 1.3 * medRled;
    for (const e of good) {
      const Dz = V.dist(e.Z, e.P);
      const Rled = ledSize * Dz / Math.max(1e-6, e.r) / 2;
      e.isFlat = allFlat;
      e.spotR = e.isFlat ? Math.max(Rneed, Rled + Rneed * e.r / Math.max(1e-9, Dz) * 0 + Rneed) : Rled;
      if (e.isFlat) e.spotR = Rled + Rneed;
    }
    // edge-inset aiming: pull each aim inside the paint (along the distance-transform
    // gradient) by up to half the facet's spot radius, so edge spots cover their cell
    // while hanging less over the gap. Interior cells (spot fits) are untouched.
    try {
      const dist = new Float32Array(pres * pres).fill(1e9);
      for (let k = 0; k < pres * pres; k++) if (!(cells[k] > 0)) dist[k] = 0;
      for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
        const k = j * pres + i;
        if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1);
        if (j > 0) dist[k] = Math.min(dist[k], dist[k - pres] + 1);
      }
      for (let j = pres - 1; j >= 0; j--) for (let i = pres - 1; i >= 0; i--) {
        const k = j * pres + i;
        if (i < pres - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1);
        if (j < pres - 1) dist[k] = Math.min(dist[k], dist[k + pres] + 1);
      }
      // the grid border is also an edge (light past it misses the target entirely)
      for (let k = 0; k < pres * pres; k++) {
        const i = k % pres, j = Math.floor(k / pres);
        if (cells[k] > 0 && (i === 0 || j === 0 || i === pres - 1 || j === pres - 1)) dist[k] = Math.min(dist[k], 1);
      }
      const cellMAP = size / pres;
      for (const e of good) {
        const dEdge = dist[e.cell.k];
        if (!(dEdge < 50)) continue;
        const i = e.cell.k % pres, j = Math.floor(e.cell.k / pres);
        const gx = (i < pres - 1 ? dist[j * pres + i + 1] : dist[e.cell.k]) - (i > 0 ? dist[j * pres + i - 1] : dist[e.cell.k]);
        const gy = (j < pres - 1 ? dist[(j + 1) * pres + i] : dist[e.cell.k]) - (j > 0 ? dist[(j - 1) * pres + i] : dist[e.cell.k]);
        const gl = Math.hypot(gx, gy);
        if (!(gl > 1e-9)) continue;
        const Dz = V.dist(e.Z, e.P);
        const Rs = e.spotR || ledSize * Dz / Math.max(1e-6, e.r) / 2;
        const pull = Math.min(Rs * 0.5, Math.max(0, Rs - (dEdge - 0.5) * cellMAP));
        let iu = gx / gl, iv = gy / gl;
        if (!(pull > 1e-9)) continue;
        // landing guard: never pull an aim off the paint (thin strokes would overshoot
        // into the gap); halve until the landing cell is painted.
        let pl = pull, ok = false;
        for (let hg = 0; hg < 4 && !ok; hg++) {
          const zx = e.Z[0] + (T.tu[0] * iu + T.tv[0] * iv) * pl, zy = e.Z[1] + (T.tu[1] * iu + T.tv[1] * iv) * pl, zz = e.Z[2] + (T.tu[2] * iu + T.tv[2] * iv) * pl;
          const uu = (zx - T.C[0]) * T.tu[0] + (zy - T.C[1]) * T.tu[1] + (zz - T.C[2]) * T.tu[2];
          const vv = (zx - T.C[0]) * T.tv[0] + (zy - T.C[1]) * T.tv[1] + (zz - T.C[2]) * T.tv[2];
          const ii = Math.floor((uu + half) / (2 * half) * pres), jj = Math.floor((vv + half) / (2 * half) * pres);
          if (ii >= 0 && jj >= 0 && ii < pres && jj < pres && cells[jj * pres + ii] > 0) ok = true;
          else pl *= 0.5;
        }
        if (!ok || !(pl > 1e-9)) continue;
        e.Z = [e.Z[0] + (T.tu[0] * iu + T.tv[0] * iv) * pl, e.Z[1] + (T.tu[1] * iu + T.tv[1] * iv) * pl, e.Z[2] + (T.tu[2] * iu + T.tv[2] * iv) * pl];
        const sh = V.norm(V.sub(S0, e.P)), ah = V.norm(V.sub(e.Z, e.P));
        const bs = V.add(sh, ah), bl = V.len(bs);
        if (bl > 0.25) { e.n = V.mul(bs, 1 / bl); e.cosA = Math.max(0.05, V.dot(V.mul(e.d, -1), e.n)); }
      }
    } catch (e2) { notes.push('edge-inset skipped'); }

    let rMean = 0;
    for (const e of good) rMean += e.r;
    rMean /= good.length;
    const capSolid = 2 * Math.PI * (1 - Math.cos(rhoEff));
    // Fill: tiles on the bisector plane overlap in the LED view when incidence is
    // grazing (projected area x |n0.d0|); size the fill to the projection cosine so
    // facets rarely shadow each other. Face-on dishes (U-turn) pack densely.
    const projCos = Math.abs(V.dot(n0, d0));
    const fill = sharpMode === 'wall' ? 0.28 : Math.max(0.22, Math.min(0.75, projCos * 0.95));
    const packR = rMean * Math.sqrt(capSolid * fill / good.length / Math.PI) * sizeScale;
    const Apack = Math.PI * packR * packR;

    // coverage-driven blur: if N spots cover the paint fewer than ~1.3x, widen them
    // (defocus) so no painted cell is left in a void. Gapless paintings (a wash)
    // can take a much denser cover (~6x) for uniformity: blur is free there.
    let blurRb = settings.defocusMM || 0;
    try {
      let hasGap = false;
      for (let k = 0; k < pres * pres && !hasGap; k++) {
        if (cells[k] > 0) continue;
        const i = k % pres, j = Math.floor(k / pres);
        if ((i > 0 && cells[k - 1] > 0) || (i < pres - 1 && cells[k + 1] > 0) || (j > 0 && cells[k - pres] > 0) || (j < pres - 1 && cells[k + pres] > 0)) hasGap = true;
      }
      const covTarget = hasGap ? 2.0 : 6;
      const paintArea = Math.max(1e-9, pc.length * cellMM * cellMM);
      const spots = good.map((e) => { const Dz = V.dist(e.Z, e.P); const R = ledSize * Dz / Math.max(1e-6, e.r) / 2; return Math.PI * R * R; }).sort((a, b) => a - b);
      const spotMed = spots[Math.floor(spots.length / 2)] || 1;
      const cov = good.length * spotMed / paintArea;
      if (cov < covTarget) { const k = Math.sqrt(covTarget / Math.max(1e-9, cov)); const Rm = Math.sqrt(spotMed / Math.PI); blurRb = Math.max(blurRb, Math.min(0, Rm * Math.sqrt(Math.max(0, k * k - 1)))); }
      notes.push('cov ' + cov.toFixed(2) + ' blurRb ' + blurRb.toFixed(1));
    } catch (e2) { /* keep */ }
    const envTol = 1e-6 * Math.max(...env.half);
    // size with wide dynamic range; count clamp hits for the notes
    let nLo = 0, nHi = 0;
    // sizes: target illuminance -> A ~ w * r^2 * max(1,(spot/cell)^2)/(I cosA).
    // A facet's flux spreads over its LED-image spot; when the spot covers many
    // paint cells only cell/spot of the flux lands on the aim cell, so nearer
    // facets (bigger spots) need proportionally more area (the r^2 cancels).
    // Resolve-aware weights: a facet's spot mixes paint over its LED-image disc, so
    // size facets by the paint BLURRED to the median spot scale (the achievable
    // target), while aims are still distributed by the raw paint. For spots much
    // bigger than the painting's features this yields near-uniform facets (a uniform
    // beam scores the majority level); for small spots it keeps the raw levels.
    let wEff = null;
    try {
      const spots = good.map((e) => { const Dz = V.dist(e.Z, e.P); return ledSize * Dz / Math.max(1e-6, e.r) / cellMM; }).sort((a, b) => a - b);
      const spotMed = spots[Math.floor(spots.length / 2)] || 1;
      wEff = RF.Photometry.boxBlur(cells, pres, Math.min(pres, spotMed));
      notes.push('spotMedCells ' + spotMed.toFixed(1));
    } catch (e2) { wEff = null; }
    const wOf = (k) => (wEff ? wEff[k] : cells[k]);
    // uniform paintings (wash): identical facets tile evenly; any sizing variance
    // becomes beam ripple, so skip flux shaping entirely.
    let uniformSizes = false;
    try {
      let mw = 0, vw = 0, nw = 0;
      for (let k = 0; k < pres * pres; k++) if (cells[k] > 0) { mw += wOf(k); nw++; }
      mw /= Math.max(1, nw);
      for (let k = 0; k < pres * pres; k++) if (cells[k] > 0) vw += (wOf(k) - mw) * (wOf(k) - mw);
      vw = Math.sqrt(vw / Math.max(1, nw)) / Math.max(1e-9, mw);
      uniformSizes = vw < 0.15;
      if (uniformSizes) notes.push('uniform paint: equal facets');
    } catch (e) { uniformSizes = false; }
    const areas = good.map((e) => {
      if (uniformSizes && !e.isFlat) return 1;
      const Dz = V.dist(e.Z, e.P);
      if (e.isFlat) { const rad = Rneed * e.r / Math.max(1e-9, Dz); return Math.PI * rad * rad; }
      const spot = 2 * (e.spotR || 0) || ledSize * Dz / Math.max(1e-6, e.r);
      const f = Math.max(1, (spot / cellMM) * (spot / cellMM));
      return ((wOf(e.cell.k) / e.share) * e.r * e.r * f / (e.I * e.cosA)) * 1;
    });
    const sA = areas.slice().sort((a, b) => a - b);
    const Amed = sA[Math.floor(sA.length / 2)] || 1;
    const Kn = Apack / Amed;
    for (let f = 0; f < good.length; f++) good[f].gain = 1;
    // analytic balance (static, no tracing): splat each facet's captured flux as a
    // disc of its LED-spot radius onto the paint grid; rescale facets whose aim cell
    // is over/under the paint-relative target. 2-3 damped Jacobi rounds.
    try {
      const rounds = uniformSizes ? 0 : (settings.balanceRounds !== undefined ? settings.balanceRounds : 2);
      const Pw = Math.max(1e-9, input.source.power || 1000);
      const Itot = Math.max(1e-9, RF.Source.totalIntegral(input.source));
      for (let rd = 0; rd < rounds; rd++) {
        const del = new Float64Array(pres * pres);
        for (let f = 0; f < good.length; f++) {
          const e = good[f];
          const A = Math.min(2.5 * Apack, Math.max(0.05 * Apack, areas[f] * Kn * e.gain));
          const Dz = V.dist(e.Z, e.P);
          const Phi = Pw * (e.I / Itot) * (A * e.cosA / (e.r * e.r));
          e._Phi = Phi;
          const Rs = e.spotR || ledSize * Dz / Math.max(1e-6, e.r) / 2;
          // splat disc in paint-cell units around aim cell
          const ci = e.cell.k % pres, cj = Math.floor(e.cell.k / pres);
          const Rc = Rs / cellMM;
          const R0 = Math.max(0.6, Rc);
          const rI = Math.max(0, Math.floor(ci - R0)), r1 = Math.min(pres - 1, Math.ceil(ci + R0));
          const q0 = Math.max(0, Math.floor(cj - R0)), q1 = Math.min(pres - 1, Math.ceil(cj + R0));
          const wsum = Math.PI * R0 * R0;
          for (let q = q0; q <= q1; q++) for (let ii = rI; ii <= r1; ii++) {
            const dd = Math.hypot(ii - ci, q - cj);
            if (dd > R0) continue;
            del[q * pres + ii] += Phi * (1 - 0.5 * (dd / R0) * (dd / R0)) / wsum;
          }
        }
        let totD = 0, totW = 0;
        for (let k = 0; k < pres * pres; k++) if (cells[k] > 0) { totD += del[k]; totW += wOf(k); }
        const S = totD > 1e-300 ? totW / totD : 1;
        for (let f = 0; f < good.length; f++) {
          const e = good[f];
          const want = wOf(e.cell.k) * S;
          const got = del[e.cell.k];
          let m = got > 1e-300 ? want / got : 2;
          m = Math.max(0.6, Math.min(1.8, m));
          // gap-aware: boosting an edge facet mostly spills past the paint edge,
          // so only turn edge facets DOWN, never up — unless there are no gaps at
          // all (a wash), where the extra light can only help.
          if (m > 1 && hasGapEarly) {
            const i = e.cell.k % pres, j = Math.floor(e.cell.k / pres);
            let dE = 1e9;
            for (let a = -2; a <= 2 && dE > 1; a++) for (let b = -2; b <= 2; b++) {
              const ii = i + a, jj = j + b;
              if (ii < 0 || jj < 0 || ii >= pres || jj >= pres || !(cells[jj * pres + ii] > 0)) { dE = Math.min(dE, Math.hypot(a, b)); break; }
            }
            const Dz = V.dist(e.Z, e.P);
            const Rs = e.spotR || ledSize * Dz / Math.max(1e-6, e.r) / 2;
            if (dE * cellMM < Rs) m = 1;
          }
          e.gain *= 1 + 0.35 * (m - 1);
          e.gain = Math.max(0.4, Math.min(2.0, e.gain));
        }
      }
    } catch (e2) { notes.push('balance skipped'); }
    // aim repair (static, no tracing): voids the assignment missed show up as underlit
    // cells in the splat model; move the most over-delivering facets' aims onto the
    // most underlit cells (bounded count, locality-agnostic), then resettle gains.
    try {
      const repairs = settings.repairRounds !== undefined ? settings.repairRounds : 1;
      const cellByK = new Map(pc.map((c) => [c.k, c]));
      const PwR = Math.max(1e-9, input.source.power || 1000);
      const ItotR = Math.max(1e-9, RF.Source.totalIntegral(input.source));
      const splat = () => {
        const del = new Float64Array(pres * pres);
        for (let f = 0; f < good.length; f++) {
          const e = good[f];
          const A = Math.min(6 * Apack, Math.max(0.05 * Apack, areas[f] * Kn * (e.gain || 1)));
          const Dz = V.dist(e.Z, e.P);
          const Phi = PwR * (e.I / ItotR) * (A * e.cosA / (e.r * e.r));
          const Rs = e.spotR || ledSize * Dz / Math.max(1e-6, e.r) / 2;
          const ci = e.cell.k % pres, cj = Math.floor(e.cell.k / pres);
          const R0 = Math.max(0.6, Rs / cellMM);
          const rI = Math.max(0, Math.floor(ci - R0)), r1 = Math.min(pres - 1, Math.ceil(ci + R0));
          const q0 = Math.max(0, Math.floor(cj - R0)), q1 = Math.min(pres - 1, Math.ceil(cj + R0));
          const wsum = Math.PI * R0 * R0;
          for (let q = q0; q <= q1; q++) for (let ii = rI; ii <= r1; ii++) {
            const dd = Math.hypot(ii - ci, q - cj);
            if (dd > R0) continue;
            del[q * pres + ii] += Phi * (1 - 0.5 * (dd / R0) * (dd / R0)) / wsum;
          }
        }
        let totD = 0, totW = 0;
        for (let k = 0; k < pres * pres; k++) if (cells[k] > 0) { totD += del[k]; totW += wOf(k); }
        return { del, S: totD > 1e-300 ? totW / totD : 1 };
      };
      for (let rp = 0; rp < repairs; rp++) {
        const { del, S } = splat();
        const under = [];
        for (let k = 0; k < pres * pres; k++) {
          if (!(cells[k] > 0)) continue;
          const want = wOf(k) * S, got = del[k];
          if (got < 0.5 * want) under.push({ k, ratio: want / Math.max(1e-300, got) });
        }
        if (!under.length) break;
        under.sort((a, b) => b.ratio - a.ratio);
        const over = [];
        for (let f = 0; f < good.length; f++) {
          const e = good[f];
          const want = wOf(e.cell.k) * S, got = del[e.cell.k];
          if (got > 1.6 * want) over.push({ f, ratio: got / Math.max(1e-300, want) });
        }
        if (!over.length) break;
        over.sort((a, b) => b.ratio - a.ratio);
        const moves = Math.min(over.length, under.length, Math.max(1, Math.floor(good.length / 8)));
        const used = new Set();
        for (let q = 0; q < moves; q++) {
          const uk = under[q % under.length].k;
          // nearest over-facet aim (keeps the move local)
          const ui = uk % pres, uj = Math.floor(uk / pres);
          let bf = -1, bd = 1e18;
          for (const o of over) {
            if (used.has(o.f)) continue;
            const e = good[o.f];
            const dd = Math.hypot((e.cell.k % pres) - ui, (Math.floor(e.cell.k / pres)) - uj);
            if (dd < bd) { bd = dd; bf = o.f; }
          }
          if (bf < 0) break;
          used.add(bf);
          const e = good[bf], nc = cellByK.get(uk);
          if (!nc || nc.k === e.cell.k) continue;
          e.cell = nc;
          e.Z = nc.Z.slice();
          const sh = V.norm(V.sub(S0, e.P)), ah = V.norm(V.sub(e.Z, e.P));
          const bs = V.add(sh, ah), bl = V.len(bs);
          if (!(bl > 0.25)) { e.bad = true; continue; }
          e.n = V.mul(bs, 1 / bl);
          e.cosA = Math.max(0.05, V.dot(V.mul(e.d, -1), e.n));
          e.gain = Math.min((e.gain || 1) * 1.2, 2.5);
        }
        // resettle shares after moves
        const cnt2 = new Map();
        for (const e of good) if (!e.bad && e.cell) cnt2.set(e.cell.k, (cnt2.get(e.cell.k) || 0) + 1);
        for (const e of good) if (!e.bad && e.cell) e.share = cnt2.get(e.cell.k);
      }
      notes.push('repair done');
    } catch (e2) { notes.push('repair skipped'); }
    for (let f = 0; f < good.length; f++) {
      const e = good[f];
      let A = areas[f] * Kn * (e.gain || 1);
      const lo = 0.05 * Apack, hi = 2.5 * Apack;
      if (A < lo) { A = lo; nLo++; } else if (A > hi) { A = hi; nHi++; }
      // anti-overlap: never wider than ~half the local dish spacing (as seen from
      // the LED neighbours must not shadow each other); bright cells are served by
      // facet DENSITY (assignment), not oversized facets.
      const spacing = e.r * Math.sqrt(capSolid / Math.max(1, good.length));
      A = Math.min(A, Math.PI * 0.48 * spacing * (0.48 * spacing));
      let rad = Math.sqrt(A / Math.PI);
      rad = Math.min(rad, Math.max(0.5, e.r - keep - 0.5));
      const ex = V.inPlane(e.n, null), ey = V.cross(e.n, ex);
      let okAll = true;
      for (let it = 0; it < 16; it++) {
        let ok = RF.Geo.envInside(env, e.P, 1e-9);
        if (ok) {
          for (let q = 0; q < 20; q++) {
            const a = q * Math.PI / 10;
            const pt = [e.P[0] + (ex[0] * Math.cos(a) + ey[0] * Math.sin(a)) * rad,
                        e.P[1] + (ex[1] * Math.cos(a) + ey[1] * Math.sin(a)) * rad,
                        e.P[2] + (ex[2] * Math.cos(a) + ey[2] * Math.sin(a)) * rad];
            if (!RF.Geo.envInside(env, pt, envTol)) { ok = false; break; }
          }
          if (ok && V.dist(e.P, L) - rad < keep) ok = false;
        }
        if (ok) break;
        rad *= 0.72;
        if (rad < 0.4) { okAll = false; break; }
      }
      if (!okAll || rad < 0.4) continue;
      const id = 'F' + f;
      const Dz = V.dist(e.Z, e.P);
      const di = blurRb > 0.1 && !e.isFlat ? Dz * (2 * rad) / (2 * rad + blurRb) : Dz;
      const rec = { type: 'facet', id, group: 'A', P: e.P, S0: S0.slice(), Z: e.Z.slice(), di,
        clip: { kind: 'disc', r: rad }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      if (e.isFlat) rec.flat = true;
      surfaces.push(rec);
      intent.push({ facet: id, cells: [[e.cell.k, e.cell.w / e.share]] });
      if (surfaces.length >= maxF) break;
    }
    notes.push(surfaces.length + ' facets, packR ' + packR.toFixed(2) + ' rMean ' + rMean.toFixed(1) + ' clampLo ' + nLo + ' clampHi ' + nHi + ' dish ' + d0.map((x) => x.toFixed(2)).join(','));
    // post-pass: verify the REAL compiled surface (with sag) against envelope + keepOut; shrink violators
    try {
      const srcs = (input.sources && input.sources.length ? input.sources : [input.source]).map((s) => s.pos);
      for (let it = 0; it < 8; it++) {
        const C = RF.Geo.compile(surfaces);
        let fixed = 0;
        for (let k = 0; k < C.n; k++) {
          let bad = false;
          for (const poly of RF.Geo.outline(C, k)) { for (const p of poly) if (!RF.Geo.envInside(env, p, envTol)) { bad = true; break; } if (bad) break; }
          if (!bad) for (const S of srcs) {
            const polys = RF.Geo.outline(C, k);
            for (const poly of polys) {
              for (const p of poly) if (RF.V.dist(p, S) < keep * (1 - 1e-6)) { bad = true; break; }
              if (bad) break;
            }
            if (bad) break;
          }
          if (bad) { surfaces[k].clip.r *= 0.78; if (surfaces[k].clip.r < 0.4) surfaces[k].clip.r = 0; fixed++; }
        }
        for (let k = surfaces.length - 1; k >= 0; k--) if (!surfaces[k].clip.r) { surfaces.splice(k, 1); intent.splice(k, 1); }
        if (!fixed) break;
      }
    } catch (e) { notes.push('postpass: ' + String(e).slice(0, 120)); }
    notes.push('postpass kept ' + surfaces.length);
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-muse13contrib--star-shell', name: 'Star shell (static)', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'inset', label: 'Wall inset (mm)', type: 'number', min: 0, max: 20, step: 0.5, default: 4 },
      { key: 'sizeScale', label: 'Facet size scale', type: 'number', min: 0.3, max: 2, step: 0.05, default: 1.1 },
      { key: 'capDeg', label: 'Dish radius (deg)', type: 'number', min: 10, max: 80, step: 1, default: 55 },
      { key: 'dishMode', label: 'Dish centre', type: 'select', options: ['quad', 'auto'], default: 'quad' },
      { key: 'dishK', label: 'Dish lean to target', type: 'number', min: 0, max: 2, step: 0.25, default: 0.5 },
      { key: 'balanceRounds', label: 'Flux balance rounds', type: 'number', min: 0, max: 5, step: 1, default: 2 },
      { key: 'assignMode', label: 'Aim assignment', type: 'select', options: ['tile', 'quantile'], default: 'quantile' },
      { key: 'repairRounds', label: 'Aim repair rounds', type: 'number', min: 0, max: 4, step: 1, default: 0 },
      { key: 'concentrate', label: 'Aim concentration (0 tile, 1 single spot)', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
      { key: 'fillUp', label: 'Fill up with near facets', type: 'select', options: [1, 0], default: 1 },
    ],
    solve: starSolve,
  });

  // Optional tuner: tries a few static settings with short traces (same seed, so
  // differences are geometry, not noise) and keeps the best for the goal.
  // faithful = best F1 fidelity; throw = best peak cd; efficient = most light
  // on the paint. Static solve() itself never traces.
  RF.Solvers.register({
    id: 'bench-muse13contrib--star-shell-auto', name: 'Star shell auto (tuner)', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    ],
    solve(input, settings, tools) {
      const goal = settings.goal || 'faithful';
      const staticDef = RF.Solvers.get('bench-muse13contrib--star-shell');
      const base = RF.Solvers.defaults(staticDef);
      base.minDistance = settings.minDistance || 0;
      const grids = {
        faithful: [
          { capDeg: 45, sizeScale: 1.0 }, { capDeg: 55, sizeScale: 1.1 },
          { capDeg: 65, sizeScale: 1.2 }, { capDeg: 55, sizeScale: 0.9 },
        ],
        throw: [
          { concentrate: 1, sizeScale: 1.3 }, { concentrate: 1, sizeScale: 1.6 },
          { concentrate: 0.7, sizeScale: 1.4 },
        ],
        efficient: [
          { sizeScale: 1.3, capDeg: 65 }, { sizeScale: 1.6, capDeg: 65 },
          { sizeScale: 1.9, capDeg: 75 },
        ],
      };
      const cands = grids[goal] || grids.faithful;
      const rays = 75000;
      let best = null, bestScore = -Infinity, bestNote = '';
      for (let ci = 0; ci < cands.length; ci++) {
        const cs = RF.Solvers.sanitize(staticDef, Object.assign({}, base, cands[ci]));
        let out;
        try { out = starSolve(input, cs); } catch (e) { continue; }
        if (!out || !out.surfaces || !out.surfaces.length) continue;
        let res = null;
        try { res = tools.trace(out.surfaces, { rays }); } catch (e) { continue; }
        let score = -Infinity;
        if (goal === 'throw') score = (res && res.peakCd) || 0;
        else if (goal === 'efficient') score = (res && res.fidelity && res.fidelity.onPaint) || (res && res.lmOnTarget) || 0;
        else score = (res && res.fidelity && res.fidelity.fidelity) || 0;
        if (tools.progress) { try { tools.progress((ci + 1) / cands.length); } catch (e) { /* ignore */ } }
        if (score > bestScore) {
          bestScore = score;
          best = out;
          bestNote = goal + ' candidate ' + (ci + 1) + '/' + cands.length + ' ' + JSON.stringify(cands[ci]) + ' -> ' + score.toFixed(4);
        }
      }
      if (!best) best = starSolve(input, RF.Solvers.sanitize(staticDef, base));
      best.notes = (best.notes || []).concat(['auto goal=' + goal + ' best=' + bestNote]);
      return best;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
