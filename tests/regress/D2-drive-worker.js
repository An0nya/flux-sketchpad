// D2: the animated Drive view's object trace on worker threads; forest and city animate.
// node tests/regress/D2-drive-worker.js [port]   (needs a server: python3 tests/serve.py <port>; D2_REAL_GPU=1 for the real GPU browser)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8728);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.D2_REAL_GPU ? { channel: 'chromium' } : {}), errors = [];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(),localStorage.setItem('flux/driveMore','true'); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.evaluate(() => RF.UI.setDisplay('drive')); await sleep(1500);
  ok('page is the Flux app on port ' + port + ' (RF.UI, RF.DriveAnim)', await page.evaluate((p) => !!(RF.UI && RF.DriveAnim) && location.port === String(p), port));
  const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return !!g && !!g.getExtension('EXT_color_buffer_float'); });
  if (!gpu) { ok('WebGL2 with float targets exists', false); await browser.close(); process.exit(1); }
  const frames = () => page.evaluate(() => RF.UI.dvAnimFrames || 0);
  const advances = async (ms) => { const a = await frames(); await sleep(ms); return (await frames()) - a; };
  const wk = () => page.evaluate(() => ({ n: RF.DriveAnim._.Wk.list.length, fail: RF.DriveAnim.stats().mtFail, pressed: document.querySelector('[data-anim="c-mt"]').getAttribute('aria-pressed') }));
  await page.evaluate(() => { RF.UI.dvOpts.glare = 0; RF.UI.dvOpts.mt = true; RF.UI.dvOpts.gpuRenderer = false; RF.UI.dvOpts.tiles = false; RF.UI.dvAnim = { view: 'anim', playing: true, popout: false, dist: 0, total: 0, t: 0 }; RF.UI.redrawSpec(); });
  // 1. playing: workers start, frames are drawn from their rows
  await page.waitForFunction(() => RF.DriveAnim._.Wk.list.length > 0, null, { timeout: 20000 }); await sleep(2500);
  const w1 = await wk(), adv = await advances(2500);
  ok('animating: worker threads started (' + w1.n + '), the threads switch is on, no failure', w1.n >= 1 && w1.pressed === 'true' && !w1.fail, JSON.stringify(w1));
  ok('frames keep coming from the workers (new frames drawn in 2.5 s: ' + adv + ')', adv >= 3);
  // 2. the picture from the workers is the picture the page itself traces: same sequence of 8 frames both ways (HDR image, half-float texture), worst difference 0
  const par = await page.evaluate(async () => {
    const _ = RF.DriveAnim._, st = _.S(RF.UI), V = _.V, Wk = _.Wk; st.playing = false; await new Promise((r) => setTimeout(r, 600));
    const seq = [0, 20, 45, 70, 95, 120, 160, 210]; V.pinSS = 1; V.act.clear(); const A = [], B = [];
    for (const d of seq) { st.dist = d; st.t = d / 13.9; _.frame(); A.push(_.readHdr()); }
    V.act.clear(); Wk.cfgKey = ''; for (const d of seq) { await _.frameMT(d, d / 13.9); B.push(_.readHdr()); }
    let worst = 0, n = 0; for (let k = 0; k < seq.length; k++) for (let i = 0; i < A[k].length; i++) { const dd = Math.abs(A[k][i] - B[k][i]); if (dd > worst) worst = dd; n++; }
    V.pinSS = 0; return { worst, n, workers: Wk.list.length };
  });
  ok('workers\' frames = the page\'s own trace: 8 frames over the drive, worst HDR difference ' + par.worst, par.worst === 0 && par.n > 1e5, par.n + ' values, ' + par.workers + ' workers');
  // 3. the switch: off → no workers, the page traces itself and the animation goes on; on → workers again
  await page.evaluate(() => { RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }); await sleep(1500);
  await page.click('[data-anim="c-mt"]'); await sleep(1500);
  const w2 = await wk(), adv2 = await advances(2500);
  ok('threads off: no workers, switch up, frames still drawn (' + adv2 + ' in 2.5 s)', w2.n === 0 && w2.pressed === 'false' && adv2 >= 2, JSON.stringify(w2));
  await page.click('[data-anim="c-mt"]'); await sleep(2500);
  const w3 = await wk(), adv3 = await advances(2000);
  ok('threads on again: workers are back and drawing', w3.n >= 1 && w3.pressed === 'true' && adv3 >= 3, JSON.stringify(w3) + ', ' + adv3 + ' frames');
  // 4. forest and city use animation
  const sceneCheck = async (sc) => {
    await page.evaluate((s) => { RF.UI.dvOpts.scene = s; RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }, sc); await sleep(3500);
    return page.evaluate(() => { const V = RF.DriveAnim._.V; return { scene: V.srcArgs && V.srcArgs[0], disabled: document.querySelector('[data-anim="play"]').disabled, view: RF.UI.dvAnim.view, layers: V.g ? V.g.layers.length : -1, seedOff: document.querySelector('[data-anim="seed"]').disabled, w: RF.DriveAnim._.Wk.list.length }; });
  };
  for (const [sc, layers] of [['forest', 1], ['city', 3]]) {
    const r = await sceneCheck(sc), a = await advances(3000);
    ok(sc + ' is animated on the workers (' + a + ' frames in 3 s), ground layers ' + r.layers + ', seed field off (fixed scene)', r.scene === sc && !r.disabled && r.view === 'anim' && r.layers === layers && r.seedOff && r.w >= 1 && a >= 2, JSON.stringify(r));
  }
  // 5. a worker that fails: the page falls back to tracing itself, says so, and the animation goes on
  await page.evaluate(() => { RF.UI.dvOpts.scene = 'road'; RF.UI.dvAnim.view = 'anim'; RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }); await sleep(3000);
  await page.evaluate(() => { RF.DriveAnim._.Wk.list[0].onerror({ message: 'test: worker script failed', preventDefault() {} }); }); await sleep(1500);
  const w4 = await wk(), adv4 = await advances(2500);
  ok('a failing worker: all stopped, failure remembered, switch disabled, animation continues on the page (' + adv4 + ' frames in 2.5 s)', w4.n === 0 && /test: worker/.test(w4.fail) && adv4 >= 2 && await page.evaluate(() => document.querySelector('[data-anim="c-mt"]').disabled), JSON.stringify(w4));
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})();
