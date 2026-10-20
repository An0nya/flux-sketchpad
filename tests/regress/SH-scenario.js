// SH page checks: the scenario harness in the browser, on two examples (road-dry, forest-fog200-beam).
// Run (worktree): python3 tests/serve.py 8995  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SH-scenario.js 8995
// Exits 1 on any failure. Writes tests/scenario/out/<name>.json and PNGs (gitignored).
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const port = +(process.argv[2] || 8995);
const scen = require('../scenario/run.js'), schema = require('../scenario/schema.js'), { runBrowserAll } = require('../scenario/browser.js');
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
(async () => {
  try {
    const dv = schema.readDvDefaults(), keys = schema.readOptionKeys();
    const names = ['road-dry.json', 'forest-fog200-beam.json'];
    const list = names.map((f) => scen.loadScenarios(path.join(scen.EXAMPLE_DIR, f), dv, keys)[0]);
    const outs = await runBrowserAll(list, port, dv);
    for (const s of list) {
      const doc = JSON.parse(fs.readFileSync(path.join(scen.OUT_DIR, s.name + '.json'), 'utf8')), c = doc.counters || {};
      ok(s.name + ': GPU renderer on, no GPU failure', c.renderer === 'three' && !c.gpuFailure, JSON.stringify({ renderer: c.renderer, gpuFailure: c.gpuFailure }));
      ok(s.name + ': no page errors', (c.errors || []).length === 0, JSON.stringify((c.errors || []).slice(0, 2)));
      ok(s.name + ': same-session rerun gives identical frame hashes', c.rerunSame === true && doc.captures.every((x) => x.rerunSame), doc.captures.map((x) => x.name + ' ' + x.hash.slice(0, 10)).join(', '));
      const pngOk = doc.captures.every((x) => crypto.createHash('sha256').update(fs.readFileSync(path.join(scen.OUT_DIR, path.basename(x.png)))).digest('hex') === x.hash);
      ok(s.name + ': each recorded hash is the sha256 of its PNG file', pngOk);
      ok(s.name + ': regions and luminance are finite and in range', doc.captures.every((x) => Number.isFinite(x.luma) && x.luma >= 0 && x.luma <= 255 && Object.values(x.regions).every((v) => Number.isFinite(v) && v >= 0 && v <= 255)));
    }
    const road = JSON.parse(fs.readFileSync(path.join(scen.OUT_DIR, 'road-dry.json'), 'utf8'));
    ok('road-dry: the drive changes the frame (start and end hashes differ)', road.captures[0].hash !== road.captures[1].hash);
    const fog = JSON.parse(fs.readFileSync(path.join(scen.OUT_DIR, 'forest-fog200-beam.json'), 'utf8'));
    ok('forest-fog200-beam: the beam options are recorded in the output', fog.options.visibility === 200 && fog.options.scatter === 16 && fog.options.scatterMode === 'direct', JSON.stringify(fog.options));
    ok('the runner returned one output per scenario', outs.length === 2);
  } catch (e) { ok('SH page run completed', false, String(e && e.stack || e).slice(0, 400)); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SH page checks passed');
  process.exitCode = fails ? 1 : 0;
})();
