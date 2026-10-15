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
  const MAT_DEF = {
    'asphalt': { name: 'asphalt', rho: [0.10, 0.10, 0.10], gloss: { a: 0.5, F0: 0.04 } },
    'gravel': { name: 'gravel shoulder', rho: [0.22, 0.21, 0.19] },
    'grass': { name: 'grass', rho: [0.05, 0.09, 0.03] },
    'leaves': { name: 'forest floor', rho: [0.06, 0.05, 0.035] },
    'concrete': { name: 'pavement', rho: [0.30, 0.30, 0.29], gloss: { a: 0.6, F0: 0.04 } },
    'white-paint': { name: 'white marking', rho: [0.45, 0.45, 0.45], retro: { rl: 1 } },
    'yellow-paint': { name: 'yellow marking', rho: [0.50, 0.38, 0.08], retro: { rl: 0.6, rgb: [1, 0.75, 0.1] } },
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
  // the table for one render: wet asphalt is darker and mirror-like; retro scales take the user's R_L
  function materials(look) {
    const out = {};
    for (const k of MAT_KEYS) {
      const m = MAT_DEF[k], r = { rho: m.rho, gloss: m.gloss || null, emit: m.emit || null, retro: null, id: MAT_ID[k] };
      if (m.retro) { const rl = m.retro.rl !== undefined ? m.retro.rl * look.RL : 0, c = m.retro.rgb || [1, 1, 1]; r.retro = Array.isArray(m.retro) ? m.retro : [rl * c[0], rl * c[1], rl * c[2]]; }
      out[k] = r;
    }
    if (look.wet) { out.asphalt = Object.assign({}, out.asphalt, { rho: [0.05, 0.05, 0.05], gloss: { a: 0.09, F0: 0.02 } }); out.concrete = Object.assign({}, out.concrete, { rho: [0.2, 0.2, 0.19], gloss: { a: 0.15, F0: 0.02 } }); }
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
    if (ob.k === 'cyl') { const hz = (ob.z1 - ob.z0) / 2; ob.bs = [ob.x, ob.y, (ob.z0 + ob.z1) / 2, Math.hypot(ob.r, hz)]; }
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
    const den = dx * ob.nx + dy * ob.ny + dz * ob.nz; if (Math.abs(den) < 1e-9) return Infinity;
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
   * tight: tile each object by the projected corners of its box, not its bounding sphere (fewer pixels traced; the picture is the same wherever an object is).  */
  function render(o) {
    const w = o.w, h = o.h, tanH = Math.tan(o.hfov * D2R / 2), tanV = tanH * h / w, eye = o.eye, ex = eye[0], ey = eye[1], ez = eye[2];
    const lamps = o.lamps, nl = lamps.length, lut = o.lut, conv = o.conv || 'A', lc = o.lampRGB || [1, 1, 1], A = o.arc || null, Lw = o.lane;
    const look = Object.assign({ wet: false, RL: 0.2, ambient: 0 }, o.look), M = Object.assign(materials(look), o.mats || {}), scene = o.scene || { objects: [], markings: [], verge: ['gravel', 1.5, 'grass'] };
    const objs = scene.objects || [], cross = scene.cross || null, marks = scene.markings || [], vg = scene.verge || ['gravel', 1.5, 'grass'], ssN = o.ss || 2;
    const objOnly = o.layer === 'objects', rgba = objOnly && o.rgba ? o.rgba : null, cov = objOnly && !rgba ? new Float32Array(w * h) : null;
    const rgb = rgba ? null : new Float32Array(w * h * 3), depth = objOnly ? null : new Float32Array(w * h).fill(Infinity), matBuf = objOnly ? null : new Uint8Array(w * h);
    const amb = look.ambient > 0 ? look.ambient : 0, skyL = amb * 0.012;       // ambient lx on diffuse surfaces; a faint sky, ~0.01 cd/m² per lx
    const delta0 = 2 * tanH / w;                                              // radians per pixel
    // tiles of 16 px: which objects can touch them (by the bounding sphere's projection)
    const TS = 16, tw = Math.ceil(w / TS), th = Math.ceil(h / TS), tiles = new Array(tw * th).fill(null);
    // front to back: near[i] = a lower bound of any hit distance on object i (its bounding sphere; 0 for the sub-pixel discs, whose tent spread can reach past the sphere). A tile lists its objects by near,
    // and a ray stops testing at the first one whose near is not below the best hit so far: the same nearest hit, fewer tests (o.sort === false: the original order, every object tested)
    const near = new Float32Array(objs.length), ord = new Int32Array(objs.length); objs.forEach((ob, idx) => { ord[idx] = idx; if (!ob.bs) boundOf(ob); });
    if (o.sort !== false) {
      objs.forEach((ob, idx) => {
        if (ob.k === 'disc' && ob.sub) return;
        let d;
        if (ob.k === 'box') { const rx = ex - ob.x, ry = ey - ob.y, lx = ob.cy * rx + ob.sy * ry, ly = -ob.sy * rx + ob.cy * ry; d = Math.hypot(Math.max(Math.abs(lx) - ob.hx, 0), Math.max(Math.abs(ly) - ob.hy, 0), Math.max(ob.z0 - ez, ez - ob.z1, 0)); }   // the distance from the eye to the box itself, not its bounding sphere (a long building has a huge sphere)
        else if (ob.k === 'cyl') d = Math.hypot(Math.max(Math.hypot(ex - ob.x, ey - ob.y) - ob.r, 0), Math.max(ob.z0 - ez, ez - ob.z1, 0));
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
        const b = ob.k === 'cyl' ? [ob.x - ob.r, ob.x + ob.r, ob.y - ob.r, ob.y + ob.r, ob.z0, ob.z1] : ob.k === 'ell' ? [ob.x - ob.rx, ob.x + ob.rx, ob.y - ob.ry, ob.y + ob.ry, ob.z - ob.rz, ob.z + ob.rz]
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
    const lw = [lut.h0, lut.h0 + lut.nh * lut.step, lut.v0, lut.v0 + lut.nv * lut.step], preA = conv === 'A' && lw[0] > -89 && lw[1] < 89 && lw[2] > -89 && lw[3] < 89;
    const sv0 = Math.sin(lw[2] * D2R) - 1e-9, sv1 = Math.sin(lw[3] * D2R) + 1e-9, th0 = Math.tan(lw[0] * D2R) * (1 + 1e-9) - 1e-12, th1 = Math.tan(lw[1] * D2R) * (1 + 1e-9) + 1e-12;
    // add a surface point's luminance, weighted: P = hit, n = unit normal (facing the eye), m = material, k = weight, v = unit vector to the eye
    function shade(px, py, pz, nx, ny, nz, m, k, vx, vy, vz, rscale) {
      let r = 0, g = 0, b = 0;
      const rho = m.rho, NoV = nx * vx + ny * vy + nz * vz;
      if (m.emit && NoV > 0) { const es = (rscale === undefined ? 1 : rscale) * (m.emitPow > 1 ? Math.pow(NoV, m.emitPow) : NoV); r += m.emit[0] * es; g += m.emit[1] * es; b += m.emit[2] * es; }   // a flat emitter is Lambertian, L·cosθ; lamps are directional: cos^n
      if (amb > 0 && nz > -0.9) { const e = amb * (0.5 + 0.5 * nz) / PI; r += rho[0] * e; g += rho[1] * e; b += rho[2] * e; }
      for (let i = 0; i < nl; i++) {
        const L = lamps[i], dx = px - L[0], dy = py - L[1], dz = pz - L[2], r2 = dx * dx + dy * dy + dz * dz, rr = Math.sqrt(r2), NoL = -(dx * nx + dy * ny + dz * nz) / rr;
        if (!(NoL > 0)) continue;
        if (preA) { const a = dx / rr, b = -dy / rr, c = dz / rr; if (c < sv0 || c > sv1 || a <= 0 || b > a * th1 || b < a * th0) continue; }
        hvFast(dx, dy, dz, conv); const I = lutAt(lut, HV0, HV1); if (!(I > 0)) continue;
        const Ep = I / r2;                                                    // E⊥, lux square to the beam
        const d = Ep * NoL / PI; r += rho[0] * d; g += rho[1] * d; b += rho[2] * d;
        if (m.gloss && NoV > 0) {
          const lx = -dx / rr, ly = -dy / rr, lz = -dz / rr; let hx = lx + vx, hy = ly + vy, hz = lz + vz; const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= hl; hy /= hl; hz /= hl;
          const NoH = nx * hx + ny * hy + nz * hz, VoH = vx * hx + vy * hy + vz * hz, a2 = m.gloss.a * m.gloss.a, den = NoH * NoH * (a2 - 1) + 1, D = a2 / (PI * den * den);
          const F = m.gloss.F0 + (1 - m.gloss.F0) * Math.pow(1 - Math.max(0, VoH), 5), kk = m.gloss.a / 2, G1 = (x) => x / (x * (1 - kk) + kk);
          const s = D * F * G1(NoL) * G1(NoV) / (4 * NoV) * Ep; r += s; g += s; b += s;
        }
        if (m.retro) { const q = Ep * (rscale === undefined ? 1 : rscale); r += m.retro[0] * q; g += m.retro[1] * q; b += m.retro[2] * q; }
      }
      LR += k * r * lc[0]; LG += k * g * lc[1]; LB += k * b * lc[2];
    }
    // the ground at P (distance t along the ray): road / verge, and the markings by coverage of the pixel's footprint
    let GM = 0;                                         // the material with the largest share of the last ground footprint (for the probe)
    function ground(px, py, t, sinB, vx, vy, vz, delta, kw) {
      let s = px, off = py, nx = 0, ny = 1; if (A) { const f = A.frame(px, py); s = f.s; off = f.off; nx = -f.t[1]; ny = f.t[0]; }
      const hw = Math.max(0.5 * t * delta, 1e-4), hl = hw / Math.max(sinB, 0.003);
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
      // the road, the two verge strips and what lies beyond them, each weighted by the share of the footprint it covers (no stair-steps along a long diagonal edge)
      const vw = vg[1] || 1.5, far = vg[2] || vg[0], INF = 1e9, e0 = -Lw / 2, e1 = 1.5 * Lw;
      const bands = [['asphalt', e0, e1], [vg[0], e0 - vw, e0], [vg[0], e1, e1 + vw], [far, -INF, e0 - vw], [far, e1 + vw, INF]];
      let tot = 0; for (let i = 0; i < 5; i++) tot += covLat(off, ho, bands[i][1], bands[i][2]);
      for (let i = 0; i < 5; i++) { const c = covLat(off, ho, bands[i][1], bands[i][2]) / (tot || 1); if (c <= 0) continue; shade(px, py, 0, 0, 0, 1, M[bands[i][0]], c * rest * kw, vx, vy, vz); if (c * rest > bestW) { bestW = c * rest; GM = M[bands[i][0]].id; } }
    }
    let sampleDepth = Infinity, sampleMat = MAT_ID.sky, covAcc = 0;
    // one ray through (fx, fy) in pixel units; adds weight k to the accumulators
    function sample(fx, fy, k, tileObjs, delta) {
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
        if (hnx * dx + hny * dy + hnz * dz > 0) { hnx = -hnx; hny = -hny; hnz = -hnz; }
        const key = typeof ob.mat === 'function' ? ob.mat({ x: px, y: py, z: pz, u: hu, face: hf }) : ob.mat;
        let m = M[key] || M.wall; if (ob.emit) m = ob.emitM && ob.emitBase === m ? ob.emitM : (ob.emitBase = m, ob.emitM = Object.assign({}, m, { emit: ob.emit, emitPow: ob.emitPow }));   // this object glows (a lamp: its own luminance); emitPow > 1 makes it directional (cos^n)
        shade(px, py, pz, hnx, hny, hnz, m, k, -dx, -dy, -dz, hs); if (!ob.glow) covAcc += k;                        // glow (a pavement marker): adds its light, does not hide the ground under it
        if (sampleDepth === Infinity) { sampleDepth = tbest; sampleMat = m.id; }
      } else if (objOnly) { /* the ground and the sky are the other layer's */ } else if (tg < Infinity && tg < 5000) {
        ground(ex + tg * dx, ey + tg * dy, tg, -dz, -dx, -dy, -dz, delta, k);
        if (sampleDepth === Infinity) { sampleDepth = tg; sampleMat = GM; }
      } else { const sl = skyL * (1 + 0.8 * Math.max(0, 1 - Math.abs(dz) * 8)); LR += k * sl; LG += k * sl; LB += k * sl; }
    }
    const pixel = (x, y, tl) => {
      const n = tl ? ssN : 1, k = 1 / (n * n), delta = delta0 / n;
      LR = LG = LB = 0; sampleDepth = Infinity; sampleMat = MAT_ID.sky; covAcc = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sample(x + (i + 0.5) / n, y + (j + 0.5) / n, k, tl, delta);
      const q = y * w + x;
      if (rgba) { rgba[4 * q] = LR; rgba[4 * q + 1] = LG; rgba[4 * q + 2] = LB; rgba[4 * q + 3] = covAcc; }
      else { rgb[3 * q] = LR; rgb[3 * q + 1] = LG; rgb[3 * q + 2] = LB; if (cov) cov[q] = covAcc; else { depth[q] = sampleDepth; matBuf[q] = sampleMat; } }
    };
    if (objOnly) { for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) { const tl = tiles[ty * tw + tx]; if (!tl || (o.tileRow && !o.tileRow(ty))) continue; for (let y = ty * TS, ye = Math.min(h, y + TS); y < ye; y++) for (let x = tx * TS, xe = Math.min(w, x + TS); x < xe; x++) pixel(x, y, tl); } }   // only the tiles an object can touch (o.tileRow(ty): only these tile rows, the workers' share)
    else for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixel(x, y, tiles[((y / TS) | 0) * tw + ((x / TS) | 0)]);
    if (objOnly) { let y0 = th, y1 = -1; const trows = []; for (let ty = 0; ty < th; ty++) { let any = false; if (!o.tileRow || o.tileRow(ty)) for (let tx = 0; tx < tw; tx++) if (tiles[ty * tw + tx]) { any = true; break; } if (any) { trows.push(ty); if (ty < y0) y0 = ty; if (ty > y1) y1 = ty; } } return { w, h, rgb, cov, rgba, rows: y1 < 0 ? [0, 0] : [y0 * TS, Math.min(h, (y1 + 1) * TS)], trows, TS, hfov: o.hfov }; }
    return { w, h, rgb, depth, mat: matBuf, keys: MAT_KEYS, names: MAT_KEYS.map((k) => MAT_DEF[k].name), hfov: o.hfov };
  }
  const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // the pixel under (x, y): luminance (cd/m²), distance, material
  function probe(res, x, y) {
    x = Math.max(0, Math.min(res.w - 1, Math.floor(x))); y = Math.max(0, Math.min(res.h - 1, Math.floor(y)));
    const q = y * res.w + x, r = res.rgb[3 * q], g = res.rgb[3 * q + 1], b = res.rgb[3 * q + 2];
    return { L: lumaOf(r, g, b), rgb: [r, g, b], depth: res.depth[q], mat: res.names[res.mat[q]] };
  }

  // ---------------------------------------------------------------- exposure and tone mapping
  /* Scene-referred luminance → a display. Two ways to set the exposure:
   *   fixed — an absolute EV: EV 0 puts 10 cd/m² at display white, each stop doubles it. The same EV on two designs makes their
   *           brightness comparable (this is the mode for comparing).
   *   auto  — the geometric mean of the lit pixels goes to 18 % grey (+ the EV offset): every picture looks "exposed", so
   *           brightness differences between designs are hidden (this is the mode for looking).
   * Then an ACES-style filmic curve (Narkowicz fit) and the sRGB transfer. glare: a cheap veiling-glare bloom — the part of each pixel
   * above display white is spread by a wide kernel (the eye's scatter) and added back.                                           */
  const L_REF = 10;
  function exposureOf(res, opt) {
    const ev = opt.ev || 0;
    if (opt.mode === 'fixed') return { k: Math.pow(2, ev) / L_REF, white: L_REF / Math.pow(2, ev) };
    let sum = 0, n = 0; const d = res.rgb;
    for (let q = 0; q < res.w * res.h; q++) { const y = lumaOf(d[3 * q], d[3 * q + 1], d[3 * q + 2]); if (y > 1e-4) { sum += Math.log(y); n++; } }
    const key = n ? Math.exp(sum / n) : 1, k = 0.18 * Math.pow(2, ev) / key;
    return { k, white: 1 / k, key };
  }
  const aces = (x) => { x = x < 0 ? 0 : x; const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return y > 1 ? 1 : y; };
  const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function boxBlur(src, w, h, r) {        // separable box blur, 3 channels, edge-clamped
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let s = 0; for (let x = -r; x <= r; x++) s += src[3 * (y * w + Math.max(0, Math.min(w - 1, x))) + c]; for (let x = 0; x < w; x++) { tmp[3 * (y * w + x) + c] = s / n; s += src[3 * (y * w + Math.min(w - 1, x + r + 1)) + c] - src[3 * (y * w + Math.max(0, x - r)) + c]; } }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[3 * (Math.max(0, Math.min(h - 1, y)) * w + x) + c]; for (let y = 0; y < h; y++) { out[3 * (y * w + x) + c] = s / n; s += tmp[3 * (Math.min(h - 1, y + r + 1) * w + x) + c] - tmp[3 * (Math.max(0, y - r) * w + x) + c]; } }
    return out;
  }
  function tonemap(res, opt) {
    opt = opt || {}; const ex = exposureOf(res, opt), w = res.w, h = res.h, n = w * h, lin = new Float32Array(3 * n);
    for (let q = 0; q < 3 * n; q++) lin[q] = res.rgb[q] * ex.k;
    const gl = opt.glare === true ? 1 : +opt.glare || 0;           // strength: 0 off, 1 = the original weights
    if (gl > 0) {
      const ex1 = new Float32Array(3 * n); let any = false; for (let q = 0; q < 3 * n; q++) { const e = lin[q] - 1; if (e > 0) { ex1[q] = e; any = true; } }
      if (any) { for (const [r, wt] of [[Math.max(1, Math.round(w / 220)), 0.012], [Math.max(2, Math.round(w / 70)), 0.010], [Math.max(3, Math.round(w / 22)), 0.008]]) { const b = boxBlur(boxBlur(ex1, w, h, r), w, h, r); for (let q = 0; q < 3 * n; q++) lin[q] += gl * wt * b[q]; } }
    }
    const px = new Uint8ClampedArray(4 * n);
    for (let q = 0; q < n; q++) { px[4 * q] = Math.round(255 * srgb(aces(lin[3 * q]))); px[4 * q + 1] = Math.round(255 * srgb(aces(lin[3 * q + 1]))); px[4 * q + 2] = Math.round(255 * srgb(aces(lin[3 * q + 2]))); px[4 * q + 3] = 255; }
    return { px, k: ex.k, white: ex.white, key: ex.key };
  }

  RF.Drive = { MAT_DEF, MAT_KEYS, materials, lutFrom, lutAt, hvFast, hv: () => [HV0, HV1], covLat, covLon, laneMarkings, boundOf, hitObj, hit: () => ({ n: [NX, NY, NZ], u: HU, face: HF, scale: HSCALE }), render, probe, lumaOf, exposureOf, tonemap, L_REF };
})(typeof globalThis !== 'undefined' ? globalThis : this);
