// Watching a solve in the real page (Playwright, Chromium): node tests/watch-solve-e2e.js [port] [--shots dir] [--perf]
// Not in tests/all.js (needs a browser and a server: python3 tests/serve.py 8746).
// 1. a worker solver that previews (tir-array-v2) shows the PREVIEW badge and updates during the solve; the result replaces it
// 2. a forced timeout (RF.SolverHost.testBudget, BUDGET untouched) leaves the notice + 'Use last candidate'; clicking it
//    applies a verified design   3. a solve replaced by a newer request leaves no notice   4. no console errors
// --perf: solve wall time with Watch on vs off (2 solvers) and the main thread's longest frames while previews draw.
const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8746), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null, perf = args.includes('--perf');
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading() && RF.Solvers.get('tir-array-v2'), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });           // the boot solve (Auto) first
  // start a solve with solver id + settings; resolves once it is running
  const start = (id, set) => page.evaluate(([id, set]) => { const ui = RF.UI, sc = ui.store.scene; sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: set || {} }); ui.generateA(); }, [id, set]);
  const shot = async (name) => { if (shots) await page.screenshot({ path: shots + '/' + name + '.png' }); };

  // ---- 1. previews during a solve
  await page.evaluate(() => RF.UI.setWatch(true));
  await start('tir-array-v2', { calib: 3, calibRays: 300000 });
  const seen = new Set(); let badgeWhileSolving = false, t0 = Date.now(), shotTaken = false;
  while (Date.now() - t0 < 110000) {
    const st = await page.evaluate(() => { const b = document.querySelector('.watch-badge[data-badge="surface-canvas"]'), h = document.querySelector('.watch-badge[data-badge="heat-canvas"]');
      return { solving: !!RF.UI.solving, badge: b && !b.hidden ? b.textContent : null, heat: h && !h.hidden ? h.textContent : null, n: RF.UI.watch ? RF.UI.watch.n : 0 }; });
    if (st.solving && st.badge) { badgeWhileSolving = true; seen.add(st.badge); if (!shotTaken && /calibration/.test(st.badge)) { await shot('watch-preview'); shotTaken = true; } }
    if (!st.solving && Date.now() - t0 > 1500) break;
    await page.waitForTimeout(150);
  }
  if (!shotTaken) await shot('watch-preview');
  const after = await page.evaluate(() => ({ badge: [...document.querySelectorAll('.watch-badge')].some((b) => !b.hidden), rep: RF.UI.store.reports.A && RF.UI.store.reports.A.solver && RF.UI.store.reports.A.solver.id, watch: !!RF.UI.watch }));
  ok('PREVIEW badge shows and updates while tir-array-v2 solves', badgeWhileSolving && seen.size >= 2, [...seen].join(' | '));
  ok('the verified result replaces the preview (badge gone, report from tir-array-v2)', !after.badge && !after.watch && after.rep === 'tir-array-v2');

  // ---- 3. replaced by a newer request: silent
  await start('tir-array-v2', { calib: 3, calibRays: 300000 });
  await page.waitForFunction(() => RF.UI.watch && RF.UI.watch.n >= 1, null, { timeout: 60000 });
  await start('tir-array-v2', { calib: 1, calibRays: 100000 });
  await page.waitForTimeout(300);
  const repl = await page.evaluate(() => ({ fail: !!document.getElementById('solve-fail'), notices: RF.UI.store.notices.slice(0, 3).map((n) => n.msg) }));
  ok('a solve replaced by a newer request leaves no failure notice', !repl.fail && !repl.notices.some((m) => /budget|NOT APPLIED|kept/.test(m)), repl.notices.join(' / '));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });

  // ---- 2. forced timeout → notice + Use last candidate
  const before = await page.evaluate(() => JSON.stringify(RF.UI.store.scene.groups.A.surfaces.map((s) => s.id)));
  await page.evaluate(() => RF.SolverHost.testBudget(10000));
  await start('tir-array-v2', { calib: 6, calibRays: 600000 });
  await page.waitForSelector('#solve-fail', { timeout: 30000 });
  const fail = await page.evaluate(() => ({ text: document.getElementById('solve-fail').textContent, btn: !!document.getElementById('btn-use-candidate'), badge: (() => { const b = document.querySelector('.watch-badge[data-badge="surface-canvas"]'); return b && !b.hidden ? b.textContent : null; })(), kept: JSON.stringify(RF.UI.store.scene.groups.A.surfaces.map((s) => s.id)) }));
  await page.evaluate(() => RF.SolverHost.testBudget(0));
  ok('timeout: notice says what happened and that the previous design is kept', /ran past its 10 s budget and was stopped/.test(fail.text) && /previous design is kept/.test(fail.text), fail.text.slice(0, 160));
  ok('timeout: the old design is still applied; the last preview is shown NOT APPLIED with Use last candidate', fail.kept === before && fail.btn && /^NOT APPLIED/.test(fail.badge || ''), fail.badge);
  await shot('watch-timeout');
  await page.click('#btn-use-candidate');
  await page.waitForTimeout(400);
  const used = await page.evaluate(() => { const r = RF.UI.store.reports.A; return { cand: r && r.solver && r.solver.candidate, facts: r && r.facts, n: RF.UI.store.scene.groups.A.surfaces.length, bounces: RF.UI.store.scene.sim.bounces, fail: !!document.getElementById('solve-fail'), notice: RF.UI.store.notices[0].msg }; });
  ok('Use last candidate applies it through verify → applySolve', used.cand && used.facts && !used.facts.errors.length && used.n > 0 && !used.fail && used.bounces >= 4, 'candidate ' + used.cand + ', ' + used.n + ' surfaces, bounces ' + used.bounces + ' · ' + used.notice.slice(0, 140));
  await page.waitForTimeout(1500); await shot('watch-applied');

  // ---- perf: Watch on vs off
  if (perf) {
    const timeSolve = async (id, set, watch) => {
      await page.evaluate((w) => RF.UI.setWatch(w), watch);
      await page.evaluate(() => { window.__pv0 = RF.UI.watchStats.previews; window.__pm0 = RF.UI.watchStats.prepMs; window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 1e5) window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
      const t = await page.evaluate(() => performance.now());
      await start(id, set);
      await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 130000 });
      return page.evaluate((t) => { cancelAnimationFrame(window.__raf); const fr = window.__frames.slice(1).sort((a, b) => b - a); return { ms: Math.round(RF.UI.lastGenMs), wall: Math.round(performance.now() - t), p99: +(fr[Math.floor(fr.length * 0.01)] || 0).toFixed(1), max: +(fr[0] || 0).toFixed(1), frames: fr.length, prev: RF.UI.watchStats.previews - window.__pv0, prepMs: +(RF.UI.watchStats.prepMs - window.__pm0).toFixed(1) }; }, t);
    };
    for (const [id, set] of [['tir-array-v2', { calib: 3, calibRays: 300000 }], ['opus-mosaic-auto', {}]]) {
      const rows = [];
      for (const w of [false, true, false, true]) rows.push(Object.assign({ watch: w }, await timeSolve(id, set, w)));
      console.log('[PERF] ' + id + ': ' + rows.map((r) => (r.watch ? 'on ' : 'off ') + r.ms + ' ms (' + r.prev + ' previews, prep ' + r.prepMs + ' ms; frame p99 ' + r.p99 + ' / max ' + r.max + ' ms)').join(' · '));
    }
  }
  ok('no console errors', !errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all watch-solve checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
