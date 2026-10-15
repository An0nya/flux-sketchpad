// Smoke test for tools/flux.js: every command runs, prints JSON, and the numbers agree with a direct engine run.
const { execFileSync } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), CLI = path.join(ROOT, 'tools', 'flux.js');
const run = (...a) => JSON.parse(execFileSync(process.execPath, [CLI, ...a], { cwd: ROOT, maxBuffer: 1 << 26 }).toString());
let fail = 0; const check = (ok, name, info) => { console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (info ? '  — ' + JSON.stringify(info) : '')); if (!ok) fail++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-cli-'));

const solvers = run('list', 'solvers');
check(solvers.length > 10 && solvers.some((s) => s.id === 'sealed-beam-v1') && !solvers.some((s) => s.error), 'list solvers: bundled solvers load, none errored', { n: solvers.length });
check(run('list', 'spec-presets').some((p) => p.id === 'fmvss-lb2m'), 'list spec-presets has fmvss-lb2m');
const ex = 'examples/sealed-beam-7in-high.json', sum = run('scene', ex);
check(sum.mode === 'D' && sum.surfaces.A.count > 0, 'scene summary reads mode + surfaces', { mode: sum.mode, A: sum.surfaces.A });
const t = run('trace', ex, '--rays', '300000', '--spec', 'fmvss-ub2'), e = t.spec['fmvss-ub2'];
check(e && e.pass + e.fail + e.unsure === e.rows.length && t.peakCd > 0, 'trace: spec verdict rows add up, peak > 0', { pass: e && e.pass, peak: t.peakCd });
const solved = path.join(tmp, 's.json'), s = run('solve', ex, '--out', solved), t2 = run('trace', solved, '--rays', '300000', '--spec', 'fmvss-ub2');
check(!s.errors.length && t2.lmWindow === t.lmWindow, 're-solving the example reproduces its far field (same lm in window at the same rays)', { before: t.lmWindow, after: t2.lmWindow });
let threw = false; try { execFileSync(process.execPath, [CLI, 'solve', ex, '--set', 'nonsense=1'], { cwd: ROOT, stdio: 'pipe' }); } catch (err) { threw = /replaced/.test(String(err.stderr)); }
check(threw, 'an unknown --set fails loudly instead of being dropped');
const h = run('heatmap', ex, '--out', path.join(tmp, 'ff.png'), '--rays', '200000');
const buf = fs.readFileSync(h.file);
check(buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === h.width && buf.readUInt32BE(20) === h.height, 'heatmap writes a PNG of the reported size', { w: h.width, h: h.height });
const comp = run('compare', ex, ex, '--rays', '10000', '--spec', 'fmvss-ub2');
const unequal = comp.diff.filter((r) => r.a !== r.b || (r.delta !== null && r.delta !== 0));
check(!unequal.length, 'compare: identical saved designs have identical metrics and zero numeric deltas', unequal.length ? unequal : comp.a.metrics);
const dim = JSON.parse(fs.readFileSync(path.join(ROOT, ex), 'utf8')); dim.source.power *= 0.5;
const dimFile = path.join(tmp, 'dim.json'); fs.writeFileSync(dimFile, JSON.stringify(dim));
const cmp = run('compare', ex, dimFile, '--rays', '10000', '--spec', 'fmvss-ub2');
check(Math.abs(cmp.b.metrics.lmWindow / cmp.a.metrics.lmWindow - 0.5) < 1e-8 && cmp.diff.find((r) => r.metric === 'peakCd').delta < 0, 'compare: halving source power halves window lumens, peak delta has correct sign', { a: cmp.a.metrics.lmWindow, b: cmp.b.metrics.lmWindow });
check(cmp.a.specs['fmvss-ub2'].pass + cmp.a.specs['fmvss-ub2'].fail + cmp.a.specs['fmvss-ub2'].unsure === cmp.a.specs['fmvss-ub2'].rows.length, 'compare: preset counts agree with raw verdict rows');
const multi = run('compare', ex, ex, '--rays', '3000', '--spec', 'fmvss-ub2,ece-r112-b');
check(multi.specs.length === 2 && multi.diff.filter((r) => r.metric.endsWith('.verdict')).length === 2 && multi.diff.every((r) => r.delta === null || r.delta === 0), 'compare: multiple presets each produce a verdict and zero self-diff');
let badCompare = false; try { execFileSync(process.execPath, [CLI, 'compare', ex, ex, '--spec', 'not-a-spec'], { cwd: ROOT, stdio: 'pipe' }); } catch (err) { badCompare = /unknown spec/.test(String(err.stderr)); }
check(badCompare, 'compare: unknown presets fail loudly');
// Layer 3: api.json (served next to index.html) must describe the code as it is now; commit/date are allowed to lag
const strip = (m) => { const c = Object.assign({}, m); delete c.commit; delete c.date; return JSON.stringify(c); };
const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'api.json'), 'utf8')), fresh = run('manifest');
check(strip(onDisk) === strip(fresh), 'api.json is current (else: node tools/flux.js manifest --out api.json)', { onDisk: onDisk.solvers.length, now: fresh.solvers.length });
// Layer 2 needs Playwright; skipped (not failed) where it isn't installed
let pw = null; for (const p of [process.env.PLAYWRIGHT, 'playwright', '/Users/anya/Projects/agent-qa/node_modules/playwright']) { if (!p) continue; try { require.resolve(p); pw = p; break; } catch (e) { /* next */ } }
if (process.argv.includes('--node-only')) console.log('[SKIP] shot / page: --node-only (builder contract forbids browser launches)');
else if (!pw) console.log('[SKIP] shot / page: Playwright not found');
else {
  const sh = run('shot', ex, '--pane', 'result', '--display', 'ff', '--out', path.join(tmp, 'ff-page.png'));
  const b2 = fs.readFileSync(sh.file);
  check(b2.slice(1, 4).toString() === 'PNG' && sh.display === 'ff' && !sh.pageErrors.length, 'shot: far-field pane screenshot, no page errors', { display: sh.display, errors: sh.pageErrors.length });
  const pv = run('page', ex, '--eval', 'RF.UI.store.scene.groups.A.surfaces.length');
  check(pv.value === sum.surfaces.A.count, 'page --eval reads the loaded scene from the live app', { value: pv.value });
}
console.log(fail ? fail + ' FAILED' : 'all flux-cli checks passed');
process.exitCode = fail ? 1 : 0;
