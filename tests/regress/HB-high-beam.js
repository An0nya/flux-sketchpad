// HB page checks. Serve the worktree first: python3 tests/serve.py <free 88xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/HB-high-beam.js <port>
// Checks: H key and button toggle aria-pressed; far road (rows near the horizon, centre) is brighter with high on (CPU and GPU);
// switch off restores the exact low-beam frame bytes (CPU, workers off); the minigame's game object follows the switch.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8776);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const gpuOn = process.argv.includes('--gpu-only');
(async () => {
  const browser = await pw.chromium.launch({});
  try {
    for (const mode of [{ name: 'CPU', gpu: false }, { name: 'GPU', gpu: true }]) {
      if (gpuOn && !mode.gpu) continue;
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
      page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | '))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript((gpu) => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, dynamicResolution: false, gpuRenderer: gpu })); }, mode.gpu);
      await page.goto('http://127.0.0.1:' + port + '/index.html');
      console.log('[step] page loaded; waiting for solver and loading the MG2 fixture');
      // same startup as UX2 ready(): wait for the solver, load the fixture, enter Drive, wait for the trace, show the drive display
      await page.evaluate(async () => {
        const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
        u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'HB fixture'); u.setMode('D');
        for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
        u.setDisplay('drive');
      });
      console.log('[step] fixture traced; waiting for the drive view to be built');
      await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p, null, { timeout: 120000 });
      console.log('[step] drive view ready');
      // HB.frame(): redraw the paused picture and read the GL canvas (bottom-up rows)
      await page.evaluate(() => { window.HB = { frame: () => { RF.DriveAnim._.frame(); return RF.DriveAnim._.readCanvas(); } }; });
      const st = () => page.evaluate(() => { const V = RF.DriveAnim._.V; return { high: !!V.high, pressed: document.querySelector('[data-anim="high-beam"]').getAttribute('aria-pressed'), three: !!V.three, gpuFailure: V.gpuFailure || '', cw: V.gl.cw, ch: V.gl.ch }; });
      const s0 = await st();
      ok(mode.name + ' starts with the switch off', s0.high === false && s0.pressed === 'false', s0);
      const band = (sel) => page.evaluate(() => { const a = HB.frame(), V = RF.DriveAnim._.V; let s = 0, n = 0; const cw = V.gl.cw, ch = V.gl.ch; for (let y = Math.floor(ch * 0.38); y < Math.floor(ch * 0.52); y++) for (let x = Math.floor(cw * 0.3); x < Math.floor(cw * 0.7); x++) { const i = 4 * (y * cw + x); s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; n++; } return s / n; });
      const hashNow = () => page.evaluate(() => { const a = HB.frame(); let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; });
      // two clicks (on, off) rebuild the picture with the current renderer, so the low frame below is the real low frame
      await page.evaluate(() => { const b = document.querySelector('[data-anim="high-beam"]'); b.click(); b.click(); });
      if (mode.gpu) await page.waitForFunction(() => RF.DriveAnim._.V.three === true, null, { timeout: 20000 }).catch(() => {});
      const warm = await st();
      ok(mode.name + ' runs the ' + (mode.gpu ? 'GPU (three)' : 'CPU') + ' renderer', mode.gpu ? warm.three === true && !warm.gpuFailure : warm.three === false, { three: warm.three, gpuFailure: warm.gpuFailure });
      const lowLuma = await band(); const lowHash = await hashNow();
      // H key on, then the button off
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await page.keyboard.press('h');
      const onKey = await st();
      ok(mode.name + ' H key turns the switch on (aria-pressed true)', onKey.high && onKey.pressed === 'true', onKey);
      const highLuma = await band();
      const ratio = highLuma / lowLuma;
      ok(mode.name + ' far road near the horizon is brighter with high on (mean luma ratio > 1.5)', ratio > 1.5, { lowLuma: +lowLuma.toFixed(2), highLuma: +highLuma.toFixed(2), ratio: +ratio.toFixed(3) });
      await page.evaluate(() => document.querySelector('[data-anim="high-beam"]').click());   // DOM click: the button sits in the collapsed drive-more area, so Playwright reports it not visible
      const offBtn = await st();
      ok(mode.name + ' button turns the switch off (aria-pressed false)', !offBtn.high && offBtn.pressed === 'false', offBtn);
      if (!mode.gpu) { const back = await hashNow(); ok('CPU: switch off restores the exact low-beam frame bytes', back === lowHash, { lowHash, back }); }
      // minigame wiring: the game object follows the live switch
      await page.evaluate(() => document.querySelector('[data-anim="high-beam"]').click());
      const gameSync = await page.evaluate(() => { const S = RF.DriveAnim._.S, V = RF.DriveAnim._.V; const g = RF.DriveGame.create({ seed: 19, speed: 50, highBeam: true }); const prev = S(V.ui).game; S(V.ui).game = g; document.querySelector('[data-anim="high-beam"]').click(); const after = g.highBeam; S(V.ui).game = prev; return { after, back: g.highBeam }; });
      ok(mode.name + ' minigame game object follows the switch', gameSync.after === false, gameSync);
      ok(mode.name + ' no page or console errors', errors.length === 0, errors.slice(0, 5));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? 'HB page FAILED: ' + fails : 'all HB page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
