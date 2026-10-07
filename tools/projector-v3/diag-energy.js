#!/usr/bin/env node
// where does the light go?  loads a scene.json written by run-on-scene (a design), traces it, prints the engine's energy ledger + window lumens
const fs = require('fs');
const { RF } = require('./lib.js');
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')), N = +(process.argv[3] || 2e6);
const input = RF.Solvers.inputOf(sc), problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: 'D' }), { target: input.target, modeA: { paint: input.paint.cells } });
sc.sim.bounces = Math.max(sc.sim.bounces | 0, 5);
const r = RF.Solvers.trace(problem, RF.State.allSurfaces(sc), { rays: N, bounces: sc.sim.bounces });
const P = sc.source.power; const e = r.energy; console.log('source', P, 'lm; keys:', Object.keys(e).join(' '));
for (const k of Object.keys(e)) console.log(k.padEnd(14), (e[k] * (e[k] <= 1.0001 ? P : 1)).toFixed(1));
console.log('lmOnTarget', r.lmOnTarget && r.lmOnTarget.toFixed(0), 'blocked', r.blocked);
