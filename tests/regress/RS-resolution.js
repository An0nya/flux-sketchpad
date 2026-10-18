// RS: resolution selector, min-fps setting, dynamic stepping under CPU throttle, old stored settings, no errors.
// Tester only (needs a browser). Run from the worktree:
//   python3 tests/serve.py 8944   (background)
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/RS-resolution.js 8944
// Screenshots go to RS_OUT (default: the RS report folder).
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8944), OUT = process.env.RS_OUT || '/Users/anya/Projects/flux-sketchpad/.claude/briefs/reports';
let fails = 0;
const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); if (!c) fails++; };
const LEVELS = { low: 640, medium: 960, high: 1600, ultra: 2560, native: 3840 };
(async () => {
  // --use-angle=metal: ANGLE Metal (Apple M4) like the owner's Mac; RS_SWIFTSHADER=1 for the software default
  const browser = await pw.chromium.launch(process.env.RS_SWIFTSHADER ? {} : { args: ['--use-angle=metal'] });
  const errors = [];
  try {
    // deviceScaleFactor 2 = the owner's Mac; without it High/Ultra/Native collapse on a 1600 px wide canvas
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
    await page.evaluate((s) => { RF.UI.loadScene(RF.State.deserialize(s), 'RS fixture'); RF.UI.setMode('D'); }, fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false }); Object.assign(u.dvOpts, { mt: false, scene: 'road', wet: false, wetSheen: false, tiles: false }); u.redrawSpec(); document.querySelector('.drive-more').open = true; });

    // 1. the selector and the min-fps choice exist, with the default High and 30 fps
    const sel = await page.evaluate(() => { const r = document.querySelector('[data-anim=resolution]'), m = document.querySelector('[data-anim=min-fps]'); return { res: r && [...r.options].map((o) => o.value), resVal: r && r.value, fps: m && [...m.options].map((o) => o.value), fpsVal: m && m.value }; });
    ok('RS selector has Low/Medium/High/Ultra/Native, default High', JSON.stringify(sel.res) === '["low","medium","high","ultra","native"]' && sel.resVal === 'high', sel);
    ok('RS min fps has 20/30/45/60, default 30', JSON.stringify(sel.fps) === '["20","30","45","60"]' && sel.fpsVal === '30', sel);

    // 2. each level sets the sim width to min(ceiling, canvas backing width), with no resize, on the road scene
    const table = [];
    for (const level of Object.keys(LEVELS)) {
      await page.locator('[data-anim=resolution]').selectOption(level);
      await page.evaluate(() => RF.UI.redrawSpec());
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => { const D = RF.DriveAnim, sz = D._.size(), st = D.stats(); return { selected: RF.UI.dvOpts.simCeiling, cssW: sz.cssW, dpr: sz.dpr, sim: st.sim, canvasPx: st.canvasPx, ceiling: st.simCeiling, scale: st.resolution.scale }; });
      const want = Math.max(640, Math.min(LEVELS[level], Math.round(r.cssW * r.dpr))) & ~1;
      table.push({ level, ceiling: LEVELS[level], canvasPx: r.canvasPx, sim: r.sim, want });
      ok('RS level ' + level + ' sim width is min(ceiling, canvas width) = ' + want, !!r.sim && r.sim[0] === want && r.selected === level, r);
    }
    console.log('RS_TABLE ' + JSON.stringify(table));

    // 3. min fps is stored as minFps and frameTargetMs = 1000 / minFps
    await page.locator('[data-anim=min-fps]').selectOption('60');
    const fps = await page.evaluate(() => ({ minFps: RF.UI.dvOpts.minFps, ft: RF.UI.dvOpts.frameTargetMs, stored: JSON.parse(localStorage.getItem('flux/driveView')).minFps }));
    ok('RS min 60 fps stores minFps 60 and frameTargetMs 1000/60', fps.minFps === 60 && Math.abs(fps.ft - 1000 / 60) < 1e-9 && fps.stored === 60, fps);

    // 4. dynamic resolution + min 60 fps under a 6x CPU throttle steps the scale down; the ceiling stays High
    await page.locator('[data-anim=resolution]').selectOption('high');
    await page.locator('[data-anim=dynamic-resolution]').click();
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => { RF.DriveAnim._.V.pinSS = 0; RF.DriveAnim.resetStats(); RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.waitForTimeout(12000);
    const thr = await page.evaluate(() => { const st = RF.DriveAnim.stats(), sz = RF.DriveAnim._.size(); return { scale: st.resolution.scale, sim: st.sim, simNow: [sz.W, sz.H], ceiling: st.simCeiling, frames: st.frames, median: st.rafMedianMs }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    ok('RS dynamic + min 60 fps under 6x throttle lowers the scale below 1 with the High ceiling', thr.scale < 1 && thr.ceiling === 1600 && thr.frames > 0, thr);
    ok('RS sim width under that scale is the ceiling times the scale (height 9:16)', thr.simNow[0] <= Math.round(1600 * thr.scale) + 2 && thr.simNow[0] >= 160, thr);
    await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); });
    await page.locator('[data-anim=dynamic-resolution]').click();

    // 5. old stored settings (frameTargetMs 50, no minFps, no ceiling) load as min 20 fps, High
    await page.evaluate(() => { localStorage.setItem('flux/driveView', JSON.stringify({ frameTargetMs: 50, dynamicResolution: false, scene: 'road' })); RF.UI.dvOpts = undefined; RF.UI.redrawSpec(); });
    const old = await page.evaluate(() => ({ minFps: RF.UI.dvOpts.minFps, ft: RF.UI.dvOpts.frameTargetMs, ceiling: RF.UI.dvOpts.simCeiling }));
    ok('RS old stored frameTargetMs 50 loads as min 20 fps, ceiling High', old.minFps === 20 && Math.abs(old.ft - 50) < 1e-9 && old.ceiling === 'high', old);

    // 6. wet sheen close-up, Low vs Ultra (upper-central band of the canvas where the wet sheen sits; chosen by eye, not verified to be 20-50 m)
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { scene: 'road', wet: true, wetSheen: true, tiles: false }); RF.DriveAnim.openPop(RF.UI); RF.UI.redrawSpec(); });
    await page.waitForTimeout(800);
    console.log('RS_POPOUT canvasPx ' + JSON.stringify(await page.evaluate(() => RF.DriveAnim.stats().canvasPx)));
    for (const level of ['low', 'ultra']) {
      await page.locator('[data-anim=resolution]').selectOption(level);
      await page.evaluate(() => { RF.DriveAnim._.V.pinSS = 1; RF.UI.redrawSpec(); });
      await page.waitForTimeout(1500);
      // element screenshot of the visible drive canvas (its backing-store pixels), then a sips crop of the upper-central band
      const el = page.locator('canvas.drive-gl:visible').first();
      const dims = await el.evaluate((c) => ({ w: c.width, h: c.height }));
      const full = path.join(OUT, 'rs-wetsheen-' + level + '-full.tmp.png'), crop = path.join(OUT, 'rs-wetsheen-' + level + '.png');
      fs.writeFileSync(full, await el.screenshot());
      // the popout toolbar covers roughly the top fifth of the canvas, so the band starts below it
const cw = Math.round(dims.w * 0.6), ch = Math.round(dims.h * 0.4), ox = Math.round(dims.w * 0.2), oy = Math.round(dims.h * 0.22);
      require('child_process').execFileSync('sips', ['-c', String(ch), String(cw), '--cropOffset', String(oy), String(ox), full, '--out', crop]);
      fs.unlinkSync(full);
      await page.evaluate(() => { RF.DriveAnim._.V.pinSS = 0; });
    }
    console.log('RS_SHOTS ' + path.join(OUT, 'rs-wetsheen-low.png') + ' ' + path.join(OUT, 'rs-wetsheen-ultra.png'));

    ok('RS no page or console errors', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + ' RS check(s) FAILED' : 'all RS checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('[FAIL] RS crashed: ' + e.stack); process.exit(1); });
