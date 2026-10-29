// Tester only: python3 tests/serve.py 8762
// UX1_REAL_GPU=1 node tests/regress/UX1-drive-ux.js 8762 [--shots /tmp/UX1-shots]
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8762), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + JSON.stringify(d) : '')); if (!c) fails++; };
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await pw.chromium.launch(process.env.UX1_REAL_GPU ? { channel: 'chromium' } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, hasTouch: true }), page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:' + port + '/index.html');
    const ready = async () => {
      await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
      ok('UX1 identifies RF.UI and expected port', await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
      await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
      await page.evaluate((txt) => { RF.UI.loadScene(RF.State.deserialize(txt), 'UX1 fixture'); RF.UI.setMode('D'); }, scene);
      await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
      await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvOpts, { mt: false, scene: 'road', speed: 50, tiles: false, oncoming: false, preceding: false, trafficDensity: 0, trafficLogic: false }); u.redrawSpec(); });
    };
    await page.evaluate(() => localStorage.removeItem('flux/driveTab')); await ready();
    // QOL1's first-visit 'Getting started' card is fixed over the drive bar at 360 px and would intercept clicks; dismiss it as a first-time user would.
    await page.evaluate(() => { if (!document.getElementById('first-guide').hidden) document.getElementById('guide-close').click(); });
    // UI step C (10-29): the More panel is gone; controls live in the layout shell's tabs. RF.DriveLayout.reveal opens the tab holding one.
    const reveal = (selector) => page.evaluate((s) => RF.DriveLayout.reveal(RF.UI, s), selector);
    const advanced = async (selector) => { await reveal(selector); await page.locator(selector).click(); };
    ok('UX1 shell starts on the Lighting tab', await page.evaluate(() => RF.UI.driveLayout.state.tab === 'lighting'));
    await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); }); // paused animation is the fixed picture
    const controls = await page.evaluate(() => [...document.querySelectorAll('.drive-tools button,.drive-tools input,.drive-tools select,.drive-extras button,.drive-extras input,.drive-extras select,[data-anim=popout]')].map((e) => e.dataset.dv || e.dataset.anim || e.dataset.game));
    ok('UX1 all distinct drive options remain after dedupe', ['scene','shape','wetness','wetSheen','onMode','expMode','evm','ev','evp','glare','oncoming','preceding','popout','tiles','toggle','play','large-card','speed','traffic-logic','gap','street-lamps','c-people','c-animals','c-signs','c-posts','c-veg','c-obstacle','c-rpm','c-tex','c-wild','c-mt','seed','dice','density','cline','traffic-density','reset-flashes'].every((k) => controls.includes(k)), controls);
    for (const width of [360, 390, 430, 1500]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(() => { RF.UI.setPane('result', 'activate'); document.querySelector('.result-pane').classList.add('expanded'); RF.UI.redrawSpec(); });
      for (const popout of [false, true]) {
        if (popout) await advanced('[data-anim=popout]');
        // layout collisions and clipping are UX2's job (measure()); here: the shell fits the viewport and a tab control can be reached
        const layout = await page.evaluate(() => { const r = RF.UI.driveBar.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
        ok('UX1 shell fits the viewport ' + width + (popout ? ' large' : ' inline'), layout.left >= -0.5 && layout.right <= width + 0.5, layout);
        await reveal('[data-anim=traffic-logic]'); await page.waitForTimeout(150);
        ok('UX1 a tab control is reachable ' + width + (popout ? ' large' : ' inline'), await page.locator('[data-anim=traffic-logic]').isVisible());
        if (shots) await page.screenshot({ path: path.join(shots, width + (popout ? '-large' : '-inline') + '-tabs.png') });
        if (popout) await advanced('[data-anim=popout]');
      }
    }
    await page.setViewportSize({ width: 1500, height: 950 }); await page.evaluate(() => RF.DriveLayout.select(RF.UI, { tab: 'performance' }));
    await page.reload(); await ready();
    ok('UX1 the open tab is remembered across reload', await page.evaluate(() => RF.UI.driveLayout.state.tab === 'performance'));
    await page.evaluate(() => { RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); });
    await reveal('[data-anim=traffic-logic]'); await page.locator('[data-anim=traffic-logic]').click();
    const speed = await page.evaluate(() => {
      const a = RF.DriveAnim._, st = a.S(RF.UI); a.advanceCamera(st, .05); a.frame(); const initial = st.camera.v * 3.6;
      RF.UI.dvOpts.speed = 130; st.camera = null; a.advanceCamera(st, .05); a.frame();
      return { initial, limited: st.camera.v * 3.6, label: RF.UI.driveBar.querySelector('[data-anim=speedlab]').textContent, aim: RF.UI.driveBar.querySelector('[data-dv-aim]').textContent };
    });
    ok('UX1 toggling logic starts at speed; actual limit appears by slider', Math.abs(speed.initial - 50) < .01 && Math.abs(speed.limited - 80) < .01 && /130 km\/h · actual 80$/.test(speed.label), speed);
    ok('UX1 drive bar names the aim used by both beams', /Our beam \+ symmetric oncoming: aimed per/.test(speed.aim), speed.aim);
    await page.locator('[data-game=toggle]').click();
    ok('UX1 lane-clear setting defaults on', await page.locator('[data-game=clear-lane]').isChecked());
    await page.locator('[data-game=start]').click();
    const touch = await page.evaluate(() => {
      const b = document.querySelector('[data-game=brake]'), panel = document.querySelector('[data-game=panel]');
      const start = new Event('touchstart', { bubbles: true, cancelable: true }); b.dispatchEvent(start); const held = RF.UI.dvAnim.game.brake;
      const end = new Event('touchend', { bubbles: true, cancelable: true }); b.dispatchEvent(end);
      const menu = new Event('contextmenu', { bubbles: true, cancelable: true }); b.dispatchEvent(menu);
      const ps = new Event('touchstart', { bubbles: true, cancelable: true }); panel.dispatchEvent(ps);
      const css = [b,panel].map((e) => { const s = getComputedStyle(e); return { select: s.userSelect || s.webkitUserSelect, action: s.touchAction, callout: s.webkitTouchCallout || 'unsupported in Chromium' }; });
      return { start: start.defaultPrevented, end: end.defaultPrevented, menu: menu.defaultPrevented, panel: ps.defaultPrevented, held, released: !RF.UI.dvAnim.game.brake, css };
    });
    ok('UX1 touch hold brakes and releases; selection/menu suppressed on Brake only, the panel still touch-scrolls', touch.start && touch.end && touch.menu && !touch.panel && touch.held && touch.released && touch.css[0].select === 'none' && touch.css[1].select !== 'none' && touch.css[0].action === 'none' && touch.css[1].action === 'manipulation', touch);
    const departure = await page.evaluate(() => {
      const a = RF.DriveAnim._, st = a.S(RF.UI), g = st.game; st.playing = false; g.next = Infinity; g.v = 0; g.brake = false;
      g.hazards = [{ id: 1, born: g.t, kind: 'deer', s0: g.x + 30, off0: 0, ds: 0, doff: 1, spd: 3.5, len: 0, side: -1 }];
      a.advanceCamera(st, .05); const h = g.hazards[0]; h.leaving.spd = .2; a.advanceCamera(st, 3); a.frame();
      const waiting = { v: g.v, off: RF.DriveGame.pose(g,h,g.t).off, rendered: !!a.V.gameBar && !a.V.gameBar.hidden };
      h.leaving.spd = 3.5; a.advanceCamera(st, .1); a.frame();
      return { waiting, resumed: g.v > 0, clear: RF.DriveGame.laneClear(g), off: RF.DriveGame.pose(g,h,g.t).off };
    });
    ok('UX1 game waits beyond timer, renders departure and resumes with road clear', departure.waiting.v === 0 && departure.waiting.off > 0 && departure.waiting.rendered && departure.resumed && departure.clear, departure);
    if (shots) await page.screenshot({ path: path.join(shots, 'departure.png') });
    // UX1-DP-test: a running minigame must stay paused after a WebGL context restore (RB-tester finding); the player resumes it.
    await page.locator('[data-game=toggle]').click(); await page.locator('[data-game=toggle]').click(); await page.locator('[data-game=start]').click();
    await page.waitForFunction(() => RF.UI.dvAnim.playing && RF.UI.dvAnim.game, null, { timeout: 15000 }); await page.waitForTimeout(800);
    const restore = await page.evaluate(async () => {
      const a = RF.DriveAnim._, st = a.S(RF.UI), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ext = a.V.gl.gl.getExtension('WEBGL_lose_context');
      ext.loseContext(); await sleep(400); ext.restoreContext(); await sleep(1500);
      const x1 = st.game.x, playing = st.playing; await sleep(800);
      return { playing, x1, x2: st.game.x, lost: a.V.lost };
    });
    ok('UX1-DP-test running minigame stays paused after WebGL context restore', restore.playing === false && restore.lost === false && restore.x1 === restore.x2, restore);
    ok('UX1 no page errors', errors.length === 0, errors);
    console.log('Manual iOS Safari check still required: hold Brake for 2+ seconds, slide off, release, scroll lobby/card. Synthetic Chromium touch cannot prove native callout suppression.');
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all UX1 page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
