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
const NODE = ['all', 'regress-node', 'glare-all', 'scatter-table', 'scatter-table-pace', 'scatter', 'scatter-fade-gain', 'fog', 'wetness', 'wet-ggx', 'foliage', 'beams', 'beam-atlas', 'traffic-beams', 'tl-traffic-taper', 'pass-parity', 'deer-tilt', 'scene-digest', 'scenery-params', 'tile-options', 'options-registry', 'options-migration', 'options-docs', 'share-presets', 'sampler-budget', 'high-dip', 'scatter-cull', 'canvas-shape'];
const PAGE_PAR = ['SB1-studs-everywhere', 'OV-scene-details', 'CD-controls-dedupe', 'UX2-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'PM-pass-mesh', 'PP-pass-parity', 'P2-drive-lighting', 'WG-wet-ggx', 'WT-wetness', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range',
  // FULL-COVERAGE (owner 2026-10-27): these used to run only via the --touched map, and 4 of them sat stale on main after a change in another file. Agents: --full is for merge checkpoints only; use --touched.
  'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'TOUGE-SKY-VEIL', 'TOUGE-HALO-TILT', 'TOUGE-ELEV-B', 'LCM1-lamp-cone', 'GS1-glare-sources', 'BJ1-shadow-cache', 'BJ2-halo-table-pin', 'E2-pass-lamp-cone', 'E2-crest-occlusion', 'CD-lampcone-depth', 'HB-high-dip-gpu', 'SCULL-scatter-cull', 'SP-polar-auto', 'CPSM-cone-shadow', 'SPEED0-stop'];
const PAGE_SOLO = ['P1-drive-three', 'SE-table-pacing', 'AC-air-cache-generations'];   // P1 needs the real GPU; SE measures per-frame ms; AC sizes its budget from the measured ms per row
const GROUPS = {
  render: ['P1-drive-three', 'P2-drive-lighting', 'PM-pass-mesh', 'PP-pass-parity', 'WT-wetness', 'WG-wet-ggx', 'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'SF1-car-silhouette', 'BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'TL2-traffic-light-range', 'SB1-studs-everywhere', 'OV-scene-details'],
  ui: ['CD-controls-dedupe', 'UX2-drive-ux', 'DC-drive-controls', 'DW-drive-wheel', 'CPU-FALLBACK-PAUSE'],
  scatter: ['SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'AC-air-cache-generations', 'SF-silhouette-fade', 'SF1-car-silhouette', 'FG-fog', 'node:scatter', 'node:scatter-table', 'node:scatter-table-pace', 'node:scatter-fade-gain', 'node:fog'],
  beams: ['BT-traffic-beams', 'BA5-gpu-atlas', 'BA-beam-library-gpu', 'P1-drive-three', 'node:beams', 'node:beam-atlas', 'node:traffic-beams'],
  wet: ['WT-wetness', 'WG-wet-ggx', 'node:wetness', 'node:wet-ggx'],
  nodeAll: NODE.map((n) => 'node:' + n),
};
// First match wins per changed file; every match contributes (union). A changed js/ file with no match => full gate.
const MAP = [
  [/^js\/drive-three-shaders\.js$/, ['render', 'ui', 'node:sampler-budget']], [/^js\/drive-three(-objects|-models)?\.js$/, ['render', 'ui', 'PL3-powerlines-reflectance']],
  [/^js\/ui\.js$/, ['ui']], [/^js\/drive-anim\.js$/, ['render', 'ui', 'nodeAll', 'PL3-powerlines-reflectance', 'GS1-glare-sources', 'SPEED0-stop']], [/^js\/spec-ui\.js$/, ['ui', 'scatter', 'beams', 'node:options-migration', 'PL3-powerlines-reflectance']],
  [/^js\/drive\.js$/, ['render', 'nodeAll', 'PL3-powerlines-reflectance', 'GS1-glare-sources']], [/^js\/table-pace\.js$/, ['scatter']], [/^js\/beam-atlas\.js$/, ['beams']],
  [/^js\/(cct|source-presets)\.js$/, ['nodeAll', 'beams']], [/^js\/drive-three-.*\.js$/, ['render']], [/^js\/drive-touge-three\.js$/, ['TOUGE-ELEV-B', 'TOUGE-SKY-VEIL', 'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'BJ1-shadow-cache', 'E2-crest-occlusion', 'node:sampler-budget']], [/^js\/drive-three-(beamcone|shadowmaps|objects)\.js$/, ['CPSM-cone-shadow', 'node:sampler-budget']], [/^js\/drive-three-halo(-cull)?\.js$/, ['CPSM-cone-shadow', 'TOUGE-HALO-TILT', 'BJ2-halo-table-pin', 'E2-crest-occlusion', 'SCULL-scatter-cull', 'SP-polar-auto', 'node:scatter-cull', 'node:sampler-budget']],   // SC: the culling bound (drive-three-halo-cull.js) and its tests
  [/^js\/drive-scenes\.js$/, ['render', 'ui', 'nodeAll', 'PL1-powerlines']],
  [/^js\/drive-touge\.js$/, ['PL2-powerlines-pass', 'node:glare-all', 'E2-pass-lamp-cone']],   // REFLECTIVE-CLOTHING: pedestrians are built here; the RC test is a new regress file, picked up automatically
  [/^js\/drive-three-lamphalo\.js$/, ['LCM1-lamp-cone']],   // deleted in Brief U (kept so the deletion is not an unmapped change: the cone took its exports)
  [/^js\/drive-three\.js$/, ['LCM1-lamp-cone', 'TOUGE-AIR', 'TOUGE-AIR-RIBBON', 'AC-air-cache-generations', 'E2-crest-occlusion']],
  [/^js\/drive-three-lampcone\.js$/, ['LCM1-lamp-cone', 'E2-pass-lamp-cone', 'CD-lampcone-depth']], [/^tests\/regress\/LCM1-lamp-cone\.js$/, ['LCM1-lamp-cone']],
  [/^js\/drive-models\.js$/, ['node:deer-tilt', 'node:pass-parity', 'node:scene-digest', 'PM-pass-mesh', 'PP-pass-parity']], [/^tests\/deer-tilt\.js$/, ['node:deer-tilt']],   // DEER-TILT (Brief T)
  [/^tests\/regress\/GS1-glare-sources\.js$/, ['GS1-glare-sources']],
  [/^js\/lamp-dist\.js$/, ['LCM1-lamp-cone', 'LDR1-lamp-road', 'GS1-glare-sources', 'node:glare-all']], [/^tests\/regress\/LDR1-lamp-road\.js$/, ['LDR1-lamp-road']],
  [/^js\/options-registry\.js$/, ['ui', 'nodeAll', 'node:drive-controls2', 'node:scenario-node']],   // OPTION-REGISTRY: the defaults of every option; tests/options-registry.js and options-migration.js are in NODE
  [/^js\/share-presets\.js$/, ['ui', 'node:share-presets']],   // SHARE-PRESET: #preset=<name> links; tests/share-presets.js
  [/^tests\/drive-three-page\.js$/, ['P1-drive-three', 'FG-fog', 'SC-beam-scatter']],
  [/^index\.html$/, ['ui']], [/^js\/drive-layout\.js$/, ['ui', 'render', 'nodeAll']],   // UI step C: the drive layout shell moves every drive control and sizes the canvas
  [/^tests\/load\.js$/, ['nodeAll']],
  [/^js\/compare-ui\.js$/, ['RESET-DRIVE-SETTINGS', 'AB-compare']], [/^css\/app\.css$/, ['ui', 'RESET-DRIVE-SETTINGS']],   // RESET-DRIVE-SETTINGS: the reset button lives in the A/B solve-cache bar; its CSS is the spec-mode gate
  [/^(docs|\.claude)\//, []], [/\.md$/, []], [/^tests\/scenario\//, ['node:scenario-node']],
];
const NOT_TESTS = ['gate', 'load', 'serve', 'drive-three-page', 'pinned-defaults'];   // drive-three-page.js is the browser-side helper of P1/FG/SC (Brief U: it gained the lampCone argument), not a Node test; it is in MAP
// NE5: open, reproducible-in-order checks we have not explained. Run by hand with --only; never in the gate.
const KNOWN_FAILING = ['NE-state-leak'];
// ---- plan -------------------------------------------------------------------------------------------------------------
const sh = (...a) => { try { return execFileSync(a[0], a.slice(1), { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };
function plan() {
  if (val('--only')) return val('--only').split(',').map((n) => n.startsWith('node:') ? n : (fs.existsSync(path.join(root, 'tests', n + '.js')) && !fs.existsSync(path.join(root, 'tests/regress', n + '.js')) ? 'node:' + n : n));
  const exists = (x) => x.startsWith('node:') ? fs.existsSync(path.join(root, 'tests', x.slice(5) + '.js')) : fs.existsSync(path.join(root, 'tests/regress', x + '.js'));
  const curated = [...NODE.map((n) => 'node:' + n), ...PAGE_PAR, ...PAGE_SOLO];
  // FULL-COVERAGE 2 (10-29): --full also runs every test the MAP names, so a test reachable only via --touched cannot be skipped at a merge (4 were: CPU-FALLBACK-PAUSE, PL3, drive-controls2, scenario-node).
  const mapped = [...new Set(MAP.flatMap(([, gs]) => gs.flatMap((g) => GROUPS[g] || [g])))].filter((x) => !curated.includes(x) && !KNOWN_FAILING.includes(x) && exists(x));
  const full = curated.concat(mapped);
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
