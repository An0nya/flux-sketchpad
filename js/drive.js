/* drive.js — the driver's-eye view of a beam on the road (Spec mode → Result → Drive). Pure: no DOM, no tracing.
 *
 * What it computes: the LUMINANCE (cd/m²) the driver sees at every pixel, as a Float32 RGB image, from the beam's intensity
 * lookup I(H, V) (cd, from the judged far field) and a road scene. Tone mapping to a display is a separate step (tonemap).
 *
 * Model (single bounce, which is all a headlamp at night has):  for each lamp, a surface point P at distance r gets
 *   E⊥ = I(direction lamp→P) / r²        lux on a plane square to the beam
 *   E  = E⊥ · cosθi                      lux on the surface (θi from its normal)
 * and the driver sees
 *   diffuse   L = ρ/π · E
 *   glossy    L = E⊥ · D·F·G₁(NoL)·G₁(NoV) / (4·NoV)           GGX microfacet; the 1/NoL of the BRDF cancels E's cosθi
 *   retro     L = R · E⊥                                      R in cd/m²/lx: road markings (EN 1436 R_L), sign sheeting
 *                                                              and reflectors (R_A, the same units), eyeshine
 * Retroreflectors are NOT given an observation-angle falloff: R is taken as the value at the standard driver-and-headlamp
 * geometry, which is the geometry here. Material numbers are typical published values, not measurements of any road.
 * Optional ambient light (moon, dusk) lights diffuse surfaces only.
 *
 * Road frame (metres), as road.js: x ahead of the lamps, y LEFT of the own-lane centre, z up. The driver's eye is behind the
 * lamps, a little left of centre (right-hand traffic); left-hand traffic is this same picture mirrored (the caller flips it,
 * since the beam lookup is already mirrored).
 *
 * Thin features are anti-aliased analytically on the ground (a lane line far away is narrower than a pixel: its coverage of the
 * pixel's footprint is computed, laterally and — for dashes — along the road) and by 2×2 samples where objects are.            */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});
  const D2R = Math.PI / 180, PI = Math.PI;

  // ---------------------------------------------------------------- materials
  // rho: diffuse reflectance (linear RGB) · gloss {a: GGX roughness α, F0} · retro: [r,g,b] in cd/m²/lx, or {rl: scale} = scale × the
  // markings' R_L the user set · emit: cd/m² (lit windows, lamp heads)
  // PAINT_WET_GLOSS: wet paint is rougher than wet asphalt (a binder with pigment, not a polished surface), so its sheen is lower and broader: GGX alpha 0.25 against asphalt's 0.09.
  const PAINT_WET_GLOSS = { a: 0.25, F0: 0.02 };
  // wet: the wet look of a material, applied by materials() at road wetness W (see wetMaterial). Its presence is what makes a material take the wet sheen (SHEEN_IDS).
  // streak: the material also takes the streak from our own beam and the street lamps (OWN_STREAK_IDS). Concrete has the reflection sheen only, as before.
  const MAT_DEF = {
    'asphalt': { name: 'asphalt', rho: [0.10, 0.10, 0.10], gloss: { a: 0.5, F0: 0.04 }, wet: { rho: [0.05, 0.05, 0.05], gloss: { a: 0.09, F0: 0.02 } }, streak: true },
    'gravel': { name: 'gravel shoulder', rho: [0.22, 0.21, 0.19] },
    'grass': { name: 'grass', rho: [0.05, 0.09, 0.03] },
    'leaves': { name: 'forest floor', rho: [0.06, 0.05, 0.035] },
    'concrete': { name: 'pavement', rho: [0.30, 0.30, 0.29], gloss: { a: 0.6, F0: 0.04 }, wet: { rho: [0.2, 0.2, 0.19], gloss: { a: 0.15, F0: 0.02 } } },
    'white-paint': { name: 'white marking', rho: [0.45, 0.45, 0.45], retro: { rl: 1 }, wet: { gloss: PAINT_WET_GLOSS }, streak: true },
    'yellow-paint': { name: 'yellow marking', rho: [0.50, 0.38, 0.08], retro: { rl: 0.6, rgb: [1, 0.75, 0.1] }, wet: { gloss: PAINT_WET_GLOSS }, streak: true },
    'bark': { name: 'bark', rho: [0.08, 0.06, 0.045] },
    'foliage': { name: 'foliage', rho: [0.035, 0.065, 0.02] },
    'trunk-birch': { name: 'birch bark', rho: [0.45, 0.43, 0.38] },
    'fur': { name: 'deer fur', rho: [0.13, 0.095, 0.06] },
    'eyeshine': { name: 'eyeshine (retroreflecting eye)', rho: [0, 0, 0], retro: [900, 1500, 600] },
    'cloth-dark': { name: 'dark clothing', rho: [0.04, 0.04, 0.05] },
    'cloth-light': { name: 'light clothing', rho: [0.50, 0.50, 0.46] },
    'skin': { name: 'skin', rho: [0.30, 0.20, 0.15] },
    'hivis': { name: 'hi-vis fabric', rho: [0.55, 0.65, 0.05] },
    'hivis-tape': { name: 'retroreflective tape', rho: [0.5, 0.5, 0.5], retro: [330, 330, 330] },
    'sign-white': { name: 'sign (white sheeting)', rho: [0.5, 0.5, 0.5], retro: [250, 250, 250] },
    'sign-green': { name: 'sign (green sheeting)', rho: [0.05, 0.2, 0.1], retro: [20, 45, 30] },
    'sign-yellow': { name: 'sign (yellow sheeting)', rho: [0.5, 0.4, 0.05], retro: [170, 125, 8] },
    'sign-back': { name: 'sign back / post', rho: [0.2, 0.2, 0.2] },
    'reflector-white': { name: 'post reflector', rho: [0.4, 0.4, 0.4], retro: [600, 600, 600] },
    'reflector-red': { name: 'red reflector', rho: [0.1, 0.01, 0.01], retro: [200, 6, 6] },
    'rpm-white': { name: 'pavement marker (white)', rho: [0.4, 0.4, 0.4], retro: [80, 80, 80] },
    'rpm-yellow': { name: 'pavement marker (yellow)', rho: [0.5, 0.38, 0.08], retro: [70, 52, 3] },
    'wall': { name: 'building wall', rho: [0.22, 0.19, 0.16] },
    'wall-light': { name: 'light wall', rho: [0.45, 0.43, 0.40] },
    'win-dark': { name: 'dark window', rho: [0.03, 0.04, 0.05], gloss: { a: 0.08, F0: 0.04 } },
    'win-warm': { name: 'lit window', rho: [0.03, 0.04, 0.05], emit: [60, 42, 20] },
    'win-cool': { name: 'lit window (cool)', rho: [0.03, 0.04, 0.05], emit: [34, 42, 52] },
    'car-paint': { name: 'car body', rho: [0.06, 0.07, 0.09], gloss: { a: 0.12, F0: 0.05 } },
    'tyre': { name: 'tyre', rho: [0.03, 0.03, 0.03] },
    'plate': { name: 'number plate', rho: [0.5, 0.5, 0.45], retro: [90, 90, 80] },
    'lamp-head': { name: 'street lamp', rho: [0, 0, 0], emit: [9000, 6500, 3200] },
    'pole': { name: 'pole', rho: [0.12, 0.12, 0.12] },
    'sky': { name: 'sky', rho: [0, 0, 0] },
  };
  const MAT_KEYS = Object.keys(MAT_DEF), MAT_ID = {};
  MAT_KEYS.forEach((k, i) => { MAT_ID[k] = i; });
  // SB2: which materials take the wet sheen. Asphalt and concrete as before; the painted lines now too (their ids are 5 and 6; drive-three-shaders.js tests them by number).
  // SB2: which materials take the wet sheen (those with a wet look: asphalt, concrete, the painted lines), and which of them also take our own beam's streak.
  const SHEEN_IDS = MAT_KEYS.filter((k) => MAT_DEF[k].wet).map((k) => MAT_ID[k]);
  const OWN_STREAK_IDS = MAT_KEYS.filter((k) => MAT_DEF[k].streak).map((k) => MAT_ID[k]);
  // Road wetness W in 0..1: look.wetness when given, else the legacy boolean look.wet (true = 1, the old wet road).
  // Fog: look.visibility in metres; off = Infinity, null or 0. Koschmieder: extinction sigma = 3.912 / V per metre.
  function sigmaOf(look) { const v = look && +look.visibility; return v > 0 && v < Infinity ? 3.912 / v : 0; }
  function wetnessOf(look) { if (look.wetness !== undefined) { const w = +look.wetness; return w > 0 ? Math.min(w, 1) : 0; } return look.wet ? 1 : 0; }
  const wetnessLevels = { dry: 0, damp: 0.4, wet: 1 };     // the three levels the road button cycles through (spec-ui)
  // One material at road wetness W. W = 1 assigns the wet values exactly (the old wet look, byte for byte). 0 < W < 1 blends: rho linearly,
  // gloss alpha in log space, F0 linearly. A material with no dry gloss (paint) takes its wet gloss only at W = 1 with the sheen on; below that
  // its wetness shows only as the sheen weight (W, applied in render).
  function wetMaterial(dry, wd, W, sheen) {
    const out = Object.assign({}, dry);
    if (W >= 1) { if (wd.rho) out.rho = wd.rho; if (wd.gloss && (dry.gloss || sheen)) out.gloss = wd.gloss; return out; }
    if (wd.rho) out.rho = dry.rho.map((v, i) => v + (wd.rho[i] - v) * W);
    if (dry.gloss && wd.gloss) out.gloss = { a: Math.exp(Math.log(dry.gloss.a) + (Math.log(wd.gloss.a) - Math.log(dry.gloss.a)) * W), F0: dry.gloss.F0 + (wd.gloss.F0 - dry.gloss.F0) * W };
    return out;
  }
  // the table for one render: wet materials blend to their wet look at road wetness W; retro scales take the user's R_L
  function materials(look) {
    const W = wetnessOf(look), out = {};
    for (const k of MAT_KEYS) {
      const m = MAT_DEF[k], r = { rho: m.rho, gloss: m.gloss || null, emit: m.emit || null, retro: null, id: MAT_ID[k] };
      if (m.retro) { const rl = m.retro.rl !== undefined ? m.retro.rl * look.RL : 0, c = m.retro.rgb || [1, 1, 1]; r.retro = Array.isArray(m.retro) ? m.retro : [rl * c[0], rl * c[1], rl * c[2]]; }
      out[k] = r;
    }
    if (W > 0) for (const k of MAT_KEYS) if (MAT_DEF[k].wet) out[k] = wetMaterial(out[k], MAT_DEF[k].wet, W, !!look.wetSheen);
    return out;
  }

  // ---------------------------------------------------------------- the beam as a lookup table
  // I(h, v) in degrees → cd, resampled once on a regular grid (bilinear lookups are ~100× cheaper than the kernel average)
  function lutFrom(I, o) {
    o = o || {}; const win = o.win || [-45, 45, -30, 15], step = o.step || 0.1, nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), data = new Float32Array(nh * nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const c = I(win[0] + (i + 0.5) * step, win[2] + (j + 0.5) * step); data[j * nh + i] = c > 0 ? c : 0; }
    return { h0: win[0], v0: win[2], step, nh, nv, data };
  }
  function lutAt(L, h, v) {
    const fx = (h - L.h0) / L.step - 0.5, fy = (v - L.v0) / L.step - 0.5, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= L.nh || j + 1 >= L.nv) return 0;
    const tx = fx - i, ty = fy - j, d = L.data, k = j * L.nh + i;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + L.nh] * (1 - tx) + d[k + L.nh + 1] * tx) * ty;
  }
  // High beam switch: our table + the generic high beam (Headlamp.generic(h, v, true)) sampled on the SAME grid. lutAt is linear
  // between grid points, so the sum equals own + high everywhere, not only at the nodes. Off returns the table itself (identity).
  // Generic high is a gaussian about the axis (0,0) in the table's own H/V coordinates; for conventions B and S that is an
  // approximation of the off-axis shape (the axis itself maps to (0,0) in all three). Cached per low table object.
  const highCache = new WeakMap();
  function withHigh(low, on) {
    if (!on || !low || !low.data) return low;
    let c = highCache.get(low); if (c) return c;
    const nh = low.nh, data = new Float32Array(low.data.length);
    for (let j = 0; j < low.nv; j++) for (let i = 0; i < nh; i++) { const k = j * nh + i; data[k] = low.data[k] + Headlamp.generic(low.h0 + (i + 0.5) * low.step, low.v0 + (j + 0.5) * low.step, true); }
    c = Object.assign({}, low, { data }); highCache.set(low, c); return c;
  }
  // direction (road frame, x ahead, y left) → [H, V] in a convention; the same as FarField.hvOf (tests/drive.js checks it)
  let HV0 = 0, HV1 = 0;
  function hvFast(dx, dy, dz, conv) {
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, a = dx / L, b = -dy / L, c = dz / L;
    if (conv === 'B') { HV0 = Math.asin(Math.max(-1, Math.min(1, b))) / D2R; HV1 = Math.atan2(c, a) / D2R; }
    else if (conv === 'S') { if (a > 0) { HV0 = Math.atan(b / a) / D2R; HV1 = Math.atan(c / a) / D2R; } else { HV0 = HV1 = NaN; } }
    else { HV0 = Math.atan2(b, a) / D2R; HV1 = Math.asin(Math.max(-1, Math.min(1, c))) / D2R; }
  }

  // ---------------------------------------------------------------- road geometry on the ground
  // 1-D coverage of the interval [a - h, a + h] by [o0, o1] (the share of a pixel's footprint a stripe covers)
  const covLat = (a, h, o0, o1) => { const lo = Math.max(a - h, o0), hi = Math.min(a + h, o1); return hi > lo ? (hi - lo) / (2 * h) : 0; };
  // coverage of [s - h, s + h] by a periodic pattern (on for `on` of every `period`, from s0 to s1)
  function covLon(s, h, p) {
    if (!p) return 1;
    const a = Math.max(s - h, p.s0), b = Math.min(s + h, p.s1); if (!(b > a)) return 0;
    const F = (x) => { const u = x - p.s0, n = Math.floor(u / p.period); return n * p.on + Math.min(u - n * p.period, p.on); };
    return (F(b) - F(a)) / (2 * h);
  }
  // the usual lane markings for a road of lane width Lw (centre-line yellow in the US, white in the EU)
  function laneMarkings(Lw, o) {
    o = o || {}; const w = o.us ? 0.15 : 0.12, edge = o.us ? 0.1 : 0.15;
    const m = [
      { o0: -Lw / 2 - edge / 2 + 0.2, o1: -Lw / 2 + edge / 2 + 0.2, mat: 'white-paint', pat: null },            // right edge line, just inside the lane
      { o0: 1.5 * Lw - edge / 2 - 0.2, o1: 1.5 * Lw + edge / 2 - 0.2, mat: 'white-paint', pat: null },          // left edge line
    ];
    if (o.us && o.broken) m.push({ o0: Lw / 2 - 0.075, o1: Lw / 2 + 0.075, mat: 'yellow-paint', pat: { s0: -18, s1: 1e5, period: 12, on: 3 } });             // a passing zone: one broken yellow line (3 m line, 9 m gap; MUTCD's 10 ft / 30 ft)
    else if (o.us) m.push({ o0: Lw / 2 - 0.15, o1: Lw / 2 - 0.05, mat: 'yellow-paint', pat: null }, { o0: Lw / 2 + 0.05, o1: Lw / 2 + 0.15, mat: 'yellow-paint', pat: null });   // double solid yellow
    else m.push({ o0: Lw / 2 - w / 2, o1: Lw / 2 + w / 2, mat: 'white-paint', pat: { s0: -20, s1: 1e5, period: 12, on: 4 } });                                           // 4 m dash, 8 m gap
    return m;
  }

  // ---------------------------------------------------------------- primitives (vertical-axis shapes; everything stands on the ground)
  //   cyl  {x, y, r, z0, z1}                 vertical cylinder with a top cap
  //   ell  {x, y, z, rx, ry, rz}             ellipsoid
  //   box  {x, y, z0, z1, hx, hy, yaw}       box, rotated about the vertical axis
  //   disc {x, y, z, r, nx, ny, nz}          flat disc (sign face, reflector, eye); sub: true keeps it visible when smaller than a pixel
  // mat: a material key, or a function of the hit ({x, y, z, u, face}) returning one. u = distance along the face / around the shape.
  let NX = 0, NY = 0, NZ = 1, HU = 0, HF = 0, HSCALE = 1;
  function boundOf(ob) {
    if (ob.k === 'sdf') ob.bs = [ob.x, ob.y, ob.z, ob.r];
    else if (ob.k === 'cyl') { const hz = (ob.z1 - ob.z0) / 2; ob.bs = [ob.x, ob.y, (ob.z0 + ob.z1) / 2, Math.hypot(ob.r, hz)]; }
    else if (ob.k === 'ell') ob.bs = [ob.x, ob.y, ob.z, Math.max(ob.rx, ob.ry, ob.rz)];
    else if (ob.k === 'box') ob.bs = [ob.x, ob.y, (ob.z0 + ob.z1) / 2, Math.hypot(ob.hx, ob.hy, (ob.z1 - ob.z0) / 2)];
    else if (ob.k === 'disc') ob.bs = [ob.x, ob.y, ob.z, ob.r];
    if (ob.k === 'box') { ob.cy = Math.cos(ob.yaw || 0); ob.sy = Math.sin(ob.yaw || 0); }
    return ob;
  }
  // one slab of a box test (module state instead of a closure per call: this runs for every ray × object)
  let ST0 = 0, ST1 = 0, SFACE = -1;
  function slab(o, d, lo, hi, f) {
    if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
    let a = (lo - o) / d, b = (hi - o) / d, fa = f * 2, fb = f * 2 + 1; if (a > b) { const tt = a; a = b; b = tt; const tf = fa; fa = fb; fb = tf; }
    if (a > ST0) { ST0 = a; SFACE = fa; } if (b < ST1) ST1 = b; return ST0 <= ST1;
  }
  // nearest hit of a ray (o + t·d, d unit) with a primitive in (1e-4, tmax); sets NX/NY/NZ, HU, HF, HSCALE
  function hitObj(ob, ox, oy, oz, dx, dy, dz, tmax, delta) {
    HSCALE = 1; HF = 0;
    if (ob.k === 'sdf') { const h=RF.Drive.Models.trace(ob,ox,oy,oz,dx,dy,dz,tmax); if(Number.isFinite(h.t)){[NX,NY,NZ]=h.n;HU=h.id;}return h.t; }
    if (ob.k === 'cyl' && ob.axis) { const h=RF.Drive.Models.cylinder(ob,ox,oy,oz,dx,dy,dz,tmax);if(h.n)[NX,NY,NZ]=h.n;return h.t; }
    if (ob.k === 'cyl') {
      const px = ox - ob.x, py = oy - ob.y, a = dx * dx + dy * dy; let best = Infinity;
      if (a > 1e-12) {
        const b = 2 * (px * dx + py * dy), c = px * px + py * py - ob.r * ob.r, q = b * b - 4 * a * c;
        if (q >= 0) { const sq = Math.sqrt(q); for (let e = 0; e < 2; e++) { const t = e ? (-b + sq) / (2 * a) : (-b - sq) / (2 * a); if (t > 1e-4 && t < tmax) { const z = oz + t * dz; if (z >= ob.z0 && z <= ob.z1) { best = t; NX = (px + t * dx) / ob.r; NY = (py + t * dy) / ob.r; NZ = 0; HU = Math.atan2(NY, NX) * ob.r; break; } } } }
      }
      if (dz < 0 && oz > ob.z1) { const t = (ob.z1 - oz) / dz; if (t > 1e-4 && t < best && t < tmax) { const qx = px + t * dx, qy = py + t * dy; if (qx * qx + qy * qy <= ob.r * ob.r) { best = t; NX = 0; NY = 0; NZ = 1; HU = qx; HF = 4; } } }
      return best;
    }
    if (ob.k === 'ell') {
      const ix = 1 / ob.rx, iy = 1 / ob.ry, iz = 1 / ob.rz, px = (ox - ob.x) * ix, py = (oy - ob.y) * iy, pz = (oz - ob.z) * iz, qx = dx * ix, qy = dy * iy, qz = dz * iz;
      const a = qx * qx + qy * qy + qz * qz, b = 2 * (px * qx + py * qy + pz * qz), c = px * px + py * py + pz * pz - 1, q = b * b - 4 * a * c;
      if (q < 0) return Infinity;
      const t = (-b - Math.sqrt(q)) / (2 * a); if (!(t > 1e-4 && t < tmax)) return Infinity;
      const hx = (ox + t * dx - ob.x) * ix * ix, hy = (oy + t * dy - ob.y) * iy * iy, hz = (oz + t * dz - ob.z) * iz * iz, L = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      NX = hx / L; NY = hy / L; NZ = hz / L; HU = Math.atan2(NY, NX) * ob.rx; return t;
    }
    if (ob.k === 'box') {
      const c = ob.cy, s = ob.sy, rx = ox - ob.x, ry = oy - ob.y, lx = c * rx + s * ry, ly = -s * rx + c * ry, ldx = c * dx + s * dy, ldy = -s * dx + c * dy;
      ST0 = 1e-4; ST1 = tmax; SFACE = -1;
      if (!slab(lx, ldx, -ob.hx, ob.hx, 0) || !slab(ly, ldy, -ob.hy, ob.hy, 1) || !slab(oz, dz, ob.z0, ob.z1, 2)) return Infinity;
      const t0 = ST0, face = SFACE;
      if (face < 0 || t0 >= tmax) return Infinity;
      let nx = 0, ny = 0, nz = 0, u = 0; const px = lx + t0 * ldx, py = ly + t0 * ldy;
      if (face === 0) { nx = -1; u = py; } else if (face === 1) { nx = 1; u = py; } else if (face === 2) { ny = -1; u = px; } else if (face === 3) { ny = 1; u = px; } else if (face === 4) { nz = -1; u = px; } else { nz = 1; u = px; }
      NX = c * nx - s * ny; NY = s * nx + c * ny; NZ = nz; HU = u; HF = face; return t0;
    }
    // disc
    const den = dx * ob.nx + dy * ob.ny + dz * ob.nz; if(ob.eyeFalloff && den>=0)return Infinity; if (Math.abs(den) < 1e-9) return Infinity;
    const t = ((ob.x - ox) * ob.nx + (ob.y - oy) * ob.ny + (ob.z - oz) * ob.nz) / den; if (!(t > 1e-4 && t < tmax)) return Infinity;
    const qx = ox + t * dx - ob.x, qy = oy + t * dy - ob.y, qz = oz + t * dz - ob.z, d2 = qx * qx + qy * qy + qz * qz;
    if (ob.sub) {
      // smaller than one sample's footprint p: spread its luminance over the nearby samples with a separable tent weight (the
      // weights over any lattice sum to 1), so the picture holds the same energy wherever the disc falls between pixels
      const p = t * delta;
      if (PI * ob.r * ob.r < p * p) {
        const ax = Math.abs(qy / p), az = Math.abs(qz / p); if (ax >= 1 || az >= 1) return Infinity;
        HSCALE = PI * ob.r * ob.r / (p * p) * (1 - ax) * (1 - az); NX = ob.nx; NY = ob.ny; NZ = ob.nz; HU = 0; return t;
      }
    }
    if (d2 > ob.r * ob.r) return Infinity;
    NX = ob.nx; NY = ob.ny; NZ = ob.nz; HU = Math.sqrt(d2); return t;
  }

  // ---------------------------------------------------------------- render
  /* o: { w, h, hfov (deg), eye [x,y,z], lamps [[x,y,z]…], lut, conv, lampRGB, arc (RF.Road.arc or null), lane (m), scene, look:
   *      { wet, RL (cd/m²/lx of white paint), ambient (lx) }, ss (samples per side where there are objects, default 2) }
   * → { w, h, rgb: Float32Array (cd/m², linear RGB), depth (m, Infinity = sky), mat (index into keys), keys }
   * layer: 'objects' (the animated view, drive-anim.js): trace only the pixels objects can touch, and no ground or sky. Each pixel is
   * then (r, g, b = the objects' luminance already weighted by their coverage, a = the share of the pixel they cover), so that
   * final = rgb + (1 − a) · ground. Pass rgba (Float32Array 4·w·h) to have them written there (only the touched tiles; the caller
   * clears) and get rows [y0, y1) back; without it the result has rgb + cov. Not set: the whole picture, as always.
   * tight: tile each object by the projected corners of its box, not its bounding sphere (fewer pixels traced; the picture is the same wherever an object is).
   * layer: 'frame' writes complete opaque RGBA rows for moving route tiles; tileRow also splits the ground/sky work.
   * pointLights [{x,y,z,cd,rgb}]: downward diffuse-only street lights; crossings [{s0,s1,o0,o1}]: side-road ground openings;
   * hazardMask: optional Uint8Array(w*h), nearest-hit gameHazard ID bits (any covered subsample); no RGB changes.
   * hazardBodyMask: same bits, excluding pixels with ANY eyeshine sample (body detection, not eye dots).
   * sampleTiles: optional Uint8Array(ceil(w/16)*ceil(h/16)); records/retains supersampled tiles for paired renders.
   * groundCache: optional persistent {}; caches static ground shading in bounded camera-distance bands (24 MiB).
   * Replace the lut/data object when changing its values (as the page does); camera/look changes invalidate automatically.
   * grain(s,off,halfFootprint): ground-only brightness factor. These are render options, not saved scene fields. */
  function render(o) {
    // Optional CPU attribution: hash pixels to avoid always sampling the same roadside columns.
    const prof = o.profile, started = prof ? performance.now() : 0;
    let timed = false, rays = 0, sampled = 0, groundTime = 0, wetTime = 0;
    const wetFn = o.look && o.look.wetModel === 'ggx' ? wetGGX : wetLobe;   // look.wetModel: 'legacy' (default) or 'ggx'
    const lobe = prof ? (...args) => { if (!timed) return wetFn(...args); const t = performance.now(), v = wetFn(...args); wetTime += performance.now() - t; return v; } : wetFn;
    const w = o.w, h = o.h, tanH = Math.tan(o.hfov * D2R / 2), tanV = tanH * h / w, eye = o.eye, ex = eye[0], ey = eye[1], ez = eye[2];
    const lamps = o.lamps, nl = lamps.length, lut = o.lut, conv = o.conv || 'A', lc = o.lampRGB || [1, 1, 1], A = o.arc || null, Lw = o.lane;
    const look = Object.assign({ wet: false, RL: 0.2, ambient: 0 }, o.look), M = Object.assign(materials(look), o.mats || {}), scene = o.scene || { objects: [], markings: [], verge: ['gravel', 1.5, 'grass'] };
    const objs = scene.objects || [], cross = scene.cross || null, marks = scene.markings || [], vg = scene.verge || ['gravel', 1.5, 'grass'], ssN = o.ss || 2;
    const fullLayer = o.layer === 'frame', objOnly = o.layer === 'objects', rgba = (objOnly || fullLayer) && o.rgba ? o.rgba : null, cov = objOnly && !rgba ? new Float32Array(w * h) : null;
    const rgb = rgba ? null : new Float32Array(w * h * 3), depth = objOnly ? null : new Float32Array(w * h).fill(Infinity), matBuf = objOnly ? null : new Uint8Array(w * h);
    const amb = look.ambient > 0 ? look.ambient : 0, skyL = amb * 0.012;
    const sig = sigmaOf(look), fogD = (dx, dy, dz) => (sig ? Math.exp(-sig * Math.sqrt(dx * dx + dy * dy + dz * dz)) : 1);   // illumination path: transmittance over a light-to-surface distance (1 when off)
    // in-scatter (look.scatter = steps; needs finite visibility): added after each view-path veil, weighted by the sample's k. Off = not called, nothing added.
    const scatN = sig && look.scatter > 0 ? Math.round(look.scatter) : 0;
    const addScatter = (dx, dy, dz, sEnd, k, fx, fy) => { const c = inScatter(o, [dx, dy, dz], sEnd, scatterJitter(Math.floor(fx), Math.floor(fy)), scatN); LR += k * c[0]; LG += k * c[1]; LB += k * c[2]; };
    // view path: the samples' radiance gathered since r0..b0 is seen through T = exp(-sig t); airlight fills the rest with the sky value at that direction (glow: T only)
    const veil = (t, rayDz, k, r0, g0, b0, glow) => { const T = Math.exp(-sig * t), A = glow ? 0 : skyL * (1 + 0.8 * Math.max(0, 1 - Math.abs(rayDz) * 8)) * (1 - T) * k; LR = r0 + T * (LR - r0) + A; LG = g0 + T * (LG - g0) + A; LB = b0 + T * (LB - b0) + A; };       // ambient lx on diffuse surfaces; a faint sky, ~0.01 cd/m² per lx
    const traffic = o.trafficBeams ? trafficSources(objs, eye, o) : [], otherBeam = traffic.length ? trafficBeam(o) : null, pitch = o.pitch || 0;
    const pointLights = o.pointLights || [], crossings = o.crossings || [], wetW = wetnessOf(look), sheen = wetW > 0 && look.wetSheen, reflections = sheen ? reflectionSources(objs, o).concat(pointLights) : [];
    const delta0 = 2 * tanH / w;                                              // radians per pixel
    // tiles of 16 px: which objects can touch them (by the bounding sphere's projection)
    const TS = 16, tw = Math.ceil(w / TS), th = Math.ceil(h / TS), tiles = new Array(tw * th).fill(null);
    // Camera-distance bands (16-pixel tiles): static beam-lit ground, independent of the route's moving materials.
    // Float64 retains the shader arithmetic; never cache grain, coverage, street lights or emitter reflections.
    const gc = traffic.length || pitch || o.yaw || o.cornerLeft || o.cornerRight ? null : o.groundCache;
    const cacheMats = gc && new Map(Object.keys(M).map((key, i) => [M[key], i]));
    if (gc) {
      const key = JSON.stringify([w, h, o.hfov, eye, lamps, conv, lc, look, o.mats, lut.h0, lut.v0, lut.step, lut.nh, lut.nv]);
      if (gc.key !== key || gc.lut !== lut || gc.data !== lut.data) { gc.key = key; gc.lut = lut; gc.data = lut.data; gc.bands = []; gc.bytes = 0; gc.builds = (gc.builds || 0) + 1; gc.hits = gc.misses = 0; }
    }
    const cacheHits = gc && gc.hits || 0, cacheMisses = gc && gc.misses || 0;
    let groundBand = null, groundSlot = 0, groundSlots = 0, groundShading = false;
    // front to back: near[i] = a lower bound of any hit distance on object i (its bounding sphere; 0 for the sub-pixel discs, whose tent spread can reach past the sphere). A tile lists its objects by near,
    // and a ray stops testing at the first one whose near is not below the best hit so far: the same nearest hit, fewer tests (o.sort === false: the original order, every object tested)
    const near = new Float32Array(objs.length), ord = new Int32Array(objs.length); objs.forEach((ob, idx) => { ord[idx] = idx; if (!ob.bs) boundOf(ob); });
    if (o.sort !== false) {
      objs.forEach((ob, idx) => {
        if (ob.k === 'disc' && ob.sub) return;
        let d;
        if (ob.k === 'box') { const rx = ex - ob.x, ry = ey - ob.y, lx = ob.cy * rx + ob.sy * ry, ly = -ob.sy * rx + ob.cy * ry; d = Math.hypot(Math.max(Math.abs(lx) - ob.hx, 0), Math.max(Math.abs(ly) - ob.hy, 0), Math.max(ob.z0 - ez, ez - ob.z1, 0)); }   // the distance from the eye to the box itself, not its bounding sphere (a long building has a huge sphere)
        else if (ob.k === 'cyl' && !ob.axis) d = Math.hypot(Math.max(Math.hypot(ex - ob.x, ey - ob.y) - ob.r, 0), Math.max(ob.z0 - ez, ez - ob.z1, 0));
        else d = Math.max(0, Math.hypot(ob.bs[0] - ex, ob.bs[1] - ey, ob.bs[2] - ez) - ob.bs[3]);
        near[idx] = Math.max(0, d * 0.999 - 1e-3);
      });
      ord.sort((a, b) => near[a] - near[b] || a - b);
    }
    for (let oi = 0; oi < ord.length; oi++) {
      const idx = ord[oi], ob = objs[idx];
      const qx = ob.bs[0] - ex, qy = ob.bs[1] - ey, qz = ob.bs[2] - ez, R = ob.bs[3], d = Math.hypot(qx, qy, qz);
      if (qx + R <= 0.05) continue;
      let x0 = 0, x1 = tw - 1, y0 = 0, y1 = th - 1;
      if (d > R * 1.001 && qx > 0.05) {
        const ux = (w / 2) * (1 + (-qy / qx) / tanH), vy = (h / 2) * (1 - (qz / qx) / tanV), rp = Math.tan(Math.asin(Math.min(1, R / d))) / tanH * w / 2 * 1.15 + 2;   // centre and a generous radius, px
        x0 = Math.max(0, Math.floor((ux - rp) / TS)); x1 = Math.min(tw - 1, Math.floor((ux + rp) / TS)); y0 = Math.max(0, Math.floor((vy - rp) / TS)); y1 = Math.min(th - 1, Math.floor((vy + rp) / TS));
      }
      if (o.tight) {        // the box around the object instead of its bounding sphere (a post close by is thin, its sphere fills the picture): the projected corners
        const b = ob.axis ? [ob.x-R,ob.x+R,ob.y-R,ob.y+R,ob.bs[2]-R,ob.bs[2]+R] : ob.k === 'cyl' ? [ob.x - ob.r, ob.x + ob.r, ob.y - ob.r, ob.y + ob.r, ob.z0, ob.z1] : ob.k === 'ell' ? [ob.x - ob.rx, ob.x + ob.rx, ob.y - ob.ry, ob.y + ob.ry, ob.z - ob.rz, ob.z + ob.rz]
          : ob.k === 'box' ? (() => { const R = Math.hypot(ob.hx, ob.hy); return [ob.x - R, ob.x + R, ob.y - R, ob.y + R, ob.z0, ob.z1]; })() : [ob.x - ob.r, ob.x + ob.r, ob.y - ob.r, ob.y + ob.r, ob.z - ob.r, ob.z + ob.r];
        let ux0 = Infinity, ux1 = -Infinity, vy0 = Infinity, vy1 = -Infinity, ok = true;
        for (let c = 0; c < 8 && ok; c++) {
          const cx = (c & 1 ? b[1] : b[0]) - ex, cy = (c & 2 ? b[3] : b[2]) - ey, cz = (c & 4 ? b[5] : b[4]) - ez; if (cx <= 0.05) { ok = false; break; }
          const ux = (w / 2) * (1 + (-cy / cx) / tanH), vy = (h / 2) * (1 - (cz / cx) / tanV); if (ux < ux0) ux0 = ux; if (ux > ux1) ux1 = ux; if (vy < vy0) vy0 = vy; if (vy > vy1) vy1 = vy;
        }
        if (ok) { x0 = Math.max(x0, Math.floor((ux0 - 2) / TS)); x1 = Math.min(x1, Math.floor((ux1 + 2) / TS)); y0 = Math.max(y0, Math.floor((vy0 - 2) / TS)); y1 = Math.min(y1, Math.floor((vy1 + 2) / TS)); }
      }
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) (tiles[ty * tw + tx] || (tiles[ty * tw + tx] = [])).push(idx);
    }
    // ---- shading
    let LR = 0, LG = 0, LB = 0;
    // a direction outside the beam table's window has I = 0 (lutAt): with the table's window in hand (A convention) most of a scene is rejected without the two trig calls of hvFast. Never rejects inside the window.
    const lw = [lut.h0, lut.h0 + lut.nh * lut.step, lut.v0, lut.v0 + lut.nv * lut.step], preA = !pitch && !o.yaw && !o.cornerLeft && !o.cornerRight && conv === 'A' && lw[0] > -89 && lw[1] < 89 && lw[2] > -89 && lw[3] < 89;
    const sv0 = Math.sin(lw[2] * D2R) - 1e-9, sv1 = Math.sin(lw[3] * D2R) + 1e-9, th0 = Math.tan(lw[0] * D2R) * (1 + 1e-9) - 1e-12, th1 = Math.tan(lw[1] * D2R) * (1 + 1e-9) + 1e-12;
    // add a surface point's luminance, weighted: P = hit, n = unit normal (facing the eye), m = material, k = weight, v = unit vector to the eye
    function shade(px, py, pz, nx, ny, nz, m, k, vx, vy, vz, rscale, staticBuild, eyeFalloff) {
      if (groundBand && groundShading && !staticBuild) {
        const mi = cacheMats.get(m);
        let a = groundBand.get(mi);
        // Bounded per renderer/worker, even when dynamic job scheduling eventually visits every tile.
        if (!a && gc.bytes + 32 * groundSlots <= 24 * 1024 * 1024) { a = new Float64Array(4 * groundSlots); groundBand.set(mi, a); gc.bytes += a.byteLength; }
        if (a) {
          const q = 4 * groundSlot;
          if (!a[q + 3]) {
            const r0 = LR, g0 = LG, b0 = LB; LR = LG = LB = 0;
            shade(px, py, pz, nx, ny, nz, m, 1, vx, vy, vz, rscale, true);
            a[q] = LR; a[q + 1] = LG; a[q + 2] = LB; a[q + 3] = 1;
            LR = r0; LG = g0; LB = b0; gc.misses++;
          } else gc.hits++;
          let r = 0, g = 0, b = 0;
          for (const L of pointLights) {
            const dx = L.x - px, dy = L.y - py, dz = L.z - pz, r2 = dx * dx + dy * dy + dz * dz;
            if (dz <= 0 || r2 < 0.01) continue;
            const e = L.cd * Math.max(0, dx * nx + dy * ny + dz * nz) / (PI * r2 * Math.sqrt(r2)) * fogD(dx, dy, dz);
            r += m.rho[0] * L.rgb[0] * e; g += m.rho[1] * L.rgb[1] * e; b += m.rho[2] * L.rgb[2] * e;
          }
          if (sheen && SHEEN_IDS.includes(m.id)) for (const L of reflections) {
            const v = L.cd * lobe(L.x - px, L.y - py, L.z - pz, vx, vy, vz) * wetW * fogD(L.x - px, L.y - py, L.z - pz); r += v * L.rgb[0]; g += v * L.rgb[1]; b += v * L.rgb[2];
          }
          LR += k * (a[q] + r * lc[0]); LG += k * (a[q + 1] + g * lc[1]); LB += k * (a[q + 2] + b * lc[2]); return;
        }
      }
      let r = 0, g = 0, b = 0;
      const rho = m.rho, NoV = nx * vx + ny * vy + nz * vz;
      if (m.emit && NoV > 0) { const es = (rscale === undefined ? 1 : rscale) * (m.emitPow > 1 ? Math.pow(NoV, m.emitPow) : NoV); r += m.emit[0] * es; g += m.emit[1] * es; b += m.emit[2] * es; }   // a flat emitter is Lambertian, L·cosθ; lamps are directional: cos^n
      if (amb > 0 && nz > -0.9) { const e = amb * (0.5 + 0.5 * nz) / PI; r += rho[0] * e; g += rho[1] * e; b += rho[2] * e; }
      // Optional street lights: downward point sources, diffuse only, no shadows. Emitters alone do not light other surfaces.
      if (!staticBuild) for (const L of pointLights) {
        const dx = L.x - px, dy = L.y - py, dz = L.z - pz, r2 = dx * dx + dy * dy + dz * dz;
        if (dz <= 0 || r2 < 0.01) continue;
        const e = L.cd * Math.max(0, dx * nx + dy * ny + dz * nz) / (PI * r2 * Math.sqrt(r2)) * fogD(dx, dy, dz);
        r += rho[0] * L.rgb[0] * e; g += rho[1] * L.rgb[1] * e; b += rho[2] * L.rgb[2] * e;
      }
      if (!staticBuild && sheen && nz === 1 && SHEEN_IDS.includes(m.id)) for (const L of reflections) {
        const a = L.cd * lobe(L.x - px, L.y - py, L.z - pz, vx, vy, vz) * wetW * fogD(L.x - px, L.y - py, L.z - pz); r += a * L.rgb[0]; g += a * L.rgb[1]; b += a * L.rgb[2];
      }
      for (const L of traffic) {
        const dx = px - L.x, dy = py - L.y, dz = pz - L.z, r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 0.01) continue; const noL = Math.max(0, -(dx * nx + dy * ny + dz * nz) / Math.sqrt(r2)); if (!noL) continue;
        const e = trafficAt(L, otherBeam, px, py, pz) / r2 * noL / PI * fogD(dx, dy, dz);
        r += rho[0] * e; g += rho[1] * e; b += rho[2] * e * 0.93;
      }
      for (let i = 0; i < nl; i++) {
        const L = lamps[i], dx = px - L[0], dy = py - L[1], dz = pz - L[2], r2 = dx * dx + dy * dy + dz * dz, rr = Math.sqrt(r2), NoL = -(dx * nx + dy * ny + dz * nz) / rr;
        if (!(NoL > 0)) continue;
        if (preA) { const a = dx / rr, b = -dy / rr, c = dz / rr; if (c < sv0 || c > sv1 || a <= 0 || b > a * th1 || b < a * th0) continue; }
        const I = ownBeamAt(o, dx, dy, dz, L[1]) * fogD(dx, dy, dz); if (!(I > 0)) continue;
        if (sheen && nz === 1 && OWN_STREAK_IDS.includes(m.id)) { const a = I * lobe(-dx, -dy, -dz, vx, vy, vz) * wetW; r += a; g += a; b += a; }
        const Ep = I / r2;                                                    // E⊥, lux square to the beam
        const d = Ep * NoL / PI; r += rho[0] * d; g += rho[1] * d; b += rho[2] * d;
        if (m.gloss && NoV > 0) {
          const lx = -dx / rr, ly = -dy / rr, lz = -dz / rr; let hx = lx + vx, hy = ly + vy, hz = lz + vz; const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= hl; hy /= hl; hz /= hl;
          const NoH = nx * hx + ny * hy + nz * hz, VoH = vx * hx + vy * hy + vz * hz, a2 = m.gloss.a * m.gloss.a, den = NoH * NoH * (a2 - 1) + 1, D = a2 / (PI * den * den);
          const F = m.gloss.F0 + (1 - m.gloss.F0) * Math.pow(1 - Math.max(0, VoH), 5), kk = m.gloss.a / 2, G1 = (x) => x / (x * (1 - kk) + kk);
          const s = D * F * G1(NoL) * G1(NoV) / (4 * NoV) * Ep; r += s; g += s; b += s;
        }
        if (m.retro) { const q = Ep * (rscale === undefined ? 1 : rscale) * (eyeFalloff ? Math.pow(NoL,eyeFalloff) : 1); r += m.retro[0] * q; g += m.retro[1] * q; b += m.retro[2] * q; }
      }
      LR += k * r * lc[0]; LG += k * g * lc[1]; LB += k * b * lc[2];
    }
    // the ground at P (distance t along the ray): road / verge, and the markings by coverage of the pixel's footprint
    let GM = 0;                                         // the material with the largest share of the last ground footprint (for the probe)
    function ground(px, py, t, sinB, vx, vy, vz, delta, kw) {
      let s = px, off = py, nx = 0, ny = 1; if (A) { const f = A.frame(px, py); s = f.s; off = f.off; nx = -f.t[1]; ny = f.t[0]; }
      const hw = Math.max(0.5 * t * delta, 1e-4), hl = hw / Math.max(sinB, 0.003);
      if (o.grain && off > -0.5 * Lw - vg[1] && off < 1.5 * Lw + vg[1]) kw *= o.grain(s, off, hl);
      // the pixel's footprint on the ground is hw wide across the ray and hl long along it: its half-extent in the offset direction (a bend's far lines run across the view, where hl counts)
      const hh = Math.hypot(vx, vy) || 1, ho = Math.hypot(hw * (nx * -vy + ny * vx) / hh, hl * (nx * vx + ny * vy) / hh);
      let rest = 1, bestW = 0; GM = MAT_ID.asphalt;
      for (let i = 0; i < marks.length; i++) {
        const mk = marks[i], c = covLat(off, ho, mk.o0, mk.o1); if (c <= 0) continue;
        if (mk.skip) { let cut = false; for (let q = 0; q < mk.skip.length; q++) if (s > mk.skip[q][0] && s < mk.skip[q][1]) { cut = true; break; } if (cut) continue; }
        const cl = c * covLon(s, hl, mk.pat); if (cl <= 0) continue;
        shade(px, py, 0, 0, 0, 1, M[mk.mat], cl * kw, vx, vy, vz); rest -= cl; if (cl > bestW) { bestW = cl; GM = M[mk.mat].id; }
      }
      if (rest <= 0) return;
      if (cross && s >= cross.s0 && s <= cross.s1) { shade(px, py, 0, 0, 0, 1, M.asphalt, rest * kw, vx, vy, vz); if (rest > bestW) GM = M.asphalt.id; return; }   // a cross street: pavement across every offset
      for (const c of crossings) {
        const cl = covLon(s, hl, { s0: c.s0, s1: c.s1, period: 1e9, on: c.s1 - c.s0 }) * covLat(off, ho, c.o0, c.o1);
        if (cl > 0) { shade(px, py, 0, 0, 0, 1, M.asphalt, cl * rest * kw, vx, vy, vz); rest *= 1 - cl; if (cl > bestW) { bestW = cl; GM = M.asphalt.id; } }
      }
      // the road, the two verge strips and what lies beyond them, each weighted by the share of the footprint it covers (no stair-steps along a long diagonal edge)
      const vw = vg[1] || 1.5, far = vg[2] || vg[0], INF = 1e9, e0 = -Lw / 2, e1 = 1.5 * Lw;
      const bands = [['asphalt', e0, e1], [vg[0], e0 - vw, e0], [vg[0], e1, e1 + vw], [far, -INF, e0 - vw], [far, e1 + vw, INF]];
      let tot = 0; for (let i = 0; i < 5; i++) tot += covLat(off, ho, bands[i][1], bands[i][2]);
      for (let i = 0; i < 5; i++) { const c = covLat(off, ho, bands[i][1], bands[i][2]) / (tot || 1); if (c <= 0) continue; shade(px, py, 0, 0, 0, 1, M[bands[i][0]], c * rest * kw, vx, vy, vz); if (c * rest > bestW) { bestW = c * rest; GM = M[bands[i][0]].id; } }
    }
    let sampleDepth = Infinity, sampleMat = MAT_ID.sky, covAcc = 0, hazardAcc = 0, eyeAcc = 0;
    // one ray through (fx, fy) in pixel units; adds weight k to the accumulators
    function sample(fx, fy, k, tileObjs, delta) {
      if (prof) { rays++; if (timed) sampled++; }
      const u = fx / w * 2 - 1, v = 1 - fy / h * 2; let dx = 1, dy = -u * tanH, dz = v * tanV; const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz); dx *= il; dy *= il; dz *= il;
      let tg = Infinity; if (dz < -1e-6) tg = -ez / dz;
      let tbest = tg, hit = -1, hnx = 0, hny = 0, hnz = 1, hu = 0, hf = 0, hs = 1;
      if (tileObjs) for (let q = 0; q < tileObjs.length; q++) {
        const oi = tileObjs[q]; if (near[oi] >= tbest) break;
        const ob = objs[oi], t = hitObj(ob, ex, ey, ez, dx, dy, dz, tbest * (1 + 1e-12), delta);             // (a hair past tbest: an exact tie with an earlier-listed object, e.g. a plate and its reflectors on one plane, goes to the earlier one, as in the original order)
        if (t < tbest || (t === tbest && oi < hit)) { tbest = t; hit = oi; hnx = NX; hny = NY; hnz = NZ; hu = HU; hf = HF; hs = HSCALE; }
      }
      if (hit >= 0) {
        const ob = objs[hit], px = ex + tbest * dx, py = ey + tbest * dy, pz = ez + tbest * dz;
        if ((o.hazardMask || o.hazardBodyMask) && ob.gameHazard) hazardAcc |= 1 << (ob.gameHazard - 1);
        if (hnx * dx + hny * dy + hnz * dz > 0) { hnx = -hnx; hny = -hny; hnz = -hnz; }
        const sdfKey=ob.k==='sdf'?MAT_KEYS[Math.round(hu)]:null;
        const key = sdfKey ? (sdfKey==='hivis' && ((pz>1 && pz<1.06)||(pz>1.26 && pz<1.32))?'hivis-tape':sdfKey) : typeof ob.mat === 'function' ? ob.mat({ x: px, y: py, z: pz, u: hu, face: hf }) : ob.mat;
        if (ob.gameHazard && key === 'eyeshine') eyeAcc |= 1 << (ob.gameHazard - 1);
        let m = M[key] || M.wall; if (ob.emit) m = ob.emitM && ob.emitBase === m ? ob.emitM : (ob.emitBase = m, ob.emitM = Object.assign({}, m, { emit: ob.emit, emitPow: ob.emitPow }));   // this object glows (a lamp: its own luminance); emitPow > 1 makes it directional (cos^n)
        const r0 = LR, g0 = LG, b0 = LB; shade(px, py, pz, hnx, hny, hnz, m, k, -dx, -dy, -dz, hs, false, ob.eyeFalloff); if (sig) veil(tbest, dz, k, r0, g0, b0, !!ob.glow); if (scatN && !ob.glow) addScatter(dx, dy, dz, tbest, k, fx, fy); if (!ob.glow) covAcc += k;                        // glow (a pavement marker): adds its light, does not hide the ground under it
        if (sampleDepth === Infinity) { sampleDepth = tbest; sampleMat = m.id; }
      } else if (objOnly) { /* the ground and the sky are the other layer's */ } else if (tg < Infinity && tg < 5000) {
        const tGround = timed ? performance.now() : 0;
        const r0 = LR, g0 = LG, b0 = LB;
        groundShading = true;
        ground(ex + tg * dx, ey + tg * dy, tg, -dz, -dx, -dy, -dz, delta, k);
        groundShading = false;
        if (sig) veil(tg, dz, k, r0, g0, b0, false);
        if (scatN) addScatter(dx, dy, dz, tg, k, fx, fy);
        if (timed) groundTime += performance.now() - tGround;
        if (sampleDepth === Infinity) { sampleDepth = tg; sampleMat = GM; }
      } else { const sl = skyL * (1 + 0.8 * Math.max(0, 1 - Math.abs(dz) * 8)); LR += k * sl; LG += k * sl; LB += k * sl; if (scatN) addScatter(dx, dy, dz, Infinity, k, fx, fy); }
    }
    const pixel = (x, y, tl) => {
      if (prof) { const q = y * w + x; timed = ((Math.imul(q ^ (q >>> 16), 0x45d9f3b) >>> 16) & 63) === 0; }
      const ti = Math.floor(y / TS) * tw + Math.floor(x / TS);
      if (o.sampleTiles && tl) o.sampleTiles[ti] = 1;
      const n = tl || (o.sampleTiles && o.sampleTiles[ti]) ? ssN : 1, k = 1 / (n * n), delta = delta0 / n;
      // Materials are rebuilt each render; key cached planes by their position in the material table.
      groundBand = null;
      if (gc && y >= h / 2) {
        const bands = gc.bands[n] || (gc.bands[n] = []);
        groundBand = bands[ti] || (bands[ti] = new Map()); groundSlots = TS * TS * n * n;
        groundSlot = ((y % TS) * TS + x % TS) * n * n;
      }
      LR = LG = LB = 0; sampleDepth = Infinity; sampleMat = MAT_ID.sky; covAcc = 0; hazardAcc = 0; eyeAcc = 0;
      const slot0 = groundSlot;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { groundSlot = slot0 + j * n + i; sample(x + (i + 0.5) / n, y + (j + 0.5) / n, k, tl, delta); }
      const q = y * w + x;
      if (o.hazardMask) o.hazardMask[q] = hazardAcc;
      if (o.hazardBodyMask) o.hazardBodyMask[q] = hazardAcc & ~eyeAcc;
      if (rgba) { rgba[4 * q] = LR; rgba[4 * q + 1] = LG; rgba[4 * q + 2] = LB; rgba[4 * q + 3] = fullLayer ? 1 : covAcc; }
      else { rgb[3 * q] = LR; rgb[3 * q + 1] = LG; rgb[3 * q + 2] = LB; if (cov) cov[q] = covAcc; else { depth[q] = sampleDepth; matBuf[q] = sampleMat; } }
    };
    if (objOnly) { for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) { const tl = tiles[ty * tw + tx]; if (!tl || (o.tileRow && !o.tileRow(ty))) continue; for (let y = ty * TS, ye = Math.min(h, y + TS); y < ye; y++) for (let x = tx * TS, xe = Math.min(w, x + TS); x < xe; x++) pixel(x, y, tl); } }   // only the tiles an object can touch (o.tileRow(ty): only these tile rows, the workers' share)
    else for (let y = 0; y < h; y++) { if (o.tileRow && !o.tileRow((y / TS) | 0)) continue; for (let x = 0; x < w; x++) pixel(x, y, tiles[((y / TS) | 0) * tw + ((x / TS) | 0)]); }
    if (prof) {
      const total = performance.now() - started, factor = sampled ? rays / sampled : 0, ground = Math.min(total, groundTime * factor), wet = Math.min(ground, wetTime * factor);
      Object.assign(prof, { traceMs: total, objectMs: total - ground, groundMs: ground - wet, wetMs: wet, rays, sampledRays: sampled, cacheHits: gc ? gc.hits - cacheHits : 0, cacheMisses: gc ? gc.misses - cacheMisses : 0, attribution: 'sampled estimate; object includes ray/setup/residual; wet is lobe evaluation only' });
    }
    if (objOnly || fullLayer) { let y0 = th, y1 = -1; const trows = []; for (let ty = 0; ty < th; ty++) { let any = fullLayer; if (!o.tileRow || o.tileRow(ty)) { for (let tx = 0; !any && tx < tw; tx++) if (tiles[ty * tw + tx]) { any = true; break; } } else any = false; if (any) { trows.push(ty); if (ty < y0) y0 = ty; if (ty > y1) y1 = ty; } } return { w, h, rgb, cov, rgba, rows: y1 < 0 ? [0, 0] : [y0 * TS, Math.min(h, (y1 + 1) * TS)], trows, TS, hfov: o.hfov }; }
    return { w, h, rgb, depth, mat: matBuf, keys: MAT_KEYS, names: MAT_KEYS.map((k) => MAT_DEF[k].name), hfov: o.hfov };
  }
  const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // the pixel under (x, y): luminance (cd/m²), distance, material
  function probe(res, x, y) {
    x = Math.max(0, Math.min(res.w - 1, Math.floor(x))); y = Math.max(0, Math.min(res.h - 1, Math.floor(y)));
    const q = y * res.w + x, r = res.rgb[3 * q], g = res.rgb[3 * q + 1], b = res.rgb[3 * q + 2];
    return { L: lumaOf(r, g, b), rgb: [r, g, b], depth: res.depth[q], mat: res.names[res.mat[q]] };
  }

  // Reusable other-driver beam, independent of the scene/animation. Analytic sketch, NOT a certified lamp.
  // R112 class B, B50L (0.57U/3.43L) <=350 cd is a constraint, not an entire far field.
  // The right-side shoulder/hotspot and left-horizon spill are deliberately approximate (cd per lamp).
  // Seeded driving behaviour, not survey data: 5% forget, others dip at 150–400 m over 8 m of travel.
  function dipState(seed, id, distance) {
    let h = (seed | 0) ^ 0x6d2b79f5; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const R = RF.Drive.rng(h >>> 0), forgetful = R() < 0.05, at = 150 + 250 * R();
    const u = Math.max(0, Math.min(1, (distance - at) / 8 + 0.5));
    return { forgetful, at, high: forgetful ? 1 : u * u * (3 - 2 * u) };
  }
  // Auto high beam (AH). Camera-sensor style: what the sensor sees in the frame decides, a hold timer brings the high beam back.
  // Tuning values (not survey data): 400 m / 20 deg for oncoming headlamps, 200 m for preceding tail lamps in our lane or the next,
  // 30 km/h, 2 s hold before returning to high. The sensor and the step are pure, so the node test drives them directly.
  const AUTO = { onRange: 160, onCone: 20, preRange: 100, slowKmh: 30, hold: 1 };
  // Camera eye: always the fixed eye. The view angle changes the lens, not the position.
  const EYE = [-2.0, 0.37, 1.2];
  const eyeFor = () => EYE.slice();
  // What the camera sees. objects: the frame's opaque objects and lamps; eye: camera position; opts.occluders defaults to objects; opts.lane = lane width (m).
  // An oncoming car counts when a headlamp faces us within onRange and onCone of our heading, and is not hidden (occluded).
  // A preceding car counts when a tail lamp is within preRange, within the same cone, and within 1.5 lanes of our centreline, and is not hidden.
  function autoHighSense(objects, eye, opts) {
    const o = opts || {}, E = eye || [-2, 0.37, 1.2], occ = o.occluders || objects, lane = o.lane || 3.5;
    const sinCone = Math.sin((o.cone === undefined ? AUTO.onCone : o.cone) * Math.PI / 180), onRange = o.onRange || AUTO.onRange, preRange = o.preRange || AUTO.preRange;
    let oncoming = false, preceding = false;
    for (const ob of objects) {
      if (!(ob.headlamp || ob.taillamp) || (ob.headlamp ? oncoming : preceding)) continue;
      const dx = ob.x - E[0], dy = ob.y - E[1], dz = ob.z - E[2], d = Math.hypot(dx, dy, dz);
      if (!(dx > 0) || !(d > 0) || Math.hypot(dy, dz) > d * sinCone) continue;
      if (ob.headlamp) {
        if (d > onRange || !(-(dx * ob.nx + dy * ob.ny) > 0)) continue;     // a headlamp only shines at us when its face points our way
      } else {
        if (d > preRange || Math.abs(ob.y) > 1.5 * lane) continue;
      }
      if (occluded([ob.x, ob.y, ob.z], E, occ)) continue;
      if (o.blocked && o.blocked([ob.x, ob.y, ob.z])) continue;     // terrain between eye and lamp (pass only; flat scenes pass no hook)
      if (ob.headlamp) oncoming = true; else preceding = true;
    }
    return { oncoming, preceding };
  }
  // One sensor step. state = { high, timer, reason } (mutated and returned). inputs = { oncoming, preceding, urban, speedKmh }.
  // Any trigger dips at once. Back to high only after opts.hold seconds with no trigger (hold 0 = no hysteresis, the positive control).
  function autoHighStep(state, inputs, dt, opts) {
    const hold = opts && opts.hold !== undefined ? opts.hold : AUTO.hold, s = state, n = inputs || {};
    const why = n.oncoming ? 'oncoming' : n.preceding ? 'preceding' : n.urban ? 'urban' : n.speedKmh !== undefined && n.speedKmh < AUTO.slowKmh ? 'slow' : null;
    if (why) { s.high = false; s.timer = 0; s.reason = why; return s; }
    if (s.high) { s.reason = 'clear'; return s; }
    s.timer += Math.max(0, dt || 0);
    if (s.timer >= hold) { s.high = true; s.timer = 0; s.reason = 'clear'; } else s.reason = 'hold';
    return s;
  }
  const Headlamp = {
    generic(h, v, high) {
      if (high) return 30000 * Math.exp(-0.5 * ((h / 9) ** 2 + (v / 4) ** 2)) + 300;
      const cut = -0.35 + Math.min(1.4, Math.max(0, h) * 0.15), below = 1 / (1 + Math.exp(Math.max(-60, Math.min(60, (v - cut) / 0.12))));
      return 120 + 750 * Math.exp(-Math.max(0, v) / 0.3) + below * (1800 + 10000 * Math.exp(-0.5 * (((h - 3) / 7) ** 2 + ((v + 1) / 2.5) ** 2)));
    },
    cd(ob, o) {
      const eye = o.eye || [-2, 0.37, 1.2], dx = eye[0] - ob.x, dy = eye[1] - ob.y, dz = eye[2] - ob.z;
      const forward = dx * ob.nx + dy * ob.ny, left = -dx * ob.ny + dy * ob.nx;
      if (!(forward > 0)) return 0;
      hvFast(forward, left, dz, o.mode === 'symmetric' && o.lut && o.hasDesign !== false ? o.conv || 'A' : 'A'); const h = HV0, v = HV1;
      if (o.mode === 'manual') return Math.max(0, o.kcd === undefined ? 30 : o.kcd) * 500 * Math.pow(forward / Math.hypot(dx, dy, dz), 8);
      if (o.mode === 'high') return Headlamp.generic(h, v, true);
      if (o.mode === 'high-dip') {
        const f = dipState(o.seed === undefined ? 7 : o.seed, ob.traffic === undefined ? 'still' : ob.traffic, Math.hypot(dx, dy, dz)).high;
        return f * Headlamp.generic(h, v, true) + (1 - f) * Headlamp.generic(h, v, false);
      }
      return o.mode !== 'generic' && o.lut && o.lut.data && o.hasDesign !== false ? lutAt(o.lut, h, v) : Headlamp.generic(h, v, false);
    },
    apply(objects, o) {
      // Test table availability once per frame, never scan it per lamp.
      o = Object.assign({}, o); if (o.lut && !o.lut.data) o.lut = null; o.hasDesign = !!(o.lut && o.lut.data.some((x) => x > 0));
      for (const ob of objects) if (ob.headlamp) {
        const cd = Headlamp.cd(ob, o), e = o.eye || [-2, 0.37, 1.2], dx = e[0] - ob.x, dy = e[1] - ob.y, dz = e[2] - ob.z;
        const cos = Math.max(1e-6, (dx * ob.nx + dy * ob.ny) / Math.hypot(dx, dy, dz));
        // Renderer applies one cosine to emitter luminance. Cancel it: cd is already toward the eye.
        const L = cd / (Math.PI * ob.r * ob.r * cos); ob.emit = [L, L, 0.93 * L]; ob.emitPow = 1; ob.eyeCd = cd;
      }
      return objects;
    }
  };
  // P2 budgets: eight nearest cars (two lamps each) within 150 m; bounded per-fragment work.
  const TRAFFIC_CARS = 8, TRAFFIC_RANGE = 150, SURFACE_SOURCES = 8, STUD_SOURCES = 8;
  // TL1 taper: a car's road light fades from full at 65% of the range to zero at the range (smoothstep), and
  // the nearest-N cap fades the same way: each car is weighted by how far it is inside the first excluded car's
  // distance dCut (smoothstep over TAPER_BAND m). Weights depend only on distances, and order statistics are
  // continuous, so swapping the Nth and (N+1)th car changes nothing. Excluded cars have weight exactly 0.
  const TAPER_START = 0.65, TAPER_BAND = 2;
  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // p.lightRange (m) and p.lightCars (nearest cars) come from the drive options; defaults are the original 150 m / 8 cars.
  function trafficLimits(p) { return { range: p && p.lightRange > 0 ? p.lightRange : TRAFFIC_RANGE, cars: p && p.lightCars > 0 ? p.lightCars : TRAFFIC_CARS }; }
  let genericLow;
  function trafficBeam(p) {
    const mode = p.src && p.src.traffic && p.src.traffic.onMode;
    // oncoming cars use OUR LOW table (p.lowLut), never the high-switched one: the high switch is ours alone
    const low = p.lowLut || p.lut;
    if (mode === 'symmetric' && low && low.data.some(x => x > 0)) return { lut: low, conv: p.conv || 'A' };
    if (!genericLow) genericLow = lutFrom((h, v) => Headlamp.generic(h, v, false), { win: [-90, 90, -90, 90], step: 0.25 });
    return { lut: genericLow, conv: 'A' };
  }
  function trafficSources(objects, eye, p) {
    eye = eye || [-2, 0.37, 1.2]; const groups = new Map(), lim = trafficLimits(p);
    for (const ob of objects) if (ob.traffic !== undefined) { if (!groups.has(ob.traffic)) groups.set(ob.traffic, []); groups.get(ob.traffic).push(ob); }
    const cars = [];
    for (const [id, obs] of groups) {
      const heads = obs.filter(ob => ob.headlamp), tails = obs.filter(ob => ob.taillamp), lamps = heads.length ? heads : tails;
      if (!lamps.length) continue;
      const d = Math.hypot(lamps[0].x - eye[0], lamps[0].y - eye[1]); if (d >= lim.range) continue;
      const sources = lamps.slice(0, 2).map(ob => {
        if (heads.length) return { x: ob.x, y: ob.y, z: ob.z, nx: ob.nx, ny: ob.ny, car: id };
        // Preceding models have tails only. Infer front plane from the body's actual oriented boxes.
        const nx = -ob.nx, ny = -ob.ny; let front = ob.x * nx + ob.y * ny;
        for (const b of obs) if (b.k === 'box') { const c = Math.cos(b.yaw || 0), sn = Math.sin(b.yaw || 0); front = Math.max(front, b.x * nx + b.y * ny + b.hx * Math.abs(c * nx + sn * ny) + b.hy * Math.abs(-sn * nx + c * ny)); }
        const shift = front - ob.x * nx - ob.y * ny + 0.01;
        return { x: ob.x + nx * shift, y: ob.y + ny * shift, z: 0.68, nx, ny, car: id };
      });
      cars.push({ d, sources });
    }
    cars.sort((a, b) => a.d - b.d);
    const R = lim.range, dCut = cars.length > lim.cars ? cars[lim.cars].d : R;
    return cars.slice(0, lim.cars).flatMap(c => {
      const w = (1 - smooth01(TAPER_START * R, R, c.d)) * smooth01(0, TAPER_BAND, dCut - c.d);
      return w > 0 ? c.sources.map(q => Object.assign(q, { w })) : [];
    });
  }
  // Generic static lamps at the existing mounting points: 400 cd on the selected side, 55° outboard.
  // Angular Gaussian, 22° horizontal / 7° vertical sigma, aimed 6° down; no LUT allocation.
  function cornerAt(dx,dy,dz,left,right) {
    if ((!left && !right) || dx <= 0 || dz >= 0) return 0;
    const h = Math.atan2(dy,dx), v = Math.atan2(dz,Math.hypot(dx,dy)), rad = Math.PI/180;
    const vertical = Math.exp(-.5 * Math.pow((v+6*rad)/(7*rad),2));
    return 200 * vertical * ((left || 0)*Math.exp(-.5*Math.pow((h-55*rad)/(22*rad),2)) + (right || 0)*Math.exp(-.5*Math.pow((h+55*rad)/(22*rad),2)));
  }
  function ownBeamAt(p,dx,dy,dz,side) {
    const left = side === undefined ? p.cornerLeft : side >= 0 ? 2 * (p.cornerLeft || 0) : 0;
    const right = side === undefined ? p.cornerRight : side < 0 ? 2 * (p.cornerRight || 0) : 0;
    return beamAt(p.lut,p.conv || 'A',dx,dy,dz,p.pitch || 0,p.yaw || 0) + cornerAt(dx,dy,dz,left,right);
  }
  function beamAt(lut, conv, dx, dy, dz, pitch, yaw) {
    if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw), x = dx; dx = c * x + s * dy; dy = c * dy - s * x; }
    if (pitch) { const c = Math.cos(pitch), s = Math.sin(pitch), x = dx; dx = c * x + s * dz; dz = c * dz - s * x; }
    hvFast(dx, dy, dz, conv); return lutAt(lut, HV0, HV1);
  }
  function trafficAt(L, beam, px, py, pz) {
    const dx = px - L.x, dy = py - L.y, dz = pz - L.z, forward = dx * L.nx + dy * L.ny;
    return forward > 0 ? (L.w === undefined ? 1 : L.w) * beamAt(beam.lut, beam.conv, forward, -dx * L.ny + dy * L.nx, dz, 0) : 0;
  }
  // Integrate actual returned RGB luminance over face area (8x8 midpoint quadrature, an estimate).
  // cd = integral L(cd/m²) * cos(view) * dA(m²). Uses the same diffuse/retro/emit law as shade.
  // Reusing the eye-direction return in the wet lobe is approximate: no angular retro BRDF or occlusion.
  function surfaceSources(objects, p) {
    const sg = sigmaOf(p.look || {}), fg = (dx, dy, dz) => (sg ? Math.exp(-sg * Math.sqrt(dx * dx + dy * dy + dz * dz)) : 1);   // fog on the lamp-to-object path, as in render
    const eye = p.eye || [-2, 0.37, 1.2], M = materials(p.look || {}), sources = [], traffic = p.trafficBeams ? trafficSources(objects, eye, p) : [], beam = traffic.length ? trafficBeam(p) : null;
    for (const ob of objects) {
      // SB2: lane studs are tilted discs (8.5 degrees up, nz 0.148) and are admitted by their kind (cls 'rpm'), not by loosening the flatness test, so no other tilted disc gets in
      const stud = ob.cls === 'rpm';
      if (ob.headlamp || ob.taillamp || !['box', 'disc'].includes(ob.k) || (ob.k === 'disc' && Math.abs(ob.nz || 0) > 1e-6 && !stud)) continue;
      const z = ob.k === 'box' ? (ob.z0 + ob.z1) / 2 : ob.z, range = Math.hypot(ob.x - eye[0], ob.y - eye[1], z - eye[2]);
      const lr = trafficLimits(p).range; if (range >= lr || range < 0.1) continue; const fade = 1 - smooth01(TAPER_START * lr, lr, range);   // TL1: object range taper, same as the lamps
      const yaw = ob.yaw || 0, nx = ob.k === 'box' ? -Math.cos(yaw) : ob.nx, ny = ob.k === 'box' ? -Math.sin(yaw) : ob.ny, nz = ob.k === 'box' ? 0 : ob.nz;
      const view = Math.max(0, ((eye[0] - ob.x) * nx + (eye[1] - ob.y) * ny + (eye[2] - z) * nz) / range); if (!view) continue;
      const keyAt = (u, zz) => typeof ob.mat === 'function' ? ob.mat({ u, z: zz, face: 0 }) : ob.mat;
      if (![keyAt(0, z), keyAt(0, z + (ob.z1 - ob.z0 || 0) * 0.3)].some(k => M[k] && (M[k].retro || M[k].emit)) && !ob.emit) continue;
      const rgb = [0, 0, 0], box = ob.k === 'box', area = box ? 2 * ob.hy * (ob.z1 - ob.z0) : PI * ob.r * ob.r;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const u = ((i + 0.5) / 8 * 2 - 1) * (box ? ob.hy : ob.r), v = ((j + 0.5) / 8 * 2 - 1) * (box ? (ob.z1 - ob.z0) / 2 : ob.r);
        if (!box && u * u + v * v > ob.r * ob.r) continue;
        const px = ob.x + (box ? nx * ob.hx : 0) - ny * u, py = ob.y + (box ? ny * ob.hx : 0) + nx * u, pz = z + v, m = M[keyAt(u, pz)] || M.wall;
        const lum = (ob.emit || m.emit || [0, 0, 0]).map(c => c * Math.pow(view, ob.emitPow || 1));
        const diffuse = Math.max(0, p.look && p.look.ambient || 0) * (0.5 + 0.5 * nz) / PI;
        for (const L of p.pointLights || []) { const dx = L.x - px, dy = L.y - py, dz = L.z - pz, r2 = dx * dx + dy * dy + dz * dz; if (dz > 0 && r2 > 0.01) { const e = L.cd * Math.max(0, dx * nx + dy * ny + dz * nz) / (PI * r2 * Math.sqrt(r2)) * fg(dx, dy, dz); for (let c = 0; c < 3; c++) lum[c] += m.rho[c] * e * L.rgb[c]; } }
        for (const L of traffic) { const dx = px - L.x, dy = py - L.y, dz = pz - L.z, r2 = dx * dx + dy * dy + dz * dz; if (r2 > 0.01) { const e = fade * trafficAt(L, beam, px, py, pz) * Math.max(0, -(dx * nx + dy * ny + dz * nz)) / (PI * r2 * Math.sqrt(r2)) * fg(dx, dy, dz); for (let c = 0; c < 3; c++) lum[c] += m.rho[c] * e * (c === 2 ? 0.93 : 1); } }
        for (let c = 0; c < 3; c++) lum[c] += m.rho[c] * diffuse;
        for (const L of p.lamps) {
          const dx = px - L[0], dy = py - L[1], dz = pz - L[2], r2 = dx * dx + dy * dy + dz * dz, noL = Math.max(0, -(dx * nx + dy * ny + dz * nz) / Math.sqrt(r2));
          if (!noL || r2 < 0.01) continue; const E = ownBeamAt(p, dx, dy, dz, L[1]) / r2 * fg(dx, dy, dz);
          for (let c = 0; c < 3; c++) lum[c] += E * (m.rho[c] * noL / PI + (m.retro ? m.retro[c] : 0));
        }
        const dA = (box ? area : 4 * ob.r * ob.r) / 64;
        for (let c = 0; c < 3; c++) rgb[c] += lum[c] * view * dA;
      }
      const cd = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; if (!(cd > 0)) continue;
      sources.push({ x: ob.x, y: ob.y, z, cd, rgb: rgb.map(v => v / cd), area, returnedLuminance: cd / (area * view), rank: cd / (range * range), stud });
    }
    // The cap: the nearest SURFACE_SOURCES non-stud sources as before, plus the nearest STUD_SOURCES studs (studs are dense along the centre line, so they get their own budget and
    // cannot push the signs and reflectors out of the top 8). Both lists are by rank (cd / range^2). reflectionSources keeps the total under the 64-entry GPU array.
    const byRank = (a, b) => b.rank - a.rank;
    return sources.filter(q => !q.stud).sort(byRank).slice(0, SURFACE_SOURCES).concat(sources.filter(q => q.stud).sort(byRank).slice(0, STUD_SOURCES));
  }
  const GLARE = { off: 0, 'dry-low': 0.035, dry: 0.1, rain: 0.3 };
  function glareLevel(v) { if (v in GLARE) return v; return v == null || v === false || v === 0 || v === 'off' ? 'off' : 'rain'; }
  const glareStrength = (v) => typeof v === 'number' ? Math.max(0, v) : v === true ? 1 : GLARE[glareLevel(v)];
  // The OS Reduce Motion setting caps the level that is RENDERED at dry-low. The saved setting is untouched.
  const reducedMotion = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  const capGlare = (v) => reducedMotion() && (glareLevel(v) === 'dry' || glareLevel(v) === 'rain') ? 'dry-low' : v;
  const brightCap = (v) => { const x = Math.max(0, v - 1); return 64 * x / (64 + x); };
  // CIE 146:2002, CIE equations for disability glare; Stiles–Holladay 10 E / theta².
  // 1 degree floor: the formula is not a model of the lamp core. No age/ocular-pigmentation correction or occlusion tracing.
  // Is the segment from P (a glare source's centre) to the eye blocked by an opaque object? Only hits at least minT metres from P count:
  // a lamp sits on its own car's face, so that body is hit within a few cm and is ignored. Emitters (headlamp/taillamp) and flat discs
  // (sign faces, eyes, reflectors) do not block. Hard test: a lamp is either fully visible or fully hidden (no partial coverage).
  function occluded(P, eye, occluders, minT) {
    const lo = minT === undefined ? 0.3 : minT, ex0 = eye[0] - P[0], ey0 = eye[1] - P[1], ez0 = eye[2] - P[2], L = Math.hypot(ex0, ey0, ez0);
    if (!(L > lo)) return false;
    const dx = ex0 / L, dy = ey0 / L, dz = ez0 / L;
    for (const ob of occluders) {
      if (ob.headlamp || ob.taillamp || ob.k === 'disc') continue;
      if (!ob.bs) boundOf(ob);
      const [cx, cy, cz, R] = ob.bs, ux = cx - P[0], uy = cy - P[1], uz = cz - P[2];
      const s = Math.min(L, Math.max(0, ux * dx + uy * dy + uz * dz)), px = ux - s * dx, py = uy - s * dy, pz = uz - s * dz;
      if (px * px + py * py + pz * pz > R * R) continue;      // bounding sphere misses the segment
      const t = hitObj(ob, P[0], P[1], P[2], dx, dy, dz, L, 0);
      if (t >= lo && t < L) return true;
    }
    return false;
  }
  // occluders: the opaque objects of the same frame (default: objects themselves). A lamp hidden from the eye contributes nothing.
  function glareSources(objects, eye, occluders) {
    eye = eye || [-2, 0.37, 1.2]; const out = [], occ = occluders || objects;
    for (const ob of objects) if (ob.headlamp) {
      const dx = ob.x - eye[0], dy = ob.y - eye[1], dz = ob.z - eye[2], rr = Math.hypot(dx, dy, dz);
      if (dx <= 0 || !(rr > 0)) continue;
      if (occluded([ob.x, ob.y, ob.z], eye, occ)) continue;
      const cos = Math.max(0, -(dx * ob.nx + dy * ob.ny) / rr), cd = ob.eyeCd === undefined ? ob.emit[0] * Math.PI * ob.r * ob.r * Math.pow(cos, ob.emitPow || 1) : ob.eyeCd;
      out.push([dx / rr, dy / rr, dz / rr, cd * dx / rr / (rr * rr)]);
    }
    return out.slice(0, 32);
  }
  function veilAt(dir, sources) {
    let L = 0; for (const q of sources || []) { const theta = Math.max(1, Math.acos(Math.max(-1, Math.min(1, dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]))) / D2R); L += 10 * q[3] / (theta * theta); } return L;
  }
  // Visible beam in fog: single in-scatter off the own lamps (SC1). Opt-in: look.scatter = steps (0 or absent = off), and only with a finite look.visibility.
  // Along the eye ray (unit dir, from the eye) out to sEnd (capped at S_MAX): sum over steps of sigma · p(θ) · E(P) · T_light · T_view · ds, with
  // E(P) = I(lamp→P) / r² from the same ownBeamAt as the surface lighting (yaw, pitch, cornering, high beam), T_light = exp(−sigma r), T_view = exp(−sigma s), per lamp in its lampRGB.
  // p(θ) = wFwd · HG(gFwd, cos) + (1 − wFwd) · HG(gBack, cos), cos = dot(u, v): u = unit lamp→P (the light's travel), v = unit P→eye (= −dir). Forward scatter = 1.
  // The own beam seen from the driver has θ ≈ 180° (cos ≈ −1), so the BACK lobe carries it: that is backscatter, the glare of one's own beam in fog.
  // Steps: stratified log spacing from s0 = min(1 m, S/4) to S: cell k = [a_k, b_k] with a_k = s0·q^k, q = (S/s0)^(1/N); the sample sits at a_k·(b_k/a_k)^jitter,
  // weight = b_k − a_k. Measured (scratch, SC1): log beats s² spacing on the beam's peaked integrand, and the jitter-mean is unbiased to ~6 % at 8 steps,
  // but ONE jitter value scatters ±35 to 95 % per pixel at 8 steps (16 steps: ±15 to 30 %). So 8 steps is a noisy, cheap setting, not a converged one.
  const SCAT = { S_MAX: 120, gFwd: 0.7, gBack: -0.4, wFwd: 0.7, rMin: 0.3 };   // tunables, one table (rMin: m, the lamp's own size; the point model is not valid inside it)
  const hgPhase = (g, c) => (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * c, 1.5));
  function scatterPhase(c) { return SCAT.wFwd * hgPhase(SCAT.gFwd, c) + (1 - SCAT.wFwd) * hgPhase(SCAT.gBack, c); }
  // per-pixel jitter in [0, 1): a hash of the integer pixel coordinates only (no time term), so frames are repeatable and banding is broken up
  function scatterJitter(x, y) { let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  // Returns [r, g, b] in cd/m² (the caller weights by the sample's k). LUT zero outside its window, so lamp-behind rays get nothing.
  function inScatter(o, dir, sEnd, jit, steps) {
    const out = [0, 0, 0], sig = sigmaOf(o.look || {}), N = steps | 0, s1 = Math.min(sEnd, SCAT.S_MAX);
    if (!(sig > 0) || !(N > 0) || !(s1 > 0)) return out;
    const eye = o.eye, lamps = o.lamps || [], lc = o.lampRGB || [1, 1, 1], dx = dir[0], dy = dir[1], dz = dir[2];
    const s0 = Math.min(1, s1 / 4), q = Math.pow(s1 / s0, 1 / N);
    for (let k = 0; k < N; k++) {
      const a = s0 * Math.pow(q, k), b = a * q, s = a * Math.pow(q, jit), ds = b - a, Tv = Math.exp(-sig * s);
      const px = eye[0] + s * dx, py = eye[1] + s * dy, pz = eye[2] + s * dz;
      for (let i = 0; i < lamps.length; i++) {
        const L = lamps[i], qx = px - L[0], qy = py - L[1], qz = pz - L[2], r2 = qx * qx + qy * qy + qz * qz;
        if (!(r2 > 0)) continue;
        const r = Math.sqrt(r2), I = ownBeamAt(o, qx, qy, qz, L[1]);
        if (!(I > 0)) continue;
        const cos = -(qx * dx + qy * dy + qz * dz) / r, E = I / Math.max(r2, SCAT.rMin * SCAT.rMin);   // point-lamp 1/r² is capped inside rMin (a ray through the lamp itself would diverge)
        const v = sig * scatterPhase(cos) * E * Math.exp(-sig * r) * Tv * ds;
        if (!Number.isFinite(v)) continue;
        out[0] += v * lc[0]; out[1] += v * lc[1]; out[2] += v * lc[2];
      }
    }
    return out;
  }
  // SD1 table (look.scatterMode 'table'): the CPU twin of the GPU table pass, for tests only. The ground, sky and object shaders read it
  // in place of inScatter. Scalar per bin (lampRGB multiplies after the lookup). Bins are K segments of the eye ray, edges log-spaced
  // from 0.5 m to S_MAX; segment 0 is [0, 0.5 m] (linear), the rest log-spaced. Unlike inScatter (which starts at s0 = min(1, S/4)), the
  // table integrates from 0, so near-eye scatter is included. The per-bin sample count is round(steps / K), at least 1.
  const TABLE = { K: 12, near: 0.5 };
  const tableEdge = (k) => TABLE.near * Math.pow(SCAT.S_MAX / TABLE.near, k / (TABLE.K - 1));   // k = 0..K-1; edge K-1 = S_MAX
  function scatterTableBins(o, dir, jit, steps) {
    const sig = sigmaOf(o.look || {}), n = Math.max(1, Math.round((steps | 0) / TABLE.K)), bins = new Float64Array(TABLE.K);
    if (!(sig > 0)) return bins;
    const eye = o.eye, lamps = o.lamps || [], dx = dir[0], dy = dir[1], dz = dir[2];
    const integrand = (s) => {
      const px = eye[0] + s * dx, py = eye[1] + s * dy, pz = eye[2] + s * dz; let f = 0;
      for (let i = 0; i < lamps.length; i++) {
        const L = lamps[i], qx = px - L[0], qy = py - L[1], qz = pz - L[2], r2 = qx * qx + qy * qy + qz * qz;
        if (!(r2 > 0)) continue;
        const r = Math.sqrt(r2), I = ownBeamAt(o, qx, qy, qz, L[1]);
        if (!(I > 0)) continue;
        const cos = -(qx * dx + qy * dy + qz * dz) / r, E = I / Math.max(r2, SCAT.rMin * SCAT.rMin);
        f += sig * scatterPhase(cos) * E * Math.exp(-sig * r) * Math.exp(-sig * s);
      }
      return Number.isFinite(f) ? f : 0;
    };
    for (let k = 0; k < TABLE.K; k++) {
      const hi = tableEdge(k), lo = k === 0 ? 0 : tableEdge(k - 1);
      let acc = 0;
      for (let m = 0; m < n; m++) {
        if (k === 0) { const ds = hi / n, s = (m + jit) * ds; acc += integrand(s) * ds; }
        else { const a = lo * Math.pow(hi / lo, m / n), b = lo * Math.pow(hi / lo, (m + 1) / n), s = a * Math.pow(b / a, jit); acc += integrand(s) * (b - a); }
      }
      bins[k] = acc;
    }
    return bins;
  }
  // Cumulative value at distance d: linear from 0 to C_0 at the first edge, then linear in log d between edges; clamped beyond S_MAX.
  function scatterTableAt(bins, d) {
    if (!(d > 0)) return 0;
    let C = 0, prevE = 0, prevC = 0;
    for (let k = 0; k < TABLE.K; k++) {
      C += bins[k]; const e = tableEdge(k);
      if (d <= e) return k === 0 ? C * d / e : prevC + (C - prevC) * Math.log(d / prevE) / Math.log(e / prevE);
      prevE = e; prevC = C;
    }
    return C;
  }
  const veilStrength = (v) => glareStrength(v) > 0 ?(glareLevel(v) === 'dry-low' ? 0.5 : 1) : 0;
  function reflectionSources(objects, p) {
    const lamps = objects.filter((o) => o.headlamp || o.taillamp).map((o) => ({ x: o.x, y: o.y, z: o.z, cd: o.eyeCd === undefined ? o.emit[0] * Math.PI * o.r * o.r : o.eyeCd, rgb: o.taillamp ? [1, 0.03, 0.015] : [1, 1, 0.93] }));
    return p && p.surfaceSheen ? lamps.concat(surfaceSources(objects, p).slice(0, Math.max(0, 64 - lamps.length - (p.pointLights || []).length))) : lamps;
  }
  // Broadening the mirror image mostly along the viewing direction makes a road streak.
  // Cheap anisotropic mirror-lobe approximation, not a measured wet-pavement BRDF or ray-traced reflection.
  function wetLobe(dx, dy, dz, vx, vy, vz) {
    const rr = Math.hypot(dx, dy, dz), lx = dx / rr, ly = dy / rr, lz = dz / rr;
    let hx = lx + vx, hy = ly + vy, hz = lz + vz; const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    const vl = Math.hypot(vx, vy) || 1, along = (hx * vx + hy * vy) / vl, across = (-hx * vy + hy * vx) / vl;
    const F = 0.02 + 0.98 * (1 - Math.max(0, vz)) ** 5;
    return F * Math.exp(-0.5 * ((along / 0.23) ** 2 + (across / 0.025) ** 2)) * Math.max(0, hz) * 4 / (rr * rr);
  }
  // Wet-road sheen, physically based option (look.wetModel === 'ggx'). A real BRDF: anisotropic GGX (Trowbridge-Reitz)
  // distribution, Smith-GGX shadowing (anisotropic Lambda), Schlick Fresnel with F0 = 0.02 (water), on the road plane n = +z.
  // Returns f_r(l, v) * cos(theta_i) / r^2 per candela: the caller multiplies by the lamp's cd toward the road point,
  // so the result is radiance per cd exactly like wetLobe. d = point -> lamp (unnormalised), v = point -> eye.
  // Roughness is the named tunables below: alongAlpha across the view direction's streak (along the road), acrossAlpha across it.
  const WET_GGX = { alongAlpha: 0.25, acrossAlpha: 0.05, F0: 0.02 };
  function wetGGX(dx, dy, dz, vx, vy, vz) {
    const rr = Math.hypot(dx, dy, dz), lz = dz / rr, vr = Math.hypot(vx, vy, vz) || 1, ux = vx / vr, uy = vy / vr, uz = vz / vr;
    if (!(lz > 0) || !(uz > 0)) return 0;
    const lx = dx / rr, ly = dy / rr;
    // tangent frame: T along the horizontal part of the view direction (as wetLobe's 'along'), B = n x T, N = +z
    const hl0 = Math.hypot(ux, uy) || 1e-12, tx = ux / hl0, ty = uy / hl0, bx = -ty, by = tx;
    let hx = lx + ux, hy = ly + uy, hz = lz + uz; const hn = Math.hypot(hx, hy, hz) || 1; hx /= hn; hy /= hn; hz /= hn;
    const a = WET_GGX.alongAlpha, b = WET_GGX.acrossAlpha, ht = hx * tx + hy * ty, hb = hx * bx + hy * by;
    const e = (ht / a) ** 2 + (hb / b) ** 2 + hz * hz, D = 1 / (Math.PI * a * b * e * e);
    const lam = (wt, wb, wz) => (Math.sqrt(1 + (a * a * wt * wt + b * b * wb * wb) / (wz * wz)) - 1) / 2;
    const G = 1 / (1 + lam(hl0, 0, uz) + lam(lx * tx + ly * ty, lx * bx + ly * by, lz));   // Smith height-correlated approx. of G2 (Heitz form: 1/(1+Lv+Ll))
    const VoH = ux * hx + uy * hy + uz * hz, F = WET_GGX.F0 + (1 - WET_GGX.F0) * (1 - Math.max(0, VoH)) ** 5;
    // f = D F G / (4 NoL NoV); times NoL (irradiance cos term) / r^2 (inverse square) gives D F G / (4 NoV r^2)
    return D * F * G / (4 * uz * rr * rr);
  }
  // ---------------------------------------------------------------- exposure and tone mapping
  /* Scene-referred luminance → a display. Exposure modes:
   *   fixed — an absolute EV: EV 0 puts 10 cd/m² at display white, each stop doubles it. The same EV on two designs makes their
   *           brightness comparable (this is the mode for comparing).
   *   auto  — the geometric mean of the lit pixels goes to 18 % grey (+ the EV offset): every picture looks "exposed", so
   *           brightness differences between designs are hidden (this is the mode for looking).
   *   adapt — fixed reference white plus the central disability veil, recomputed as lamps approach.
   * Then an ACES-style filmic curve (Narkowicz fit) and the sRGB transfer. glare: capped bright pixels spread through a
   * Gaussian mixture (appearance); the separate Stiles–Holladay veil reduces contrast before mapping.                                           */
  const L_REF = 10;
  function exposureOf(res, opt) {
    const ev = opt.ev || 0;
    if (opt.mode === 'fixed' || opt.mode === 'adapt') return { k: Math.pow(2, ev) / L_REF, white: L_REF / Math.pow(2, ev) };
    let sum = 0, n = 0; const d = res.rgb;
    for (let q = 0; q < res.w * res.h; q++) { const y = lumaOf(d[3 * q], d[3 * q + 1], d[3 * q + 2]); if (y > 1e-4) { sum += Math.log(y); n++; } }
    const key = n ? Math.exp(sum / n) : 1, k = 0.18 * Math.pow(2, ev) / key;
    return { k, white: 1 / k, key };
  }
  // Eye adaptation, adapt mode only: the gain eases toward its target in stops (log2 of k). Glare arriving (k falls) takes
  // ADAPT_DOWN_S; glare leaving (k rises) takes ADAPT_UP_S. alpha = 1 - exp(-dt/tau), so the result does not depend on frame rate.
  // state = { k } from the last drawn frame, or null. dt = sim seconds since then. No state, dt < 0, or a seek (dt > ADAPT_SEEK_S)
  // snaps to target; dt = 0 (paused, or the same frame again) holds the state.
  const ADAPT_DOWN_S = 0.4, ADAPT_UP_S = 3, ADAPT_SEEK_S = 0.5;
  function adaptStep(state, target, dt) {
    if (!state || !(state.k > 0) || !(target > 0) || !(dt >= 0) || dt > ADAPT_SEEK_S) return { k: target };
    if (dt === 0) return { k: state.k };
    const tau = target < state.k ? ADAPT_DOWN_S : ADAPT_UP_S, a = 1 - Math.exp(-dt / tau), l0 = Math.log2(state.k);
    return { k: Math.pow(2, l0 + (Math.log2(target) - l0) * a) };
  }
  const aces =(x) => { x = x < 0 ? 0 : x; const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return y > 1 ? 1 : y; };
  const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  // Four equal-energy Gaussian bands at logarithmically spaced angular scales: their
  // normalized 2D peaks scale as 1/sigma², approximating the CIE 146 theta^-2 tail.
  // This is a visual approximation, not a fitted/calibrated CIE PSF; rain is an artistic level.
  const GLARE_BANDS = [1, 2, 4, 8], GLARE_WEIGHT = 0.0075;
  const glareSigma = (w, fov) => Math.max(0.35, 1.5 * w / 640 * Math.tan(Math.PI / 6) / Math.tan((fov || 60) * D2R / 2));
  function resample(src, w, h, W, H) {
    const out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xx = (x + 0.5) * w / W - 0.5, yy = (y + 0.5) * h / H - 0.5, ix = Math.floor(xx), iy = Math.floor(yy), fx = xx - ix, fy = yy - iy;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) for (let c = 0; c < 3; c++) out[3 * (y * W + x) + c] += src[3 * (Math.max(0, Math.min(h - 1, iy + j)) * w + Math.max(0, Math.min(w - 1, ix + i))) + c] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
    } return out;
  }
  function reduce(src, w, h, W, H) {
    const out = new Float32Array(W * H * 3), nx = Math.ceil(w / W), ny = Math.ceil(h / H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let c = 0; c < 3; c++) out[3 * (y * W + x) + c] += src[3 * (Math.min(h - 1, y * ny + j) * w + Math.min(w - 1, x * nx + i)) + c] / (nx * ny);
    return out;
  }
  function gaussian(src, w, h, sigma) {
    const rad = Math.ceil(3 * sigma), tmp = new Float32Array(src.length), out = new Float32Array(src.length), weights = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-0.5 * ((i - rad) / sigma) ** 2)), norm = weights.reduce((a, b) => a + b, 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let i = -rad; i <= rad; i++) for (let c = 0; c < 3; c++) tmp[3 * (y * w + x) + c] += src[3 * (y * w + Math.max(0, Math.min(w - 1, x + i))) + c] * weights[i + rad] / norm;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let i = -rad; i <= rad; i++) for (let c = 0; c < 3; c++) out[3 * (y * w + x) + c] += tmp[3 * (Math.max(0, Math.min(h - 1, y + i)) * w + x) + c] * weights[i + rad] / norm;
    return out;
  }
  function tonemap(res, opt) {
    opt = opt || {}; const ex = exposureOf(res, opt), w = res.w, h = res.h, n = w * h, lin = new Float32Array(3 * n);
    const vs = veilStrength(opt.glare), sources = opt.sources || [], tanH = Math.tan((res.hfov || 60) * D2R / 2), tanV = tanH * h / w;
    if (opt.mode === 'adapt') { const white = L_REF / Math.pow(2, opt.ev || 0) + vs * veilAt([1, 0, 0], sources); ex.k = 1 / white; ex.white = white; }
    for (let q = 0; q < n; q++) {
      let veil = 0;
      if (vs && sources.length) { const dy = -(2 * (q % w + 0.5) / w - 1) * tanH, dz = (1 - 2 * (Math.floor(q / w) + 0.5) / h) * tanV, rr = Math.hypot(1, dy, dz); veil = vs * veilAt([1 / rr, dy / rr, dz / rr], sources); }
      for (let c = 0; c < 3; c++) lin[3 * q + c] = (res.rgb[3 * q + c] + veil) * ex.k;
    }
    const gl = glareStrength(opt.glare);
    if (gl > 0) {
      let src = new Float32Array(3 * n), W = w, H = h;
      for (let q = 0; q < 3 * n; q++) src[q] = brightCap(res.rgb[q] * ex.k);
      for (const factor of GLARE_BANDS) {
        const bw = Math.max(1, Math.ceil(w / (2 * factor))), bh = Math.max(1, Math.ceil(h / (2 * factor)));
        src = reduce(src, W, H, bw, bh); W = bw; H = bh;
        const b = resample(gaussian(src, W, H, glareSigma(w, res.hfov)), W, H, w, h); for (let q = 0; q < 3 * n; q++) lin[q] += gl * GLARE_WEIGHT * b[q];
      }
    }
    const px = new Uint8ClampedArray(4 * n);
    for (let q = 0; q < n; q++) { px[4 * q] = Math.round(255 * srgb(aces(lin[3 * q]))); px[4 * q + 1] = Math.round(255 * srgb(aces(lin[3 * q + 1]))); px[4 * q + 2] = Math.round(255 * srgb(aces(lin[3 * q + 2]))); px[4 * q + 3] = 255; }
    return { px, k: ex.k, white: ex.white, key: ex.key };
  }

  RF.Drive = { wetnessOf, sigmaOf, wetnessLevels, cornerAt,ownBeamAt, occluded, dipState, AUTO, eyeFor, autoHighSense, autoHighStep,TRAFFIC_CARS, TRAFFIC_RANGE, SURFACE_SOURCES, trafficBeam, trafficSources, trafficAt, beamAt, surfaceSources, Headlamp, GLARE, GLARE_BANDS, GLARE_WEIGHT, glareSigma, glareLevel, capGlare, glareStrength, brightCap, glareSources, veilAt, inScatter, scatterPhase, scatterJitter, SCAT, scatterTableBins, scatterTableAt, TABLE, veilStrength, reflectionSources, wetLobe, wetGGX, WET_GGX, MAT_DEF, MAT_KEYS, materials, lutFrom, lutAt, withHigh, hvFast, hv: () => [HV0, HV1], covLat, covLon, laneMarkings, boundOf, hitObj, hit: () => ({ n: [NX, NY, NZ], u: HU, face: HF, scale: HSCALE }), render, probe, lumaOf, exposureOf, adaptStep, ADAPT_DOWN_S, ADAPT_UP_S, ADAPT_SEEK_S, tonemap, L_REF };
})(typeof globalThis !== 'undefined' ? globalThis : this);
