// SC: the oncoming in-scatter culling bound (js/drive-three-halo-cull.js). Node only; the page side is tests/regress/SCULL-scatter-cull.js.
// The one property that matters: litBound never leaves out a table cell or depth slice in which the shader's integrand can be non-zero. Checked by brute force:
// random beam extents (all three conventions), random lamp poses and bases (some with a roll-like skew), random eyes; every (cell, sample distance) the shader would
// find lit (its own otherIntensity bounds rule, written out here) must be inside the slice range and the rectangle. The control proves the check can see a wrong bound:
// the same run with the rectangle shrunk by 2 cells must report misses.
// Run: node tests/scatter-cull.js
const { pathToFileURL } = require('url'), path = require('path');
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, rr = (a, b) => a + (b - a) * rnd();
const DEG = Math.PI / 180, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '../js/drive-three-halo-cull.js')).href);
  // ---- 1. beamExtent: a box of non-zero texels in a grid; the angle span covers every f the shader's bilinear rule can call non-zero
  {
    const W = 40, H = 20, data = new Float32Array(W * H); for (let y = 6; y <= 11; y++) for (let x = 10; x <= 25; x++) data[y * W + x] = 1 + x;
    const g = [-20, -10, 1 / 1, 1 / 1], e = C.beamExtent(data, 0, W, g, [W, H]);   // 1 degree texels
    // the shader: f = (deg - h0) * inv - 0.5, base = floor(f), non-zero iff texel base or base + 1 is non-zero
    const nz = (h, v) => { const fx = (h - g[0]) * g[2] - 0.5, fy = (v - g[1]) * g[3] - 0.5, bx = Math.floor(fx), by = Math.floor(fy); if (bx < 0 || by < 0 || bx + 1 >= W || by + 1 >= H) return false; for (const [a, b] of [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]]) if (data[b * W + a] !== 0) return true; return false; };
    let miss = 0, inside = 0; for (let h = -21; h < 21; h += 0.01) for (let v = -11; v < 11; v += 0.05) if (nz(h, v)) { inside++; if (h < e.h[0] || h > e.h[1] || v < e.v[0] || v > e.v[1]) miss++; }
    ok('beamExtent: every angle the shader reads as non-zero is inside the span (' + inside + ' sampled)', miss === 0 && inside > 1000, { miss, h: e.h, v: e.v });
    ok('beamExtent: the span is the box widened by one texel and no more (within 1 texel + float margin)', e.h[0] > -20 + 9 - 0.2 && e.h[1] < -20 + 27 + 0.2 && e.v[0] > -10 + 5 - 0.2 && e.v[1] < -10 + 13 + 0.2, e);
    ok('beamExtent: an all-zero beam is null, and the max is the largest texel', C.beamExtent(new Float32Array(W * H), 0, W, g, [W, H]) === null && e.max === 26);
  }
  // ---- 2. litBound against the brute-force lit set
  const conv3 = [0, 1, 2], names = ['A', 'B', 'S'];
  const shaderNZ = (P, L, B, conv, ext, g, size, boxIdx) => {   // otherIntensity != 0 for the beam whose non-zero texels are the box boxIdx = [i0, i1, j0, j1]
    const d = [P[0] - L[0], P[1] - L[1], P[2] - L[2]], lx = dot(d, B.f), ly = dot(d, B.l), lz = dot(d, B.u);
    if (lx <= 0) return false;
    const r = Math.hypot(lx, ly, lz), a = lx / r, b = -ly / r, c = lz / r; let h, v;
    if (conv === 1) { h = Math.asin(Math.max(-1, Math.min(1, b))); v = Math.atan2(c, a); }
    else if (conv === 2) { if (a <= 0) return false; h = Math.atan(b / a); v = Math.atan(c / a); }
    else { h = Math.atan2(b, a); v = Math.asin(Math.max(-1, Math.min(1, c))); }
    const fx = (h / DEG - g[0]) * g[2] - 0.5, fy = (v / DEG - g[1]) * g[3] - 0.5, bx = Math.floor(fx), by = Math.floor(fy);
    if (bx < 0 || by < 0 || bx + 1 >= size[0] || by + 1 >= size[1]) return false;
    return bx + 1 >= boxIdx[0] && bx <= boxIdx[1] && by + 1 >= boxIdx[2] && by <= boxIdx[3];
  };
  const NB = 24, edges = [0, ...Array.from({ length: NB }, (_, k) => 0.5 * Math.pow(240, (k + 1) / NB))]; edges[NB] = 120;
  const sliceOf = (s) => { for (let k = 0; k < NB; k++) if (s <= edges[k + 1]) return k; return NB - 1; };
  const run = (shrink) => {
    seed = 987654321; let cases = 0, tested = 0, lit = 0, missRect = 0, missSlice = 0, savedCells = 0, fullCells = 0, emptyN = 0;
    for (let it = 0; it < 240; it++) {
      const conv = conv3[it % 3], size = [rr(0, 1) < 0.5 ? 48 : 64, 32], step = rr(0.5, 2);
      const g = [-rr(10, 40), -rr(8, 20), 1 / step, 1 / step];
      const w = Math.round(rr(3, Math.min(size[0] - 2, 40))), h = Math.round(rr(2, size[1] - 2)), x0 = Math.floor(rr(0, size[0] - w)), y0 = Math.floor(rr(0, size[1] - h));
      const box = [x0, x0 + w - 1, y0, y0 + h - 1];
      const ext = { h: [g[0] + (Math.max(box[0] - 1, 0) + 0.5) * step - 0.03 * step - 1e-3, g[0] + (Math.min(box[1] + 1, size[0] - 1) + 0.5) * step + 0.03 * step + 1e-3], v: [g[1] + (Math.max(box[2] - 1, 0) + 0.5) * step - 0.03 * step - 1e-3, g[1] + (Math.min(box[3] + 1, size[1] - 1) + 0.5) * step + 0.03 * step + 1e-3] };
      // lamp pose: a heading, a small pitch, a roll; the local axes are the shader's (fwd from heading + elevation; lat, up either level or banked), with a skew in half the cases
      const hd = rr(0, 2 * Math.PI), se = Math.sin(rr(-0.15, 0.15)), ce = Math.sqrt(1 - se * se), fwd = [Math.cos(hd) * ce, Math.sin(hd) * ce, se];
      let lat = [-Math.sin(hd), Math.cos(hd), 0], up = [-se * Math.cos(hd), -se * Math.sin(hd), ce];
      if (it % 2) { const roll = rr(-0.3, 0.3), l2 = unit(cross(up, fwd)); lat = unit(l2.map((v, i) => v * Math.cos(roll) + up[i] * Math.sin(roll))); up = unit(cross(fwd, lat)); up = unit(up.map((v, i) => v + 0.02 * fwd[i])); }
      const B = { f: fwd, l: lat, u: up };
      const eye = [rr(-3, 3), rr(-3, 3), rr(0.8, 1.6)], dist = Math.pow(10, rr(0.5, 2.2)), ang = rr(-0.5, 0.5) + (rnd() < 0.3 ? Math.PI : 0);
      const L = [eye[0] + dist * Math.cos(ang), eye[1] + dist * Math.sin(ang), eye[2] + rr(-4, 2)];
      const tanH = Math.tan(rr(25, 50) * DEG), tab = [40, 24], aspect = tab[1] / tab[0] * (rnd() < 0.5 ? 1 : 0.8);
      const cc = C.coneClip(L, B, ext, conv);
      const view = { eye, tanH, aspect, edges, tab, frustum: true, xmin: 0.1 };
      const bd = C.litBound(view, [cc]);
      if (shrink && bd.rect) { bd.rect = [bd.rect[0] + shrink, bd.rect[1] - shrink, bd.rect[2] + shrink, bd.rect[3] - shrink]; if (bd.rect[0] > bd.rect[1] || bd.rect[2] > bd.rect[3]) bd.empty = true; }
      cases++; if (bd.empty) emptyN++;
      else { savedCells += tab[0] * tab[1] * NB - (bd.rect[1] - bd.rect[0] + 1) * (bd.rect[3] - bd.rect[2] + 1) * (bd.k1 - bd.k0 + 1); fullCells += tab[0] * tab[1] * NB; }
      for (let cx = 0; cx < tab[0]; cx++) for (let cy = 0; cy < tab[1]; cy++) {
        const sx = ((cx + 0.5) / tab[0]) * 2 - 1, sy = ((cy + 0.5) / tab[1]) * 2 - 1, ray = unit([1, -sx * tanH, sy * tanH * aspect]);
        for (let q = 0; q < 160; q++) {
          const s = 0.5 * Math.pow(240, (q + 0.5) / 160), P = [eye[0] + s * ray[0], eye[1] + s * ray[1], eye[2] + s * ray[2]];
          tested++;
          if (!shaderNZ(P, L, B, conv, ext, g, size, box)) continue;
          lit++;
          const k = sliceOf(s);
          if (bd.empty || k < bd.k0 || k > bd.k1) { missSlice++; continue; }
          if (cx < bd.rect[0] || cx > bd.rect[1] || cy < bd.rect[2] || cy > bd.rect[3]) missRect++;
        }
      }
    }
    return { cases, tested, lit, missRect, missSlice, emptyN, savedFrac: fullCells ? savedCells / fullCells : 0 };
  };
  const r0 = run(0);
  ok('litBound: no lit (cell, distance) is outside the slice range or the rectangle (240 random lamps, 3 conventions, tilt and skew)', r0.missRect === 0 && r0.missSlice === 0 && r0.lit > 5000, r0);
  const r2 = run(2);
  ok('CONTROL: with the rectangle shrunk by 2 cells the same check reports misses (it can see a wrong cull)', r2.missRect + r2.missSlice > 0, r2);
  // ---- 3. the clips compose: a ball clip only ever shrinks the bound; an empty cone is empty; fastRadius is monotone in eps
  {
    seed = 5; const eye = [0, 0, 1.2], ext = { h: [-30, 30], v: [-10, 10] }, B = { f: [-1, 0, 0], l: [0, -1, 0], u: [0, 0, 1] }, L = [60, 0, 0.7];
    const view = { eye, tanH: 0.8, aspect: 0.56, edges, tab: [60, 34], frustum: true, xmin: 0.1 };
    const a = C.litBound(view, [C.coneClip(L, B, ext, 0)]), b = C.litBound(view, [C.coneClip(L, B, ext, 0), C.ballClip(L, 12)]);
    ok('a car facing us at 60 m: the eye is inside its cone, so slices run from the eye to the lamp end of the cone (exact keeps the near slices)', !a.empty && a.k0 === 0, { k0: a.k0, k1: a.k1, rect: a.rect });
    ok('the fast ball (12 m about the lamp) tightens the slices and the rectangle', !b.empty && b.k0 >= a.k0 && b.k1 <= a.k1 && (b.rect[1] - b.rect[0]) <= (a.rect[1] - a.rect[0]) && b.k0 > a.k0, { exact: [a.k0, a.k1, a.rect], fast: [b.k0, b.k1, b.rect] });
    ok('a beam with no lit direction gives an empty bound', C.coneClip(L, B, null, 0) === null && C.litBound(view, [null]).empty === true);
    const f = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2].map((e) => C.fastRadius(0.02, 0.3, 30000, 0.5, e));
    ok('fastRadius falls as eps rises, and is infinite at eps 0', f.every((v, i) => i === 0 || v < f[i - 1]) && C.fastRadius(0.02, 0.3, 30000, 0.5, 0) === Infinity, f);
  }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
