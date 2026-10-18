// RS measurement: frame cadence per scene x resolution level, 8 s of playing, large view, 1600x900 at deviceScaleFactor 2.
// Tester only (needs a browser). Usage (one renderer per call, to stay under a Bash timeout):
//   node tests/regress/RS-resolution-bench.js 8944 cpu  > log   (or: ... 8944 gpu)
// Every row is appended as one JSON line to RS_JSONL as it is produced (default: the RS scratchpad file).
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8944), renderer = process.argv[3] === 'gpu' ? 'gpu' : 'cpu';
const JSONL = process.env.RS_JSONL || '/private/tmp/claude-501/-Users-anya/52ba1220-88d6-48e7-b153-44feae36f96e/scratchpad/rs-bench.jsonl';
const RUN_MS = +(process.env.RS_RUN_MS || 8000);
const SCENES = {
  road: { scene: 'road', tiles: false, wet: false, wetSheen: false },
  forest: { scene: 'forest', tiles: false, wet: false, wetSheen: false },
  city: { scene: 'city', tiles: false, wet: false, wetSheen: false },
  'tiles+wetsheen': { scene: 'road', tiles: true, wet: true, wetSheen: true },
};
const LEVELS = ['low', 'medium', 'high', 'ultra', 'native'];
(async () => {
  // --use-angle=metal: on this Mac the default headless Chromium uses SwiftShader (software GL); this forces ANGLE Metal (Apple M4)
  const browser = await pw.chromium.launch(process.env.RS_SWIFTSHADER ? {} : { args: ['--use-angle=metal'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
    await page.evaluate((s) => { RF.UI.loadScene(RF.State.deserialize(s), 'RS bench'); RF.UI.setMode('D'); }, fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false }); u.redrawSpec(); });
    await page.evaluate(() => RF.DriveAnim.openPop(RF.UI));
    await page.waitForTimeout(1000);
    const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    console.log('RS_BENCH renderer=' + renderer + ' GL=' + gl);
    for (const [name, cfg] of Object.entries(SCENES)) {
      for (const level of LEVELS) {
        await page.evaluate(([c, lv, gpu]) => {
          Object.assign(RF.UI.dvOpts, c, { simCeiling: lv, gpuRenderer: gpu, dynamicResolution: false, mt: true, fpsCounter: false, debugTimings: false });
          RF.DriveAnim._.V.pinSS = 0; RF.DriveAnim.resetStats(); RF.UI.dvAnim.playing = true; RF.UI.redrawSpec();
        }, [cfg, level, renderer === 'gpu']);
        await page.waitForTimeout(RUN_MS);
        const r = await page.evaluate(() => {
          const st = RF.DriveAnim.stats(), sz = RF.DriveAnim._.size();
          return { renderer: st.renderer, gpuFailure: st.gpuFailure, frames: st.frames, rafMedianMs: st.rafMedianMs, fps: st.fps, p95Ms: st.p95Ms, sim: st.sim, canvasPx: st.canvasPx, ss: st.ss, cssW: sz.cssW, dpr: sz.dpr, ceiling: st.simCeiling, workers: st.workers, contextLost: st.contextLost, contextFailed: st.contextFailed };
        });
        await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); });
        await page.waitForTimeout(500);
        const row = { renderer, GL: gl, scene: name, level, ...r, pageErrors: pageErrors.length };
        fs.appendFileSync(JSONL, JSON.stringify(row) + '\n');
        console.log('RS_ROW ' + JSON.stringify(row));
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('RS_BENCH crashed: ' + e.stack); process.exit(1); });
