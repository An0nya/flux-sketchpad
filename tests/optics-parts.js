// Multi-part optics: the conic surface primitive, the aspheric lens, an ellipsoidal reflector, multi-emitter scenes.
const RF = require('./load').load();
const { V } = RF;
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '[PASS] ' : '[FAIL] ') + m + (x !== undefined ? '  — ' + x : '')); if (!c) fails++; };
const base = () => { const s = RF.State.testScene(); s.sim.bounces = 4; s.lenses = []; return s; };

// 1. a conic reflector = the facet ellipsoid: a paraboloid (k = −1) collimates its focus exactly
{
  const f = 10, sc = base();
  const surf = { type: 'rev', id: 'p', O: [0, 0, 0], W: [0, 0, 1], seg: { kind: 'conic', zv: -f, R: 2 * f, k: -1, r0: 2, r1: 30 }, front: -1, optics: { interaction: 'reflect', reflectivity: 1 } };
  const P = RF.Engine.prepare(sc, [surf]);
  let worst = 0, hits = 0;
  for (let i = 0; i < 200; i++) {
    const th = (5 + 80 * i / 200) * Math.PI / 180, ph = i * 2.4, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), -Math.cos(th)];
    const ev = RF.Engine.probeRay(P, [0, 0, 0], d).events.find((e) => e.type === 'reflect');
    if (!ev) continue; hits++; worst = Math.max(worst, Math.acos(Math.min(1, ev.dOut[2])) * 180 / Math.PI);
  }
  ok(hits > 150 && worst < 1e-6, 'conic k = −1 (paraboloid) collimates its focus', hits + ' rays, worst ' + worst.toExponential(2) + '°');
}
// 2. an ellipsoid (k ∈ (−1, 0)) images focus 1 onto focus 2 exactly
{
  const a = 40, c = 25, b = Math.sqrt(a * a - c * c), R = b * b / a, k = -(c * c) / (a * a), sc = base();
  // vertex at z = −(a − c) below focus 1 (origin); focus 2 at z = 2c
  const surf = { type: 'rev', id: 'e', O: [0, 0, 0], W: [0, 0, 1], seg: { kind: 'conic', zv: -(a - c), R, k, r0: 1, r1: 0.95 * b }, front: -1, optics: { interaction: 'reflect', reflectivity: 1 } };
  const P = RF.Engine.prepare(sc, [surf]);
  let worst = 0, hits = 0;
  for (let i = 0; i < 200; i++) {
    const th = (100 + 70 * i / 200) * Math.PI / 180, ph = i * 2.4, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const ev = RF.Engine.probeRay(P, [0, 0, 0], d).events.find((e) => e.type === 'reflect');
    if (!ev) continue; hits++;
    // distance of the reflected ray's line from focus 2
    const F2 = [0, 0, 2 * c], w = V.sub(F2, ev.point), t = V.dot(w, ev.dOut), miss = V.len(V.sub(w, V.mul(ev.dOut, t)));
    worst = Math.max(worst, miss);
  }
  ok(hits > 150 && worst < 1e-9 * 100, 'conic ellipsoid images focus 1 onto focus 2', hits + ' rays, worst miss ' + worst.toExponential(2) + ' mm');
}
// 3. the aspheric lens collimates a point at its focus exactly (a spherical plano-convex does not)
{
  const run = (kind) => {
    const sc = base(); sc.source = Object.assign(sc.source, { kind: 'point', pos: [0, 0, 0], axis: [0, 0, 1] });
    sc.lenses = [{ id: 'l1', kind, params: Object.assign(RF.Lenses.defaults(kind), { axisMode: 'z', f: 40, a: 18 }) }];
    const P = RF.Engine.prepare(sc, RF.Lenses.buildAll(sc).surfaces);
    let worst = 0, n = 0;
    for (let i = 1; i <= 100; i++) {
      const th = Math.atan2(17 * i / 100, 40), d = [Math.sin(th), 0, Math.cos(th)];
      const ev = RF.Engine.probeRay(P, [0, 0, 0], d).events.filter((e) => e.type === 'refract');
      if (ev.length < 2) continue; n++;
      const out = ev[ev.length - 1].dOut; worst = Math.max(worst, Math.atan2(Math.hypot(out[0], out[1]), out[2]) * 180 / Math.PI);
    }
    return { worst, n };
  };
  const as = run('asphere'), pc = run('planoconvex');
  ok(as.n >= 85 && as.worst < 1e-6 && pc.worst > 100 * as.worst, 'aspheric lens: exact collimation on axis (spherical plano-convex for scale)', as.n + ' rays, asphere ' + as.worst.toExponential(2) + '°, spherical ' + pc.worst.toFixed(3) + '°');
}
// 4. conic zones survive JSON and compile identically
{
  const s = { type: 'rev', id: 'c', O: [1, 2, 3], W: [0.2, 0.1, 1], seg: { kind: 'conic', zv: -5, R: 12, k: -0.4, r0: 0, r1: 9 }, front: 1, optics: { interaction: 'refract', ior: 1.5, fresnelT: 0.96 } };
  const a = RF.Geo.compile([s]), b = RF.Geo.compile([JSON.parse(JSON.stringify(s))]);
  ok(RF.hash.f64([a.D]) === RF.hash.f64([b.D]), 'conic zone: JSON round trip compiles byte-identically');
}
// 5. multi-emitter: single-emitter runs are unchanged; power splits rays by power; disabled emitters are ignored
{
  const sc = RF.State.testScene(); sc.sim.rays = 20000;
  const run = (s) => { const P = RF.Engine.prepare(s, []); return RF.Engine.runSync(P, 20000); };
  const h0 = RF.Engine.gridHash(run(sc));
  const s1 = RF.State.deserialize(RF.State.serialize(sc)); s1.emitters = [Object.assign(RF.U.deepCopy(sc.source), { id: 'e2', power: 3000, enabled: false })];
  ok(RF.Engine.gridHash(run(s1)) === h0, 'a disabled extra emitter leaves the run byte-identical');
  // two emitters 1000 lm (left, aimed at the target) and 3000 lm (right, aimed away): direct light on target ≈ 1000 / 4000 of the rays
  const s2 = RF.State.deserialize(RF.State.serialize(sc));
  Object.assign(s2.source, { pos: [0, 50, 0], axis: [1, 0, 0], power: 1000 });
  s2.emitters = [Object.assign(RF.U.deepCopy(s2.source), { id: 'e2', pos: [0, -50, 0], axis: [-1, 0, 0], power: 3000 })];
  const c = run(s2), P2 = c.P;
  ok(Math.abs(P2.power - 4000) < 1e-9 && Math.abs(c.E.emitted - 4000) < 1e-6, 'power = sum of emitters, and every ray carries the same energy', P2.power + ' lm');
  const share = c.E.direct / c.E.emitted, frac = 1000 / 4000;
  // the forward emitter's light that lands = its share × its own on-target fraction (traced alone)
  const s3 = RF.State.deserialize(RF.State.serialize(s2)); s3.emitters = []; const c3 = run(s3), alone = c3.E.direct / c3.E.emitted;
  ok(Math.abs(share - frac * alone) < 4 * Math.sqrt(frac * alone / 20000), 'rays split by power between emitters', 'landed ' + share.toFixed(4) + ' vs ' + (frac * alone).toFixed(4));
  const inp = RF.Solvers.inputOf(s2);
  ok(inp.sources.length === 2 && inp.source.power === 1000 && inp.sources[1].power === 3000, 'solvers see input.sources (input.source stays the first)');
  const back = RF.State.deserialize(RF.State.serialize(s2));
  ok(back.emitters.length === 1 && back.emitters[0].power === 3000, 'emitters survive save / load; older files load with none', JSON.stringify(RF.State.deserialize(JSON.stringify({ source: sc.source })).emitters));
}
// 6. solver contract: lens / shield parts don't count against the facet budget; needs.bounces is reported
{
  const sc = RF.State.testScene(); sc.modeA.budget = 2;
  const L = RF.Lenses.build(Object.assign({}, sc, { lenses: [] }), { id: 'x', kind: 'asphere', params: Object.assign(RF.Lenses.defaults('asphere'), { axisMode: 'z', f: 30, a: 10 }) }).surfaces;
  const f = RF.Solvers.verify(sc, { surfaces: L.map((s, i) => Object.assign({}, s, { id: 'L' + i })), needs: { bounces: 3 } });
  ok(f.placed === 0 && f.parts === L.length && !f.violations.budget && f.needsBounces === 3, 'lens parts are free of the facet budget; needs.bounces reported', f.placed + ' facets, ' + f.parts + ' parts');
}
// 7. quad: a general quadric patch for any interaction
{
  const sc = base(), R = 25;
  // a sphere written as a quad (cx = cy = cz = 1/R) matches the rev arc of the same sphere, hit for hit
  const q = { type: 'quad', id: 'q', P: [0, 0, 0], n: [0, 0, 1], curv: [1 / R, 1 / R, 0, 1 / R], front: -1, clip: { kind: 'disc', r: 15 }, optics: { interaction: 'reflect', reflectivity: 1 } };
  const a = { type: 'rev', id: 'a', O: [0, 0, 0], W: [0, 0, 1], seg: { kind: 'arc', zc: R, R, z0: 0, z1: R - Math.sqrt(R * R - 225), rmax: 15 }, front: 1, optics: { interaction: 'reflect', reflectivity: 1 } };
  const Pq = RF.Engine.prepare(sc, [q]), Pa = RF.Engine.prepare(sc, [a]);
  let worst = 0, n = 0;
  for (let i = 0; i < 100; i++) {
    const o = [(i % 10 - 4.5) * 2.5, (Math.floor(i / 10) - 4.5) * 2.5, -30], d = V.norm([0.05 * Math.sin(i), 0.04 * Math.cos(i), 1]);
    const e1 = RF.Engine.probeRay(Pq, o, d).events[0], e2 = RF.Engine.probeRay(Pa, o, d).events[0];
    if (!e1 || !e2 || e1.type !== 'reflect') continue; n++;
    worst = Math.max(worst, V.dist(e1.point, e2.point), V.len(V.sub(e1.dOut, e2.dOut)));
  }
  ok(n > 60 && worst < 1e-9, 'quad sphere (curv) = rev arc sphere, hit for hit', n + ' rays, worst ' + worst.toExponential(2));
  // the explicit quadric form compiles to the same surface as the curvature form
  const q2 = Object.assign({}, q, { curv: undefined, quadric: { A: [0.5 / R, 0.5 / R, 0.5 / R, 0, 0, 0], b: [0, 0, -1] } });
  ok(RF.hash.f64([RF.Geo.compile([q]).D]) === RF.hash.f64([RF.Geo.compile([q2]).D]), 'quad: quadric form = curvature form');
  // a cylindrical lenslet (curved in x only, glass behind, flat back) focuses a collimated beam to a LINE: x converges, y doesn't
  const f = 40, n0 = 1.5, c = 1 / ((n0 - 1) * f);       // plano-convex thin lens: 1/f = (n − 1) c
  const lens = [
    { type: 'quad', id: 'c1', P: [0, 0, 0], n: [0, 0, -1], ref: [1, 0, 0], curv: [-c, 0, 0, 0], clip: { kind: 'rect', hx: 6, hy: 6 }, optics: { interaction: 'refract', ior: n0, fresnelT: 1 } },
    { type: 'plane', id: 'c2', P: [0, 0, 2], n: [0, 0, 1], clip: { kind: 'rect', hx: 8, hy: 8 }, optics: { interaction: 'refract', ior: n0, fresnelT: 1 } },
  ];
  const Pl = RF.Engine.prepare(sc, lens);
  let ax = 0, ay = 0, m = 0;
  for (let i = 0; i < 25; i++) {
    const o = [(i % 5 - 2) * 0.8, (Math.floor(i / 5) - 2) * 2, -10], ev = RF.Engine.probeRay(Pl, o, [0, 0, 1]).events.filter((e) => e.type === 'refract');
    if (ev.length < 2) continue; m++;
    const p = ev[1].point, d = ev[1].dOut, t = (f - p[2]) / d[2];
    ax = Math.max(ax, Math.abs(p[0] + t * d[0])); ay = Math.max(ay, Math.abs(Math.atan2(d[1], d[2])));
  }
  ok(m === 25 && ax < 0.05 && ay < 1e-12, 'quad toric: a cylindrical lenslet focuses x to a line at f, leaves y collimated', 'x spread at f ' + ax.toFixed(4) + ' mm, y angle ' + ay.toExponential(1));
}
// 8. material-aware refraction (iorFront): index-matched contact is invisible; Snell between two glasses; TIR at their critical angle
{
  const sc = base(), slab = (z, nF, nB, id) => ({ type: 'plane', id, P: [0, 0, z], n: [0, 0, -1], clip: { kind: 'rect', hx: 50, hy: 50 }, optics: { interaction: 'refract', ior: nB, iorFront: nF, fresnelT: 1 } });
  const th = 30 * Math.PI / 180, d = [Math.sin(th), 0, Math.cos(th)];
  // air → 1.5 at z = 0, then a 1.5 | 1.5 contact at z = 5 (cemented, same glass), then 1.5 → air out the back at z = 10
  const back = { type: 'plane', id: 'b', P: [0, 0, 10], n: [0, 0, 1], clip: { kind: 'rect', hx: 50, hy: 50 }, optics: { interaction: 'refract', ior: 1.5, fresnelT: 1 } };
  const Pm = RF.Engine.prepare(sc, [slab(0, 1, 1.5, 'a'), slab(5, 1.5, 1.5, 'm'), back]);
  const evm = RF.Engine.probeRay(Pm, [0, 0, -5], d).events.filter((e) => e.type === 'refract');
  const mid = evm[1], out = evm[evm.length - 1];
  ok(evm.length === 3 && V.len(V.sub(mid.dIn, mid.dOut)) < 1e-12 && V.len(V.sub(out.dOut, d)) < 1e-12, 'index-matched contact (1.5 | 1.5) is invisible; the slab exits parallel');
  // 1.5 → 1.7 inside glass: n1 sinθ1 = n2 sinθ2
  const Pg = RF.Engine.prepare(sc, [slab(0, 1, 1.5, 'a'), slab(5, 1.5, 1.7, 'g')]);
  const e2 = RF.Engine.probeRay(Pg, [0, 0, -5], d).events[1], s1 = Math.hypot(e2.dIn[0], e2.dIn[1]), s2 = Math.hypot(e2.dOut[0], e2.dOut[1]);
  ok(Math.abs(1.5 * s1 - 1.7 * s2) < 1e-12, 'glass | glass Snell (1.5 → 1.7)', (1.5 * s1).toFixed(12) + ' = ' + (1.7 * s2).toFixed(12));
  // 1.5 → 1.4 beyond asin(1.4/1.5) = 69.0°: TIR; below it: refracts
  const Pt = RF.Engine.prepare(sc, [{ type: 'plane', id: 't', P: [0, 0, 0], n: [0, 0, 1], clip: { kind: 'rect', hx: 50, hy: 50 }, optics: { interaction: 'refract', ior: 1.5, iorFront: 1.4, fresnelT: 1 } }]);
  const at = (deg) => RF.Engine.probeRay(Pt, [0, 0, -5], [Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)]).events[0].type;
  ok(at(68.5) === 'refract' && at(69.5) === 'tir', 'TIR between two glasses at their own critical angle', '68.5° ' + at(68.5) + ', 69.5° ' + at(69.5));
}
// 9. exact Fresnel: 4 % reflected at normal incidence on n = 1.5, energy kept, deterministic, retrace = trace
{
  const sc = base(); sc.source = Object.assign(sc.source, { kind: 'point', pos: [0, 0, 0], axis: [1, 0, 0], dist: 'cone', halfAngle: 0.5 });
  sc.target = Object.assign(sc.target, { distance: 1000, size: 400 });
  const glass = { type: 'plane', id: 'g', P: [50, 0, 0], n: [-1, 0, 0], clip: { kind: 'rect', hx: 30, hy: 30 }, optics: { interaction: 'refract', ior: 1.5, fresnel: 'exact' } };
  const P = RF.Engine.prepare(sc, [glass]), N = 200000, c = RF.Engine.runSync(P, N);
  const R = c.E.fresnelR / c.E.emitted, R0 = 0.04, sd = Math.sqrt(R0 * (1 - R0) / N);
  ok(Math.abs(R - R0) < 4 * sd && c.E.interfaceLoss === 0, 'exact Fresnel reflects R(0°) = 4 % of the rays, no fixed loss', (100 * R).toFixed(3) + ' % ± ' + (100 * sd).toFixed(3));
  ok(RF.Engine.gridHash(RF.Engine.runSync(P, N)) === RF.Engine.gridHash(c), 'exact Fresnel is deterministic (same seed ⇒ same grid)');
  // progressive = one shot
  const P2 = RF.Engine.prepare(sc, [glass]), c2 = RF.Engine.newCtx(P2, N, 0); while (!RF.Engine.step(c2, 5));
  ok(RF.Engine.gridHash(c2) === RF.Engine.gridHash(c), 'exact Fresnel: progressive run = one-shot run');
  let same = 0; const ends = []; for (let i = 0; i < 2000; i++) { const p = RF.Engine.retrace(P, i); ends.push(p.end); }
  const reflected = ends.filter((e) => e === 'escape').length;   // a reflected ray goes back past the source and escapes
  ok(Math.abs(reflected / 2000 - R0) < 0.02, 'retrace replays the same Fresnel draws', reflected + ' of 2000 reflected');
  // default optics still compile with the new slots at 0 (old designs byte-identical)
  const G = RF.Geo.compile([{ type: 'plane', id: 'x', P: [0, 0, 0], n: [0, 0, 1], optics: { interaction: 'refract', ior: 1.5 } }]);
  ok(G.D[36] === 0 && G.D[37] === 0, 'default optics leave the new slots at 0');
}
module.exports = { fails: () => fails };
if (require.main === module) { console.log(fails ? fails + ' failed' : 'all passed'); process.exit(fails ? 1 : 0); }
