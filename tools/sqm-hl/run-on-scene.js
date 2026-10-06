#!/usr/bin/env node
/* run-on-scene.js <solver-id> [--load file.js[,file2]] [--settings '{...}'] [--scene path] [--rays 4e6] [--out name]
 * Runs a registered solver on the scene exactly like tests/bench-spec.js (Spec-mode input, tools.trace), then verifies, judges,
 * writes <name>.png (far field) and <name>.scene.json (the scene with the new design, openable in the app). Streams every line. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF, ROOT, loadScene, judge, report } = require('./lib.js');
const { makeScene } = require('./scenes.js');
const args = {}; for (let i = 3; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const id = process.argv[2];
for (const f of ['lab-fill-fix', 'lab-sqm', 'sonnet55-2026-09-28-dish-fit', 'opus55-2026-09-27-mosaic', 'lab-auto', 'spec-hl-v2', 'spec-hl-v1']) { const p = path.join(ROOT, 'solvers', f + '.js'); if (fs.existsSync(p) && !RF.Solvers.get(f)) { try { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); } catch (e) { console.log('load fail', f, e.message); } } }
for (const f of (args.load ? String(args.load).split(',') : [])) vm.runInThisContext(fs.readFileSync(path.resolve(f), 'utf8'), { filename: path.resolve(f) });
const sc = args.scene && !/^file:/.test(args.scene) && !/\.json$/.test(args.scene) ? makeScene(args.scene, { preset: args.preset || 'ece-r112-b', budget: +(args.budget || 100), md: args.md ? JSON.parse(args.md) : undefined }) : makeScene('file:' + (args.scene || require('./lib.js').SCENE).replace(/^file:/, ''), { budget: args.budget ? +args.budget : undefined }); if (args.budget) sc.modeA.budget = +args.budget; sc.groups.A.surfaces = []; sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings || {}); sc.solverSettings[id] = Object.assign({}, (sc.solverSettings && sc.solverSettings[id]) || {}, args.settings ? JSON.parse(args.settings) : {});
const def = RF.Solvers.get(id); if (!def) { console.log('no solver', id, RF.Solvers.list().map((d) => d.id).join()); process.exit(2); }
const input = RF.Solvers.inputOf(sc), problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
let nTrace = 0, raysTraced = 0;
const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: +(args.ms || 120000) }, scene: problem, trace: (s, o) => { nTrace++; raysTraced += (o && o.rays) || 0; return RF.Solvers.trace(problem, s, o); } };
(async () => {
  const t0 = Date.now(); let out;
  try { out = await def.solve(input, RF.Solvers.settingsOf(sc, id), tools); } catch (e) { console.log('SOLVE ERROR', e.stack || e); process.exit(1); }
  const ms = Date.now() - t0;
  console.log(`solve ${ (ms / 1000).toFixed(1) } s, ${nTrace} traces (${(raysTraced / 1e6).toFixed(1)} M rays), ${out.surfaces.length} surfaces`);
  for (const n of (out.notes || [])) console.log('  note:', n);
  const facts = RF.Solvers.verify(sc, out); console.log('verify: placed', facts.placed, 'errors', JSON.stringify(facts.errors), 'envelope outside', facts.violations.envelope.length, 'keepOut', facts.violations.keepOut.length, 'budget', JSON.stringify(facts.violations.budget), 'needsBounces', facts.needsBounces);
  sc.groups.A.surfaces = out.surfaces; if (facts.needsBounces > sc.sim.bounces) sc.sim.bounces = facts.needsBounces;
  const t1 = Date.now(); const { G, ev, reach } = judge(sc, +(args.rays || 8e6)); console.log('judge trace', ((Date.now() - t1) / 1000).toFixed(1) + 's'); console.log(report(ev, G, null, reach));
  const name = args.out || id; const dir = args.dir || __dirname;
  const { renderFF } = require('./ffpng.js'); const r = renderFF(RF, G, sc.modeD, { ev, label: name }); fs.writeFileSync(path.join(dir, name + '.png'), r.png); console.log('png', path.join(dir, name + '.png'), 'peak', Math.round(r.peak));
  sc.solve = { id, version: def.version, settings: RF.Solvers.settingsOf(sc, id), seed: sc.sim.seed | 0 };
  fs.writeFileSync(path.join(dir, name + '.scene.json'), RF.State.serialize(sc)); console.log('scene', path.join(dir, name + '.scene.json'));
})();
