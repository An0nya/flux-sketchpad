// D-M03: the Optics turntable stops 10 s after the page goes idle, and when you click into Optics; nothing redraws it every frame afterwards.
// node tests/regress/D-M03-orbit.js [port] [--measure]   (needs a server: python3 tests/serve.py <port>; takes ~1.5 min)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833), measureOnly = process.argv.includes('--measure');
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const open = async (browser) => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  await page.addInitScript(() => { window.__raf = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => r((t) => { window.__raf++; cb(t); }); });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  if (!(await page.evaluate(() => !!(RF.UI && RF.UI.camS)))) throw new Error('not the Flux page'); return page;
};
const az = (page) => page.evaluate(() => RF.UI.camS.R.flat().map((v) => v.toFixed(4)).join());
const raf = (page, ms) => page.evaluate((ms) => new Promise((res) => { const a = window.__raf; setTimeout(() => res(window.__raf - a), ms); }), ms);
(async () => {
  const browser = await pw.chromium.launch();
  // 1. run + idle stop
  let page = await open(browser);
  const t0 = Date.now(); const a0 = await az(page); await page.waitForTimeout(1500);
  ok('the turntable runs after load', (await az(page)) !== a0);
  const busyFrames = await raf(page, 5000); console.log('       rAF callbacks in 5 s while orbiting: ' + busyFrames);
  await page.waitForTimeout(Math.max(0, 14000 - (Date.now() - t0)));       // load + ~14 s untouched
  const a1 = await az(page); await page.waitForTimeout(1500); const a2 = await az(page);
  ok('after ~10 s of idle the turntable has stopped', a1 === a2);
  const idleFrames = await raf(page, 15000); console.log('       rAF callbacks in 15 s idle (after it stopped): ' + idleFrames);
  if (!measureOnly) ok('idle: no per-frame redraw (< 60 rAF callbacks in 15 s)', idleFrames < 60, String(idleFrames));
  ok('the stop is permanent without input', (await az(page)) === a2);
  await page.close();
  // 2. input keeps it going; a click into Optics stops it
  page = await open(browser);
  const b = await page.locator('#surface-canvas').boundingBox();
  for (let i = 0; i < 14; i++) { await page.mouse.move(b.x - 40 - i, b.y - 20); await page.waitForTimeout(1000); }   // pointer activity outside Optics, 14 s
  const r1 = await az(page); await page.waitForTimeout(800);
  ok('page input keeps the turntable running past 10 s', (await az(page)) !== r1);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300);
  const c1 = await az(page); await page.waitForTimeout(1500);
  ok('a click into Optics stops it at once', (await az(page)) === c1);
  // 3. the sidebar option restarts it
  await page.evaluate(() => { const io = document.getElementById('idle-orbit'); io.value = '0'; io.dispatchEvent(new Event('input')); });   // step 0 = 0 s
  await page.waitForTimeout(1500);
  ok('the sidebar "idle orbit" option still restarts orbiting', (await az(page)) !== c1);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
