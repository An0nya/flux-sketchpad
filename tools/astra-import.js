#!/usr/bin/env node
// Import a design from the /astra/ build into Flux: its scene (LED, envelope, target, paint) and its facets.
//   node tools/astra-import.js <astra-export.json> [--out scene.json] [--regenerate] [--compare] [--rays 1000000]
//
//   --regenerate  run Astra's own solver (astra/js, headless) on the export instead of using the facets it carries
//   --compare     trace the facets in BOTH engines and grade them with Flux's fidelity (a check on the conversion)
//   --out         write the converted scene (Flux format; facets are type 'parab') for tools and tests
//
// Coordinates.  Astra's target faces −z with paint axes u = (−1,0,0), v = (0,1,0); Flux's target faces −x with
// u = (0,−1,0), v = (0,0,1).  Both are right-handed, so ONE rotation maps Astra onto Flux with nothing mirrored:
// (x, y, z) → (z, x, y), then a shift that puts Astra's target centre at Flux's (d, 0, 0).  Paint cells keep their
// index (row = v, column = u in both).  Astra's facet = a paraboloid cap z = r²/(4·focal) about its normal, clipped
// to a width × height rectangle in Astra's frame(normal) → Flux surface type 'parab' with clip.ref = that frame's u.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const file = args.find((a, i) => !a.startsWith('--') && !['--out', '--rays'].includes(args[i - 1]));
if (!file) { console.error('usage: node tools/astra-import.js <astra-export.json> [--out scene.json] [--regenerate] [--compare] [--rays N]'); process.exit(2); }
const RAYS = +opt('rays', 1e6);

// ---- Astra, headless (the same files its own test harness loads)
for (const f of ['math', 'state', 'geometry', 'engine', 'design']) require(path.join(ROOT, 'astra/js', f + '.js'));
const O = globalThis.Optics;
const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
let facets = exp.surfaces || [];
if (args.includes('--regenerate') || !facets.length) {
  const st = JSON.parse(JSON.stringify(exp)); delete st.designCache; st.surfaces = [];   // no cache: a fresh solve
  const t0 = Date.now(), g = O.Design.generate(st); facets = (g && g.surfaces) || st.surfaces;
  console.log('astra solver: ' + facets.length + ' facets in ' + (Date.now() - t0) + ' ms');
}
if (facets.some((f) => f.vertices)) { console.error('this export has triangle (profile/extrusion) surfaces; only facets are supported'); process.exit(2); }

// ---- convert
const { load } = require(path.join(ROOT, 'tests/load.js')); const RF = load(), E = RF.Engine, V = RF.V;
function convert(exp, facets) {
  const cA = exp.target.center, d = cA[2];
  const R = (p) => [p[2], p[0], p[1]], X = (p) => { const q = R([p[0] - cA[0], p[1] - cA[1], p[2] - cA[2]]); return [q[0] + d, q[1], q[2]]; };
  const src = exp.source, sfr = O.V.frame(src.axis), sc = RF.State.defaultScene();
  if (src.kind !== 'planar' || src.shape !== 'rectangle') throw new Error('only rectangular planar LEDs are supported (got ' + src.kind + '/' + src.shape + ')');
  Object.assign(sc.source, { kind: 'planar', shape: 'rect', pos: X(src.position), axis: R(sfr.n), w: src.size, h: src.size * src.aspect, roll: 0, dist: 'lambertian' });
  { const fr = RF.Source.frame(sc.source), u = R(sfr.u); sc.source.roll = Math.atan2(V.dot(u, fr.v), V.dot(u, fr.u)) * 180 / Math.PI; }   // LED width along Astra's u
  const env = exp.envelope; if (env.kind !== 'box') throw new Error('only box envelopes are supported (got ' + env.kind + ')');
  Object.assign(sc.envelope, { shape: 'box', center: X(env.center), half: R(env.size).map((x) => x / 2), keepOut: 0 });
  Object.assign(sc.target, { distance: d, size: exp.target.width, res: exp.target.resolution, tiltX: 0, tiltY: 0, linked: true, aim: [d, 0, 0] });
  Object.assign(sc.sim, { res: exp.target.resolution, autoRes: false });
  Object.assign(sc.modeA, { paint: exp.paint.slice(), budget: exp.design.budget, minDistance: 0, reflectivity: 0.9 });
  sc.name = 'Imported from /astra/';
  sc.groups.A.surfaces = facets.map((f, i) => { const fr = O.V.frame(f.normal); return { type: 'parab', id: 'X' + i, group: 'A', P: X(f.center), n: R(fr.n), focal: f.focal || 0,
    clip: { kind: 'rect', hx: f.width / 2, hy: f.height / 2, ref: R(fr.u) }, optics: { interaction: 'reflect', reflectivity: f.reflectivity ?? 0.9, twoSided: !!f.twoSided } }; });
  return sc;
}
const sc = convert(exp, facets);
console.log('converted: LED ' + sc.source.w + ' × ' + +sc.source.h.toFixed(4) + ', target ' + sc.target.size + ' wide at ' + sc.target.distance.toFixed(1) + ', box ' + sc.envelope.half.map((h) => (2 * h).toFixed(1)).join(' × ') + ', ' + sc.groups.A.surfaces.length + ' facets');
if (opt('out')) { fs.writeFileSync(opt('out'), RF.State.serialize(sc)); console.log('wrote ' + opt('out')); }

// ---- compare: the same facets in both engines, graded by Flux's fidelity
if (args.includes('--compare')) {
  const aSim = new O.Simulation({ ...exp, surfaces: facets, simulation: { ...exp.simulation, rays: RAYS } }, { paths: 0 }).finish();
  const P = E.prepare(sc, RF.State.allSurfaces(sc)), c = E.runSync(P, RAYS), f = RF.Photometry.fidelity(sc, P, c);
  const fake = { ctx: { gridD: Float64Array.from(aSim.grid), gridR: new Float64Array(aSim.grid.length), N: RAYS, E: { emitted: 1 } }, P: { res: sc.target.res, power: 1 } }, fa = RF.Photometry.fidelity(sc, fake.P, fake.ctx);
  const norm = (G) => { const s = G.reduce((a, b) => a + b, 0); return Array.from(G, (x) => x / s); };
  const ga = norm(aSim.grid), gf = norm(E.toPaintGrid(E.gridTotal(c), P.res, sc.target.res));
  const pc = (x) => (100 * x).toFixed(1) + '%', line = (n, q) => console.log('  ' + n.padEnd(14) + 'fidelity ' + pc(q.fidelity) + ' (painted ' + pc(q.within) + ', gaps dark ' + pc(q.gapsDark) + ') · spill ' + pc(q.spill));
  console.log('same facets, ' + RAYS.toLocaleString() + ' rays:'); line('astra engine', fa); line('flux engine', f);
  console.log('  engine agreement: total variation ' + (0.5 * ga.reduce((a, x, i) => a + Math.abs(x - gf[i]), 0)).toFixed(3) + ' between the two maps (0 = identical; measured 2026-09-26: two Flux runs of the same facets with different seeds differ by 0.035 at 1M rays, so ≈ that means the engines agree to within shot noise)');
}
