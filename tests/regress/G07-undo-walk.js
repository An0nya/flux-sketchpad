// G07: Undo must walk back one edit per press (solver meta and lazy defaults are not edits); Undo is disabled after load.
// node tests/regress/G07-undo-walk.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8823);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  await idle();
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  ok('fresh load: Undo is disabled and the stack is empty', await page.evaluate(() => document.getElementById('btn-undo').disabled && RF.UI.hist.past.length === 0), 'past ' + await page.evaluate(() => RF.UI.hist.past.length));
  // a Spec visit creates modeD.road lazily; a solver-box render creates solverSettings; neither is an edit
  await page.evaluate(() => { RF.UI.setMode('D'); }); await page.waitForTimeout(800); await idle();
  await page.evaluate(() => { RF.UI.setMode('A'); }); await page.waitForTimeout(500); await idle();
  ok('visiting Spec and back makes no entry', await page.evaluate(() => RF.UI.hist.past.length === 0), 'past ' + await page.evaluate(() => RF.UI.hist.past.length));
  // profile preset (no solve key), then taps, then undo them all
  await page.evaluate(() => { const s = document.getElementById('preset-select'); s.value = 'parabola'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#preset-confirm button.primary').click()); await page.waitForTimeout(300); await idle();
  const S = () => page.evaluate(() => ({ n: RF.UI.store.scene.modeC.profile.length, past: RF.UI.hist.past.length }));
  const r = await page.evaluate(() => { const b = document.getElementById('left-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const s0 = await S();
  for (let i = 0; i < 4; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.85); await page.waitForTimeout(900); }
  await idle(); const s1 = await S();
  ok('4 slow taps add 4 profile points (' + s0.n + ' -> ' + s1.n + ')', s1.n === s0.n + 4);
  const trail = [];
  for (let i = 0; i < 4; i++) { await page.click('#btn-undo'); await page.waitForTimeout(400); await idle(); trail.push((await S()).n); }
  ok('4 Undos remove the 4 points one at a time (points ' + trail.join(',') + ')', trail.join() === [s1.n - 1, s1.n - 2, s1.n - 3, s1.n - 4].join());
  const s2 = await S();
  ok('the stack went down by 4 and did not refill (past ' + s1.past + ' -> ' + s2.past + ')', s2.past <= s1.past - 4);
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
