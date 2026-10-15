// Tester-only performance bench; builder must not execute a browser.
// python3 tests/serve.py 8737
// D5_REAL_GPU=1 node tests/bench/D5-drive-realism.js 8737 > /tmp/D5-realism-bench.jsonl
// Fresh-frame cadence + free-run: glare off/dry/rain, high beam, old wet/new sheen, adapt; off repeated last.
// Tiles and wet sheen cap tracing at 640 px; output includes sim dimensions so popout comparisons disclose the different resolution.
// All conditions include both traffic lanes. Mobile emulation uses desktop hardware, not a physical phone.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8737), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.D5_REAL_GPU ? { channel: 'chromium' } : {});
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 950 }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile });
      const page = await context.newPage(); await page.addInitScript(() => localStorage.clear());
      await page.goto('http://localhost:' + port + '/index.html');
      await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
      if (!await page.evaluate((p) => !!RF.UI && location.port === String(p), port)) throw Error('wrong app or port');
      await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.evaluate(() => RF.UI.setMode('D'));
      await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
      // Mobile has a Result tab; select through the same controller the tab uses.
      await page.evaluate(() => { RF.UI.setDisplay('drive'); RF.UI.setPane('result', 'activate'); }); await sleep(1000);
      const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
      console.log(JSON.stringify({ type: 'environment', port, mobileEmulation: mobile, gpu, cores: await page.evaluate(() => navigator.hardwareConcurrency) }));
      if (/SwiftShader|llvmpipe|unknown/i.test(gpu)) throw Error('real GPU required for performance measurements (set D5_REAL_GPU=1)');
      for (const scene of ['road', 'city']) for (const tiles of [false, true]) for (const popout of [false, true]) {
        if (mobile) await page.setViewportSize(popout ? { width: 844, height: 390 } : { width: 390, height: 844 });
        await page.evaluate(({ scene, popout }) => {
          const D = RF.DriveAnim, u = RF.UI; if (u.dvAnim && u.dvAnim.popout) D.closePop(u);
          Object.assign(u.dvOpts, { scene, mt: true, wild: true, density: 1.5, seed: 7, trafficDensity: 2, glare: 'off', onMode: 'generic', wet: false, wetSheen: false, expMode: 'fixed', ev: 1.5, oncoming: true, preceding: true, tiles: false, safeGap: true });
          Object.assign(u.dvAnim, { view: 'anim', playing: false, popout: false, dist: 0, total: 0, t: 0 }); u.redrawSpec();
        }, { scene, popout }); await sleep(700);
        if (popout) { await page.evaluate(() => RF.DriveAnim.openPop(RF.UI)); await sleep(600); }
        if (!await page.evaluate(() => !!RF.DriveAnim._.V.gl && RF.DriveAnim._.V.canvas.getClientRects().length > 0)) throw Error('animation not visible; select the mobile Result tab before benching');
        // Same seed, clock and positions; pin AA so sample changes cannot masquerade as a tile cost.
        for (const condition of ['dry-off','dry-dry','dry-rain','dry-high','wet-legacy','wet-sheen','wet-adapt','dry-off-again']) {
          const position = await page.evaluate(({condition,tiles}) => {
            const u=RF.UI,D=RF.DriveAnim,tile=Array.from({length:160},(_,k)=>D.roadTile(7,k)).find(t=>t.kind==='urban'); u.dvAnim.playing=false;
            Object.assign(u.dvOpts,{tiles,streetLamps:'led',wet:condition.startsWith('wet'),wetSheen:condition==='wet-sheen'||condition==='wet-adapt',onMode:condition==='dry-high'?'high':'generic',glare:condition.includes('off')?'off':condition==='dry-rain'?'rain':'dry',expMode:condition==='wet-adapt'?'adapt':'fixed'});
            u.dvAnim.dist=tiles?tile.s0+55:40;u.dvAnim.t=2;u.redrawSpec();return {dist:u.dvAnim.dist,t:u.dvAnim.t,tile:tiles?tile:null};
          }, {condition,tiles}); await sleep(600);
          await page.evaluate(() => { RF.DriveAnim._.V.pinSS = 1; RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }); await sleep(750);
          const startFrames = await page.evaluate(() => { RF.DriveAnim.resetStats(); return RF.DriveAnim.stats().frames; }); await sleep(3000);
          const cadence = await page.evaluate((n) => { const s = RF.DriveAnim.stats(); return Object.assign(s, { freshFrames: s.frames - n }); }, startFrames);
          if (!cadence.workers || cadence.mtFail || cadence.freshFrames < 10 || !cadence.rafMedianMs) throw Error('worker bench invalid: ' + JSON.stringify(cadence));
          await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); }); await sleep(600);
          const free = await page.evaluate(async (position) => { RF.UI.dvAnim.dist=position.dist; RF.UI.dvAnim.t=position.t; return RF.DriveAnim.benchMT(80); }, position);
          console.log(JSON.stringify({ type: 'measurement', scene, tiles, condition, position, popout, mobileEmulation: mobile, trafficDensity: 2, seed: 7, ss: 1, cadence, free }));
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
