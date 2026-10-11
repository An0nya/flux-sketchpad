// G15 regression (Playwright): node tests/regress/G15-spec-footer.js [port]
// A judge-only Spec edit (Aim -> manual, then Manual aim) must refresh the footer tile at once, not on the 1 s stats tick.  Needs: python3 tests/serve.py 8825
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
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const cmp = () => page.evaluate(() => { const ev = RF.UI.spec.ev, f = document.querySelector('.tile.spec-v').innerText.split('\n')[0], rep = ev.n.pass + '✓ ' + ev.n.fail + '✗ ' + ev.n.unsure + '?'; return { same: f === rep, f, rep }; });
  await page.waitForTimeout(1500);
  await setRow('^Aim$', 'manual'); await page.waitForTimeout(200);   // well inside the 1 s stats tick
  let c = await cmp(); ok('footer matches the report 200 ms after Aim -> manual', c.same, JSON.stringify(c));
  for (let t = 0; t < 3; t++) {
    await page.evaluate((t) => { const h = document.querySelector('input[aria-label="Manual aim, beam up"]'); h.value = String(-0.5 * (t + 1)); h.dispatchEvent(new Event('change')); }, t);
    await page.waitForTimeout(150);
    c = await cmp(); ok('footer matches the report 150 ms after Manual up edit #' + t, c.same, JSON.stringify(c));
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
