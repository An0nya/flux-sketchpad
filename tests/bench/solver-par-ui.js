// W3b: a solve the way a user starts it (RF.UI.generateA: page redraws, Watch solve, status updates, verify + apply on the main thread).
//   PLAYWRIGHT=... node tests/bench/solver-par-ui.js <port> <scene.json> <solver-id> [--budget N] [--watch 0|1] [--hide] [--set k=v] [--tag x] [--out f.jsonl]
// Reports: solveMs (ui.lastGenMs: start → result applied), postRunMs (until the page's own follow-up trace is done), main-thread long tasks during the solve.
// --hide: a second tab is brought to front first, so the solving page is not visible (rAF paused).
'use strict';
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flags = (k) => argv.flatMap((a, i) => (a === '--' + k ? [argv[i + 1]] : []));
const VAL = new Set(['set', 'tag', 'out', 'budget', 'watch', 'mitig', 'threads']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && VAL.has(argv[i - 1].slice(2))));
const [port, sceneFile, id] = pos;
const sets = Object.fromEntries(flags('set').map((kv) => { const i = kv.indexOf('='), v = kv.slice(i + 1); return [kv.slice(0, i), v !== '' && !isNaN(+v) ? +v : v === 'true' ? true : v === 'false' ? false : v]; }));
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await ctx.newPage();
  await page.addInitScript(([th, ka]) => { try { localStorage.setItem('flux/solveLimitMs', '1800000'); localStorage.setItem('flux/solverThreads', String(th)); localStorage.setItem('flux/solveKeepAwake', ka ? '1' : '0'); } catch (e) { /* ignore */ } }, [+flag('threads', 0), argv.includes('--keepawake')]);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 300000 });
  if (String(await page.evaluate(() => location.port)) !== String(port)) throw new Error('wrong page');
  const w = flag('watch'); if (w !== undefined) await page.evaluate((on) => RF.UI.setWatch(on === '1'), w);
  await page.evaluate(([txt, id, sets, budget]) => {
    const sc = RF.State.deserialize(txt); if (budget) sc.modeA.budget = budget;
    sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: Object.assign({}, (sc.solverSettings || {})[id], sets) });
    RF.UI.loadScene(sc, null, true);
  }, [fs.readFileSync(path.resolve(sceneFile), 'utf8'), id, sets, +flag('budget', 0)]);
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 600000 });   // loadScene may start an auto-solve of its own: let it finish, then time a clean one
  await page.waitForTimeout(500);
  let other = null; if (argv.includes('--hide')) { other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); }
  const mitig = flag('mitig');   // --mitig lock | audio | both: things a page can do that might keep a hidden tab's worker at full speed (probe, not a fix)
  if (mitig) await page.evaluate(async (m) => {
    if (/lock|both/.test(m)) navigator.locks.request('flux-solve', () => new Promise(() => {}));
    if (/audio|both/.test(m)) { const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0.00001; o.connect(g); g.connect(ac.destination); o.start(); await ac.resume(); window.__ac = ac; }
  }, mitig);
  await page.evaluate(() => { window.__vlog = []; document.addEventListener('visibilitychange', () => window.__vlog.push(document.visibilityState)); window.__lt = []; window.__tr = new Set(); window.__prev = new Set(); setInterval(() => { const w = RF.UI.watch; if (w && w.msg) window.__prev.add(w.msg.n); if (w && w.traced) window.__tr.add(w.traced.label + '|' + w.traced.ms); }, 50); window.__vis = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ } });
  const t0 = Date.now();
  await page.evaluate(() => { RF.UI.lastGenMs = 0; RF.UI.generateA(); });
  await page.waitForFunction(() => RF.UI.lastGenMs > 0 && !RF.UI.solving, null, { timeout: 1800000, polling: 250 });
  const solveMs = await page.evaluate(() => Math.round(RF.UI.lastGenMs)), t1 = Date.now();
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 600000, polling: 250 });
  const r = await page.evaluate(() => ({ vis: document.visibilityState, lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)), ltSum: Math.round(window.__lt.reduce((a, b) => a + b, 0)), vlog: window.__vlog, previews: window.__prev.size, tracedPreviews: window.__tr.size, placed: RF.UI.store.scene.groups.A.surfaces.length, st: RF.SolverHost.lastStats() }));
  const row = { tag: flag('tag', ''), where: 'ui', threads: +flag('threads', 0), keepAwake: argv.includes('--keepawake'), solver: id, scene: path.basename(sceneFile), budget: +flag('budget', 0) || null, sets, watch: w === undefined ? 'default' : w, hidden: argv.includes('--hide'), visibility: r.vis, vlog: r.vlog, mitig: mitig || null,
    solveMs, wallMs: t1 - t0, postRunMs: Date.now() - t1, previews: r.previews, tracedPreviews: r.tracedPreviews, workerTraceMs: r.st && r.st.traceMs, longTasks: r.lt, longTaskMax: r.ltMax, longTaskSum: r.ltSum, placed: r.placed };
  console.log(JSON.stringify(row)); const o = flag('out'); if (o) fs.appendFileSync(o, JSON.stringify(row) + '\n');
  await browser.close();
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
