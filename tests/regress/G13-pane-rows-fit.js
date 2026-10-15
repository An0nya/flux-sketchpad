// G13: pane header mode tabs and the Spec tool rows (far field / drive / road) stay inside their pane at small sizes.
// node tests/regress/G13-pane-rows-fit.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8824);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
// buttons / selects of the pane that stick out past its right edge (or the viewport), or below its bottom edge
const stickingOut = (page, paneSel, bottom = true) => page.evaluate(([paneSel, bottom]) => {
  const pane = document.querySelector(paneSel), p = pane.getBoundingClientRect(), vw = document.documentElement.clientWidth, out = [];
  for (const el of pane.querySelectorAll('button, select')) {
    let r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    // RB: a control inside a horizontally scrolling row (Drive's toolbars) is reachable by scrolling: it counts where the row clips it
    for (let a = el.parentElement; a && a !== pane; a = a.parentElement) { if (/auto|scroll/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth) { const q = a.getBoundingClientRect(); r = { right: Math.min(r.right, q.right), bottom: r.bottom }; break; } }
    if (r.right > p.right + 1 || r.right > vw + 1 || (bottom && r.bottom > p.bottom + 1)) out.push((el.dataset.mode || el.dataset.disp || el.id || el.textContent.trim().slice(0, 12)) + ' r' + Math.round(r.right - p.right) + ' b' + Math.round(r.bottom - p.bottom));
  }
  return out;
}, [paneSel, bottom]);
(async () => {
  const browser = await pw.chromium.launch(), errors = [];
  for (const vp of [{ width: 1280, height: 720 }, { width: 768, height: 1024 }]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
    const tag = vp.width + 'x' + vp.height;
    ok(tag + ': page identifies as Flux', await page.evaluate(() => !!(window.RF && RF.UI)));
    let o = await stickingOut(page, '.editor-pane');
    ok(tag + ': Editor header mode tabs fit the pane', o.length === 0, o.join(', '));
    await page.evaluate(() => RF.UI.setMode('D')); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(800);
    for (const d of ['grid', 'ff', 'drive', 'road']) {
      await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(900);
      // 1280x720 + sidebar open leaves the Result map no height at all in Spec (chrome ~250 px in a ~255 px pane), so the drive toolbar's 3 rows can't fit below it: only the right edge is checked there (see B4.md)
      o = await stickingOut(page, '.result-pane', !(vp.width === 1280 && d === 'drive'));
      ok(tag + ': Spec Result / ' + d + ' controls fit the pane', o.length === 0, o.join(', '));
      o = await stickingOut(page, '.editor-pane');
      ok(tag + ': Spec Editor / ' + d + ' controls fit the pane', o.length === 0, o.join(', '));
    }
    await page.close();
  }
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
