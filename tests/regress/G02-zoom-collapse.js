// G02 regression (Playwright, Chromium): node tests/regress/G02-zoom-collapse.js [port]
// A zoomed 2D map must keep finite s/ox/oy after its canvas was 0x0 (pane collapsed) and reopened.  Needs: python3 tests/serve.py 8821
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.vLeft && RF.UI.vHeat && RF.UI.setPane)));
  const fin = (key) => page.evaluate((k) => { const v = RF.UI[k]; return { s: v.s, ox: v.ox, oy: v.oy, ok: [v.s, v.ox, v.oy].every(Number.isFinite) && v.s > 0 }; }, key);
  for (const [pane, cid, key, reset] of [['editor', 'left-canvas', 'vLeft', 'left'], ['result', 'heat-canvas', 'vHeat', 'heat']]) {
    await page.evaluate((p) => RF.UI.setPane(p, 'activate'), pane);
    if (await page.evaluate((p) => RF.UI.layout.collapsed[p], pane)) await page.evaluate((p) => RF.UI.setPane(p, 'collapse'), pane);   // toggles open if it was closed
    await page.waitForTimeout(400);
    const box = await page.locator('#' + cid).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); }
    await page.waitForTimeout(300);
    const z = await fin(key);
    ok(pane + ': zoomed view is finite before collapse', z.ok && await page.evaluate((k) => RF.UI[k].zoomed, key), JSON.stringify(z));
    await page.click(`button.collapse[data-collapse="${pane}"]`); await page.waitForTimeout(500);
    await page.click(`.pane[data-pane="${pane}"] h2`); await page.waitForTimeout(700);
    const r = await fin(key);
    ok(pane + ': zoomed view is finite after collapse + reopen', r.ok, JSON.stringify(r));
    await page.click(`button[data-reset="${reset}"]`); await page.waitForTimeout(300);
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
