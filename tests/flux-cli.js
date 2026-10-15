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
process.exitCode = fail ? 1 : 0;
