// G33 regression (Playwright): node tests/regress/G33-stroke-gaps.js [port]
// A fast paint stroke (few pointermove samples) must leave no gaps: dabs are stamped along the segment.  Needs: python3 tests/serve.py 8831
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
  const { browser, page, errors } = await open();
  await page.evaluate(() => { RF.UI.setMode('A'); RF.UI.setAuto('paint', false); RF.UI.clearPaint(); RF.UI.setPane('editor', 'activate'); }); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const row = () => page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint, R = RF.UI.store.scene.target.res; let best = -1, bc = 0; for (let j = 0; j < R; j++) { let c = 0; for (let i = 0; i < R; i++) if (p[j * R + i] > 0) c++; if (c > bc) { bc = c; best = j; } } let lo = R, hi = -1; for (let i = 0; i < R; i++) if (p[best * R + i] > 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); } return { span: hi - lo + 1, filled: bc, undo: RF.UI.hist.past.length }; });
  const base = (await row()).undo;
  for (const steps of [40, 8, 2, 1]) {
    await page.evaluate(() => RF.UI.clearPaint());
    await page.mouse.move(r.x + r.w * 0.2, r.y + r.h * 0.5); await page.mouse.down();
    await page.mouse.move(r.x + r.w * 0.8, r.y + r.h * 0.5, { steps }); await page.mouse.up(); await page.waitForTimeout(100);
    const s = await row();
    ok('stroke in ' + steps + ' move step(s) leaves no gap (filled == span)', s.span > 20 && s.filled === s.span, JSON.stringify(s));
  }
  await page.evaluate(() => { RF.UI.clearPaint(); }); const u0 = (await row()).undo;
  await page.mouse.move(r.x + r.w * 0.2, r.y + r.h * 0.5); await page.mouse.down(); await page.mouse.move(r.x + r.w * 0.8, r.y + r.h * 0.5, { steps: 2 }); await page.mouse.up(); await page.waitForTimeout(100);
  ok('the whole stroke is one undo entry', (await row()).undo - u0 <= 1, 'entries added ' + ((await row()).undo - u0));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
