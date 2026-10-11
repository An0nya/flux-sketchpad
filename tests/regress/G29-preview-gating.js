// G29: a Paint solve's preview overlay must not show in Stamp / Profile mode, and with Watch off the footer must not stay on a
// candidate's PREVIEW numbers.
// node tests/regress/G29-preview-gating.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8829);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));
  const start = (id) => page.evaluate((id) => { RF.UI.store.scene.solve = { id }; RF.UI.generateA(); }, id);
  const badges = () => page.evaluate(() => [...document.querySelectorAll('.watch-badge')].filter((b) => !b.hidden).map((b) => b.textContent.slice(0, 40)));
  const foot = () => page.evaluate(() => (document.body.innerText.match(/PREVIEW[^\n]*/) || [null])[0]);

  // 1. Profile mode mid-solve
  await start('fill-fix'); await page.waitForFunction(() => RF.UI.solving && RF.UI.watch && RF.UI.watch.msg, null, { timeout: 30000 });
  ok('in Paint mode the solve shows a PREVIEW badge', (await badges()).length > 0 && await page.evaluate(() => RF.UI.watchShown()));
  await page.evaluate(() => document.querySelector('.modes button[data-mode=C]').click()); await page.waitForTimeout(700);
  ok('Profile mode mid-solve: no preview badge / overlay', (await badges()).length === 0 && !(await page.evaluate(() => RF.UI.watchShown())), JSON.stringify(await badges()));
  await page.evaluate(() => RF.UI.stopSolve()); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.modes button[data-mode=A]').click()); await page.waitForTimeout(500);
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 });

  // 2. Watch off mid-solve: footer
  await page.evaluate(() => RF.UI.setWatch(true));
  await start('sqm');
  try { await page.waitForFunction(() => /PREVIEW/.test(document.body.innerText), null, { timeout: 40000 }); } catch (e) { /* reported below */ }
  ok('precondition: the footer shows PREVIEW numbers while Watch is on', !!(await foot()), String(await foot()));
  await page.evaluate(() => RF.UI.setWatch(false)); await page.waitForTimeout(800);
  ok('Watch off: the footer no longer shows PREVIEW numbers', !(await foot()), String(await foot()));
  await page.evaluate(() => { RF.UI.stopSolve(); RF.UI.setWatch(true); });
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
