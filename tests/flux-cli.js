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
// EX: exports use the same trace bins and writers as the page, including finite-screen scenes.
const formats = require('./export-formats.js');
const directRF = require('./load.js').load(), exportScene = directRF.State.deserialize(fs.readFileSync(path.join(ROOT, ex), 'utf8'));
exportScene.modeD.step = 0.5; exportScene.modeD.distance = 10000;
const exportInput = path.join(tmp, 'export-scene.json'); fs.writeFileSync(exportInput, directRF.State.serialize(exportScene));
const exported = {};
for (const format of ['ies', 'ldt', 'gltf']) {
  const r = run('export', exportInput, '--format', format, '--out', path.join(tmp, 'out.' + format), '--rays', '30000');
  const text = fs.readFileSync(r.file, 'utf8'); exported[format] = { r, parsed: format === 'gltf' ? formats.validateGltf(text).g : format === 'ies' ? formats.parseIes(text) : formats.parseLdt(text) };
  check(r.bytes === Buffer.byteLength(text) && (format === 'gltf' ? exported[format].parsed.meshes.length === sum.surfaces.A.count : r.rays === 30000 && r.lmWindow > 0), 'export '+format+': writes and parses file, valid reported size', r);
}
const gopts = directRF.Spec.gridOpts(exportScene, 0), eP = directRF.Engine.prepare(exportScene, directRF.State.allSurfaces(exportScene)); eP.ffStreams = [gopts];
const eCtx = directRF.Engine.runSync(eP, 30000), eG = directRF.FarField.build(eCtx, gopts); let exportWorst = 0;
for (const [cd, q] of Array.from(eG.E, (e, q) => [e / eG.Om[q], q]).sort((a,b) => b[0]-a[0]).slice(0,5)) {
  const h=eG.h0+(q%eG.nh+0.5)*eG.step, v=eG.v0+(Math.floor(q/eG.nh)+0.5)*eG.step;
  for (const f of ['ies','ldt']) exportWorst=Math.max(exportWorst,Math.abs(formats.atHV(exported[f].parsed,h,v,eG.conv)-cd));
}
check(exportWorst < 0.001 && Math.abs(exported.ies.r.lmWindow-eG.lmWindow)<1e-8, 'export traces infinity despite saved 10 m setting; round-trip top five raw bins', { maxCdError: exportWorst, lmWindow: eG.lmWindow });
const legacy = run('export', exportInput, '--format', 'ies', '--out', path.join(tmp, 'legacy.ies'), '--rays', '1000', '--ies-2002');
check(fs.readFileSync(legacy.file,'utf8').startsWith('IESNA:LM-63-2002'), 'export --ies-2002 provides older-reader header');
for (const extra of [['--format','bad','--out',path.join(tmp,'bad')], ['--format','ies'], ['--format','ies','--out',path.join(tmp,'bad'),'--rays','0']]) {
  let rejected=false; try { execFileSync(process.execPath,[CLI,'export',exportInput,...extra],{cwd:ROOT,stdio:'pipe'}); } catch(e) { rejected=/flux:/.test(String(e.stderr)); }
  check(rejected,'export invalid format / missing output / invalid ray count fails loudly: '+extra.join(' '));
}
// Layer 3: api.json (served next to index.html) must describe the code as it is now; commit/date are allowed to lag
const strip = (m) => { const c = Object.assign({}, m); delete c.commit; delete c.date; return JSON.stringify(c); };
const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'api.json'), 'utf8')), fresh = run('manifest');
check(strip(onDisk) === strip(fresh), 'api.json is current (else: node tools/flux.js manifest --out api.json)', { onDisk: onDisk.solvers.length, now: fresh.solvers.length });
// Layer 2 needs Playwright; skipped (not failed) where it isn't installed
let pw = null; for (const p of [process.env.PLAYWRIGHT, 'playwright', '/Users/anya/Projects/agent-qa/node_modules/playwright']) { if (!p) continue; try { require.resolve(p); pw = p; break; } catch (e) { /* next */ } }
if (process.argv.includes('--node-only')) console.log('[SKIP] shot / page: --node-only (builder contract forbids browser execution)');
else if (!pw) console.log('[SKIP] shot / page: Playwright not found');
else {
  const sh = run('shot', ex, '--pane', 'result', '--display', 'ff', '--out', path.join(tmp, 'ff-page.png'));
  const b2 = fs.readFileSync(sh.file);
  check(b2.slice(1, 4).toString() === 'PNG' && sh.display === 'ff' && !sh.pageErrors.length, 'shot: far-field pane screenshot, no page errors', { display: sh.display, errors: sh.pageErrors.length });
  const pv = run('page', ex, '--eval', 'RF.UI.store.scene.groups.A.surfaces.length');
  check(pv.value === sum.surfaces.A.count, 'page --eval reads the loaded scene from the live app', { value: pv.value });
}
console.log('flux CLI: ' + (fail ? fail + ' FAILED' : 'all checks passed'));
process.exitCode = fail ? 1 : 0;
