// G02b regression (Playwright): node tests/regress/G02b-spec-zoom-collapse.js [port]
// Spec mode: a zoomed far-field / road / drive view must keep a finite s/ox/oy after the Result pane was collapsed (canvas 0x0) and reopened.  Needs: python3 tests/serve.py 8825
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.vHeat && RF.UI.setPane && RF.SpecUI)));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  const fin = () => page.evaluate(() => { const v = RF.UI.vHeat; return { s: v.s, ox: v.ox, oy: v.oy, w: v.w, h: v.h, zoomed: v.zoomed, ok: [v.s, v.ox, v.oy].every(Number.isFinite) && v.s > 0 }; });
  for (const disp of ['ff', 'road', 'drive']) {
    await page.evaluate((d) => RF.UI.setDisplay(d), disp); await page.waitForTimeout(2500);
    if (await page.evaluate(() => RF.UI.layout.collapsed.result)) { await page.click('.pane[data-pane="result"] h2'); await page.waitForTimeout(500); }
    if (disp !== 'drive') {   // the drive picture is a fixed-aspect image; zoom is the shared 2D view for the others
      const box = await page.locator('#heat-canvas').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); }
      await page.waitForTimeout(300);
      if (!await page.evaluate(() => RF.UI.vHeat.zoomed)) { await page.evaluate(() => { const v = RF.UI.vHeat; v.zoomAt(2, v.w / 2, v.h / 2); RF.UI.redrawSpec(); }); await page.waitForTimeout(300); }   // wheel did not zoom this display: zoom through the view
    }
    const z = await fin(); ok(disp + ': view is finite before collapse (zoomed ' + await page.evaluate(() => RF.UI.vHeat.zoomed) + ')', z.ok, JSON.stringify(z));
    await page.click('button.collapse[data-collapse="result"]'); await page.waitForTimeout(600);
    await page.evaluate(() => RF.UI.redrawSpec()); await page.waitForTimeout(300);   // draw while the canvas is 0x0
    const mid = await fin();
    await page.click('.pane[data-pane="result"] h2'); await page.waitForTimeout(900);
    const r = await fin(); ok(disp + ': view is finite after collapse + reopen', r.ok, JSON.stringify({ mid, r }));
    if (z.zoomed) ok(disp + ': the zoom survives collapse + reopen (same scale, still zoomed)', r.zoomed && Math.abs(r.s / z.s - 1) < 0.01, 'before s ' + z.s + ', after s ' + r.s + ', zoomed ' + r.zoomed);
    const px = await page.evaluate(() => { const cv = document.getElementById('heat-canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 50) if (d[i]) n++; return n; });
    ok(disp + ': the reopened canvas shows a picture', px > 0, 'non-transparent samples ' + px);
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
