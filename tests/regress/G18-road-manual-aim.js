// G18 regression (Playwright): node tests/regress/G18-road-manual-aim.js [port]
// Road "Manual inclination" must put the beam's cut-off on the set slope whatever the judge's Aim mode.  Needs: python3 tests/serve.py 8825
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.Road)));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  await setRow('^Aim on the car', 'manual'); await setRow('^Inclination', '-1'); await page.waitForTimeout(800);
  for (const mode of ['cutoff', 'design', 'peak', 'manual']) {
    await setRow('^Aim$', mode); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const ev = RF.UI.spec.ev, rd = RF.SpecUI.roadModel(RF.UI); return { cutV: ev.aim.cutV, sh: rd.sh }; });
    // the road reads the beam at V + sh[1], so the cut-off lands at cutV - sh[1] = -1 % of slope (-0.573 deg)
    ok('aim=' + mode + ': the cut-off sits at -1 % (0.573 deg D) on the road', isFinite(r.cutV) && Math.abs((r.cutV - r.sh[1]) + 0.5729) < 0.01, JSON.stringify(r));
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
