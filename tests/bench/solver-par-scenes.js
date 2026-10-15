// W3b: writes the scenes the solver-parallelism benchmarks use (so Node and the page solve the SAME file).
//   node tests/bench/solver-par-scenes.js <outdir>
'use strict';
const fs = require('fs'), path = require('path');
const { RF } = require('../../tools/sqm-hl/lib.js');
const { makeScene } = require('../../tools/sqm-hl/scenes.js');
const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });
const box = makeScene('box', { preset: 'ece-r112-b', budget: 100 }); box.sim.seed = 1; box.sim.rays = 2e6;
fs.writeFileSync(path.join(out, 'box-ece.json'), RF.State.serialize(box));
const ex = RF.State.deserialize(fs.readFileSync(path.join(__dirname, '../../examples/sealed-beam-7in-low.json'), 'utf8'));
ex.solverSettings['sealed-beam-v1'].tune = true; ex.solverSettings['sealed-beam-v1'].tuneSeconds = 0;   // deterministic: no wall-clock cap
fs.writeFileSync(path.join(out, 'sealed-tune.json'), RF.State.serialize(ex));
const def = RF.State.defaultScene(); fs.writeFileSync(path.join(out, 'default.json'), RF.State.serialize(def));
console.log('wrote', fs.readdirSync(out).join(' '));
