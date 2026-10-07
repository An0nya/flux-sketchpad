// Run every gate: node tests/all.js — exits 1 if any fails.
// 1. syntax of every browser script (the headless suite never loads ui.js / panels.js / render*.js)
// 2. the 24-check suite  3. undo/redo  4. evaluation metrics  5. layout  6. per-hit facet attribution
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); let failed = 0;
// Each test gets HANG_MS. Node 25.8 sometimes never finishes exiting (stuck in process.exit → platform shutdown →
// pthread_join, seen on facet2.js after its checks had passed), and an unbounded wait stalled the whole suite. A hang is
// killed and retried once; it is always reported, and two in a row count as a failure.
const HANG_MS = 240000;
const hung = (e) => e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL');
const run = (label, args) => {
  const once = () => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: HANG_MS, killSignal: 'SIGKILL' });
  let note = '';
  try {
    let out;
    try { out = once(); }
    catch (e) { if (!hung(e)) throw e; note = '  (hung once: killed after ' + HANG_MS / 1000 + ' s, passed on retry)'; out = once(); }
    console.log('✓ ' + label + (out.trim() ? '  — ' + out.trim().split('\n').pop() : '') + note);
  } catch (e) {
    failed++;
    console.log('✗ ' + label + (hung(e) ? '  — HUNG twice (no exit within ' + HANG_MS / 1000 + ' s), killed' : '') + '\n' + String(e.stdout || '') + String(e.stderr || ''));
  }
};
for (const d of ['js', 'tests']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) run('syntax ' + d + '/' + f, ['--check', path.join(d, f)]);
run('checks (tests/headless.js)', ['tests/headless.js']);
run('undo/redo (tests/history.js)', ['tests/history.js']);
run('metrics (tests/metrics.js)', ['tests/metrics.js']);
run('layout (tests/layout.js)', ['tests/layout.js']);
run('attribution (tests/attribution.js)', ['tests/attribution.js']);
run('photometry (tests/photometry.js)', ['tests/photometry.js']);
run('two-curvature facet (tests/facet2.js)', ['tests/facet2.js']);
run('solvers (tests/solvers.js)', ['tests/solvers.js']);
run('modes + auto (tests/modes.js)', ['tests/modes.js']);
run('spec mode + far field (tests/spec.js)', ['tests/spec.js']);
run('multi-part optics + multi-emitter (tests/optics-parts.js)', ['tests/optics-parts.js']);
run('watching a solve: worker previews (tests/preview.js)', ['tests/preview.js']);
run('road model + IIHS metrics (tests/road.js)', ['tests/road.js']);
run('driver\'s-eye view (tests/drive.js)', ['tests/drive.js']);
console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
