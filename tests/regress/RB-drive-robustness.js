// RB builder test, for the tester only: node tests/regress/RB-drive-robustness.js 8760
// Serve this worktree: python3 tests/serve.py 8760. RB_SHOTS=/path saves desktop/mobile end cards.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8760), errors = [];
let fails = 0;
const ok = (name, yes, detail) => { console.log((yes ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + JSON.stringify(detail) : '')); if (!yes) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      const Native = window.Worker;
      window.__rb = { stalls: 0, created: 0, killed: 0 };
      window.Worker = function (url, opts) {
        const w = new Native(url, opts);
        if (!/drive-worker\.js$/.test(String(url))) return w;
        __rb.created++;
        const post = w.postMessage.bind(w), terminate = w.terminate.bind(w);
        w.postMessage = (m, ...rest) => { if (m.type === 'job' && __rb.stalls > 0) { __rb.stalls--; return; } post(m, ...rest); };
        w.terminate = () => { __rb.killed++; terminate(); }; return w;
      };
    });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    // QOL1's first-visit 'Getting started' card is fixed over the phone tabs and would intercept clicks; dismiss it as a first-time user would.
    await page.evaluate(() => { if (!document.getElementById('first-guide').hidden) document.getElementById('guide-close').click(); });
    ok('RB identifies RF.UI and exact requested port', await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
    await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 180000 });
    // Real page-loop fallback: destroy the device in the call that starts a batch, avoiding a timing race with the tester.
    const gpu = await page.evaluate(async () => {
      const G = RF.GpuTrace; if (!(await G.init())) return { available: false };
      G.setPref(true); const step = G.step;
      window.__rbGpuCtx = null;
      G.step = (ctx, n, done) => { G.step = step; window.__rbGpuCtx = ctx; const r = step(ctx, n, done); G._loseDevice(); return r; };
      RF.UI.requestRun(false); return { available: true };
    });
    if (gpu.available) {
      await page.waitForFunction(() => window.__rbGpuCtx && __rbGpuCtx.done && !__rbGpuCtx._gpuBusy, null, { timeout: 180000 });
      const r = await page.evaluate(() => ({ error: __rbGpuCtx.gpuError, next: __rbGpuCtx.next, n: __rbGpuCtx.N, cpu: !RF.GpuTrace.use(__rbGpuCtx), emitted: __rbGpuCtx.E.emitted, power: __rbGpuCtx.P.power }));
      ok('RB page run completes on CPU after GPU device loss, without double-counting energy', r.error && r.cpu && r.next === r.n && Math.abs(r.emitted / r.power - 1) < 1e-6, r);
    } else console.log('[SKIP] RB real GPU loss: no WebGPU adapter; deterministic Node loss test still applies');
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
    await page.evaluate(() => { RF.SolverHost.setRecovery(true); RF.UI.setMode('D'); });
    await page.waitForFunction(() => { const ui = RF.UI; return !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000 });
    await page.evaluate(() => { RF.UI.setDisplay('drive'); Object.assign(RF.UI.dvOpts, { scene: 'road', fitControls: true, largeCard: true, mt: true, gpuRenderer: false }); RF.UI.redrawSpec(); });
    await page.evaluate(() => { const a = RF.DriveAnim._; a.S(RF.UI).view = 'anim'; a.S(RF.UI).playing = false; a.V.pinSS = 1; RF.UI.redrawSpec(); });
    const hasGL = await page.evaluate(() => !!RF.DriveAnim._.V.gl);
    ok('RB Drive has WebGL2 float targets (required for these loss tests)', hasGL);
    if (!hasGL) throw new Error('tester needs WebGL2 float targets');
    // Context restoration must rebuild objects, programs and ground textures even with unchanged dimensions.
    const loss = await page.evaluate(() => {
      const a = RF.DriveAnim._; a.frame(); window.__rbOldGL = a.V.gl;
      const pixels = a.V.gl.readHdr(); window.__rbHdr = Array.from(pixels);
      const ext = a.V.gl.gl.getExtension('WEBGL_lose_context'); if (!ext) return false;
      window.__rbExt = ext; ext.loseContext(); return true;
    });
    ok('RB WEBGL_lose_context is available', loss);
    await page.waitForFunction(() => RF.DriveAnim._.V.lost);
    const paused = await page.evaluate(() => { const a = RF.DriveAnim._; return { playing: a.S(RF.UI).playing, running: !!a.V.raf, jobs: a.Wk.jobs.size, workers: a.Wk.list.length, hidden: a.V.canvas.hidden, notice: a.V.why }; });
    ok('RB context loss pauses Drive, discards jobs and shows notice', !paused.playing && !paused.running && !paused.jobs && !paused.workers && paused.hidden && /lost/.test(paused.notice), paused);
    await page.evaluate(() => __rbExt.restoreContext());
    await page.waitForFunction(() => !RF.DriveAnim._.V.lost && RF.DriveAnim._.V.gl !== window.__rbOldGL && !RF.DriveAnim._.V.canvas.hidden);
    const restored = await page.evaluate(() => { const a = RF.DriveAnim._; a.frame(); const px = a.V.gl.readHdr(); let max = 0, sum = 0; for (let i = 0; i < px.length; i++) { max = Math.max(max, Math.abs(px[i] - __rbHdr[i])); if (i % 4 !== 3) sum += px[i]; } return { max, sum, playing: a.S(RF.UI).playing }; });
    ok('RB restored resources render the same paused HDR frame', restored.max === 0 && restored.sum > 0 && !restored.playing, restored);
    // Test exact job retry with actual row transfers, then a permanent hang and main-thread frames.
    await page.evaluate(() => { const a = RF.DriveAnim._; a.killWorkers(); a.Wk.forced = 1; a.Wk.deadlineMs = 1500; a.Wk.restarts = 0; });
    const retry = await page.evaluate(async () => {
      const a = RF.DriveAnim._; await a.frameMT(35, 4); const before = Array.from(a.V.gl.readHdr()), n = __rb.created, killed = __rb.killed;
      __rb.stalls = 1; const drawn = await a.frameMT(35, 4), after = a.V.gl.readHdr(); let max = 0;
      for (let i = 0; i < after.length; i++) max = Math.max(max, Math.abs(before[i] - after[i]));
      return { drawn, max, spawned: __rb.created - n, killed: __rb.killed - killed, restarts: a.Wk.restarts, timers: a.Wk.jobs.size };
    });
    ok('RB stalled real worker replaced once; redispatched pose gives identical HDR', retry.drawn && retry.max === 0 && retry.spawned === 1 && retry.killed === 1 && retry.restarts === 1 && retry.timers === 0, retry);
    const cap = await page.evaluate(async () => {
      const a = RF.DriveAnim._; a.killWorkers(); a.Wk.restarts = 0; __rb.stalls = Infinity;
      const drawn = await a.frameMT(40, 5); __rb.stalls = 0;
      const r = { drawn, restarts: a.Wk.restarts, failed: a.Wk.failed, workers: a.Wk.list.length, notice: a.V.why, frames: a.V.frames };
      a.S(RF.UI).playing = true; RF.UI.redrawSpec(); return r;
    });
    await page.waitForFunction((n) => RF.DriveAnim._.V.frames > n + 1, cap.frames);
    ok('RB permanent stall caps replacements and animation continues on caller CPU', !cap.drawn && cap.restarts === 2 && cap.workers === 0 && /limit/.test(cap.failed) && /page traces/.test(cap.notice), cap);
    await page.evaluate(() => { window.__rbFrames = RF.DriveAnim._.V.frames; __rbExt = RF.DriveAnim._.V.gl.gl.getExtension('WEBGL_lose_context'); __rbExt.loseContext(); });
    await page.waitForFunction(() => RF.DriveAnim._.V.lost && !RF.UI.dvAnim.playing && !RF.DriveAnim._.V.raf);
    await page.evaluate(() => __rbExt.restoreContext());
    await page.waitForFunction(() => !RF.DriveAnim._.V.lost && RF.UI.dvAnim.playing && RF.DriveAnim._.V.frames > __rbFrames + 1);
    ok('RB playing Drive automatically resumes fresh frames after context restoration', await page.evaluate(() => RF.UI.dvAnim.playing && !!RF.DriveAnim._.V.raf));
    await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); });
    // UX1 nests extras in More; retain RB's phone hit-test and non-overlap check on the new panel.
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.click('[data-tab=result]');   // phone layout shows one pane at a time: the Drive controls live in Result
      await page.evaluate(() => { const p = document.querySelector('.result-pane'); if (p) p.classList.add('expanded'); RF.UI.redrawSpec(); });
      const fit = await page.evaluate(async () => {
        const top = document.querySelector('.drive-primary'), more = document.querySelector('.drive-more'), bottom = RF.UI.driveExtras, game = document.querySelector('[data-game=toggle]');
        more.open = false;
        game.scrollIntoView({ block: 'nearest', inline: 'end' });
        const t = top.getBoundingClientRect(), y0 = scrollY, r = game.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        more.open = true; await new Promise((r) => setTimeout(r, 150)); const b = bottom.getBoundingClientRect(), dy = y0 - scrollY;   // document coordinates: opening More may shift the scroll. The <details> toggle event un-hides the extras a task later
         more.open = false;
        return { top: [t.top, t.bottom], bottom: [b.top - dy, b.bottom - dy], gameHit: hit === game, within: r.left >= 0 && r.right <= innerWidth, scroll: top.scrollWidth <= top.clientWidth + 1 };
      });
      ok('RB full Drive controls do not overlap at ' + width + ' px; Game can be clicked', fit.top[1] <= fit.bottom[0] && fit.gameHit && fit.within && fit.scroll, fit);
    }
    // A completed fixture exercises presentation only; it makes no gameplay/detection claim.
    for (const [width, height] of [[1280, 720], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { if (RF.UI.dvAnim.popout) RF.DriveAnim.closePop(RF.UI); if (RF.UI.dvAnim.gameMode) RF.DriveAnim._.toggleGame(RF.UI); RF.DriveAnim._.toggleGame(RF.UI); document.querySelector('[data-game=start]').click(); });
      await page.evaluate(() => { const g = RF.UI.dvAnim.game; if (!g) throw new Error('no game fixture'); g.done = true; g.reason = 'RB presentation fixture'; RF.UI.dvAnim.playing = false; RF.DriveAnim._.gameFrame(g); });
      await page.waitForFunction(() => RF.UI.dvAnim.popout && !!document.querySelector('.drive-popout [data-game=card]:not([hidden])'));
      const card = await page.evaluate(() => {
        const c = document.querySelector('[data-game=card]'), p = c.closest('.drive-below'), host = p.parentElement.getBoundingClientRect();
        p.scrollTop = p.scrollHeight; const r = p.getBoundingClientRect(); const tail = p.scrollTop + p.clientHeight >= p.scrollHeight - 1;
        p.scrollTop = 0; const exit = p.querySelector('[data-game=exit]'), e = exit.getBoundingClientRect();
        return { bounded: r.top >= host.top && r.bottom <= host.bottom + 1 && r.bottom <= innerHeight, tail, readable: p.clientHeight >= 200, exit: document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2) === exit, text: c.textContent.slice(-145), height: p.clientHeight };
      });
      ok('RB end card opens large, stays within viewport, tail and Exit reachable at ' + width + '×' + height, card.bounded && card.tail && card.readable && card.exit && /Game flavour/.test(card.text), card);
      if (process.env.RB_SHOTS) await page.screenshot({ path: process.env.RB_SHOTS + '/RB-card-' + width + '.png' });
      await page.click('[data-game=exit]');
      ok('RB Exit game restores inline view after automatic card popout at ' + width, await page.evaluate(() => !RF.UI.dvAnim.popout && !document.querySelector('.drive-popout')));
    }
    // OFF options remain available and recovery preference persists; do not hang a worker with recovery OFF.
    const off = await page.evaluate(() => {
      if (RF.UI.dvAnim.popout) RF.DriveAnim.closePop(RF.UI);
      const b = document.querySelector('[data-anim=fit-controls]'); b.click();
      document.querySelector('[data-anim=large-card]').click();
      const box = document.querySelector('[aria-label="Automatic recovery"]'); box.checked = false; box.dispatchEvent(new Event('change'));
      return { fit: RF.UI.dvOpts.fitControls, large: RF.UI.dvOpts.largeCard, stored: JSON.parse(localStorage.getItem('flux/driveView')), recovery: RF.SolverHost.recovery(), recoveryStored: localStorage.getItem('flux/recovery'), fitClass: RF.DriveAnim._.V.canvas.parentElement.classList.contains('drive-fit') };
    });
    ok('RB old layout/end card/recovery behavior stays reachable and persisted', off.fit === false && off.large === false && off.stored.fitControls === false && off.stored.largeCard === false && !off.recovery && off.recoveryStored === '0' && !off.fitClass, off);
    await page.evaluate(() => { RF.SolverHost.setRecovery(true); RF.UI.dvOpts.fitControls = true; RF.UI.dvOpts.largeCard = true; RF.UI.redrawSpec(); });
    // Force restore failure; the old CPU still remains usable and the popout is removed.
    await page.evaluate(() => { RF.DriveAnim.openPop(RF.UI); __rbExt = RF.DriveAnim._.V.gl.gl.getExtension('WEBGL_lose_context'); __rbExt.loseContext(); });
    await page.waitForFunction(() => RF.DriveAnim._.V.lost);
    await page.evaluate(() => { RF.DriveAnim._.V.canvas.getContext = () => null; __rbExt.restoreContext(); });
    await page.waitForFunction(() => RF.DriveAnim._.V.glFailed);
    const fallback = await page.evaluate(() => ({ view: RF.UI.dvAnim.view, playing: RF.UI.dvAnim.playing, popout: RF.UI.dvAnim.popout, dialog: !!document.querySelector('.drive-popout'), hidden: RF.DriveAnim._.V.canvas.hidden, still: !!(RF.UI.driveShown && RF.UI.driveShown.res), notice: RF.DriveAnim._.V.why }));
    ok('RB failed restore closes popout and uses CPU recovery picture with notice', fallback.view === 'anim' && !fallback.playing && !fallback.popout && !fallback.dialog && fallback.hidden && fallback.still && /rebuild failed/.test(fallback.notice), fallback);
    await page.setViewportSize({ width: 1280, height: 720 });   // phone layout hides the Scene pane, so no GL underlay would be visible
    await page.evaluate(() => { RF.RenderGL.setPref(true); RF.RenderGL._resetFailure(); RF.UI.sceneDirty = true; RF.UI.redrawSpec(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.gl-under')].some((c) => c.style.display !== 'none' && c.getClientRects().length));
    await page.evaluate(() => {
      const cv = [...document.querySelectorAll('.gl-under')].find((c) => c.style.display !== 'none' && c.getClientRects().length), gl = cv.getContext('webgl2'), ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) throw new Error('renderer loss extension unavailable');
      window.__rbRenderCanvas = cv;
      const draw = gl.drawElements.bind(gl); let once = false;
      gl.drawElements = (...args) => { if (!once) { once = true; ext.loseContext(); } return draw(...args); };
      RF.UI.sceneDirty = true; RF.UI.redrawSpec();
    });
    await page.waitForFunction(() => !!RF.RenderGL.failure());
    const sceneLoss = await page.evaluate(() => ({ failure: RF.RenderGL.failure(), on: RF.RenderGL.on(), hidden: __rbRenderCanvas.style.display === 'none' }));
    ok('RB scene renderer loss during a draw hides the GL underlay and stays on CPU', !sceneLoss.on && sceneLoss.hidden && /context lost/.test(sceneLoss.failure), sceneLoss);
    ok('RB no uncaught page errors', errors.length === 0, errors);
  } finally { await browser.close(); }
  console.log(fails ? fails + ' RB checks FAILED' : 'all RB page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('[FAIL] ' + (e.stack || e)); process.exitCode = 1; });
