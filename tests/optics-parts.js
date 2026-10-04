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
module.exports = { fails: () => fails };
if (require.main === module) { console.log(fails ? fails + ' failed' : 'all passed'); process.exit(fails ? 1 : 0); }
