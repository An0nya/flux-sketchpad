#!/usr/bin/env node
'use strict';
// One isolated case per process. Save the solved scene before the expensive judgment.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const { RF, ROOT, judge } = require('../sqm-hl/lib.js');
const { scene } = require('./scenes.js');
const { renderFF } = require('../sqm-hl/ffpng.js');
const arg = {}; for (let i = 2; i < process.argv.length; i += 2) { assert(process.argv[i].startsWith('--')); arg[process.argv[i].slice(2)] = process.argv[i + 1]; }
const files = ['spec-hl-v2', 'spec-hl-v3', 'sqm-hl', 'sqm-hl-dish', 'sonnet55-2026-09-28-dish-fit', 'opus55-2026-09-27-mosaic', 'projector-liou'];
for (const f of files) { const p = path.join(ROOT, 'solvers', f + '.js'); if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
(async () => {
  const id = arg.solver || 'spec-hl-v2', preset = arg.preset || 'ece-r112-b', name = arg.scene || 'ledUp', N = +(arg.rays || 2e6);
  const dir = path.resolve(arg.out || path.join(ROOT, 'bench-out/spec-hl-v3', name + '-' + preset + '-' + id)); fs.mkdirSync(dir, { recursive: true });
  const sc = arg.retrace ? RF.State.deserialize(fs.readFileSync(arg.retrace, 'utf8')) : scene(name, preset, +(arg.budget || 100));
  const settings = JSON.parse(arg.settings || '{}'); const t0 = Date.now(); let out, solveMs;
  if (!arg.retrace) {
    sc.solve = { id }; sc.solverSettings = { [id]: settings }; const def = RF.Solvers.get(id); assert(def, 'Solver must register');
    const defaults = RF.Solvers.settingsOf(sc, id); for (const k of Object.keys(settings)) assert(k in defaults && defaults[k] === settings[k], 'Setting was discarded or changed: ' + k);
    const input = RF.Solvers.inputOf(sc); assert(input.limits.maxFacets === +(arg.budget || 100), 'facet cap must reach solver');
    const problem = Object.assign(RF.U.deepCopy({ source: sc.source, sources: sc.sources, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
    const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: +(arg.ms || 300000) }, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
    out = await def.solve(input, defaults, tools); solveMs = Date.now() - t0;
    assert(out && out.surfaces.length, 'empty design'); const v = RF.Solvers.verify(sc, out);
    assert(!v.errors.length && !v.violations.envelope.length && !v.violations.keepOut.length && !v.violations.budget, JSON.stringify(v));
    sc.groups.A.surfaces = out.surfaces; sc.sim.bounces = Math.max(sc.sim.bounces, v.needsBounces || 1);
    sc.solve = { id, version: def.version, settings: defaults, seed: sc.sim.seed };
    fs.writeFileSync(path.join(dir, 'scene.json'), RF.State.serialize(sc));
    fs.writeFileSync(path.join(dir, 'solve.json'), JSON.stringify({ solveMs, notes: out.notes, verify: v, settings: defaults }, null, 2));
    console.log('SOLVED', name, preset, id, solveMs, out.surfaces.length);
  } else solveMs = null;
  if (arg.seed) sc.sim.seed = +arg.seed;
  const tj = Date.now(), { G, ev, ctx, P } = judge(sc, N, Math.min(N, 1e6));
  const W = RF.FarField.build(ctx, P.ffStreams[1]);
  const mirror = sc.modeD.traffic === 'LHT' ? -1 : 1;
  const I = RF.Road.beamOf(G, W, ev.shift || [0, 0], mirror, 0.2, 0.2, 1);
  for (const h of [-5, 0, 5]) { const sh = ev.shift || [0,0], v = -1;
    const expected = RF.FarField.intensityAt(G, mirror*h+sh[0],v+sh[1],0.2,0.2).cd;
    assert(Math.abs(I(h,v)-Math.max(0,expected))<1e-7, 'Road angular lookup must preserve horizontal position'); }
  const road = RF.Road.model({ road: sc.modeD.road, preset: sc.modeD.preset, conv: sc.modeD.conv, I });
  const ii = road.iihs(), samples = [];
  for (let x = 10; x <= 120; x += 2) for (const y of [-3.3, -1.65, 0, 1.65, 3.3, 4.95, 6.6]) samples.push({ x, y, vertical: road.lux([x,y,0.25]), ground: road.lux([x,y,0], 'up') });
  const shoulders = samples.filter(p => p.x >= 50 && p.x <= 80 && (p.y === -1.65 || p.y === 4.95));
  const sorted = shoulders.map(p => p.vertical).sort((a,b)=>a-b);
  const map = RF.FarField.map(G, .25); let peak = 0; for (const cd of map.cd) peak = Math.max(peak, cd);
  const energy = ctx.E, accounted = ['direct','reflected','absorbed','backface','interfaceLoss','escaped','targetBack','truncated'].reduce((s,k)=>s+energy[k],0);
  const conservationError = (accounted-energy.emitted)/energy.emitted;
  assert(Math.abs(conservationError)<1e-6, 'Energy accounting does not close: '+conservationError);
  const row = { harnessVersion: 2, name, preset: sc.modeD.preset, solver: sc.solve.id, version: sc.solve.version, seed: sc.sim.seed, rays: ctx.N, solveMs, traceMs: Date.now()-tj,
    source: sc.source, envelope: sc.envelope, settings: sc.solve.settings, facets: sc.groups.A.surfaces.length,
    sourceHash: hash(files.filter(f=>fs.existsSync(path.join(ROOT,'solvers',f+'.js'))).map(f=>fs.readFileSync(path.join(ROOT,'solvers',f+'.js'))).join('\n')),
    judgeHash: hash(fs.readFileSync(path.join(ROOT,'js/spec.js'))), sceneHash: hash(RF.State.serialize(sc)),
    verdict: ev.verdict, n: ev.n, score: ev.score, shift: ev.shift, aim: ev.aim, reaim: ev.reaim, rows: ev.rows,
    lmWindow: G.lmWindow, lmWide: W.lmWindow, peak, efficiency: G.lmWindow / sc.source.power,
    road: ii, curves: road.curves(), shoulderFraction5lx: shoulders.filter(p=>p.vertical>=5).length/shoulders.length,
    shoulderP10lx: sorted[Math.floor(.1*sorted.length)], roadSamples: samples, energy, conservationError };
  fs.writeFileSync(path.join(dir, 'result-'+N+'-'+sc.sim.seed+'.json'), JSON.stringify(row, null, 2));
  const plot = { name, preset: row.preset, solver: row.solver, n: row.n, rays: N, sourceLumens: sc.source.power, lmWindow: G.lmWindow,
    reach: ii, h: [], v: [], cd: [], side: [], distance: [], lux: [] };
  for (let h=-25;h<=25.001;h+=0.25) plot.h.push(h);
  for (let v=-10;v<=5.001;v+=0.125) plot.v.push(v);
  for (const v of plot.v) plot.cd.push(plot.h.map(h=>I(h,v)));
  for (let side=-12;side<=12.001;side+=0.15) plot.side.push(+side.toFixed(3));
  for (let x=5;x<=100.001;x+=0.5) plot.distance.push(x);
  for (const x of plot.distance) plot.lux.push(plot.side.map(side=>road.lux([x,-side,0.25])));
  fs.writeFileSync(path.join(dir, 'plot-'+N+'-'+sc.sim.seed+'.json'), JSON.stringify(plot));
  fs.writeFileSync(path.join(dir, 'beam-'+N+'-'+sc.sim.seed+'.png'), renderFF(RF, G, sc.modeD, { ev, h: [-25,25], v: [-10,5], ppd: 18, hi: 50000, lo: 50 }).png);
  console.log('RESULT', JSON.stringify({ name, preset:row.preset, id:row.solver, n:ev.n, lm:Math.round(G.lmWindow), far:[ii.farRight,ii.farLeft], continuous:[ii.right,ii.left], shoulder5:row.shoulderFraction5lx, fails:ev.rows.filter(r=>r.verdict==='fail').map(r=>[r.name, r.value, r.bound]) }));
})().catch(e=>{console.error(e.stack); process.exitCode=1;});
