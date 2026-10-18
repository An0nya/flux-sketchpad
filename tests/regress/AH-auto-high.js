// AH page checks. Serve the worktree first: python3 tests/serve.py <free 88xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/AH-auto-high.js <port>
// Checks: the button cycles Off -> On -> Auto -> Off with the right aria-pressed and data-state; in a rural drive with oncoming
// traffic, Auto produces both high and low frames over 60 s of simulated time, the readout reason changes, and high frames are brighter
// on the far road; no page or console errors (favicon.ico 404 ignored).
// Simulated time: the page's own clock (S.t, S.dist) is advanced by 0.5 s per frame and frame() is called directly (as HB does),
// so 60 s of sim is 120 frames and does not depend on wall-clock speed.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
// DC: traffic range pinned to 230 m. At the 400 m default the oncoming stream never leaves the 400 m sensor range in this scene (0 high frames in 60 s), so Auto never returns to high. Owner decision pending; see the DC report.
const port = +(process.argv[2] || 8776);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const SIM_STEP = 0.5, SIM_TOTAL = 60;
(async () => {
  const browser = await pw.chromium.launch({});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ')));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
    // rural road (no tiles), oncoming traffic on, no preceding traffic, CPU renderer, animation paused so the test drives the clock
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, dynamicResolution: false, gpuRenderer: false, oncoming: true, preceding: false, tiles: false })); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    console.log('[step] page loaded; waiting for solver and loading the MG2 fixture');
    await page.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'AH fixture'); u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p, null, { timeout: 120000 });
    console.log('[step] drive view ready');
    await page.evaluate(() => { window.AH = { frame: () => RF.DriveAnim._.frame(), canvas: () => RF.DriveAnim._.readCanvas(), S: () => RF.DriveAnim._.S(RF.DriveAnim._.V.ui), V: () => RF.DriveAnim._.V }; });
    const btn = () => page.evaluate(() => { const b = document.querySelector('[data-anim="high-beam"]'); return { pressed: b.getAttribute('aria-pressed'), state: b.dataset.state, text: b.textContent }; });
    const click = () => page.evaluate(() => document.querySelector('[data-anim="high-beam"]').click());
    const cfg = await page.evaluate(() => { const o = RF.DriveAnim._.V.info.o; return { oncoming: o.oncoming, preceding: o.preceding, tiles: !!o.tiles, speed: o.speed }; });
    ok('scene is rural with oncoming traffic on', cfg.oncoming === true && !cfg.tiles, cfg);
    // the button cycle: Off -> On -> Auto -> Off
    const b0 = await btn();
    ok('starts Off (aria-pressed false, state off)', b0.pressed === 'false' && b0.state === 'off', b0);
    await click(); const b1 = await btn();
    ok('click 1: On (aria-pressed true, state on)', b1.pressed === 'true' && b1.state === 'on', b1);
    await click(); const b2 = await btn();
    const hi2 = await page.evaluate(() => !!window.AH.V().high);
    ok('click 2: Auto (state auto, aria-pressed follows the lit beam: true if high, false if dipped)', b2.state === 'auto' && b2.pressed === String(hi2), { b2, lit: hi2 });
    await click(); const b3 = await btn();
    ok('click 3: Off again (aria-pressed false, state off)', b3.pressed === 'false' && b3.state === 'off', b3);
    // Auto over 60 s of sim time. Start in Auto.
    await click(); await click();   // Off -> On -> Auto
    const frames = [];
    for (let k = 0; k < Math.round(SIM_TOTAL / SIM_STEP); k++) {
      const r = await page.evaluate((dt) => {
        const S = window.AH.S(), V = window.AH.V(), speed = (+V.info.o.speed || 50) / 3.6;
        S.t += dt; S.dist += speed * dt; window.AH.frame();
        const a = window.AH.canvas(), cw = V.gl.cw, ch = V.gl.ch; let s = 0, n = 0;
        for (let y = Math.floor(ch * 0.38); y < Math.floor(ch * 0.52); y++) for (let x = Math.floor(cw * 0.3); x < Math.floor(cw * 0.7); x++) { const i = (y * cw + x) * 4; s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; n++; }
        return { t: +S.t.toFixed(2), high: !!V.high, reason: V.autoSt ? V.autoSt.reason : null, mode: V.highMode, luma: s / n };
      }, SIM_STEP);
      frames.push(r);
    }
    const hi = frames.filter((f) => f.high), lo = frames.filter((f) => !f.high);
    ok('Auto ran in Auto mode for all 60 s', frames.every((f) => f.mode === 'auto'));
    ok('Auto produced high frames and low frames over 60 s', hi.length > 0 && lo.length > 0, { high: hi.length, low: lo.length });
    const reasons = [...new Set(frames.map((f) => f.reason))];
    ok('readout reason changes during the drive', reasons.length >= 2, reasons);
    const mean = (xs) => xs.reduce((a, f) => a + f.luma, 0) / Math.max(1, xs.length);
    const ratio = mean(hi) / mean(lo);
    ok('far road (centre band) is brighter on high frames than low (mean luma ratio > 1.2)', ratio > 1.2, { highMean: +mean(hi).toFixed(2), lowMean: +mean(lo).toFixed(2), ratio: +ratio.toFixed(3) });
    console.log('[trace] ' + frames.map((f) => (f.high ? 'H' : 'l') + (f.reason === 'oncoming' ? '*' : f.reason === 'preceding' ? 'p' : f.reason === 'hold' ? '~' : '')).join(' '));
    const ab = await btn();
    ok('final readout shows Auto with a reason', ab.state === 'auto' && /^high beam: auto \(/.test(ab.text), ab);
    ok('no page or console errors', errors.length === 0, errors.slice(0, 5));
    await page.close();
  } finally { await browser.close(); }
  console.log(fails ? 'AH page FAILED: ' + fails : 'all AH page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
