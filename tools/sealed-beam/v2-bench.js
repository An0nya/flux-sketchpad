#!/usr/bin/env node
/* SB2 bench: node tools/sealed-beam/v2-bench.js placement|bare|lens [--rays 2000000] [--evals 150] [--tuneRays 60000]
 * All numbers come from child processes running flux.js solve/trace. Raw stdout + exact argv are saved per case.
 * No browsers. Output: tools/sealed-beam/v2-results/<phase>/*.json, append-only measurements.jsonl. */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { RF, makeScene } = require('./v2-lab.js');
const phase = process.argv[2] || 'placement', arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const root = path.resolve(__dirname, '../..'), dir = path.join(__dirname, 'v2-results', phase), rays = +arg('rays', 2e6);
fs.mkdirSync(dir, { recursive: true });
function cli(name, args) {
  const cmd = ['tools/flux.js', ...args], stdout = execFileSync(process.execPath, cmd, { cwd: root, maxBuffer: 32 << 20, timeout: 3600000 }).toString();
  fs.writeFileSync(path.join(dir, name + '.json'), stdout);
  const data = JSON.parse(stdout); fs.appendFileSync(path.join(dir, 'commands.jsonl'), JSON.stringify({ name, argv: [process.execPath, ...cmd] }) + '\n');
  return data;
}
function measure(name, scene) {
  const file = path.join(dir, name + '-scene.json'); fs.writeFileSync(file, RF.State.serialize(scene));
  const trace = cli(name + '-trace', ['trace', file, '--rays', String(rays), '--spec', scene.source.preset.endsWith('high') ? 'fmvss-ub2' : 'fmvss-lb2m,fmvss-lb2v']);
  const row = { name, rays, peakCd: trace.peakCd, lmWindow: trace.lmWindow, spec: Object.fromEntries(Object.entries(trace.spec).filter(([k]) => !k.startsWith('scene:')).map(([k, v]) => [k, { pass: v.pass, fail: v.fail, unsure: v.unsure, aim: v.aim }])) };
  fs.appendFileSync(path.join(__dirname, 'v2-results', 'measurements.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
  return trace;
}
function solve(name, sc, extra) {
  const src = path.join(dir, name + '-input.json'), out = path.join(dir, name + '-solved.json'); fs.writeFileSync(src, RF.State.serialize(sc));
  const r = cli(name + '-solve', ['solve', src, '--out', out, ...(extra || [])]);
  if (r.errors.length) throw new Error(name + ': ' + r.errors.join('; '));
  const scene = RF.State.deserialize(fs.readFileSync(out, 'utf8')), facts = RF.Solvers.verify(scene, { surfaces: scene.groups.A.surfaces });
  fs.writeFileSync(path.join(dir, name + '-facts.json'), JSON.stringify(facts, null, 2) + '\n');
  if (facts.violations.envelope.length || facts.violations.keepOut.length || facts.violations.budget) throw new Error(name + ': constraint violations ' + JSON.stringify(facts.violations));
  return scene;
}
if (phase === 'placement') {
  const base = RF.State.deserialize(fs.readFileSync(path.join(root, 'examples/sealed-beam-7in-low.json'), 'utf8'));
  // Exactly the reviewer/Claude source edits on the saved v1 optics. No solve in this phase.
  for (const [name, pos] of [['origin', [0, 0, 0]], ['right', [1, -0.5, 0.5]], ['left-control', [1, 0.5, 0.5]]]) {
    const sc = RF.U.deepCopy(base); sc.source.axis = [1, 0, 0]; sc.source.pos = pos;
    // This is the old incomplete H4 FILAMENT comparison, deliberately without the new assembly.
    sc.source.preset = 'h4-low'; measure(name, sc);
  }
} else if (phase === 'bare') {
  for (const lamp of String(arg('lamps', '7,5.75')).split(',')) for (const beam of ['low', 'high']) for (const model of ['sealed', 'h4']) {
    const name = lamp + '-' + beam + '-' + model, sc = makeScene(lamp, beam, model, { lens: 'none', shield: false });
    measure(name, solve(name, sc));
    if (model === 'h4') { const plain = RF.U.deepCopy(sc); plain.solverSettings['sealed-beam-v2'].assembly = 'none'; measure(name + '-filament-only', solve(name + '-filament-only', plain)); }
  }
} else if (phase === 'lens') {
  const evals = +arg('evals', 150), tuneRays = +arg('tuneRays', 60000);
  for (const lamp of String(arg('lamps', '7')).split(',')) for (const beam of String(arg('beams', 'low')).split(',')) for (const model of String(arg('models', 'sealed,h4')).split(',')) {
    const name = lamp + '-' + beam + '-' + model, sc = makeScene(lamp, beam, model);
    for (const lens of ['plain', 'fluted']) { const p = RF.U.deepCopy(sc); p.solverSettings['sealed-beam-v2'].lens = lens; measure(name + '-' + lens, solve(name + '-' + lens, p)); }
    sc.solverSettings['sealed-beam-v2'] = Object.assign(sc.solverSettings['sealed-beam-v2'], { tune: true, tuneEvals: evals, tuneRays });
    const tuned = solve(name + '-tuned', sc), report = JSON.parse(fs.readFileSync(path.join(dir, name + '-tuned-solve.json'), 'utf8'));
    const note = report.notes.find((n) => n.startsWith('tuned: ')); if (!note) throw new Error('tuner did not record settings');
    const knobs = Object.fromEntries(note.slice(7).split(', ').map((kv) => { const [k, v] = kv.split(' '); return [k, +v]; }));
    Object.assign(tuned.solverSettings['sealed-beam-v2'], knobs, { tune: false });
    // Store final knobs so an ordinary Rebuild reproduces the shipped geometry without tuning again.
    measure(name + '-tuned', tuned);
    const ex = path.join(root, 'examples', 'sealed-beam-v2-' + (lamp === '7' ? '7in' : '5.75in') + '-' + beam + '-' + model + '.json');
    fs.writeFileSync(ex, RF.State.serialize(tuned));
  }
} else throw new Error('unknown phase ' + phase);
