// G16 regression (Playwright): node tests/regress/G16-spec-view-settings.js [port]
// Picture-only Spec settings (Drive / Road view rows) must redraw once and must not rebuild the road model or re-render the drive picture twice.
// Settings the road depends on (mounting height) must still rebuild it.  Needs: python3 tests/serve.py 8825
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.Road && RF.Drive)));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.evaluate(() => {
    window.__c = { model: 0, drive: 0, redraw: 0 };
    const wrap = (o, k, n) => { const f = o[k]; o[k] = function () { window.__c[n]++; return f.apply(this, arguments); }; };
    wrap(RF.Road, 'model', 'model'); wrap(RF.Drive, 'render', 'drive'); wrap(RF.UI, 'redrawSpec', 'redraw');
  });
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const counts = async (label, fn) => { await page.evaluate(() => { window.__c = { model: 0, drive: 0, redraw: 0 }; }); await fn(); await page.waitForTimeout(2500); return page.evaluate(() => Object.assign({}, window.__c)); };
  await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(3000);
  let c = await counts('RL', () => setRow('^Drive view: marking', '150'));
  ok('Drive marking reflectivity: one redraw, no road-model rebuild', c.redraw === 1 && c.model === 0, JSON.stringify(c));
  ok('Drive marking reflectivity: the drive picture is rendered once', c.drive === 1, JSON.stringify(c));
  await page.evaluate(() => RF.UI.setDisplay('road')); await page.waitForTimeout(1500);
  c = await counts('scale', () => setRow('^Road view: scale top', '20'));
  ok('Road view scale top: one redraw, no road-model rebuild', c.redraw === 1 && c.model === 0, JSON.stringify(c));
  c = await counts('mount', () => setRow('^Mounting height', '0.9'));
  ok('Mounting height still rebuilds the road model (once) and redraws once', c.model >= 1 && c.redraw === 1, JSON.stringify(c));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
