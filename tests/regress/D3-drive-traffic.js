// D3 traffic integration. Builder: syntax-check only; browser execution belongs to the tester.
// node tests/regress/D3-drive-traffic.js 8730 [--shots /tmp/d3-shots]   (D3_REAL_GPU=1: installed real-GPU Chromium)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8730), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.D3_REAL_GPU ? { channel: 'chromium' } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => (localStorage.clear(),localStorage.setItem('flux/driveMore','true')));
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    ok('Flux page identity and port ' + port, await page.evaluate((p) => !!RF.UI && !!RF.DriveAnim && location.port === String(p), port));
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
    await page.evaluate(() => RF.UI.setMode('D'));
    await page.waitForFunction(() => { const u = RF.UI; return u.store.scene.mode === 'D' && !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => RF.UI.setDisplay('drive')); await sleep(1000);
    const saved = await page.evaluate(() => RF.State.serialize(RF.UI.store.scene));
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { seed: 7, trafficDensity: 2, glare: 0.3, mt: true }); Object.assign(RF.UI.dvAnim, { view: 'anim', playing: false, popout: false, dist: 0, total: 0, t: 0 }); RF.UI.redrawSpec(); }); await sleep(700);
    await page.click('[data-dv="oncoming"]'); await page.click('[data-dv="preceding"]'); await sleep(700);
    const toggles = await page.evaluate(() => { const D = RF.DriveAnim, s = RF.UI.dvAnim; return { cars: D.trafficCars(D._.V.src, s.dist, s.t), pressed: ['oncoming', 'preceding'].every((k) => document.querySelector('[data-dv="' + k + '"]').getAttribute('aria-pressed') === 'true'), emit: D.placedObjects(D._.V.p, s.dist, s.t).filter((o) => o.traffic && o.emit).map((o) => o.emit) }; });
    ok('existing toolbar buttons add both traffic lanes and their emitters while paused', toggles.pressed && toggles.cars.some((c) => c.kind === 'oncoming') && toggles.cars.some((c) => c.kind === 'preceding') && toggles.emit.length >= 4, JSON.stringify(toggles.cars));
    // Compare actual worker-rendered HDR pixels to the main-thread frames at identical positions and clocks.
    const parity = await page.evaluate(async () => {
      const D = RF.DriveAnim, _ = D._, s = RF.UI.dvAnim; _.V.pinSS = 1; let worst = 0, n = 0, workers = false;
      for (const [dist, t] of [[0, 0], [35, 1.5], [70, 3], [110, 5]]) {
        s.dist = dist; s.t = t; _.frame(); const a = _.readHdr();
        workers = await _.frameMT(dist, t); const b = _.readHdr();
        for (let i = 0; i < a.length; i++) { worst = Math.max(worst, Math.abs(a[i] - b[i])); n++; }
      }
      _.V.pinSS = 0; return { worst, n, workers, fail: D.stats().mtFail };
    });
    ok('both moving traffic lanes: worker HDR = main-thread HDR bit for bit', parity.workers && !parity.fail && parity.n > 100000 && parity.worst === 0, JSON.stringify(parity));
    // The glare pass must change actual canvas pixels when these emitters are present.
    const glare = await page.evaluate(() => {
      const _ = RF.DriveAnim._, o = RF.UI.dvOpts; o.glare = 0; _.frame(); const a = _.readCanvas(); o.glare = 1; _.frame(); const b = _.readCanvas(); let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); o.glare = 0.3; return sum;
    });
    ok('existing tone-map glare changes the traffic picture', glare > 0, 'canvas absolute byte difference ' + glare);
    // Controlled beam for the UI count: 1k cd puts >1 lx at a 30 m eye; black puts 0. No dependence on whichever solver booted.
    await page.click('[data-anim="reset-flashes"]');
    const count = await page.evaluate(() => {
      const D = RF.DriveAnim, _ = D._, s = RF.UI.dvAnim, old = _.V.p.lut, car = D.trafficCars(_.V.src, 0, 0).find((c) => c.kind === 'oncoming');
      s.dist = car.rel - 30; s.t = 0; _.V.p.lut = RF.Drive.lutFrom(() => 0); _.frame(); const dark = _.V.flash.n;
      _.V.p.lut = RF.Drive.lutFrom(() => 1000); _.frame(); _.frame(); const lit = _.V.flash.n, label = document.querySelector('[data-anim="flashes"]').textContent; _.V.p.lut = old;
      return { dark, lit, label };
    });
    ok('drive bar counts an illuminated oncoming driver once, not once per frame', count.dark === 0 && count.lit === 1 && /above 1 lx: 1$/.test(count.label), JSON.stringify(count));
    await page.click('[data-anim="reset-flashes"]');
    ok('reset count clears the displayed total', await page.textContent('[data-anim="flashes"]') === 'oncoming drivers above 1 lx: 0');
    await page.locator('[data-anim="traffic-density"]').evaluate((e) => { e.value = '0'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
    ok('density zero removes animated traffic without changing the lane toggles', await page.evaluate(() => !RF.DriveAnim.trafficCars(RF.DriveAnim._.V.src, RF.UI.dvAnim.dist, RF.UI.dvAnim.t).length && RF.UI.dvOpts.oncoming && RF.UI.dvOpts.preceding));
    await page.locator('[data-anim="traffic-density"]').evaluate((e) => { e.value = '2'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
    await page.click('[data-dv="oncoming"]'); await sleep(400);
    ok('oncoming off removes only its lane', await page.evaluate(() => { const cs = RF.DriveAnim.trafficCars(RF.DriveAnim._.V.src, 0, 0); return cs.length > 0 && cs.every((c) => c.kind === 'preceding'); }));
    await page.click('[data-dv="preceding"]'); await sleep(400);
    ok('both off restores the traffic-free animation', await page.evaluate(() => !RF.DriveAnim.placedObjects(RF.DriveAnim._.V.p, 0, 0).some((o) => o.traffic)));
    await page.click('[data-dv="oncoming"]'); await page.click('[data-dv="preceding"]'); await sleep(400);
    await page.click('[data-anim="play"]'); await sleep(2500);
    const before = await page.evaluate(() => ({ d: RF.UI.dvAnim.dist, n: RF.UI.dvAnimFrames })); await sleep(1500);
    ok('traffic animation continues on workers with fresh frames', await page.evaluate((b) => RF.UI.dvAnim.dist > b.d && RF.UI.dvAnimFrames > b.n && RF.DriveAnim.stats().workers > 0 && !RF.DriveAnim.stats().mtFail, before));
    await page.click('[data-anim="play"]'); await sleep(500);
    if (shots) { require('fs').mkdirSync(shots, { recursive: true }); await page.screenshot({ path: shots + '/traffic-pane.png' }); await page.click('[data-anim="popout"]'); await sleep(600); await page.screenshot({ path: shots + '/traffic-large.png' }); await page.keyboard.press('Escape'); }
    ok('traffic controls leave the saved optical scene unchanged', saved === await page.evaluate(() => RF.State.serialize(RF.UI.store.scene)));
    ok('no page errors', errors.length === 0, errors.join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all D3 traffic page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
