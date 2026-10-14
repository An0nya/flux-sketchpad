/* gpu-trace.js — RF.GpuTrace: the engine's Monte-Carlo trace (engine.js traceRange) on WebGPU, for the same rays.
 *
 * Same rays: ray i draws the same integer random stream (seed, i) as on the CPU (core.js streamSeed + mulberry32 are
 * integer arithmetic, so the u32 draws are identical); only the floating point differs (WGSL has no f64: f32 here).
 * So a GPU trace is the CPU trace with every ray nudged by ~1e-7 relative: rays that pass within that of a facet
 * edge can land differently, everything else follows the same path (tests/gpu.js measures it: 0–2e-5 of the rays).
 * WGSL's own sin/cos/atan2 are allowed errors of 2⁻¹¹ / 4096 ULP (and SwiftShader uses them), so this kernel has its own.
 * The CPU path stays the reference: nothing uses the GPU unless the user switches it on (Simulation → Advanced → GPU
 * trace, per browser) and the caller asks (the page loop, tools.traceAsync); tools.trace is never the GPU's.  GPU.md.
 *
 * What it fills: exactly what traceRange(ctx, i0, i1) adds to a context: gridD / gridR, the energy ledger E, surfIn,
 * occ (blocked, out1, per surface), far-field streams (P.ffStreams), guided-emission learning (P.guideLearn), guided
 * segments (P.guides), recorded hits + rayK (P.recordHits, in ray order up to hitCap), ray paths (the first
 * ctx.pathLimit rays are traced on the CPU, as they need their polylines).  Not on the GPU: exit-ray lists
 * (P.recordExit) → supports(P) says why and the caller traces on the CPU.
 *
 * Sums are fixed point: every deposit is rounded to 2⁻²⁴ of a ray's emitted energy and added to a 64-bit integer
 * (two u32 atomics with carry).  Integer sums don't depend on order, so a GPU run is deterministic on one device, and
 * the rounding (≤ 3e-8 of a ray per deposit) is far under any noise the app reports.
 *
 *   await RF.GpuTrace.init()        → true when a WebGPU device is ready (false: no WebGPU, no adapter, lost device)
 *   RF.GpuTrace.supports(P)         → true | 'reason it cannot'
 *   await RF.GpuTrace.traceRange(ctx, i0, i1)   → adds rays i0 … i1 − 1 to ctx (like Engine.traceRange; does not move ctx.next)
 *   RF.GpuTrace.step(ctx, batch, onDone)       → the progressive form for the page loop: one batch in flight at a time;
 *                                                 moves ctx.next / ctx.done / ctx.elapsed when it lands, then calls onDone
 * No DOM: runs in the page and in workers (navigator.gpu exists in both).                                          */
(function (root) {
  'use strict';
  const RF = root.RF;
  const STRIDE = 40, NB = 1024, GB = 32, MAXFF = 8, LED = 15, WLS = LED + 3 * MAXFF;   // ledger slots (64-bit each)
  const LEDGER = ['emitted', 'direct', 'reflected', 'absorbed', 'backface', 'interfaceLoss', 'escaped', 'targetBack', 'truncated', 'intercepted', 'reHit', 'tir', 'fresnelR'];   // 13 → occ.blocked, occ.out1
  const Q1 = 16777216, Q2 = 65536;            // deposit quanta: energy × 2²⁴, energy² × 2¹⁶ (in units of one ray's emitted energy)
  const CHUNK = 262144;                       // rays per dispatch (several dispatches per submit)
  const BIG = 3e38;

  // ---------------------------------------------------------------- WGSL
  const WGSL = /* wgsl */`
const STRIDE: u32 = ${STRIDE}u;
const NBINS: u32 = ${NB}u;
const GBINS: u32 = ${GB}u;
const WLS: u32 = ${WLS}u;
const R2D: f32 = 57.29577951308232;
const TAU: f32 = 6.283185307179586;
const BIG: f32 = 3.0e38;

@group(0) @binding(0) var<storage, read> prm: array<u32>;
@group(0) @binding(1) var<storage, read> surf: array<f32>;
@group(0) @binding(2) var<storage, read> poly: array<f32>;
@group(0) @binding(3) var<storage, read> bvhF: array<f32>;
@group(0) @binding(4) var<storage, read> bvhI: array<i32>;
@group(0) @binding(5) var<storage, read> aux: array<u32>;
@group(0) @binding(6) var<storage, read_write> acc: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> rayOut: array<u32>;

var<workgroup> wl: array<atomic<u32>, ${2 * WLS}>;

fn pf(i: u32) -> f32 { return bitcast<f32>(prm[i]); }
fn af(i: u32) -> f32 { return bitcast<f32>(aux[i]); }
fn av3(i: u32) -> vec3f { return vec3f(af(i), af(i + 1u), af(i + 2u)); }

// ---- integer RNG (core.js: fmix32, streamSeed; engine.js: mulberry32 over the stream)
fn fmix32(h0: u32) -> u32 { var h = h0; h ^= h >> 16u; h *= 0x85ebca6bu; h ^= h >> 13u; h *= 0xc2b2ae35u; h ^= h >> 16u; return h; }
fn streamSeed(seed: u32, i: u32) -> u32 { return fmix32(seed ^ fmix32(((i + 1u) * 0x9E3779B1u) ^ 0x5bd1e995u)); }
fn mb(s: ptr<function, u32>) -> u32 {
  *s = *s + 0x6D2B79F5u; let a = *s;
  var t = (a ^ (a >> 15u)) * (1u | a);
  t = (t + ((t ^ (t >> 7u)) * (61u | t))) ^ t;
  return t ^ (t >> 14u);
}
fn uf(u: u32) -> f32 { return f32(u >> 8u) * (1.0 / 16777216.0); }   // [0, 1): u / 2³² rounded down to 24 bits
fn omx(u: u32) -> f32 { return (f32(0xFFFFFFFFu - u) + 1.0) * 2.3283064365386963e-10; }   // 1 − u / 2³², full relative precision near 0

// ---- accurate f32 trig: WGSL only promises sin/cos to 2⁻¹¹ absolute and atan2 to 4096 ULP (SwiftShader uses that slack:
// 1e-4 rad errors in emission directions), so these are Cephes-style minimax polynomials, ~1e-7, with exact range reduction
fn sc4(x: f32) -> vec2f {                            // (sin x, cos x) for |x| ≤ π/4
  let z = x * x;
  let sn = x + x * z * (-1.6666654611e-1 + z * (8.3321608736e-3 + z * -1.9515295891e-4));
  let cs = 1.0 - 0.5 * z + z * z * (4.166664568298827e-2 + z * (-1.388731625493765e-3 + z * 2.443315711809948e-5));
  return vec2f(sn, cs);
}
fn scPhase(u: u32) -> vec2f {                        // (sin, cos) of 2π · u / 2³²: the quadrant from the top bits, the rest exactly
  let q = u >> 30u; let r = f32(u & 0x3FFFFFFFu) * 1.4629180792671596e-9 - 0.7853981633974483;   // r ∈ [−π/4, π/4): angle − quadrant start − π/4
  let a = sc4(r); let k = 0.7071067811865476;
  let s0 = k * (a.x + a.y); let c0 = k * (a.y - a.x);   // sin / cos of r + π/4
  if (q == 0u) { return vec2f(s0, c0); } if (q == 1u) { return vec2f(c0, -s0); } if (q == 2u) { return vec2f(-s0, -c0); } return vec2f(-c0, s0);
}
fn cosQ(t: f32) -> f32 {                             // cos t for t ∈ [0, π/2]
  if (t <= 0.7853981633974483) { return sc4(t).y; }
  return sc4(1.5707963267948966 - t).x;
}
fn atanP(x0: f32) -> f32 {                           // atan x for x ≥ 0
  var x = x0; var y = 0.0;
  if (x > 2.414213562373095) { y = 1.5707963267948966; x = -1.0 / x; }
  else if (x > 0.4142135623730950) { y = 0.7853981633974483; x = (x - 1.0) / (x + 1.0); }
  let z = x * x;
  return y + (((8.05374449538e-2 * z - 1.38776856032e-1) * z + 1.99777106478e-1) * z - 3.33329491539e-1) * z * x + x;
}
fn atan2A(y: f32, x: f32) -> f32 {
  let ax = abs(x); let ay = abs(y);
  if (ax == 0.0 && ay == 0.0) { return 0.0; }
  var a: f32;
  if (ay <= ax) { a = atanP(ay / ax); } else { a = 1.5707963267948966 - atanP(ax / ay); }
  if (x < 0.0) { a = 3.141592653589793 - a; }
  return select(a, -a, y < 0.0);
}
fn asinA(x: f32) -> f32 { let c = clamp(x, -1.0, 1.0); return atan2A(c, sqrt(max(0.0, (1.0 - c) * (1.0 + c)))); }

// ---- fixed-point accumulation: 64-bit sums from u32 atomics
fn add64(off: u32, x: u32) {
  if (x == 0u) { return; }
  let old = atomicAdd(&acc[off], x);
  if (old > 0xFFFFFFFFu - x) { atomicAdd(&acc[off + 1u], 1u); }
}
fn addW(slot: u32, x: u32) {
  if (x == 0u) { return; }
  let old = atomicAdd(&wl[2u * slot], x);
  if (old > 0xFFFFFFFFu - x) { atomicAdd(&wl[2u * slot + 1u], 1u); }
}
fn qz(e: f32) -> u32 { return u32(clamp(e, 0.0, 255.0) * 16777216.0 + 0.5); }
fn qz2(e: f32) -> u32 { let c = clamp(e, 0.0, 255.0); return u32(c * c * 65536.0 + 0.5); }

// ledger slots (gpu-trace.js LEDGER)
const L_EMIT: u32 = 0u; const L_DIRECT: u32 = 1u; const L_REFL: u32 = 2u; const L_ABS: u32 = 3u; const L_BACK: u32 = 4u;
const L_IFL: u32 = 5u; const L_ESC: u32 = 6u; const L_TBACK: u32 = 7u; const L_TRUNC: u32 = 8u; const L_INTER: u32 = 9u;
const L_REHIT: u32 = 10u; const L_TIR: u32 = 11u; const L_FRES: u32 = 12u; const L_BLOCK: u32 = 13u; const L_OUT1: u32 = 14u;

// params (gpu-trace.js PRM)
const P_I0: u32 = 0u; const P_COUNT: u32 = 1u; const P_SEED: u32 = 2u; const P_NSURF: u32 = 3u; const P_CAP: u32 = 4u; const P_RES: u32 = 5u;
const P_FLAGS: u32 = 6u; const P_NFF: u32 = 7u; const P_NG: u32 = 8u; const P_SRC: u32 = 9u; const P_GUIDE: u32 = 10u; const P_FF: u32 = 11u;
const P_ITEMS: u32 = 12u; const P_GD: u32 = 13u; const P_GR: u32 = 14u; const P_SIN: u32 = 15u; const P_BLK: u32 = 16u; const P_OUT1: u32 = 17u;
const P_GLH: u32 = 18u; const P_GLHN: u32 = 19u; const P_GLKC: u32 = 20u; const P_GLNCI: u32 = 21u; const P_GLNC: u32 = 22u; const P_GLNH: u32 = 23u;
const P_NPART: u32 = 24u; const P_BASE: u32 = 25u; const P_SEEDF: u32 = 26u;
const P_FLOOR: u32 = 32u; const P_EPS: u32 = 33u; const P_EPSSELF: u32 = 34u; const P_TC: u32 = 36u; const P_TN: u32 = 39u; const P_TU: u32 = 42u; const P_TV: u32 = 45u; const P_HALF: u32 = 48u;
fn pv3(i: u32) -> vec3f { return vec3f(pf(i), pf(i + 1u), pf(i + 2u)); }

// ---- source sampling (source.js sampleRay; sampler descriptor: gpu-trace.js packSource)
fn basisU(n: vec3f) -> vec3f {                       // V.basis(n)[0] with ref (0, 0, 1)
  var r = vec3f(0.0, 0.0, 1.0);
  if (abs(dot(r, n)) > 0.999) { r = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.x) < 0.9); }
  return normalize(cross(r, n));
}
// x as a 32-bit fixed-point uniform (the CPU's u / 2³² exactly): the tables are fixed point too, so table lookups make the same
// choice as the CPU's f64 ones (an f32 uniform loses the far tail of a gaussian, where the cdf steps are under 2⁻²⁴)
// returns (cos θ, sin θ), each computed directly (sin from cos loses precision near the axis)
fn sampleCos(b: u32, x: u32) -> vec2f {
  let dist = aux[b + 2u];
  if (dist == 0u) { return vec2f(sqrt(omx(x)), sqrt(uf(x))); }
  if (dist == 1u) {
    let off = aux[b + 5u]; let N = aux[b + 6u];
    var lo = 0u; var hi = N;
    loop { if (hi - lo <= 1u) { break; } let m = (lo + hi) >> 1u; if (aux[off + m] <= x) { lo = m; } else { hi = m; } }
    let f = f32(x - aux[off + lo]) / max(1.0, f32(aux[off + hi] - aux[off + lo]));
    let t = min(3.141592653589793, (f32(lo) + f) / f32(N) * af(b + 24u));
    if (t <= 1.5707963267948966) { return vec2f(cosQ(t), cosQ(1.5707963267948966 - t)); }
    return vec2f(-cosQ(3.141592653589793 - t), cosQ(t - 1.5707963267948966));
  }
  let k = uf(x) * (1.0 - af(b + 23u));             // 1 − cos θ
  return vec2f(1.0 - k, sqrt(max(0.0, k * (2.0 - k))));
}
struct Ray { o: vec3f, d: vec3f }
fn domeOut(b: u32, o0: vec3f, d0: vec3f, u0: u32, u3: u32, u4: u32) -> Ray {
  let a = av3(b + 16u); let p = av3(b + 7u); let R = af(b + 26u); let n = af(b + 27u); let c = p + af(b + 28u) * a;
  let fu = av3(b + 10u); let fv = av3(b + 13u);
  var st: u32 = u0 ^ (u3 * 0x9E3779B1u) ^ (u4 >> 1u);
  let R0 = ((n - 1.0) / (n + 1.0)) * ((n - 1.0) / (n + 1.0));
  var o = o0; var d = d0;
  for (var k = 0; k < 64; k++) {
    let q = o - c; let bb = dot(q, d); let cc = dot(q, q) - R * R;
    let ts = -bb + sqrt(max(0.0, bb * bb - cc));
    let da = dot(d, a); let ha = dot(o - p, a);
    var tp = BIG; if (da < -1e-12) { tp = -ha / da; }
    if (tp < ts) {
      o = o + tp * d;
      let cz = sqrt(omx(mb(&st))); let sn = sqrt(max(0.0, 1.0 - cz * cz)); let ph = scPhase(mb(&st));
      d = sn * ph.y * fu + sn * ph.x * fv + cz * a;
      continue;
    }
    o = o + ts * d;
    let m = (o - c) / R; let ci = clamp(dot(d, m), 0.0, 1.0);
    let s2 = n * n * (1.0 - ci * ci);
    var refl = s2 >= 1.0;
    if (!refl) {
      let ct = sqrt(1.0 - s2); let rs = (n * ci - ct) / (n * ci + ct); let rp = (n * ct - ci) / (n * ct + ci);
      var pr = 0.0; if (R0 > 0.0) { pr = 0.5 * (rs * rs + rp * rp); }
      refl = uf(mb(&st)) < pr;
      if (!refl) { let f = ct - n * ci; return Ray(o, normalize(n * d + f * m)); }
    }
    d = d - 2.0 * ci * m;
  }
  return Ray(o, normalize(o - c));
}
fn sampleRay(b: u32, u: array<u32, 6>) -> Ray {
  let fu = av3(b + 10u); let fv = av3(b + 13u); let fa = av3(b + 16u); let p = av3(b + 7u);
  let kind = aux[b]; let shape = aux[b + 1u];
  let x0 = uf(u[0]); let x1 = uf(u[1]); let x2 = uf(u[2]);
  let R = af(b + 21u); let L = af(b + 22u);
  if (aux[b + 3u] == 1u) {                           // opaque body: a point on the skin, cosine-weighted about its normal
    var n: vec3f; var t1: vec3f; var t2: vec3f; var q: vec3f;
    if (shape == 3u) {
      let pSide = af(b + 25u);
      if (x0 < pSide) {
        let an = scPhase(u[1]); let c = an.y; let s = an.x; let h = (x2 - 0.5) * L;
        n = c * fu + s * fv; t1 = fa; t2 = -s * fu + c * fv; q = R * n + h * fa;
      } else {
        let top = (x0 - pSide) / (1.0 - pSide) < 0.5; let sg = select(-1.0, 1.0, top); let r = R * sqrt(x2); let an = scPhase(u[1]);
        n = sg * fa; t1 = fu; t2 = fv; q = r * an.y * fu + r * an.x * fv + sg * L / 2.0 * fa;
      }
    } else {
      let ct = 1.0 - 2.0 * x1; let st = sqrt(max(0.0, 1.0 - ct * ct)); let an = scPhase(u[2]);
      n = vec3f(st * an.y, st * an.x, ct); t1 = basisU(n); t2 = cross(n, t1); q = R * n;
    }
    let c = sqrt(omx(u[3])); let s = sqrt(uf(u[3])); let ph = scPhase(u[4]);
    return Ray(p + q, c * n + s * ph.y * t1 + s * ph.x * t2);
  }
  var o = p;
  if (kind == 1u) {
    if (shape == 1u) { let r = R * sqrt(x0); let an = scPhase(u[1]); o = o + r * an.y * fu + r * an.x * fv; }
    else { o = o + (x0 - 0.5) * af(b + 19u) * fu + (x1 - 0.5) * af(b + 20u) * fv; }
  } else if (kind == 2u) {
    if (shape == 3u) { let r = R * sqrt(x0); let an = scPhase(u[1]); o = o + r * an.y * fu + r * an.x * fv + (x2 - 0.5) * L * fa; }
    else { let r = select(0.0, R * pow(x0, 1.0 / 3.0), x0 > 0.0); let ct = 1.0 - 2.0 * x1; let st = sqrt(max(0.0, 1.0 - ct * ct)); let an = scPhase(u[2]); o = o + vec3f(r * st * an.y, r * st * an.x, r * ct); }
  }
  let cs = sampleCos(b, u[3]); let ct = cs.x; let st = cs.y; let ph = scPhase(u[4]);
  let d = st * ph.y * fu + st * ph.x * fv + ct * fa;
  if (aux[b + 4u] == 1u) { return domeOut(b, o, d, u[0], u[3], u[4]); }
  return Ray(o, d);
}

// ---- exact ray / quadric patch (geometry.js intersect): (t, local hit) or t < 0
fn isect(k: u32, o: vec3f, d: vec3f, tmin: f32, tmax: f32) -> vec4f {
  let s = k * STRIDE;
  let r = o - vec3f(surf[s], surf[s + 1u], surf[s + 2u]);
  let ex = vec3f(surf[s + 3u], surf[s + 4u], surf[s + 5u]); let ey = vec3f(surf[s + 6u], surf[s + 7u], surf[s + 8u]); let ez = vec3f(surf[s + 9u], surf[s + 10u], surf[s + 11u]);
  let O = vec3f(dot(r, ex), dot(r, ey), dot(r, ez)); let D = vec3f(dot(d, ex), dot(d, ey), dot(d, ez));
  let l = vec3f(surf[s + 18u], surf[s + 19u], surf[s + 20u]); let K = surf[s + 21u];
  var t0: f32; var t1: f32 = -1.0; var two = false;
  if (surf[s + 34u] == 1.0) {
    let den = dot(l, D); if (den == 0.0) { return vec4f(-1.0); }
    t0 = -(dot(l, O) + K) / den;
  } else {
    let qxx = surf[s + 12u]; let qyy = surf[s + 13u]; let qzz = surf[s + 14u]; let qxy = surf[s + 15u]; let qxz = surf[s + 16u]; let qyz = surf[s + 17u];
    let QD = vec3f(qxx * D.x + qxy * D.y + qxz * D.z, qxy * D.x + qyy * D.y + qyz * D.z, qxz * D.x + qyz * D.y + qzz * D.z);
    let QO = vec3f(qxx * O.x + qxy * O.y + qxz * O.z, qxy * O.x + qyy * O.y + qyz * O.z, qxz * O.x + qyz * O.y + qzz * O.z);
    let a = dot(D, QD); let b = 2.0 * dot(O, QD) + dot(l, D); let c = dot(O, QO) + dot(l, O) + K;
    if (a == 0.0) { if (b == 0.0) { return vec4f(-1.0); } t0 = -c / b; }
    else {
      let disc = b * b - 4.0 * a * c; if (disc < 0.0) { return vec4f(-1.0); }
      let sq = sqrt(disc); let q = -0.5 * (b + select(-sq, sq, b >= 0.0));
      let r1 = q / a; var r2 = r1; if (q != 0.0) { r2 = c / q; }
      t0 = min(r1, r2); t1 = max(r1, r2); two = true;
    }
  }
  let ct = surf[s + 22u];
  for (var ps = 0u; ps < 2u; ps++) {
    if (ps == 1u && !two) { break; }
    let t = select(t0, t1, ps == 1u);
    if (!(t > tmin && t < tmax)) { continue; }
    let X = O + t * D;
    var ok: bool;
    if (ct == 3.0) {
      let r2 = X.x * X.x + X.y * X.y;
      ok = X.z >= surf[s + 23u] && X.z <= surf[s + 24u] && r2 >= surf[s + 25u] && r2 <= surf[s + 26u];
    } else if (abs(X.z) > surf[s + 27u]) {
      ok = false;
    } else if (ct == 0.0) {
      ok = abs(X.x) <= surf[s + 23u] && abs(X.y) <= surf[s + 24u];
    } else if (ct == 1.0) {
      ok = X.x * X.x + X.y * X.y <= surf[s + 23u] * surf[s + 23u];
    } else {
      let off = u32(surf[s + 23u]); let cnt = u32(surf[s + 24u]);
      ok = true;
      for (var i = 0u; i < cnt; i++) {
        let j = select(i + 1u, 0u, i + 1u == cnt);
        let x0 = poly[2u * (off + i)]; let y0 = poly[2u * (off + i) + 1u]; let x1 = poly[2u * (off + j)]; let y1 = poly[2u * (off + j) + 1u];
        let e = vec2f(x1 - x0, y1 - y0);
        // f32: the edge tolerance is 1e-6 of the edge (CPU f64: 1e-9) so shared facet edges still leave no crack
        if (e.x * (X.y - y0) - e.y * (X.x - x0) < -1e-6 * dot(e, e)) { ok = false; break; }
      }
    }
    if (ok) { return vec4f(t, X); }
  }
  return vec4f(-1.0);
}
fn frontNormal(k: u32, X: vec3f) -> vec3f {
  let s = k * STRIDE;
  let g = vec3f(2.0 * (surf[s + 12u] * X.x + surf[s + 15u] * X.y + surf[s + 16u] * X.z) + surf[s + 18u],
                2.0 * (surf[s + 15u] * X.x + surf[s + 13u] * X.y + surf[s + 17u] * X.z) + surf[s + 19u],
                2.0 * (surf[s + 16u] * X.x + surf[s + 17u] * X.y + surf[s + 14u] * X.z) + surf[s + 20u]);
  let w = g.x * vec3f(surf[s + 3u], surf[s + 4u], surf[s + 5u]) + g.y * vec3f(surf[s + 6u], surf[s + 7u], surf[s + 8u]) + g.z * vec3f(surf[s + 9u], surf[s + 10u], surf[s + 11u]);
  return surf[s + 33u] * normalize(w);
}

// ---- far-field streams (farfield.js binExit); returns the bin of stream 0's grid (−1: outside)
fn binExit(f: u32, o: vec3f, d: vec3f, e: f32, slot: u32) -> i32 {
  addW(${LED}u + 3u * slot + 1u, qz(e));             // lmExit
  var a = d.x; var b = -d.y; var c = d.z;
  if (aux[f] == 1u) {
    if (!(a > 0.0)) { return -1; }
    let t = (af(f + 9u) - o.x) / a; if (!(t > 0.0)) { return -1; }
    let pp = o + t * d - av3(f + 10u); let L = length(pp);
    a = pp.x / L; b = -pp.y / L; c = pp.z / L;
  }
  let conv = aux[f + 1u]; var h: f32; var v: f32;
  if (conv == 1u) { h = asinA(b) * R2D; v = atan2A(c, a) * R2D; }
  else if (conv == 2u) { if (!(a > 0.0)) { return -1; } h = atan2A(b, a) * R2D; v = atan2A(c, a) * R2D; }
  else { h = atan2A(b, a) * R2D; v = asinA(c) * R2D; }
  let step = af(f + 15u);
  let fi = floor((h - af(f + 13u)) / step); let fj = floor((v - af(f + 14u)) / step);
  let nh = aux[f + 2u]; let nv = aux[f + 3u];
  if (!(fi >= 0.0 && fi < f32(nh) && fj >= 0.0 && fj < f32(nv))) { return -1; }
  let m = u32(fj) * nh + u32(fi);
  add64(aux[f + 4u] + 2u * m, qz(e)); add64(aux[f + 5u] + 2u * m, qz2(e));
  addW(${LED}u + 3u * slot, qz(e)); addW(${LED}u + 3u * slot + 2u, 1u);
  return i32(m);
}
fn exitAll(o: vec3f, d: vec3f, e: f32, gbin: u32) {
  let nff = prm[P_NFF];
  for (var s = 0u; s < nff; s++) {
    let m = binExit(prm[P_FF] + 16u * s, o, d, e, s);
    if (s == 0u && m >= 0 && (prm[P_FLAGS] & 4u) != 0u) {
      let nh = prm[P_GLNH]; let kc = prm[P_GLKC]; let i = u32(m) % nh; let j = u32(m) / nh;
      atomicAdd(&acc[prm[P_GLH] + gbin * prm[P_GLNC] + (j / kc) * prm[P_GLNCI] + i / kc], 1u);
    }
  }
}

// ---- one ray, all bounces (engine.js traceOne)
fn traceRay(i: u32, slot: u32) {
  let flags = prm[P_FLAGS];
  var s = streamSeed(prm[P_SEED], i);
  var u: array<u32, 6>;
  let nx = select(5u, 6u, (flags & 2u) != 0u);
  for (var j = 0u; j < nx; j++) { u[j] = mb(&s); }
  var w: f32 = 1.0;
  var gbin = (u[3] >> 27u) * GBINS + (u[4] >> 27u);
  let ng = prm[P_NG];
  for (var gk = i32(ng) - 1; gk >= 0; gk--) {
    let g = prm[P_GUIDE] + 4u * u32(gk);
    if (i < aux[g] || i >= aux[g + 1u]) { continue; }
    let c = aux[g + 2u]; let qo = aux[g + 3u];
    // the guide's cdf in 32-bit fixed point (as sampleCos); the remapped uniforms stay fixed point: x3 = (a + f) / 32, x4 = (b + x4) / 32
    let x3 = u[3]; var lo = 0u; var hi = NBINS;
    loop { if (hi - lo <= 1u) { break; } let m = (lo + hi) >> 1u; if (aux[c + m] <= x3) { lo = m; } else { hi = m; } }
    let f = min(1.0 - 1e-7, max(0.0, f32(x3 - aux[c + lo]) / max(1.0, f32(aux[c + lo + 1u] - aux[c + lo]))));
    let aa = lo / GBINS; let bb = lo - aa * GBINS;
    u[3] = aa * 134217728u + min(134217727u, u32(f * 134217728.0)); u[4] = bb * 134217728u + (u[4] >> 5u);
    w = 1.0 / (f32(NBINS) * af(qo + lo));
    gbin = lo;
    break;
  }
  var part = prm[P_SRC];
  let np = prm[P_NPART];
  if (np > 1u) {
    let x5 = uf(u[5]); let cdf = prm[P_SRC] + 32u * np; var k = 0u;
    loop { if (!(k < np - 1u && af(cdf + k + 1u) <= x5)) { break; } k++; }
    part = prm[P_SRC] + 32u * k;
  }
  let ray = sampleRay(part, u);
  var o = ray.o; var d = ray.d;
  var E = w;
  addW(L_EMIT, qz(w));
  if ((flags & 4u) != 0u) { atomicAdd(&acc[prm[P_GLHN] + gbin], 1u); }

  let floorE = w * pf(P_FLOOR); let eps = pf(P_EPS); let epsSelf = pf(P_EPSSELF);
  let TC = pv3(P_TC); let Tn = pv3(P_TN); let Tu = pv3(P_TU); let Tv = pv3(P_TV); let half = pf(P_HALF);
  let nsurf = prm[P_NSURF]; let cap = prm[P_CAP]; let items = prm[P_ITEMS];
  let rec = (flags & 1u) != 0u;
  var bounces = 0u; var firstK: i32 = -1; var lastK: i32 = -1; var hitRec = 0u; var hu = 0.0; var hv = 0.0; var he = 0.0;
  var stack: array<i32, 64>;
  for (var guard = 0u; guard < 64u; guard++) {
    var tBest = BIG; var kBest: i32 = -1; var X = vec3f(0.0);
    if (nsurf > 0u) {
      let inv = vec3f(select(1.0 / d.x, sign(d.x) * 1e30 + select(0.0, 1e30, d.x == 0.0), abs(d.x) < 1e-30),
                      select(1.0 / d.y, sign(d.y) * 1e30 + select(0.0, 1e30, d.y == 0.0), abs(d.y) < 1e-30),
                      select(1.0 / d.z, sign(d.z) * 1e30 + select(0.0, 1e30, d.z == 0.0), abs(d.z) < 1e-30));
      var sp = 0; stack[0] = 0; sp = 1;
      while (sp > 0) {
        sp--; let nd = stack[sp]; let b6 = 6u * u32(nd);
        let ta = (vec3f(bvhF[b6], bvhF[b6 + 1u], bvhF[b6 + 2u]) - o) * inv;
        let tb = (vec3f(bvhF[b6 + 3u], bvhF[b6 + 4u], bvhF[b6 + 5u]) - o) * inv;
        let lo3 = min(ta, tb); let hi3 = max(ta, tb);
        let tn = max(lo3.x, max(lo3.y, lo3.z)); let tf = min(hi3.x, min(hi3.y, hi3.z));
        if (!(tf >= tn) || tf < eps || tn > tBest) { continue; }
        let b4 = 4u * u32(nd); let left = bvhI[b4];
        if (left < 0) {
          let s0 = u32(bvhI[b4 + 2u]); let s1 = s0 + u32(bvhI[b4 + 3u]);
          for (var q = s0; q < s1; q++) {
            let k = bvhI[items + q];
            let r = isect(u32(k), o, d, select(eps, epsSelf, k == lastK), tBest);
            if (r.x >= 0.0 && r.x < tBest) { tBest = r.x; kBest = k; X = r.yzw; }
          }
        } else if (sp < 63) { stack[sp] = left; stack[sp + 1] = bvhI[b4 + 1u]; sp += 2; }
      }
    }
    // the target plane (a finite rectangle; it also occludes)
    let den = dot(d, Tn);
    if (den != 0.0) {
      let t = dot(TC - o, Tn) / den;
      if (t > eps && t < tBest) {
        let pp = o + t * d - TC; let uu = dot(pp, Tu); let vv = dot(pp, Tv);
        if (abs(uu) <= half && abs(vv) <= half) {
          exitAll(o, d, E, gbin);
          if (den < 0.0) {
            let r = prm[P_RES];
            let iu = min(r - 1u, u32(max(0.0, floor((uu + half) / (2.0 * half) * f32(r)))));
            let iv = min(r - 1u, u32(max(0.0, floor((vv + half) / (2.0 * half) * f32(r)))));
            let cell = iv * r + iu;
            if (bounces == 0u) { add64(prm[P_GD] + 2u * cell, qz(E)); addW(L_DIRECT, qz(E)); }
            else { add64(prm[P_GR] + 2u * cell, qz(E)); addW(L_REFL, qz(E)); }
            hitRec = 1u + bounces; hu = uu; hv = vv; he = E;
          } else { addW(L_TBACK, qz(E)); }
          break;
        }
      }
    }
    if (kBest < 0) { addW(L_ESC, qz(E)); exitAll(o, d, E, gbin); break; }
    // surface interaction
    let wpt = o + tBest * d;
    let kb = u32(kBest);
    if (bounces == 0u) { addW(L_INTER, qz(w)); firstK = kBest; } else { addW(L_REHIT, qz(E)); }
    add64(prm[P_SIN] + 2u * kb, qz(E));
    if (bounces >= cap) {
      addW(L_TRUNC, qz(E));
      if (bounces >= 1u) { addW(L_BLOCK, qz(E)); add64(prm[P_BLK] + 2u * u32(firstK), qz(E)); }
      break;
    }
    bounces++;
    let n = frontNormal(kb, X);
    let cosI = dot(d, n);
    let so = kb * STRIDE; let inter = surf[so + 28u];
    if (inter == 2.0) { addW(L_ABS, qz(E)); addW(L_BLOCK, qz(E)); add64(prm[P_BLK] + 2u * u32(firstK), qz(E)); break; }
    if (inter == 0.0) {
      if (cosI > 0.0 && surf[so + 32u] == 0.0) { addW(L_BACK, qz(E)); addW(L_BLOCK, qz(E)); add64(prm[P_BLK] + 2u * u32(firstK), qz(E)); break; }
      let R = surf[so + 29u];
      addW(L_ABS, qz(E * (1.0 - R))); E *= R;
      d = d - 2.0 * cosI * n;
    } else {
      var n1: f32; var n2: f32; var m: vec3f; var ci: f32;
      let nF = 1.0 + surf[so + 36u]; let nB = surf[so + 30u];
      if (cosI < 0.0) { n1 = nF; n2 = nB; m = n; ci = -cosI; } else { n1 = nB; n2 = nF; m = -n; ci = cosI; }
      let eta = n1 / n2; let kk = 1.0 - eta * eta * (1.0 - ci * ci);
      var reflectIt = kk < 0.0;
      if (!reflectIt && surf[so + 37u] == 1.0) {
        let ct = sqrt(kk); let rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct); let rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
        let uu = f32(fmix32(streamSeed(prm[P_SEEDF], i) + bounces * 0x9E3779B1u) >> 8u) * (1.0 / 16777216.0);
        if (uu < 0.5 * (rs * rs + rp * rp)) { reflectIt = true; addW(L_FRES, qz(E)); }
      }
      if (reflectIt) {
        d = d + 2.0 * ci * m;
        if (kk < 0.0) { addW(L_TIR, qz(E)); }
      } else {
        if (surf[so + 37u] != 1.0) { let Tf = surf[so + 31u]; addW(L_IFL, qz(E * (1.0 - Tf))); E *= Tf; }
        let ct = sqrt(kk); let f = eta * ci - ct;
        d = eta * d + f * m;
      }
    }
    if (bounces == 1u) { addW(L_OUT1, qz(E)); add64(prm[P_OUT1] + 2u * kb, qz(E)); }
    d = normalize(d);
    if (E < floorE) { addW(L_TRUNC, qz(E)); break; }
    o = wpt; lastK = kBest;
  }
  if (rec) {
    let r5 = 5u * slot;
    if ((flags & 8u) != 0u) {                        // P.gpuEmitDump (tests): the sampled ray instead of the hit record
      rayOut[r5] = bitcast<u32>(ray.d.x); rayOut[r5 + 1u] = bitcast<u32>(ray.d.y); rayOut[r5 + 2u] = bitcast<u32>(ray.d.z); rayOut[r5 + 3u] = bitcast<u32>(ray.o.x); rayOut[r5 + 4u] = bitcast<u32>(ray.o.y); return;
    }
    rayOut[r5] = u32(firstK + 1); rayOut[r5 + 1u] = hitRec;
    rayOut[r5 + 2u] = bitcast<u32>(hu); rayOut[r5 + 3u] = bitcast<u32>(hv); rayOut[r5 + 4u] = bitcast<u32>(he);
  }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  for (var q = li; q < 2u * WLS; q += 64u) { atomicStore(&wl[q], 0u); }
  workgroupBarrier();
  if (gid.x < prm[P_COUNT]) { traceRay(prm[P_I0] + gid.x, prm[P_I0] + gid.x - prm[P_BASE]); }
  workgroupBarrier();
  for (var sl = li; sl < WLS; sl += 64u) {
    let lo = atomicLoad(&wl[2u * sl]); let hi = atomicLoad(&wl[2u * sl + 1u]);
    add64(2u * sl, lo); if (hi > 0u) { atomicAdd(&acc[2u * sl + 1u], hi); }
  }
}
`;

  // ---------------------------------------------------------------- device
  const st = { device: null, pipeline: null, init: null, lost: false, info: null };
  const has = () => typeof navigator !== 'undefined' && !!navigator.gpu;
  function init() {
    if (st.init) return st.init;
    st.init = (async () => {
      try {
        if (!has()) return false;
        const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!ad) return false;
        const lim = ad.limits; st.limits = { maxBufferSize: lim.maxBufferSize, maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize };
        const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize, maxBufferSize: lim.maxBufferSize } });
        dev.lost.then(() => { st.lost = true; st.device = null; st.pipeline = null; st.init = null; });
        const mod = dev.createShaderModule({ code: WGSL });
        const ci = mod.getCompilationInfo ? await mod.getCompilationInfo() : { messages: [] };
        const errs = ci.messages.filter((m) => m.type === 'error');
        if (errs.length) throw new Error('WGSL: ' + errs.map((m) => m.lineNum + ': ' + m.message).join('; '));
        st.pipeline = await dev.createComputePipelineAsync({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        st.device = dev; st.lost = false;
        const info = ad.info || {}; st.info = { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '' };
        return true;
      } catch (e) { st.error = String(e && e.message || e); st.init = null; return false; }
    })();
    return st.init;
  }
  const ready = () => !!(st.device && st.pipeline && !st.lost);

  function supports(P) {
    if (P.recordExit) return 'exit-ray lists (recordExit) are CPU only';
    if (P.ffStreams && P.ffStreams.length > MAXFF) return 'more than ' + MAXFF + ' far-field streams';
    if (P.G.n >= 0x7fffffff) return 'too many surfaces';
    return true;
  }

  // ---------------------------------------------------------------- packing (per prepared scene: geometry; per call: aux)
  const fix32 = (x) => Math.min(4294967295, Math.max(0, Math.round(x * 4294967296)));   // a cdf value as the u32 the GPU compares draws with
  const f32safe = (x) => (x === Infinity ? BIG : x === -Infinity ? -BIG : x !== x ? 0 : x);
  function geometry(P) {
    if (P._gpuGeo && P._gpuGeo.device === st.device) return P._gpuGeo;
    const G = P.G, dev = st.device, n = Math.max(1, G.n);
    const surf = new Float32Array(n * STRIDE); for (let i = 0; i < G.n * STRIDE; i++) surf[i] = f32safe(G.D[i]);
    const poly = Float32Array.from(G.poly, f32safe);
    const b = G.bvh, M = Math.max(1, b.M || 0);
    const bf = new Float32Array(6 * M), bi = new Int32Array(4 * M + Math.max(1, b.items ? b.items.length : 0));
    // boxes rounded outward (f32) and padded a little: a box must never be tighter than its surface
    const pad = 1e-6 * P.scale;
    for (let k = 0; k < (b.M || 0); k++) {
      for (let a = 0; a < 3; a++) { const lo = b.bmin[3 * k + a], hi = b.bmax[3 * k + a]; bf[6 * k + a] = Math.fround(lo - pad - 1e-6 * Math.abs(lo)); bf[6 * k + 3 + a] = Math.fround(hi + pad + 1e-6 * Math.abs(hi)); }
      bi[4 * k] = b.left[k]; bi[4 * k + 1] = b.right[k]; bi[4 * k + 2] = b.start[k]; bi[4 * k + 3] = b.count[k];
    }
    if (b.items) bi.set(b.items, 4 * M);
    if (!G.n) { bi[0] = -1; bi[2] = 0; bi[3] = 0; }
    const buf = (arr) => { const B = dev.createBuffer({ size: Math.max(16, arr.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(B, 0, arr); return B; };
    P._gpuGeo = { device: dev, surf: buf(surf), poly: buf(poly), bvhF: buf(bf), bvhI: buf(bi), itemsOff: 4 * M };
    return P._gpuGeo;
  }
  // the sampler(s) as 32-word blocks (+ gaussian tables, + the emitter cdf for a mixture)
  function packSource(P, out) {
    const parts = P.S.mix ? P.S.parts : [P.S], base = out.length, tables = [];
    for (const S of parts) {
      const w = new Array(32).fill(0), fr = S.fr;
      w[0] = S.kind === 'planar' ? 1 : S.kind === 'volume' ? 2 : 0;
      w[1] = S.shape === 'disc' ? 1 : S.shape === 'sphere' ? 2 : S.shape === 'cylinder' ? 3 : 0;
      w[2] = S.dist === 'lambertian' ? 0 : S.dist === 'gaussian' ? 1 : 2;
      w[3] = S.opaque ? 1 : 0; w[4] = S.dome ? 1 : 0;
      w[6] = S.table ? S.N : 0;
      const F = (i, x) => { w[i] = { f: Math.fround(f32safe(x)) }; };
      for (let i = 0; i < 3; i++) { F(7 + i, S.pos[i]); F(10 + i, fr.u[i]); F(13 + i, fr.v[i]); F(16 + i, fr.a[i]); }
      F(19, S.w || 0); F(20, S.h || 0); F(21, S.R || 0); F(22, S.L || 0); F(23, S.cosMax); F(24, S.tm); F(25, S.pSide || 0);
      if (S.dome) { F(26, S.dome.r); F(27, S.dome.n); F(28, S.dome.z); }
      tables.push(S.table || null); out.push(...w);
    }
    if (P.S.mix) for (let i = 0; i <= parts.length; i++) out.push({ f: P.S.cdf[i] });
    tables.forEach((t, k) => { if (!t) return; out[base + 32 * k + 5] = out.length; for (let i = 0; i < t.length; i++) out.push(fix32(t[i])); });
    return { base, n: parts.length };
  }
  const toU32 = (list) => { const u = new Uint32Array(Math.max(4, list.length)), f = new Float32Array(1), fu = new Uint32Array(f.buffer); for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === 'object') { f[0] = x.f; u[i] = fu[0]; } else u[i] = x >>> 0; } return u; };

  // accumulator layout for a context
  function layout(ctx) {
    const P = ctx.P, n = Math.max(1, P.G.n), cells = P.res * P.res, L = { size: 2 * WLS };
    const take = (k) => { const o = L.size; L.size += k; return o; };
    L.gd = take(2 * cells); L.gr = take(2 * cells); L.sin = take(2 * n); L.blk = take(2 * n); L.out1 = take(2 * n);
    L.ff = (ctx.ff || []).map((S) => ({ E: take(2 * S.nh * S.nv), E2: take(2 * S.nh * S.nv) }));
    if (ctx.gl) { L.glh = take(ctx.gl.H.length); L.glhn = take(NB); } else { L.glh = 0; L.glhn = 0; }
    return L;
  }

  // ---------------------------------------------------------------- one range of rays, merged into ctx
  let queue = Promise.resolve();
  function traceRange(ctx, i0, i1) {
    const run = queue.then(() => traceRangeNow(ctx, i0, i1));
    queue = run.catch(() => {});
    return run;
  }
  async function traceRangeNow(ctx, i0, i1) {
    if (!ready() && !(await init())) throw new Error('WebGPU is not available' + (st.error ? ': ' + st.error : ''));
    const P = ctx.P, ok = supports(P); if (ok !== true) throw new Error('GPU trace: ' + ok);
    // the first pathLimit rays keep their polylines: traced on the CPU, exactly as before
    if (i0 < ctx.pathLimit) { const c1 = Math.min(i1, ctx.pathLimit); RF.Engine.traceRange(ctx, i0, c1); i0 = c1; }
    if (i1 <= i0) return;
    const dev = st.device, geo = geometry(P), L = layout(ctx), count = i1 - i0;
    // aux: sampler, guides, streams
    const aux = [], src = packSource(P, aux);
    const guides = (P.guides || []).filter((g) => g.to > i0 && g.from < i1), gOff = aux.length;
    for (let k = 0; k < guides.length; k++) aux.push(0, 0, 0, 0);
    guides.forEach((g, k) => {
      aux[gOff + 4 * k] = g.from; aux[gOff + 4 * k + 1] = g.to;
      aux[gOff + 4 * k + 2] = aux.length; for (let b = 0; b <= NB; b++) aux.push(fix32(g.cdf[b]));
      aux[gOff + 4 * k + 3] = aux.length; for (let b = 0; b < NB; b++) aux.push({ f: g.q[b] });
    });
    const ffOff = aux.length;
    (ctx.ff || []).forEach((S, s) => {
      const w = new Array(16).fill(0);
      w[0] = S.finite ? 1 : 0; w[1] = S.conv === 'B' ? 1 : S.conv === 'S' ? 2 : 0; w[2] = S.nh; w[3] = S.nv; w[4] = L.ff[s].E; w[5] = L.ff[s].E2;
      w[9] = { f: S.finite ? S.X : 0 }; for (let i = 0; i < 3; i++) w[10 + i] = { f: S.c[i] }; w[13] = { f: S.h0 }; w[14] = { f: S.v0 }; w[15] = { f: S.step };
      aux.push(...w);
    });
    const T = P.T, gl = ctx.gl;
    const prm = new Array(64).fill(0), F = (i, x) => { prm[i] = { f: x }; };
    prm[2] = P.seed | 0; prm[3] = P.G.n; prm[4] = P.cap; prm[5] = P.res;
    prm[6] = (P.recordHits || P.gpuEmitDump ? 1 : 0) | (P.S.mix ? 2 : 0) | (gl ? 4 : 0) | (P.gpuEmitDump ? 8 : 0);
    prm[7] = (ctx.ff || []).length; prm[8] = guides.length; prm[9] = src.base; prm[10] = gOff; prm[11] = ffOff; prm[12] = geo.itemsOff;
    prm[13] = L.gd; prm[14] = L.gr; prm[15] = L.sin; prm[16] = L.blk; prm[17] = L.out1; prm[18] = L.glh; prm[19] = L.glhn;
    if (gl) { prm[20] = gl.kc; prm[21] = gl.nci; prm[22] = gl.NC; prm[23] = gl.nh; }
    prm[24] = src.n; prm[25] = i0; prm[26] = (P.seed ^ 0x6f9e5d3) | 0;
    F(32, P.floor); F(33, Math.max(1e-7 * P.scale, P.eps)); F(34, 1e-4 * P.scale);
    for (let i = 0; i < 3; i++) { F(36 + i, T.C[i]); F(39 + i, T.n[i]); F(42 + i, T.tu[i]); F(45 + i, T.tv[i]); }
    F(48, T.half);

    const t0 = RF.U.now();
    const auxB = dev.createBuffer({ size: 4 * Math.max(4, aux.length), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(auxB, 0, toU32(aux));
    const accB = dev.createBuffer({ size: 4 * L.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const rec = P.recordHits || P.gpuEmitDump, recB = dev.createBuffer({ size: rec ? 20 * count : 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const accR = dev.createBuffer({ size: 4 * L.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const recR = rec ? dev.createBuffer({ size: 20 * count, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
    const enc = dev.createCommandEncoder(), tmp = [];
    enc.clearBuffer(accB);
    for (let a = i0; a < i1; a += CHUNK) {
      const n = Math.min(CHUNK, i1 - a); prm[0] = a; prm[1] = n;
      const pB = dev.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(pB, 0, toU32(prm)); tmp.push(pB);
      const bg = dev.createBindGroup({ layout: st.pipeline.getBindGroupLayout(0), entries: [pB, geo.surf, geo.poly, geo.bvhF, geo.bvhI, auxB, accB, recB].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const pass = enc.beginComputePass(); pass.setPipeline(st.pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
    }
    enc.copyBufferToBuffer(accB, 0, accR, 0, 4 * L.size);
    if (recR) enc.copyBufferToBuffer(recB, 0, recR, 0, 20 * count);
    dev.queue.submit([enc.finish()]);
    await accR.mapAsync(GPUMapMode.READ); if (recR) await recR.mapAsync(GPUMapMode.READ);
    const A = new Uint32Array(accR.getMappedRange()), Rr = recR ? new Uint32Array(recR.getMappedRange()) : null;
    if (P.gpuEmitDump) { ctx.emitDump = new Float32Array(Rr.slice().buffer); merge(ctx, L, A, null, i0, count); } else merge(ctx, L, A, Rr, i0, count);
    accR.unmap(); if (recR) recR.unmap();
    for (const b of [auxB, accB, recB, accR, recR].concat(tmp)) if (b) b.destroy();
    ctx.gpuMs = (ctx.gpuMs || 0) + RF.U.now() - t0;
  }

  // the integer sums → the context's floating-point accumulators (one ray's emitted energy = P.power / ctx.N)
  function merge(ctx, L, A, Rr, i0, count) {
    const P = ctx.P, e0 = P.power / ctx.N, k1 = e0 / Q1, k2 = e0 * e0 / Q2, E = ctx.E;
    const v64 = (o) => A[o + 1] * 4294967296 + A[o];
    LEDGER.forEach((name, s) => { E[name] += v64(2 * s) * k1; });
    ctx.occ.blocked += v64(26) * k1; ctx.occ.out1 += v64(28) * k1;
    const add = (arr, off, k) => { for (let i = 0, n = arr.length; i < n; i++) { const o = off + 2 * i; if (A[o] || A[o + 1]) arr[i] += v64(o) * k; } };
    add(ctx.gridD, L.gd, k1); add(ctx.gridR, L.gr, k1);
    if (P.G.n) { add(ctx.surfIn, L.sin, k1); add(ctx.occ.blockedK, L.blk, k1); add(ctx.occ.out1K, L.out1, k1); }
    (ctx.ff || []).forEach((S, s) => {
      add(S.E, L.ff[s].E, k1); add(S.E2, L.ff[s].E2, k2);
      const w = 2 * (LED + 3 * s); S.lm += v64(w) * k1; S.lmExit += v64(w + 2) * k1; S.rays += v64(w + 4);
    });
    if (ctx.gl) { const H = ctx.gl.H, Hn = ctx.gl.Hn; for (let i = 0; i < H.length; i++) if (A[L.glh + i]) H[i] += A[L.glh + i]; for (let b = 0; b < NB; b++) Hn[b] += A[L.glhn + b]; }
    if (Rr) {
      const f = new Float32Array(Rr.buffer, Rr.byteOffset, Rr.length);
      for (let r = 0; r < count; r++) {
        const q = 5 * r, i = i0 + r;
        if (ctx.rayK) ctx.rayK[i] = Rr[q];
        if (Rr[q + 1] && ctx.hits && ctx.nHits < ctx.hitCap) {
          const h = ctx.nHits++, p = 3 * h; ctx.hits[p] = f[q + 2]; ctx.hits[p + 1] = f[q + 3]; ctx.hits[p + 2] = f[q + 4] * e0;
          ctx.hitK[h] = Rr[q]; ctx.hitB[h] = Rr[q + 1] - 1; ctx.hitI[h] = i;
        }
      }
    }
  }

  // ---------------------------------------------------------------- progressive (page loop): one batch in flight
  function step(ctx, batch, onDone) {
    if (ctx.done) return true;
    if (ctx._gpuBusy) return false;
    const i0 = ctx.next, i1 = Math.min(ctx.N, i0 + Math.max(1, batch | 0)), t0 = RF.U.now();
    ctx._gpuBusy = true;
    traceRange(ctx, i0, i1).then(() => {
      ctx.next = i1; ctx.elapsed += RF.U.now() - t0; ctx.done = ctx.next >= ctx.N; ctx._gpuBusy = false;
      if (onDone) onDone(null);
    }, (err) => { ctx._gpuBusy = false; ctx.gpuError = String(err && err.message || err); if (onDone) onDone(err); });
    return false;
  }

  // the user's choice (Simulation → Advanced → GPU trace, remembered per browser): a property of the machine, not the scene.
  // Never chosen → ON wherever WebGPU exists (it only runs once an adapter was obtained: use() needs ready()); '0' stays off.
  function userChoice() { try { const v = typeof localStorage !== 'undefined' ? localStorage.getItem('flux/gpu') : null; return v === '1' ? true : v === '0' ? false : null; } catch (e) { return null; } }
  function pref() { const c = userChoice(); return c === null ? has() : c; }
  function setPref(on) { try { localStorage.setItem('flux/gpu', on ? '1' : '0'); } catch (e) { /* ignore */ } }
  /* Per-device ray cap, pure: env = { gpu: bool, limits: adapter limits, deviceMemory: GB (navigator.deviceMemory, Chrome only, ≤ 8),
   * mobile: bool } → { cap: rays per trace (Infinity = none), batch: most rays in one GPU call, why }.  Each signal can only lower
   * the cap.  The numbers are judgement, not measurements of any phone: 150 k on a touch-first device, 100 k / 250 k at ≤ 2 / ≤ 4 GB
   * reported memory, 250 k when the storage-buffer limit is the WebGPU spec's default floor (128 MiB).  A call allocates the
   * accumulator plus 2 × 20 B/ray of hit records, so the batch is kept to a twentieth of the smaller buffer limit (≥ 64 k, ≤ 8 M). */
  function rayCap(env) {
    env = env || {}; const lim = env.gpu ? env.limits || null : null, mem = +env.deviceMemory || 0;
    let cap = Infinity, why = ''; const take = (c, w) => { if (c < cap) { cap = c; why = w; } };
    if (env.mobile) take(150000, 'touch device');
    if (mem > 0 && mem <= 2) take(100000, mem + ' GB device memory'); else if (mem > 0 && mem <= 4) take(250000, mem + ' GB device memory');
    const bind = lim ? Math.min(lim.maxStorageBufferBindingSize || Infinity, lim.maxBufferSize || Infinity) : Infinity;
    if (bind <= 134217728) take(250000, 'GPU buffer limit ' + Math.round(bind / 1048576) + ' MiB');
    let batch = isFinite(bind) ? Math.max(65536, Math.min(8e6, Math.floor(bind / 40))) : 8e6;
    if (env.mobile) batch = Math.min(batch, 262144);
    return { cap, batch, why };
  }
  function deviceEnv() {
    const n = typeof navigator !== 'undefined' ? navigator : {}, mm = (q) => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch (e) { return false; } };
    const mobile = !!(n.userAgentData && n.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(n.userAgent || '') || (mm('(pointer: coarse)') && !mm('(hover: hover)'));
    return { gpu: !!st.limits, limits: st.limits, deviceMemory: n.deviceMemory, mobile };
  }
  // this device's cap, and the user's override (Simulation → Advanced; localStorage flux/rayCap = 'off', per browser)
  function rayLimit() { const r = rayCap(deviceEnv()); let off = false; try { off = typeof localStorage !== 'undefined' && localStorage.getItem('flux/rayCap') === 'off'; } catch (e) { /* ignore */ } return Object.assign(r, { off }); }
  function setRayCapOff(off) { try { localStorage.setItem('flux/rayCap', off ? 'off' : 'on'); } catch (e) { /* ignore */ } }
  const capRays = (n) => { const r = rayLimit(); return r.off ? n : Math.min(n, r.cap); };
  const batchMax = () => rayLimit().batch;
  // on: the page follows the preference; a worker (no localStorage) is switched by its host per request (enable)
  let forced = null;
  const enable = (on) => { forced = on === null || on === undefined ? null : !!on; };
  const on = () => (forced !== null ? forced : pref());
  // the page loop's question: trace this context on the GPU now?
  const use = (ctx) => on() && ready() && !ctx.gpuError && supports(ctx.P) === true;

  RF.GpuTrace = { init, ready, supports, traceRange, step, use, on, enable, pref, userChoice, setPref, rayCap, rayLimit, setRayCapOff, capRays, batchMax, info: () => st.info, error: () => st.error || null, available: has, WGSL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
