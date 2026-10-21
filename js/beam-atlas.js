/* beam-atlas.js — BA5: one float texture holding every pool beam, for per-car traffic beams on the GPU.
 *
 * Pure: no DOM, no three.js. Loads in the page and in Node (tests/beam-atlas.js).
 *
 * Layout: each beam is one band of H rows, all bands W texels wide, stacked top to bottom. Beam i starts at row i*H.
 * Every beam is resampled to the same W x H grid (W = largest pool nh, H = largest pool nv, both capped at MAX_RES),
 * over its OWN window (h0, v0, nh*step, nv*step), so a beam keeps its own angles. Values are candela, unscaled.
 * Per-beam metadata (vec4 arrays, one entry per beam):
 *   beamMeta[i] = (rowOffset, W, H, candelaScale)     candelaScale is 1: the atlas never renormalises a beam
 *   beamGrid[i] = (h0, v0, 1/stepH, 1/stepV)          degrees; the shader does f = (deg - h0) * invStep - 0.5
 *   beamTint[i] = (r, g, b, convention)               tint is chromaticity (peak 1); convention 0 = A, 1 = B, 2 = S
 * sampleAtlas() is the same lookup the shader does, so the node tests can check the packed data without a GPU.
 */
(function () {
  const R = (typeof RF !== 'undefined' && RF) || (globalThis.RF = globalThis.RF || {});
  const MAX_BEAMS = 16, MAX_RES = 256;
  const CONV = { A: 0, B: 1, S: 2 };

  // A LUT (cd, row-major data[j*nh+i] at (h0+(i+.5)*step, v0+(j+.5)*step)) read at (h, v) degrees: bilinear over sample
  // centres, edge samples clamped, 0 outside the window. Used only to resample; the shader reads the atlas instead.
  function lutValue(L, h, v) {
    const fx = (h - L.h0) / L.step - 0.5, fy = (v - L.v0) / L.step - 0.5;
    if (fx < -0.5 || fy < -0.5 || fx > L.nh - 0.5 || fy > L.nv - 0.5) return 0;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const at = (a, b) => L.data[Math.min(L.nv - 1, Math.max(0, b)) * L.nh + Math.min(L.nh - 1, Math.max(0, a))];
    const top = at(i, j) * (1 - tx) + at(i + 1, j) * tx, bot = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return top * (1 - ty) + bot * ty;
  }

  // Pack the pool's LUTs (entries: { lut, tint, conv }, in pool order; index i is the atlas index the shader gets).
  function packAtlas(entries) {
    const n = entries.length;
    if (!n || n > MAX_BEAMS) throw Error('beam atlas takes 1 to ' + MAX_BEAMS + ' beams, got ' + n);
    const W = Math.min(MAX_RES, Math.max(...entries.map(e => e.lut.nh))), H = Math.min(MAX_RES, Math.max(...entries.map(e => e.lut.nv)));
    const data = new Float32Array(W * H * n * 1), meta = { beamMeta: new Float32Array(4 * n), beamGrid: new Float32Array(4 * n), beamTint: new Float32Array(4 * n) };
    entries.forEach((e, i) => {
      const L = e.lut, stepH = (L.nh * L.step) / W, stepV = (L.nv * L.step) / H, y0 = i * H;
      if (!(L.step > 0) || !L.data || L.data.length !== L.nh * L.nv) throw Error('beam atlas: beam ' + i + ' has no grid');
      for (let j = 0; j < H; j++) for (let x = 0; x < W; x++) {
        const c = lutValue(L, L.h0 + (x + 0.5) * stepH, L.v0 + (j + 0.5) * stepV);
        data[(y0 + j) * W + x] = c > 0 ? c : 0;
      }
      meta.beamMeta.set([y0, W, H, 1], 4 * i);
      meta.beamGrid.set([L.h0, L.v0, 1 / stepH, 1 / stepV], 4 * i);
      const t = e.tint || [1, 1, 1];
      meta.beamTint.set([t[0], t[1], t[2], CONV[e.conv || 'A'] ?? 0], 4 * i);
    });
    return { data, width: W, height: H * n, count: n, W, H, ...meta };
  }

  // The shader's lookup for atlas beam i at (h, v) degrees. Same bounds rule as the GLSL: a sample needs its +1 neighbour inside the band.
  function sampleAtlas(A, i, h, v) {
    const g = A.beamGrid.subarray(4 * i, 4 * i + 4), m = A.beamMeta.subarray(4 * i, 4 * i + 4);
    const fx = (h - g[0]) * g[2] - 0.5, fy = (v - g[1]) * g[3] - 0.5, bx = Math.floor(fx), by = Math.floor(fy), tx = fx - bx, ty = fy - by;
    if (bx < 0 || by < 0 || bx + 1 >= m[1] || by + 1 >= m[2]) return 0;
    const px = (x, y) => A.data[(m[0] + y) * A.W + x];
    const top = px(bx, by) * (1 - tx) + px(bx + 1, by) * tx, bot = px(bx, by + 1) * (1 - tx) + px(bx + 1, by + 1) * tx;
    return m[3] * (top * (1 - ty) + bot * ty);
  }

  R.BeamAtlas = { MAX_BEAMS, MAX_RES, packAtlas, sampleAtlas, lutValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = R.BeamAtlas;
})();
