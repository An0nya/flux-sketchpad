// G05: typed extremes in the sidebar are clamped (no tab freeze, no NaN lens, no off-target stamp).
// node tests/regress/G05-bounds.js [port]   (needs: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8822);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI && !!RF.UI.store));
  // 1. type an absurd target distance in the field, as a user would
  const f = page.locator('input[type=text][data-control="tgt.dist"]');
  let alive = true;
  try { await f.fill('1e10', { timeout: 20000 }); await f.press('Enter', { timeout: 20000 }); await page.evaluate(() => 1, null); await Promise.race([page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 1500)))), new Promise((_, rej) => setTimeout(() => rej(new Error('frozen')), 20000))]); } catch (e) { alive = false; }
  ok('typing 1e10 as the target distance does not freeze the tab', alive);
  if (alive) {
    ok('target distance was clamped to the control max', await page.evaluate(() => RF.UI.store.scene.target.distance <= RF.Controller.BY_ID['tgt.dist'].max), String(await page.evaluate(() => RF.UI.store.scene.target.distance)));
    // 2. a Fresnel lens with Rings N = 5000
    await page.evaluate(() => { RF.UI.store.scene.target.distance = 2000; RF.Controller.actions.addLens(RF.UI.store, 'fresnel'); RF.UI.store.invalidate(['L']); RF.UI.afterChange(); });
    await page.waitForTimeout(500);
    // the lens panel is collapsed (fields not visible): set the field and fire the same 'change' the UI listens to
    const typeLens = (key, val) => page.evaluate(([key, val]) => { const i = document.querySelector('input[data-lens$=".' + key + '"]'); if (!i) return false; i.value = val; i.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [key, val]);
    const t0 = Date.now(); ok('the lens panel has a Rings N field', await typeLens('rings', '5000'));
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ rings: RF.UI.store.scene.lenses[0].params.rings, n: RF.UI.store.scene.groups.L.surfaces.length }));
    ok('Rings N = 5000 is clamped (stored ' + r.rings + ', ' + r.n + ' surfaces, ' + (Date.now() - t0) + ' ms)', r.rings === 200 && r.n < 1000);
    // 3. a lens field cleared (NaN) is ignored
    await typeLens('ior', '0'); await page.waitForTimeout(300);
    ok('Index n = 0 is clamped to a usable value', await page.evaluate(() => { const p = RF.UI.store.scene.lenses[0].params; return p.ior >= 1.01 && !JSON.stringify(RF.UI.store.scene.groups.L.surfaces).includes('null'); }));
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})();
