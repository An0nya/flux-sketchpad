// G01 regression + "draw every view in every mode" self-test (Playwright, Chromium): node tests/regress/G01-draw-all-views.js [port]
// Needs a server: python3 tests/serve.py 8821.  Not in tests/all.js (needs a browser).
// For each mode (A-D) x each heat display x each Optics view style: switch to it, let the tick loop draw, and fail on any
// page error / console error (a ReferenceError in a draw path stalls the loop).  Plus: Stamp mode's picker canvas is not blank.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8821);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.Render2D)));
  const displays = await page.evaluate(() => [...document.querySelectorAll('#heat-display button')].map((b) => b.dataset.disp));
  const styles = await page.evaluate(() => [...document.querySelectorAll('[data-control-view="surfaceView"] option')].map((o) => o.value));
  ok('found heat displays and Optics view styles', displays.length >= 3 && styles.length === 3, displays.join(',') + ' | ' + styles.join(','));
  const base = errors.length;
  for (const mode of ['A', 'B', 'C', 'D']) {
    await page.evaluate((m) => RF.UI.setMode(m), mode);
    await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 }).catch(() => {});
    for (const d of displays) {
      const e0 = errors.length;
      await page.evaluate((d) => RF.UI.setDisplay(d), d);
      for (const s of styles) { await page.evaluate((s) => { const el = document.querySelector('[data-control-view="surfaceView"]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); }, s); await page.waitForTimeout(60); }
      await page.waitForTimeout(150);
      ok('mode ' + mode + ' / display ' + d + ': draws without errors', errors.length === e0, errors.slice(e0, e0 + 2).join(' || '));
    }
    await page.evaluate(() => RF.UI.setDisplay('grid'));
  }
  // Stamp mode: the direction picker (left canvas) has drawn real pixels
  await page.evaluate(() => RF.UI.setMode('B')); await page.waitForTimeout(500);
  const px = await page.evaluate(() => { const c = document.getElementById('left-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return { n, w: c.width, h: c.height }; });
  ok('Stamp mode: picker canvas is not blank', px.n > 0.05 * px.w * px.h, px.n + ' of ' + px.w * px.h + ' px painted');
  ok('no page errors overall', errors.length === base, [...new Set(errors.slice(base).map((e) => e.split('\n')[0]))].slice(0, 3).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
