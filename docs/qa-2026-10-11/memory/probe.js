const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  const info = await page.evaluate(() => ({
    title: document.title, mode: RF.UI.store.scene.mode,
    solvers: RF.Solvers.list().map((d) => d.id + (d.worker ? '(w)' : '') + '[' + (d.modes || []).join('') + ']'),
    disp: [...document.querySelectorAll('#heat-display button')].map((b) => b.dataset.disp),
    specPresets: Object.keys(RF.Spec.PRESETS), solve: RF.UI.store.scene.solve, lastGenMs: RF.UI.lastGenMs,
    surfView: [...document.querySelectorAll('[data-control-view="surfaceView"] option')].map((o) => o.value),
    rays: RF.UI.store.scene.sim, res: RF.UI.store.scene.target.res,
    panes: [...document.querySelectorAll('[data-collapse]')].map((b) => b.dataset.collapse),
  }));
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
