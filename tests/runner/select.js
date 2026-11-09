// The test selection both adapters use: exactly what tests/gate.js selects, so `--touched`, `--full` and `--only` mean the
// same thing under node --test and @playwright/test as under the gate. Selection comes from environment variables so it also
// works inside playwright.config.js / a spec file, where argv belongs to Playwright:
//   GATE_ONLY=a,b       explicit names (as gate.js --only)
//   GATE_TOUCHED=<ref>  the MAP-driven subset changed against <ref> (as gate.js --touched --base <ref>); '1' means main
//   (neither)           the full curated gate (as gate.js --full)
// The plan is read from the gate's OWN --list output (a child process), NOT from require('../gate.js'):
//   - the lander replaces a patch's tests/gate.js with swarm's before it chooses and runs the tests (claude, ccf4), and
//   - requiring the gate RUNS the gate: its main is not guarded, so a runner that requires it starts a second, nested gate
//     inside the lander's gate (and in the landed tree the runner would break if the gate.js change were ever dropped).
// Asking the gate through its CLI works with any version of gate.js, in the lander's staged tree and in the landed one.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const NAME = /^(?:node:[A-Za-z0-9][A-Za-z0-9._/-]*|[A-Za-z0-9][A-Za-z0-9._-]*)$/;   // a plan entry: 'node:<suite>' or a page test name
// the gate's --list output: one name per line, after its "dark page tests" notice (that line has spaces and commas, so the
// name shape filters it out)
function gateListRaw(env = process.env) {
  const args = [path.join(root, 'tests', 'gate.js'), '--list'];
  if (env.GATE_ONLY) args.push('--only', env.GATE_ONLY);
  if (env.GATE_TOUCHED && env.GATE_TOUCHED !== '0') { args.push('--touched'); if (env.GATE_TOUCHED !== '1') args.push('--base', env.GATE_TOUCHED); }
  return execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
}
const selected = (env = process.env) => gateListRaw(env).split('\n').map((l) => l.trim()).filter((l) => NAME.test(l));
const nodeSuites = (names) => names.filter((n) => n.startsWith('node:')).map((n) => n.slice(5));
const pageTests = (names) => names.filter((n) => !n.startsWith('node:'));
const pageFile = (n) => path.join(root, 'tests', 'regress', n + '.js');
const nodeFile = (n) => path.join(root, 'tests', n + '.js');
module.exports = { root, gateListRaw, selected, nodeSuites, pageTests, pageFile, nodeFile, exists: fs.existsSync };
