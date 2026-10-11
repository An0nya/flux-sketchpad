// G17 regression (Playwright): node tests/regress/G17-measure-target.js [port]
// Spec "Measure at: target" must follow the target when it moves (a link, not a snapshot).  Needs: python3 tests/serve.py 8825
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8825);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI)));
  const judged = () => page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.evaluate(() => RF.UI.setMode('D')); await judged();
  await page.click('#spec-box [data-dist="-1"]'); await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => ({ md: RF.UI.store.scene.modeD.distance, target: RF.UI.store.scene.target.distance, on: [...document.querySelectorAll('#spec-box [data-dist]')].filter((b) => b.classList.contains('on')).map((b) => b.textContent), G: RF.UI.spec && RF.UI.spec.G && RF.UI.spec.G.distance }));
  let s = await st(); ok('"target" button is on after clicking it', s.on.join() === 'target', JSON.stringify(s));
  await page.evaluate(() => { RF.UI.store.scene.target.distance = 5000; RF.UI.store.invalidate(['A', 'B', 'C', 'L']); RF.UI.afterChange(); });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 }); await page.waitForTimeout(1500);
  try { await judged(); } catch (e) { console.log('not judged', e.message); }
  s = await st();
  ok('"target" button stays on after the target moved to 5 m', s.on.join() === 'target', JSON.stringify(s));
  ok('the report measures at the new target distance (5000 mm)', s.G === 5000, JSON.stringify(s));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
