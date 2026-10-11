// G32 regression (Playwright): node tests/regress/G32-paint-gesture.js [port]
// Paint must not be committed before the gesture is known: a pinch (second finger) or a double-click reset paints nothing and adds no undo entry;
// a plain click still paints (one undo entry), a drag still paints.  Needs: python3 tests/serve.py 8831
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8831);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
async function open(opts) {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, hasTouch: !!(opts && opts.touch) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.UI.vLeft)));
  return { browser, ctx, page, errors };
}
(async () => {
  // ---- mouse: double-click, single click, drag
  {
    const { browser, page, errors } = await open();
    await page.evaluate(() => { RF.UI.setMode('A'); RF.UI.setAuto('paint', false); RF.UI.clearPaint(); RF.UI.setPane('editor', 'activate'); }); await page.waitForTimeout(400);
    const lb = await page.locator('#left-canvas').boundingBox();
    const S = () => page.evaluate(() => ({ cells: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, past: RF.UI.hist.past.length }));
    const s0 = await S();
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(300);
    const z0 = await page.evaluate(() => RF.UI.vLeft.zoomed);
    await page.mouse.dblclick(lb.x + lb.width * 0.3, lb.y + lb.height * 0.3); await page.waitForTimeout(900);
    const s1 = await S();
    ok('double-click reset: nothing painted', s1.cells === s0.cells, JSON.stringify(s1));
    ok('double-click reset: no undo entry', s1.past === s0.past, JSON.stringify(s1));
    ok('double-click still resets the view (was zoomed ' + z0 + ')', z0 === true && (await page.evaluate(() => RF.UI.vLeft.zoomed)) === false);
    await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5); await page.waitForTimeout(900);
    const s2 = await S();
    ok('a single click still paints, as one undo entry', s2.cells > 0 && s2.past === s0.past + 1, JSON.stringify(s2));
    await page.mouse.move(lb.x + lb.width * 0.2, lb.y + lb.height * 0.8); await page.mouse.down(); await page.mouse.move(lb.x + lb.width * 0.5, lb.y + lb.height * 0.8, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    const s3 = await S();
    ok('a drag still paints, as one undo entry', s3.cells > s2.cells + 5 && s3.past === s2.past + 1, JSON.stringify(s3));
    ok('no page errors (mouse)', errors.length === 0, errors.slice(0, 2).join(' || '));
    await browser.close();
  }
  // ---- touch: two-finger pinch
  {
    const { browser, page, ctx, errors } = await open({ touch: true });
    await page.evaluate(() => { RF.UI.setMode('A'); RF.UI.setAuto('paint', false); RF.UI.clearPaint(); RF.UI.setPane('editor', 'activate'); }); await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p[0], y: p[1], id: p[2] })) });
    const S = () => page.evaluate(() => ({ cells: RF.UI.store.scene.modeA.paint.filter((x) => x > 0).length, past: RF.UI.hist.past.length, s: +RF.UI.vLeft.s.toFixed(3) }));
    const s0 = await S(), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    await T('touchStart', [[cx - 20, cy, 0]]); await page.waitForTimeout(40);
    await T('touchStart', [[cx - 20, cy, 0], [cx + 20, cy, 1]]);
    for (let k = 1; k <= 10; k++) await T('touchMove', [[cx - 20 - 6 * k, cy, 0], [cx + 20 + 6 * k, cy, 1]]);
    await T('touchEnd', [[cx + 80, cy, 1]]); await T('touchEnd', []); await page.waitForTimeout(900);
    const s1 = await S();
    ok('pinch zoomed the view', s1.s !== s0.s, JSON.stringify([s0, s1]));
    ok('pinch: nothing painted', s1.cells === s0.cells, JSON.stringify(s1));
    ok('pinch: no undo entry', s1.past === s0.past, JSON.stringify(s1));
    ok('no page errors (touch)', errors.length === 0, errors.slice(0, 2).join(' || '));
    await browser.close();
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
