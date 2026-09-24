// Run every gate: node tests/all.js — exits 1 if any fails.
// 1. syntax of every browser script (the headless suite never loads ui.js / panels.js / render*.js)
// 2. the 24-check suite  3. undo/redo  4. evaluation metrics
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); let failed = 0;
const run = (label, args) => {
  try { const out = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }); console.log('✓ ' + label + (out.trim() ? '  — ' + out.trim().split('\n').pop() : '')); }
  catch (e) { failed++; console.log('✗ ' + label + '\n' + String(e.stdout || '') + String(e.stderr || '')); }
};
for (const d of ['js', 'tests']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) run('syntax ' + d + '/' + f, ['--check', path.join(d, f)]);
run('checks (tests/headless.js)', ['tests/headless.js']);
run('undo/redo (tests/history.js)', ['tests/history.js']);
run('metrics (tests/metrics.js)', ['tests/metrics.js']);
console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
