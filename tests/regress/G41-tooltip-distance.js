// G41 regression (Playwright): node tests/regress/G41-tooltip-distance.js [port]
// The footer verdict tooltip must say the measuring distance as it is (7.5 m), not rounded (8 m).  Needs: python3 tests/serve.py 8830
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8830);
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
  await page.click('#spec-box [data-dist="-1"]'); await page.waitForTimeout(800);
  await page.evaluate(() => { RF.UI.store.scene.target.distance = 7500; RF.UI.store.invalidate(['A', 'B', 'C', 'L']); RF.UI.afterChange(); });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 }); await page.waitForTimeout(1500);
  try { await judged(); } catch (e) { console.log('not judged', e.message); }
  await page.waitForTimeout(1500);
  const tip = await page.evaluate(() => ({ G: RF.UI.spec && RF.UI.spec.G && RF.UI.spec.G.distance, title: (document.querySelector('.tile.spec-v') || {}).title }));
  ok('the report measures at 7500 mm', tip.G === 7500, JSON.stringify(tip.G));
  ok('tooltip says "7.5 m", not a rounded distance', /Measured at 7\.5 m/.test(tip.title || ''), (tip.title || '').slice(-40));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
