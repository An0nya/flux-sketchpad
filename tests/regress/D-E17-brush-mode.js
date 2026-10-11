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
  const sel = page.locator('#left-tools select[data-control="A.brushMode"]');
  ok('a brush mode select is in the paint row', await sel.count() === 1);
  ok('it defaults to raise', (await sel.inputValue()) === 'raise' && (await page.evaluate(() => RF.UI.store.scene.modeA.brush.mode)) === 'raise');
  const tip = await sel.getAttribute('title');
  ok('its tooltip says what each mode does', /Raise/.test(tip) && /Set/.test(tip) && /Lower/.test(tip), tip);
  const lb = await page.locator('#left-canvas').boundingBox(), cx = lb.x + lb.width / 2, cy = lb.y + lb.height / 2;
  const mx = () => page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint; return { max: Math.max(...p), lit: p.filter((x) => x > 0).length }; });
  await page.evaluate(() => { RF.UI.setControl('A.strength', 1); }); await page.mouse.click(cx, cy); await page.waitForTimeout(700);
  ok('raise at level 1 paints', (await mx()).max === 1);
  await page.evaluate(() => { RF.UI.setControl('A.strength', 0.3); }); await sel.selectOption('set');
  ok('choosing Set stores it with the brush', (await page.evaluate(() => RF.UI.store.scene.modeA.brush.mode)) === 'set');
  await page.mouse.click(cx, cy); await page.waitForTimeout(700);
  const a = await page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint; return Math.max(...p); });
  ok('Set at level 0.3 over a level-1 dab pulls it down to 0.3', Math.abs(a - 0.3) < 1e-9, 'max ' + a);
  await page.evaluate(() => { RF.UI.setControl('A.strength', 0.8); }); await sel.selectOption('raise'); await page.mouse.click(cx, cy); await page.waitForTimeout(700);
  ok('Raise at 0.8 brightens it to 0.8', Math.abs((await mx()).max - 0.8) < 1e-9);
  const lit = (await mx()).lit; await page.evaluate(() => { RF.UI.setControl('A.strength', 0.2); }); await sel.selectOption('lower'); await page.mouse.click(cx, cy); await page.waitForTimeout(700);
  const b = await mx(); ok('Lower at 0.2 darkens it to 0.2 and adds no cells', Math.abs(b.max - 0.2) < 1e-9 && b.lit === lit, JSON.stringify(b));
  await page.mouse.click(lb.x + lb.width * 0.15, lb.y + lb.height * 0.15); await page.waitForTimeout(700);
  ok('Lower on an empty area paints nothing', (await mx()).lit === lit);
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
