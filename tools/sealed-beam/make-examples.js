#!/usr/bin/env node
/* make-examples.js — writes examples/sealed-beam-<lamp>-<beam>.json: a Spec-mode (FMVSS 108) scene with the H4 filament, the sealed-beam envelope,
 * the solver set to sealed-beam-v1 with the TUNED flute settings from tools/sealed-beam/results-transverse.jsonl (rows 'fluted, tuned'), and the solved
 * design already in group A so it loads and traces without a solve.   node tools/sealed-beam/make-examples.js [results.jsonl]               */
const fs = require('fs'), path = require('path');
const L = require('./lab.js'), RF = L.RF;
const resFile = process.argv[2] || path.join(__dirname, 'results-transverse.jsonl');
const rows = fs.readFileSync(resFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.variant === 'fluted, tuned');
(async () => {
  for (const lamp of ['7', '5.75']) for (const beam of ['low', 'high']) {
    const row = rows.filter((r) => r.lamp === lamp && r.beam === beam).pop(); if (!row) { console.log('no tuned row for', lamp, beam); continue; }
    const tuned = {}; (row.notes.find((n) => /^tuned: /.test(n)) || '').replace(/^tuned: /, '').split(', ').forEach((kv) => { const [k, v] = kv.split(' '); tuned[k] = +v; });
    const sc = L.makeScene(lamp, beam, { settings: Object.assign({ lens: 'fluted', tune: false }, tuned) });
    const r = await L.solve(sc, {});
    if (r.facts.errors.length) throw new Error('solve errors: ' + r.facts.errors.join('; '));
    sc.groups.A.surfaces = r.out.surfaces; sc.sim.bounces = Math.max(sc.sim.bounces, 3);
    sc.solve = { id: 'sealed-beam-v1', version: '0.1', settings: RF.Solvers.settingsOf(sc, 'sealed-beam-v1'), seed: sc.sim.seed | 0 };
    const f = path.join(__dirname, '..', '..', 'examples', 'sealed-beam-' + (lamp === '7' ? '7in' : '5.75in') + '-' + beam + '.json');
    fs.writeFileSync(f, RF.State.serialize(sc)); console.log('wrote', f, (fs.statSync(f).size / 1024).toFixed(0) + ' KB', r.out.surfaces.length + ' surfaces');
  }
})();
