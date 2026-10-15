// W3c: solver rollout in the real page: Solver threads default (min(4, cores-2), an explicit 0 = off is kept), the same design at the default thread count,
// the worker's GPU follows the page default (skipped where the browser has no WebGPU adapter), and the one-time "keep solving in the background" question
// (asked once, only after a solve that ran while the tab was hidden; no AudioContext before the click).
// node tests/regress/W3c-solver-rollout.js [port]   (needs: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8755);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const skip = (name, why) => console.log('[SKIP] ' + name + '  — ' + why);
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: process.env.WEBGPU ? ['--enable-unsafe-webgpu'] : [] }), errors = [];
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { window.__ac = 0; const A = window.AudioContext; if (A) window.AudioContext = class extends A { constructor(...a) { super(...a); window.__ac++; } }; });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading() && RF.Solvers.get('dish-fit-auto'), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
    const where = await page.evaluate(() => ({ ui: !!RF.UI, port: location.port })); if (!where.ui || +where.port !== port) throw new Error('wrong page ' + JSON.stringify(where));
    return { ctx, page };
  };
  const solve = (page, big) => page.evaluate(async (big) => {
    const sc = RF.State.defaultScene(); sc.modeA.budget = big ? 60 : 40; sc.solve = { id: 'dish-fit-auto' }; sc.solverSettings = { 'dish-fit-auto': big ? { rays: 250000, trials: 14 } : { rays: 60000, trials: 8 } };
    const r = await RF.Solvers.runAsync(sc, 'dish-fit-auto'), s = JSON.stringify(r.output.surfaces); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    const st = RF.SolverHost.lastStats(); return { hash: h >>> 0, placed: r.facts.placed, traces: st.traces, gpuTraces: st.gpuTraces, rays: st.raysUsed, ms: Math.round(st.ms) };
  }, big);

  // 1. fresh profile: the default thread count, shown in the setting; a chosen 0 stays 0 after a reload
  {
    const { ctx, page } = await open();
    const s = await page.evaluate(() => { const hw = navigator.hardwareConcurrency || 4, want = Math.min(4, hw - 2) >= 2 ? Math.min(4, hw - 2) : 0, sel = document.querySelector('select[aria-label="Solver threads"]');
      return { hw, want, got: RF.SolverHost.threads(), chosen: RF.SolverHost.threadsChosen(), stored: localStorage.getItem('flux/solverThreads'), sel: sel && sel.value, label: sel && sel.selectedOptions[0] && sel.selectedOptions[0].textContent }; });
    ok('threads: never chosen -> min(4, cores-2) (0 under 2), nothing stored, the setting shows it as the default', s.got === s.want && !s.chosen && s.stored === null && +s.sel === s.want && (s.want === 0 || /default/.test(s.label)), JSON.stringify(s));
    await page.evaluate(() => RF.GpuTrace && RF.GpuTrace.setPref(false));      // the pool check is about CPU traces; the GPU default has its own check below
    const a = await solve(page);
    // (with traceGpu on and no GPU the first batch, a single trial, is traced here to find that out; every later batch goes to the pool)
    ok('threads: a solve at the default count places facets and ran nearly all its traces in the pool', a.placed > 0 && a.rays > 0 && (s.want < 2 || a.traces <= 2), JSON.stringify(a));
    await page.evaluate(() => RF.SolverHost.setThreads(0));
    const b = await solve(page);
    ok('threads: same design at the default count and at 0 (off)', a.hash === b.hash && a.placed === b.placed, a.hash + ' vs ' + b.hash);
    ok('threads: off runs every trace on the solve worker', b.traces >= 8 && b.traces > a.traces, JSON.stringify(b));
    await page.reload(); await page.waitForFunction(() => window.RF && RF.UI && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ got: RF.SolverHost.threads(), chosen: RF.SolverHost.threadsChosen(), stored: localStorage.getItem('flux/solverThreads') }));
    ok('threads: an explicit "off" survives a reload (not replaced by the default)', r.got === 0 && r.chosen && r.stored === '0', JSON.stringify(r));
    await ctx.close();
  }

  // 2. GPU default: the worker follows the page default (on wherever WebGPU gives an adapter); unticking stays off
  {
    const { ctx, page } = await open();
    const g = await page.evaluate(async () => { const G = RF.GpuTrace; const ready = G && G.available() ? await G.init() : false; return { avail: G && G.available(), ready, pref: G && G.pref(), choice: G && G.userChoice(), adapter: G && G.info() && [G.info().vendor, G.info().architecture].join('/') }; });
    if (g.ready) console.log('       GPU adapter: ' + g.adapter);
    if (g.ready) {
      await page.evaluate(() => RF.SolverHost.setThreads(0));
      const on = await solve(page); await page.evaluate(() => RF.GpuTrace.setPref(false)); const off = await solve(page);
      ok('GPU: never chosen -> dish-fit-auto traces on the GPU in the solve worker; unticked -> 0 GPU traces; same design either way', on.gpuTraces > 0 && off.gpuTraces === 0 && on.hash === off.hash, JSON.stringify([on, off]));
    } else skip('GPU default in a solve', 'this browser has no WebGPU adapter (' + JSON.stringify(g) + '); run with WEBGPU=1 on a machine with one');
    await ctx.close();
  }

  // 3. the background-tab question
  const fakeVis = (page, v) => page.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  const state = (page) => page.evaluate(() => ({ prompt: !!document.getElementById('awake-prompt'), asked: RF.SolverHost.askAwake(), stored: localStorage.getItem('flux/solveKeepAwake'), keep: RF.SolverHost.keepAwake(), ac: window.__ac,
    box: (() => { const l = [...document.querySelectorAll('label.tog')].find((x) => /background tab/.test(x.textContent)); return l ? l.querySelector('input').checked : null; })() }));
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { RF.SolverHost.setThreads(0); if (RF.GpuTrace) RF.GpuTrace.setPref(false); });
    const st0 = await state(page);
    ok('background tone: off and unasked on a fresh profile; the Advanced box exists and is unticked', !st0.prompt && !st0.keep && st0.stored === null && st0.box === false, JSON.stringify(st0));
    await solve(page);
    const st1 = await state(page);
    ok('background tone: a solve in a visible tab asks nothing and plays nothing', !st1.prompt && !st1.asked && st1.ac === 0, JSON.stringify(st1));
    // the tab goes to the background in the middle of a solve and comes back before it ends
    const run = solve(page, true); await page.waitForTimeout(500); await fakeVis(page, 'hidden'); await page.waitForTimeout(300); await fakeVis(page, 'visible'); const took = (await run).ms;
    await page.waitForSelector('#awake-prompt', { timeout: 5000 }).catch(() => {});
    const st2 = await state(page);
    ok('background tone: asked once after a solve that ran while the tab was hidden; no AudioContext before the click', st2.prompt && st2.asked && st2.ac === 0 && st2.stored === null, JSON.stringify(st2) + ' solve ' + took + ' ms');
    await page.click('#btn-awake-yes');
    const st3 = await state(page);
    ok('background tone: "Keep it fast" stores 1, ticks the Advanced box, closes the question', !st3.prompt && st3.keep && st3.stored === '1' && st3.box === true, JSON.stringify(st3));
    await solve(page, true);
    const st4 = await state(page);
    ok('background tone: the next solve plays the tone (one AudioContext) and nothing is asked again', st4.ac === 1 && !st4.prompt, JSON.stringify(st4));
    await ctx.close();
  }
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { RF.SolverHost.setThreads(0); if (RF.GpuTrace) RF.GpuTrace.setPref(false); });
    // the solve ends while the tab is still hidden: the question waits for the user to come back
    const run = solve(page, true); await page.waitForTimeout(500); await fakeVis(page, 'hidden'); await run;
    const early = await state(page); await fakeVis(page, 'visible'); await page.waitForSelector('#awake-prompt', { timeout: 5000 }).catch(() => {});
    const late = await state(page);
    ok('background tone: a solve that ended in the background asks when the tab comes back, not before', !early.prompt && late.prompt && late.ac === 0, JSON.stringify([early, late]));
    await page.click('#btn-awake-no');
    const no = await state(page);
    ok('background tone: "No thanks" stores 0 (never asked again, no tone, box unticked)', !no.prompt && no.stored === '0' && !no.keep && no.box === false, JSON.stringify(no));
    const run2 = solve(page, true); await page.waitForTimeout(500); await fakeVis(page, 'hidden'); await page.waitForTimeout(200); await fakeVis(page, 'visible'); await run2;
    const again = await state(page);
    ok('background tone: after an answer a hidden solve asks nothing and plays nothing', !again.prompt && again.ac === 0, JSON.stringify(again));
    await ctx.close();
  }
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
