// Tester: python3 tests/serve.py 8784; node tests/regress/P2-drive-lighting.js 8784
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright'), port = +(process.argv[2] || 8784);
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(String(e))); await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate(txt => RF.UI.loadScene(RF.State.deserialize(txt), 'P2 fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/p2-drive-lighting-page.js' }); const result = await page.evaluate(p => P2Page.run(p), port);
    const base = {}, files = { cpu: 'js/drive.js', renderer: 'js/drive-three.js', objects: 'js/drive-three-objects.js', shaders: 'js/drive-three-shaders.js' };
    for (const [k, file] of Object.entries(files)) base[k] = require('child_process').execFileSync('git', ['show', 'a95029b:' + file], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
    result.baseProof = await page.evaluate(base => P2Page.baseProof(base), base); result.pass = result.pass && result.baseProof.pass;
    console.log((result.baseProof.pass ? '[PASS] ' : '[FAIL] ') + 'P2 all-off CPU and GPU frames identical to base a95029b in eight cases');
    for (const c of result.checks) console.log((c.pass ? '[PASS] ' : '[FAIL] ') + c.name + (c.detail ? ' — ' + JSON.stringify(c.detail) : ''));
    console.log(JSON.stringify(result)); console.log((errors.length ? '[FAIL]' : '[PASS]') + ' P2 no page errors ' + JSON.stringify(errors)); process.exitCode = result.pass && !errors.length ? 0 : 1;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
