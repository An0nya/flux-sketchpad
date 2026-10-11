// G22b: over file:// the bundled solvers cannot load; the app must say so in a visible notice (needs http), naming the fallback solver.
// node tests/regress/G22b-file-notice.js   (no server; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const path = require('path');
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '../../index.html'));
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#notices .notice')].map((n) => n.textContent), stored: RF.UI.store.notices.map((n) => n.msg), cur: RF.Solvers.current(RF.UI.store.scene), name: (RF.Solvers.get(RF.Solvers.DEFAULT_ID) || {}).name }));
  const hit = (a) => a.filter((m) => /http/.test(m) && /solver/i.test(m));
  ok('a visible notice says the solvers need http', hit(t.shown).length === 1, JSON.stringify(t.shown).slice(0, 300));
  ok('it names the fallback solver (' + t.name + ')', hit(t.shown).length > 0 && hit(t.shown)[0].includes(t.name), t.name);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
