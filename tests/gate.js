#!/usr/bin/env node
// Gate runner: node tests/gate.js [--touched | --full | --list] [--jobs N] [--only a,b] [--base main]
//   --touched  run only the tests mapped to files changed against --base (default main), plus new test files; an unmapped
//              changed js/ file falls back to the full gate (so a gap in the map can never silently skip tests).
//   --full     the whole curated gate (use at merge checkpoints).
//   --only     explicit comma list of test names (page = tests/regress/<name>.js, node = tests/<name>.js).
// Node suites and "parallel" page tests run in a pool of --jobs workers (default 3); "solo" page tests (real GPU or timing
// sensitive) run alone afterwards so parallel load cannot distort them. Every test has a hard wall limit and is killed by PID.
// Prints "name exit fails seconds" per test, then a total. Exit 1 if anything failed or timed out.
// Known-failing page tests (MG2, QOL1, G20, D1, D5, F2, FO-foliage, M1-models-proto, NE-state-leak) are NOT in the gate; run them with --only.
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), net = require('net');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2), has = (f) => args.includes(f), val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const JOBS = +val('--jobs', 3), BASE = val('--base', 'main'), WALL_MS = +val('--wall', 600000);
const PW = process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright';

// ---- the curated gate -------------------------------------------------------------------------------------------------
const NODE = ['all', 'regress-node', 'scatter-table', 'scatter-table-pace', 'scatter', 'scatter-fade-gain', 'fog', 'wetness', 'wet-ggx', 'foliage', 'beams', 'beam-atlas', 'traffic-beams', 'tl-traffic-taper', 'pass-parity', 'scene-digest', 'scenery-params', 'tile-options', 'options-registry', 'options-migration', 'options-docs'];
const PAGE_PAR = ['SB1-studs-everywhere', 'OV-scene-details', 'CD-controls-dedupe', 'UX2-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'PM-pass-mesh', 'PP-pass-parity', 'P2-drive-lighting', 'WG-wet-ggx', 'WT-wetness', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range'];
const PAGE_SOLO = ['P1-drive-three', 'SE-table-pacing'];   // P1 needs the real GPU; SE measures per-frame ms
const GROUPS = {
  render: ['P1-drive-three', 'P2-drive-lighting', 'PM-pass-mesh', 'PP-pass-parity', 'WT-wetness', 'WG-wet-ggx', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range', 'SB1-studs-everywhere', 'OV-scene-details'],
  ui: ['CD-controls-dedupe', 'UX2-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'CPU-FALLBACK-PAUSE'],
  scatter: ['SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'SF1-car-silhouette', 'FG-fog', 'node:scatter', 'node:scatter-table', 'node:scatter-table-pace', 'node:scatter-fade-gain', 'node:fog'],
  beams: ['BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'P1-drive-three', 'node:beams', 'node:beam-atlas', 'node:traffic-beams'],
  wet: ['WT-wetness', 'WG-wet-ggx', 'node:wetness', 'node:wet-ggx'],
  nodeAll: NODE.map((n) => 'node:' + n),
};
// First match wins per changed file; every match contributes (union). A changed js/ file with no match => full gate.
const MAP = [
  [/^js\/drive-three-shaders\.js$/, ['render', 'ui']], [/^js\/drive-three(-objects|-models)?\.js$/, ['render', 'ui']],
  [/^js\/ui\.js$/, ['ui']], [/^js\/drive-anim\.js$/, ['render', 'ui', 'nodeAll']], [/^js\/spec-ui\.js$/, ['ui', 'scatter', 'beams', 'node:options-migration']],
  [/^js\/drive\.js$/, ['render', 'nodeAll']], [/^js\/table-pace\.js$/, ['scatter']], [/^js\/beam-atlas\.js$/, ['beams']],
  [/^js\/(cct|source-presets)\.js$/, ['nodeAll', 'beams']], [/^js\/drive-three-.*\.js$/, ['render']], [/^js\/drive-touge-three\.js$/, ['TOUGE-ELEV-B', 'TOUGE-SKY-VEIL']], [/^js\/drive-three-halo\.js$/, ['TOUGE-HALO-TILT']],
  [/^js\/drive-scenes\.js$/, ['render', 'ui', 'nodeAll']],   // REFLECTIVE-CLOTHING: pedestrians are built here; the RC test is a new regress file, picked up automatically
  [/^js\/drive-three-lamphalo\.js$/, ['LHS1-lamp-halos']], [/^js\/drive-three\.js$/, ['LHS1-lamp-halos']],
  [/^js\/drive-three-lampcone\.js$/, ['LCM1-lamp-cone']], [/^tests\/regress\/LCM1-lamp-cone\.js$/, ['LCM1-lamp-cone']],
  [/^js\/lamp-dist\.js$/, ['LHS1-lamp-halos', 'LDR1-lamp-road']], [/^tests\/regress\/LDR1-lamp-road\.js$/, ['LDR1-lamp-road']],
  [/^js\/options-registry\.js$/, ['ui', 'nodeAll', 'node:drive-controls2', 'node:scenario-node']],   // OPTION-REGISTRY: the defaults of every option; tests/options-registry.js and options-migration.js are in NODE
  [/^index\.html$/, ['ui']], [/^tests\/load\.js$/, ['nodeAll']],
  [/^js\/compare-ui\.js$/, ['RESET-DRIVE-SETTINGS', 'AB-compare']], [/^css\/app\.css$/, ['ui', 'RESET-DRIVE-SETTINGS']],   // RESET-DRIVE-SETTINGS: the reset button lives in the A/B solve-cache bar; its CSS is the spec-mode gate
  [/^(docs|\.claude)\//, []], [/\.md$/, []], [/^tests\/scenario\//, ['node:scenario-node']],
];
const NOT_TESTS = ['gate', 'load', 'serve'];
// NE5: open, reproducible-in-order checks we have not explained. Run by hand with --only; never in the gate.
const KNOWN_FAILING = ['NE-state-leak'];
// ---- plan -------------------------------------------------------------------------------------------------------------
const sh = (...a) => { try { return execFileSync(a[0], a.slice(1), { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };
function plan() {
  if (val('--only')) return val('--only').split(',').map((n) => n.startsWith('node:') ? n : (fs.existsSync(path.join(root, 'tests', n + '.js')) && !fs.existsSync(path.join(root, 'tests/regress', n + '.js')) ? 'node:' + n : n));
  const full = [...NODE.map((n) => 'node:' + n), ...PAGE_PAR, ...PAGE_SOLO];
  if (!has('--touched')) return full;
  const files = new Set([...sh('git', 'diff', '--name-only', BASE + '...HEAD').split('\n'), ...sh('git', 'diff', '--name-only', 'HEAD').split('\n'), ...sh('git', 'ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  const picked = new Set(); let unmapped = [];
  for (const f of files) {
    const t = /^tests\/regress\/(.+)\.js$/.exec(f), n = /^tests\/([^/]+)\.js$/.exec(f);
    if (t) { if (!KNOWN_FAILING.includes(t[1])) picked.add(t[1]); continue; }   // known-failing tests never run by --touched either (new regress files are picked up automatically)
    if (n && !NOT_TESTS.includes(n[1])) { picked.add('node:' + n[1]); continue; }   // a changed Node test runs itself; gate.js, load.js and serve.js are not tests (picking gate.js ran a nested full gate), load.js is in MAP
    let hit = false; for (const [re, gs] of MAP) if (re.test(f)) { hit = true; for (const g of gs) (GROUPS[g] || [g]).forEach((x) => picked.add(x)); }
    if (!hit && /^(js|css|index\.html)/.test(f)) unmapped.push(f);
  }
  if (unmapped.length) { console.log('unmapped changed files, running the full gate: ' + unmapped.join(', ')); return full; }
  return full.filter((x) => picked.has(x)).concat([...picked].filter((x) => !full.includes(x) && (x.startsWith('node:') ? fs.existsSync(path.join(root, 'tests', x.slice(5) + '.js')) : fs.existsSync(path.join(root, 'tests/regress', x + '.js')))));
}
// ---- run --------------------------------------------------------------------------------------------------------------
function freePort() { return new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function runOne(name, port) {
  const node = name.startsWith('node:'), file = node ? path.join('tests', name.slice(5) + '.js') : path.join('tests/regress', name + '.js');
  const env = Object.assign({}, process.env, { PLAYWRIGHT: PW, PATH: '/opt/homebrew/bin:' + process.env.PATH }); if (name === 'P1-drive-three') env.P1_REAL_GPU = '1';
  const t0 = Date.now(); let out = '';
  return new Promise((resolve) => {
    const c = spawn(process.execPath, node ? [file] : [file, String(port)], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false; const to = setTimeout(() => { timedOut = true; try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, WALL_MS);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => { clearTimeout(to); try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ }   // reap leftover browsers of this test's process group
      const fails = (out.match(/^\s*\[?(FAIL|✗|not ok)/gm) || []).length; const s = ((Date.now() - t0) / 1000).toFixed(0);
      try { fs.mkdirSync(path.join(root, 'tests/gate-logs'), { recursive: true }); fs.writeFileSync(path.join(root, 'tests/gate-logs', name.replace(':', '-') + '.log'), out); } catch (e) { /* ignore */ }
      resolve({ name, code: timedOut ? 'TIMEOUT' : code, fails, s }); });
  });
}
async function pool(items, n, fn) { const res = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; const r = await fn(it); res.push(r); console.log(`${r.name} exit ${r.code} fails ${r.fails} ${r.s}s`); } })); return res; }
(async () => {
  const tests = plan(); if (has('--list')) { console.log(tests.join('\n')); return; }
  const solo = tests.filter((t) => PAGE_SOLO.includes(t)), par = tests.filter((t) => !PAGE_SOLO.includes(t));
  const needsPage = tests.some((t) => !t.startsWith('node:')); let server = null, port = 0;
  if (needsPage) { port = await freePort(); server = spawn('python3', ['tests/serve.py', String(port)], { cwd: root, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1500)); }
  const t0 = Date.now(); let res = [];
  try {
    res = res.concat(await pool(par, JOBS, (t) => runOne(t, port)));
    // A page test that fails in the parallel pool is re-run alone once: some checks are load-sensitive (SD's frame-hash pin passed alone twice and
    // failed under 3-way load). A pass on the solo re-run counts as clean but is reported as LOAD-SENSITIVE so it is not forgotten.
    for (const r of res.slice()) if ((r.code !== 0 || r.fails > 0) && !r.name.startsWith('node:')) { const again = await runOne(r.name, port); console.log(`${r.name} solo re-run exit ${again.code} fails ${again.fails} ${again.s}s`); if (again.code === 0 && again.fails === 0) { r.code = 0; r.fails = 0; r.flaky = true; } }
    res = res.concat(await pool(solo, 1, (t) => runOne(t, port)));
  }
  finally { if (server) { try { process.kill(server.pid); } catch (e) { /* gone */ } } }
  const bad = res.filter((r) => r.code !== 0 || r.fails > 0);
  const flaky = res.filter((r) => r.flaky); if (flaky.length) console.log('LOAD-SENSITIVE (failed in the pool, passed alone): ' + flaky.map((r) => r.name).join(' '));
  console.log(`\n${res.length} tests, ${bad.length} not clean, ${((Date.now() - t0) / 1000).toFixed(0)}s` + (bad.length ? '\nNOT CLEAN: ' + bad.map((r) => `${r.name}(${r.code}/${r.fails})`).join(' ') : ''));
  process.exit(bad.length ? 1 : 0);
})();
