// The test selection both adapters use: exactly tests/gate.js's plan(), so `--touched`, `--full` and `--only` mean the same
// thing under node --test and @playwright/test as under the gate. Selection comes from environment variables so it also
// works inside playwright.config.js / a spec file, where argv belongs to Playwright:
//   GATE_ONLY=a,b       explicit names (as gate.js --only)
//   GATE_TOUCHED=<ref>  the MAP-driven subset changed against <ref> (as gate.js --touched --base <ref>); '1' means main
//   (neither)           the full curated gate (as gate.js --full)
const fs = require('fs'), path = require('path');
const gate = require('../gate.js');
const root = path.join(__dirname, '..', '..');
function selected(env = process.env) {
  const t = env.GATE_TOUCHED;
  return gate.plan({ only: env.GATE_ONLY || null, touched: !!t && t !== '0', base: t && t !== '1' ? t : 'main' });
}
const nodeSuites = (names) => names.filter((n) => n.startsWith('node:')).map((n) => n.slice(5));
const pageTests = (names) => names.filter((n) => !n.startsWith('node:'));
const pageFile = (n) => path.join(root, 'tests', 'regress', n + '.js');
const nodeFile = (n) => path.join(root, 'tests', n + '.js');
module.exports = { gate, root, selected, nodeSuites, pageTests, pageFile, nodeFile, exists: fs.existsSync };
