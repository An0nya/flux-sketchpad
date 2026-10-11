// G11: a paint stroke / a tap must not leave the Result stuck on the 1,500-ray preview. node tests/regress/G11-preview-upgrade.js [port]
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8824);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identifies as Flux (RF.UI exists)', await page.evaluate(() => !!(window.RF && RF.UI)));
  const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  const R = () => page.evaluate(() => ({ preview: RF.UI.run.preview, N: RF.UI.run.ctx.N, status: document.getElementById('run-state').textContent }));
  const rect = () => page.evaluate(() => { const r = document.getElementById('left-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // paint stroke, Mode A
  await page.evaluate(() => RF.UI.setMode('A')); await page.waitForTimeout(200);
  let r = await rect();
  await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.4); await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.7, r.y + r.h * 0.6, { steps: 40 }); await page.mouse.up();
  await idle(); await page.waitForTimeout(2500);
  let s = await R();
  ok('after a paint stroke the trace is the full one', !s.preview && s.N > 1500, JSON.stringify(s));
  // tap adds a profile point, Profile mode (Mode C)
  await page.evaluate(() => RF.UI.setMode('C')); await page.waitForTimeout(300);
  await page.evaluate(() => { const s = document.getElementById('preset-select'); s.value = 'parabola'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#preset-confirm button.primary').click());
  await page.waitForTimeout(300); await idle(); await page.waitForTimeout(1500);
  r = await rect();
  await page.mouse.click(r.x + r.w * 0.8, r.y + r.h * 0.85);
  await idle(); await page.waitForTimeout(2500);
  s = await R();
  ok('after a tap the trace is the full one', !s.preview && s.N > 1500, JSON.stringify(s));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
