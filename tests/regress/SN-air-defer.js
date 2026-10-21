// SN: the first Drive frame with the air beam on is drawn with the air off (two hold frames), the status is set on the second hold frame,
// and the air (table pass, blocking shader compile) starts on the third. Checks are per frame, read in one page.evaluate, so nothing
// else runs between them. Headless SOFTWARE GL: the timings here are not the owner's Safari/Metal numbers, and a synchronous loop cannot
// show a paint. The paint between hold frames is covered by the rAF/tick cadence, not by this test.
// Run (worktree): python3 tests/serve.py 8992  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SN-air-defer.js 8992
// Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8992);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const base = { visibility: 200, wet: false, wetness: 0, wetSheen: false, fpsCounter: false, scatter: 16, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', afs: false, lampPitch: false, corneringLamps: false, scatterCache: 'on', scatterCycle: 8 };

    // 1. air off (direct): no hold, no status, no table frame
    const direct = await page.evaluate((b) => {
      const A = RF.DriveAnim._, V = A.V, S = A.S; S(RF.UI).playing = false;
      Object.assign(RF.UI.dvOpts, b, { scatterMode: 'direct' });
      const rows = []; for (let i = 0; i < 3; i++) { A.frame(); rows.push({ hold: !!V.airHold, seq: V.airSeq, frames: SD_SCATTER.frames, status: document.getElementById('progress-text').textContent }); }
      return { rows, p: V.p && !!V.p.airHold };
    }, base);
    ok('SN off: direct mode never holds', direct.rows.every((r) => r.hold === false && r.seq === null && r.frames === 0), JSON.stringify(direct.rows.map((r) => [r.hold, r.frames])));
    ok('SN off: direct mode shows no air status', direct.rows.every((r) => !/air/.test(r.status)), JSON.stringify(direct.rows.map((r) => r.status)));

    // 2. table on: frame by frame. Times are performance.now() around each frame() call (headless, software GL).
    const seq = await page.evaluate((b) => {
      const A = RF.DriveAnim._, V = A.V, S = A.S; S(RF.UI).playing = false;
      const pc = () => (V.three ? V.three.programCount() : -1), txt = () => document.getElementById('progress-text').textContent;
      // the option change takes effect on the next prepare (redrawSpec runs one frame synchronously): that frame is hold frame 1
      const pcR0 = pc(), t1 = performance.now(); Object.assign(RF.UI.dvOpts, b, { scatterMode: 'table' }); RF.UI.redrawSpec(); const redrawMs = Math.round(performance.now() - t1), pcR1 = pc();
      const first = { n: V.airSeq ? V.airSeq.n : 0, hold: !!V.airHold, frames: SD_SCATTER.frames, valid: SD_SCATTER.valid, status: txt(), redrawMs, pcBefore: pcR0, pcAfter: pcR1 };
      const rows = []; for (let i = 0; i < 3; i++) { const p0 = pc(), t = performance.now(); A.frame(); rows.push({ i: i + 2, n: V.airSeq ? V.airSeq.n : 0, ms: Math.round(performance.now() - t), hold: !!V.airHold, frames: SD_SCATTER.frames, valid: SD_SCATTER.valid, status: txt(), progDelta: pc() - p0 }); }
      let n = 0; while (SD_SCATTER.valid < 8 && n < 400) { A.frame(); n++; }
      return { first, rows, more: n, valid: SD_SCATTER.valid };
    }, base);
    console.log('table frames: ' + JSON.stringify([seq.first, ...seq.rows]));
    const f1 = seq.first, [f2, f3] = seq.rows;
    ok('SN table: first frame is a hold frame with no table version valid', f1.n === 1 && f1.hold === true && f1.valid === 0 && f1.frames === 0, JSON.stringify(f1));
    ok('SN table: first status is the preparing line', f1.status === 'preparing air beam…', JSON.stringify(f1.status));
    ok('SN table: second hold frame sets the compile status before the air starts', f2.hold === true && f2.status === 'compiling air-beam shaders…' && f2.frames === 0, JSON.stringify(f2));
    ok('SN table: third frame runs the air (table pass counted)', f3.n === 4 - 1 && f3.hold === false && f3.frames > 0, JSON.stringify(f3));
    ok('SN table: the air fills to 8 valid versions', seq.valid === 8, 'valid=' + seq.valid + ' after ' + seq.more + ' more frames');
    // 3. paused Drive: no tick runs frames, so the hold continues on its own animation-frame requests (no synchronous loop here)
    await page.evaluate((b) => { const A = RF.DriveAnim._; Object.assign(RF.UI.dvOpts, b, { scatterMode: 'direct' }); RF.UI.redrawSpec(); A.frame(); }, base);
    await sleep(300);
    const paused = await page.evaluate(async (b) => {
      const A = RF.DriveAnim._, V = A.V; const rec = [];
      Object.assign(RF.UI.dvOpts, b, { scatterMode: 'table' }); RF.UI.redrawSpec(); rec.push({ n: V.airSeq ? V.airSeq.n : 0, hold: !!V.airHold, frames: SD_SCATTER.frames });
      for (let i = 0; i < 6; i++) { await new Promise((r) => requestAnimationFrame(() => r())); rec.push({ n: V.airSeq ? V.airSeq.n : 0, hold: !!V.airHold, frames: SD_SCATTER.frames }); }
      return { rec, playing: A.S(RF.UI).playing };
    }, base);
    console.log('paused: ' + JSON.stringify(paused));
    ok('SN paused: the air starts without a playing tick (hold ends, table frames run)', paused.playing === false && paused.rec.some((r) => r.hold === false && r.frames > 0) && paused.rec[paused.rec.length - 1].hold === false, JSON.stringify(paused.rec));
    ok('SN table: no error on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('timing (headless, software GL, label not Safari): redraw (hold frame 1) ms ' + f1.redrawMs + '; hold frame 2 ms ' + f2.ms + '; air frame ms ' + f3.ms + '; programs compiled on air frame ' + f3.progDelta);
  } catch (e) { ok('SN page run completed', false, String(e && e.stack || e).slice(0, 500)); }
  finally {
    await browser.close();
  }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SN page checks passed'); process.exitCode = fails ? 1 : 0;
})();
