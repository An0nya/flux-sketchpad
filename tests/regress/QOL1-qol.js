// node tests/regress/QOL1-qol.js 8788 — tester only; uses the same assertions as the running owner runner.
const fs = require('fs'), path = require('path'), pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const port = +(process.argv[2] || 8788), root = path.join(__dirname, '../..'); let fails = 0;
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  try {
    for (const mode of ['safe', 'phone', 'reload', 'features', '?safe', '#safe']) {
      const ctx = await browser.newContext({ viewport: mode === 'phone' || mode === 'safe' ? { width: 428, height: 926 } : { width: 1440, height: 900 }, hasTouch: mode === 'phone' || mode === 'safe' });
      const scene = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/MG2-default-lamp.json'), 'utf8')); if (mode === 'phone') scene.sim.rays = 4000000;
      await ctx.addInitScript(({ scene, mode }) => { if (!sessionStorage.getItem('qolInit')) { localStorage.clear(); localStorage.setItem('faceted-reflector-demo/scene/v1', JSON.stringify(scene)); localStorage.setItem('flux/rayCap', 'off'); if (mode === 'safe') localStorage.setItem('flux/booting', '1'); sessionStorage.setItem('qolInit', '1'); } window.qolSavedGeometry = JSON.stringify(scene.groups.A.surfaces); }, { scene, mode });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (/^\[(PASS|FAIL)\]/.test(m.text())) console.log(m.text()); });
      await page.goto('http://127.0.0.1:' + port + '/index.html' + (mode.startsWith('?') || mode.startsWith('#') ? mode : ''));
      await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store);
      await page.addScriptTag({ path: path.join(__dirname, 'QOL1-checks.js') });
      if (mode.startsWith('?') || mode.startsWith('#')) {
        const safe = await page.evaluate(port => RF.UI && RF.UI.safeMode && !RF.UI.run && !RF.UI.solving && location.port === String(port), port);
        console.log((safe ? '[PASS] ' : '[FAIL] ') + 'QOL1 URL ' + mode); if (!safe) fails++;
      } else { const checks = await page.evaluate(([mode, port]) => window.qol1Checks(mode, port), [mode, port]); fails += checks.filter(c => !c.pass).length; }
      if (errors.length) { console.log('[FAIL] QOL1 page errors ' + errors.join('\n')); fails++; }
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all QOL1 page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
