// G19 regression (Playwright): node tests/regress/G19-report-wording.js [port]
// Spec report wording: U/D on vertical angles, no "no re-aim helps" under Manual aim or a live partial judgement, "(held while the trace runs)" once.  Needs: python3 tests/serve.py 8825
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8825);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.Spec)));
  const judged = () => page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.evaluate(() => RF.UI.setMode('D')); await judged();
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const note = () => page.evaluate(() => [...document.querySelectorAll('#spec-report .note')].map((n) => n.innerText).find((t) => /^Measured/.test(t)) || '');
  await setRow('^Aim$', 'cutoff'); await setRow('^Aim line', '-0.5'); await page.waitForTimeout(1500);   // the input shows ° D: -0.5 stores an aim line 0.5 deg UP
  let t = await note(); ok('aim line above the horizon reads "put on 0.5° U"', /put on 0\.5° U/.test(t), t);
  ok('the inflection position carries U / D', /inflection at [\d.]+° [UD] put on/.test(t), t);
  await setRow('^Aim$', 'manual'); await page.waitForTimeout(1500);
  t = await note(); ok('Manual aim: no "no re-aim helps"', !/no re-aim helps/.test(t) && /manual: beam/.test(t), t);
  await setRow('^Aim$', 'design'); await page.waitForTimeout(500);
  await page.evaluate(() => { RF.UI.store.scene.sim.rays = 4000000; RF.UI.spec = null; RF.UI.requestRun(false); });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.N === 4000000, null, { timeout: 20000 });
  const notes = new Set(); let live = 0;
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate(() => ({ done: RF.UI.run.ctx.done, n: [...document.querySelectorAll('#spec-report .note')].map((x) => x.innerText).find((x) => /^Measured/.test(x)) || '' }));
    if (!r.done && r.n) { notes.add(r.n.replace(/[\d,]+ rays/, 'N rays')); live++; }
    if (r.done) break; await page.waitForTimeout(150);
  }
  const worst = Math.max(0, ...[...notes].map((n) => (n.match(/held while the trace runs/g) || []).length));
  ok('live notes seen (' + live + ' samples) say "held while the trace runs" at most once', live > 0 && worst <= 1, 'max copies ' + worst + (worst > 1 ? ': ' + [...notes].find((n) => (n.match(/held while/g) || []).length > 1) : ''));
  ok('no live note claims "no re-aim helps"', ![...notes].some((n) => /no re-aim helps/.test(n)), [...notes].filter((n) => /no re-aim helps/.test(n))[0] || '');
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
