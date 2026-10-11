// G03 regression (Playwright, Chromium): node tests/regress/G03-zoom-limits.js [port]
// Wheel-zooming far out / in must stay inside [fit*0.05, fit*200] on the 3D cameras and the 2D maps.  Needs: python3 tests/serve.py 8821
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8821);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.camS && RF.UI.vHeat)));
  await page.evaluate(() => RF.UI.setAuto && RF.UI.setAuto('paint', false));
  // [canvas id, reader of {scale, fit}]; the 3D cameras' fit is the scale they start at (they are fitted at boot)
  const cams = { 'scene-canvas': 'cam', 'surface-canvas': 'camS' }, base = {};
  for (const [id, k] of Object.entries(cams)) base[id] = await page.evaluate((k) => RF.UI[k].scale, k);
  const read = { 'scene-canvas': () => ({ s: RF.UI.cam.scale, fit: window.__fit['scene-canvas'] }), 'surface-canvas': () => ({ s: RF.UI.camS.scale, fit: window.__fit['surface-canvas'] }),
    'heat-canvas': () => ({ s: RF.UI.vHeat.s, fit: RF.UI.vHeat.fitS }), 'left-canvas': () => ({ s: RF.UI.vLeft.s, fit: RF.UI.vLeft.fitS }) };
  await page.evaluate((b) => { window.__fit = b; }, base);
  for (const id of Object.keys(read)) {
    await page.evaluate((id) => { const el = document.getElementById(id).closest('.pane'); if (el && !el.classList.contains('active')) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, id);
    await page.waitForTimeout(100);
    const box = await page.locator('#' + id).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const get = (fn) => page.evaluate(`(${fn})()`);
    for (const [dir, label, test] of [[400, 'out', (r) => r.s >= r.fit * 0.05 * 0.999], [-400, 'in', (r) => r.s <= r.fit * 200 * 1.001]]) {
      for (let i = 0; i < 150; i++) await page.mouse.wheel(0, dir);
      await page.waitForTimeout(250);
      const r = await get(read[id]);
      ok(id + ': zoom ' + label + ' is limited', Number.isFinite(r.s) && r.fit > 0 && test(r), 'scale ' + r.s + ', fit ' + r.fit + ', ratio ' + (r.s / r.fit).toExponential(2));
      await page.evaluate(([k, b]) => { RF.UI.vHeat.fitted = false; RF.UI.vLeft.fitted = false; if (k) RF.UI[k].scale = b; }, [cams[id], base[id]]);
    }
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
