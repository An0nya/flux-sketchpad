/* shell.js — the base shell: where along its own ray from the LED every facet sits.
 *
 * A facet's aim and the light it catches depend on DIRECTIONS only, so sliding it along its own ray (a scale about the LED) changes neither: a facet moved out by ρ keeps its normal,
 * its cell and its flux; its LED image shrinks as 1/ρ, and the surface stops being one continuous piece (neighbours meet with small steps).  A SHELL is a radius for every direction,
 * r(u); the facet of a cell is put at r(u_cell), clamped to what the envelope and the LED clearance allow.  Every shell has a focus at the LED:
 *   conic    r = p / (1 − e·u·T)   e = 0 a sphere about the LED, e < 1 an ellipsoid, e = 1 a paraboloid (focal length p/2), e > 1 a hyperboloid;  T = the direction the beam leaves,
 *            i.e. from the vertex through the LED
 *   plane    r = p / (−u·T)        a flat plate p mm behind the LED, perpendicular to T
 *   wall     the inside of the envelope (a hair short of it)
 *   natural  the SQM surface itself (ρ = 1, one continuous piece)
 *   RF.SqmShell = { frame, radiusFn, rhoFor, choose, fitConic, steps, KINDS }                                                                                                  */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, C = RF.SqmCore;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const KINDS = ['natural', 'fit', 'paraboloid', 'sphere', 'conic', 'plane', 'wall'];
  const MARGIN = 0.97;                                                         // a facet is never put closer than 3 % to the wall along its ray — nor pulled in from where the natural surface already has it

  // per main facet: the cell-centre direction (as in facetOf), its natural radius, the scale range the envelope and the LED clearance leave it, and its flux
  function frame(D, on, A, x, as) {
    const J = A.length, byJ = A.map(() => []); for (let i = 0; i < D.n; i++) if (on[i] && as.asg[i] >= 0) byJ[as.asg[i]].push(i);
    const F = { J, u: new Array(J).fill(null), rNat: new Float64Array(J), lo: new Float64Array(J), hi: new Float64Array(J).fill(Infinity), flux: new Float64Array(J), live: new Uint8Array(J), tot: 0, aim: [0, 0, 0] };
    for (let j = 0; j < J; j++) {
      const cs = byJ[j]; if (!cs.length) continue;
      let u = [0, 0, 0], W = 0, hi = Infinity, lo = 0; for (const i of cs) { u = V.add(u, V.mul([D.ux[i], D.uy[i], D.uz[i]], D.m[i])); W += D.m[i]; hi = Math.min(hi, D.rEnv[i] / as.rr[i]); lo = Math.max(lo, D.rMin[i] / as.rr[i]); }
      u = V.norm(u); F.u[j] = u; F.rNat[j] = C.radius(A[j], x[j], u); F.flux[j] = W; F.hi[j] = hi; F.lo[j] = lo; F.live[j] = 1; F.tot += W;
      F.aim = V.add(F.aim, V.mul([A[j].ax, A[j].ay, A[j].az], W));
    }
    F.aim = V.norm(F.aim); return F;
  }

  const tilted = (T, dv, dh, conv) => { if (!dv && !dh) return T; const hv = RF.FarField.hvOf(T, conv); return V.norm(RF.FarField.dirOf(hv[0] + dh, hv[1] + dv, conv)); };
  function radiusFn(sh) {
    const T = sh.T || [1, 0, 0];
    if (sh.kind === 'plane') return (u) => { const c = -(u[0] * T[0] + u[1] * T[1] + u[2] * T[2]); return c > 0.05 ? sh.p / c : 0; };
    return (u) => { const c = u[0] * T[0] + u[1] * T[1] + u[2] * T[2], d = 1 - sh.e * c; return d > 0.02 ? sh.p / d : 0; };
  }

  // the scale ρ of every facet for a shell, clamped into [clearance, wall]; info = what the clamping did
  function rhoFor(F, sh, mix) {
    const J = F.J, rho = new Float64Array(J).fill(1), info = { kind: sh.kind, clampedWall: 0, clampedLed: 0, invalid: 0, fluxClamped: 0, depth: 0, rhoMin: Infinity, rhoMax: 0 };
    if (sh.kind === 'natural') { for (let j = 0; j < J; j++) if (F.live[j]) { info.depth = Math.max(info.depth, F.rNat[j]); info.rhoMin = info.rhoMax = 1; } return { rho, info }; }
    const fn = sh.kind === 'wall' ? null : radiusFn(sh);
    for (let j = 0; j < J; j++) {
      if (!F.live[j]) continue;
      const hi = Math.max(1, MARGIN * F.hi[j]), lo = Math.min(1, F.lo[j]); let want = fn ? fn(F.u[j]) / F.rNat[j] : hi;
      if (!(want > 0) || !isFinite(want) || lo > hi) { info.invalid++; info.fluxClamped += F.flux[j]; rho[j] = 1; }
      else if (want > hi) { rho[j] = hi; info.clampedWall++; info.fluxClamped += F.flux[j]; }
      else if (want < lo) { rho[j] = lo; info.clampedLed++; info.fluxClamped += F.flux[j]; }
      else rho[j] = want;
      info.depth = Math.max(info.depth, rho[j] * F.rNat[j]); info.rhoMin = Math.min(info.rhoMin, rho[j]); info.rhoMax = Math.max(info.rhoMax, rho[j]);
    }
    if (mix >= 0 && mix < 1) { info.depth = 0; info.rhoMin = Infinity; info.rhoMax = 0; for (let j = 0; j < J; j++) if (F.live[j]) { rho[j] = 1 + mix * (rho[j] - 1); info.depth = Math.max(info.depth, rho[j] * F.rNat[j]); info.rhoMin = Math.min(info.rhoMin, rho[j]); info.rhoMax = Math.max(info.rhoMax, rho[j]); } }       // mix: how far from the natural surface toward the shell (0 = natural)
    info.shareClamped = F.tot > 0 ? info.fluxClamped / F.tot : 0; return { rho, info };
  }

  // shells linear in p (conic, plane): the largest p at which a share `fill` of the light still has its facet inside [clearance, wall]; none reaches it → the p with the most light inside
  function solveP(F, sh, fill) {
    const base = Object.assign({}, sh, { p: 1 }), fn = radiusFn(base), g = new Float64Array(F.J), lo = new Float64Array(F.J), hi = new Float64Array(F.J), cand = [];
    for (let j = 0; j < F.J; j++) { if (!F.live[j]) continue; const gj = fn(F.u[j]); g[j] = gj; if (!(gj > 0)) continue; lo[j] = Math.min(1, F.lo[j]) * F.rNat[j] / gj; hi[j] = Math.max(1, MARGIN * F.hi[j]) * F.rNat[j] / gj; if (lo[j] <= hi[j]) { cand.push(lo[j], hi[j]); } }
    let best = null; for (const p of cand) { let s = 0; for (let j = 0; j < F.J; j++) if (F.live[j] && g[j] > 0 && p >= lo[j] * 0.9999 && p <= hi[j] * 1.0001) s += F.flux[j]; const share = F.tot > 0 ? s / F.tot : 0;
      if (!best || (share >= fill ? (best.share < fill || p > best.p) : (best.share < fill && (share > best.share + 1e-9 || (Math.abs(share - best.share) <= 1e-9 && p > best.p))))) best = { p, share }; }
    return best || { p: 0, share: 0 };
  }

  // the axis the shell opens along: the beam's mean aim, tilted; the search keeps the tilt that lets the biggest dish through
  const TILTS = (() => { const t = []; for (const dv of [0, 10, -10, 20, -20, 30, -30]) for (const dh of [0, 10, -10]) t.push([dv, dh]); return t; })();
  function choose(F, kind, o) {
    o = Object.assign({ e: 1, p: 0, fill: 0.97, tiltV: null, tiltH: null, conv: 'A' }, o || {});
    if (kind === 'natural' || kind === 'wall') return { kind };
    if (kind === 'fit') return fitConic(F, o);
    const e = kind === 'sphere' ? 0 : kind === 'paraboloid' ? 1 : o.e, shape = kind === 'plane' ? 'plane' : 'conic', T0 = F.aim;
    const tilts = (o.tiltV !== null || o.tiltH !== null) ? [[o.tiltV || 0, o.tiltH || 0]] : kind === 'sphere' ? [[0, 0]] : TILTS;
    let best = null;
    for (const [dv, dh] of tilts) {
      const T = tilted(T0, dv, dh, o.conv), sh = { kind: shape, e, T, p: 1 }, r = o.p > 0 ? (() => { const rr = rhoFor(F, Object.assign({}, sh, { p: o.p })); return { p: o.p, share: 1 - rr.info.shareClamped }; })() : solveP(F, sh, o.fill);
      const ok = r.share >= o.fill, score = (ok ? 1e6 : 0) + (ok ? r.p : r.share * 1e3) - (Math.abs(dv) + Math.abs(dh)) * 1e-3;
      if (!best || score > best.score) best = { score, sh: Object.assign(sh, { p: r.p, tilt: [dv, dh], share: r.share, e }) };
    }
    return best.sh;
  }

  // the conic (focus at the LED) closest to the natural surface in relative radius, weighted by flux: the smoothest imitation of the SQM surface by a simple shell (smallest steps)
  function fitConic(F, o) {
    const T0 = F.aim, live = []; for (let j = 0; j < F.J; j++) if (F.live[j]) live.push(j);
    const err = (v) => { const sh = { kind: 'conic', e: clamp(v[1], 0, 2.5), T: tilted(T0, v[2], v[3], o.conv), p: Math.exp(v[0]) }, fn = radiusFn(sh); let s = 0;
      for (const j of live) { const r = fn(F.u[j]); s += F.flux[j] * (r > 0 ? Math.pow(Math.log(r / F.rNat[j]), 2) : 4); } return s / Math.max(1e-9, F.tot); };
    let best = null;
    for (const e0 of [0, 0.6, 1]) {
      let v = [Math.log(live.reduce((a, j) => a + F.rNat[j], 0) / Math.max(1, live.length)), e0, 0, 0], f = err(v), step = [0.3, 0.3, 8, 8];
      for (let it = 0; it < 80; it++) { let moved = false; for (let k = 0; k < 4; k++) for (const sg of [1, -1]) { const w = v.slice(); w[k] += sg * step[k]; const g = err(w); if (g < f - 1e-12) { v = w; f = g; moved = true; } } if (!moved) { step = step.map((s) => s * 0.5); if (step[0] < 1e-3) break; } }
      if (!best || f < best.f) best = { f, v };
    }
    const v = best.v, sh = { kind: 'conic', e: clamp(v[1], 0, 2.5), T: tilted(T0, v[2], v[3], o.conv), p: Math.exp(v[0]), tilt: [v[2], v[3]], fitErr: Math.sqrt(best.f) };
    const rr = rhoFor(F, sh); sh.share = 1 - rr.info.shareClamped; return sh;
  }

  // the steps between neighbouring facets: along every edge between two cells of different facets, the radial offset of the two surfaces and what it is across the surface (mm)
  function steps(D, on, A, x, as, rho) {
    const NA = D.NA, NP = D.NP, dr = [], dn = []; if (!D.cellOf) return null;
    const rad = (j, w) => (rho ? rho[j] : 1) * C.radius(A[j], x[j], w);
    const edge = (i, k, w) => { const j = as.asg[i], l = as.asg[k]; if (j < 0 || l < 0 || j === l) return; const rj = rad(j, w), rl = rad(l, w); if (!(rj > 0 && rl > 0)) return;
      const d = Math.abs(rj - rl), a = A[j], n = V.norm(V.add(V.mul(w, -1), [a.ax, a.ay, a.az])); dr.push(d); dn.push(d * Math.abs(V.dot(w, n))); };
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const i = D.cellOf[q * NA + a]; if (i < 0 || !on[i]) continue;
      const k1 = D.cellOf[((q + 1) % NP) * NA + a]; if (k1 >= 0 && on[k1]) edge(i, k1, C.corner(D, q + 1, a + 0.5));
      if (a + 1 < NA) { const k2 = D.cellOf[q * NA + a + 1]; if (k2 >= 0 && on[k2]) edge(i, k2, C.corner(D, q + 0.5, a + 1)); }
    }
    const pct = (arr, f) => { if (!arr.length) return 0; const s = arr.slice().sort((p, q) => p - q); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
    return { edges: dr.length, median: pct(dn, 0.5), p95: pct(dn, 0.95), max: dn.length ? Math.max(...dn) : 0, over03: dn.length ? dn.filter((d) => d > 0.3).length / dn.length : 0, radialMax: dr.length ? Math.max(...dr) : 0 };
  }

  const describe = (sh) => sh.kind === 'natural' ? 'natural SQM surface' : sh.kind === 'wall' ? 'envelope wall' : sh.kind === 'plane' ? `plane ${sh.p.toFixed(0)} mm behind the LED` :
    (sh.e === 0 ? `sphere R ${sh.p.toFixed(0)} mm` : Math.abs(sh.e - 1) < 1e-6 ? `paraboloid f ${(sh.p / 2).toFixed(0)} mm` : `conic e ${sh.e.toFixed(2)} p ${sh.p.toFixed(0)} mm`) + (sh.tilt && (sh.tilt[0] || sh.tilt[1]) ? `, axis tilted ${sh.tilt[0].toFixed(0)}° v ${sh.tilt[1].toFixed(0)}° h` : '');
  RF.SqmShell = { KINDS, frame, radiusFn, rhoFor, choose, fitConic, steps, describe, MARGIN };
})();
