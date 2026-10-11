const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://localhost:8806/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  const before = errs.length;
  await page.evaluate(() => RF.UI.setMode('B'));
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, caption: document.getElementById('left-caption').textContent }));
  await page.screenshot({ path: 'picker-modeB.png' });
  let direct; try { direct = await page.evaluate(() => { try { RF.Render2D.drawPicker(document.createElement('canvas'), RF.UI.vPick, RF.UI.store.scene, RF.UI.store.reports, null); return 'ok'; } catch (e) { return String(e); } }); } catch (e) { direct = String(e); }
  console.log(JSON.stringify({ st, errorsInModeB: errs.length - before, sample: errs.slice(before, before + 2), direct }));
  await browser.close();
})();
