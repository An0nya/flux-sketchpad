// Tester only: python3 tests/serve.py 8763
// DP_REAL_GPU=1 node tests/regress/DP-drive-polish.js 8763
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8763);
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + JSON.stringify(d) : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(process.env.DP_REAL_GPU ? { channel: 'chromium' } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e))); await page.addInitScript(() => localStorage.clear());
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    const identity = await page.evaluate((p) => !!RF.UI && location.port === String(p), port); ok('DP RF.UI and expected port', identity); if (!identity) throw Error('wrong page');
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
    await page.evaluate((s) => { RF.UI.loadScene(RF.State.deserialize(s), 'DP fixture'); RF.UI.setMode('D'); }, fixture);
    await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false }); Object.assign(u.dvOpts, { mt: false, tiles: true, seed: 7, scene: 'road', oncoming: true, preceding: true, trafficDensity: 2 }); u.redrawSpec(); document.querySelector('.drive-more').open = true; RF.DriveAnim._.V.pinSS = 2; });
    const saved = await page.evaluate(() => RF.State.serialize(RF.UI.store.scene));
    ok('DP cache defaults off', await page.locator('[data-anim=tile-cache]').getAttribute('aria-pressed') === 'false');
    await page.locator('[data-anim=tile-cache]').click();
    ok('DP cache toggle enables persisted view preference', await page.evaluate(() => RF.UI.dvOpts.tileCache === true && JSON.parse(localStorage.getItem('flux/driveView')).tileCache === true && !!RF.DriveAnim._.V.src.tiles.groundCache));
    for (const kind of ['150R', 'intersection', 't-junction', 'urban']) {
      const result = await page.evaluate(async (kind) => {
        const D = RF.DriveAnim, a = D._, u = RF.UI, tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((q) => q.kind === kind), dist = tile.s0 + 95, t = 25;
        const draw = (cached) => { u.dvOpts.tileCache = cached; Object.assign(u.dvAnim, { dist, t, playing: false }); u.redrawSpec(); a.frame(); return new Float32Array(a.V.rgba); };
        const off = draw(false), on = draw(true); let worst = 0;
        for (let q = 0; q < on.length; q++) worst = Math.max(worst, Math.abs(on[q] - off[q]) / Math.max(1e-8, Math.abs(off[q])));
        a.Wk.forced = 2; u.dvOpts.mt = true; u.redrawSpec(); const drawn = await a.frameMT(dist, t), worker = a.V.rgba; let workerWorst = 0;
        for (let q = 0; q < on.length; q++) workerWorst = Math.max(workerWorst, Math.abs(on[q] - worker[q]) / Math.max(1e-8, Math.abs(on[q])));
        const hdr = a.readHdr(); let halfWorst = 0, samples = [];
        for (let q = 0; q < hdr.length; q++) if (q % 4 !== 3 && worker[q] >= 1e-5 && worker[q] < 65504) { const err = Math.abs(hdr[q] - worker[q]) / worker[q]; halfWorst = Math.max(halfWorst, err); if (samples.length < 5) samples.push({ q, cpu: worker[q], stored: hdr[q] }); }
        u.dvOpts.mt = false; u.redrawSpec();
        return { worst, workerWorst, drawn, halfWorst, samples, workersFailed: a.Wk.failed };
      }, kind);
      ok('DP cached/uncached, worker and half-float parity ' + kind, result.worst < 2e-7 && result.drawn && result.workerWorst === 0 && result.halfWorst < 0.0011 && !result.workersFailed && result.samples.length === 5, result);
    }
    await page.evaluate(() => { RF.UI.dvOpts.tiles = false; RF.UI.redrawSpec(); });
    ok('DP cache control disabled without tiles', await page.locator('[data-anim=tile-cache]').isDisabled());
    ok('DP optical scene unchanged', saved === await page.evaluate(() => RF.State.serialize(RF.UI.store.scene)));
    ok('DP no page errors', errors.length === 0, errors);
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all DP page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
