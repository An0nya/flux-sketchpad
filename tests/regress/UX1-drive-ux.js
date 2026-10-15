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
      await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvOpts, { mt: false, fitControls: true, scene: 'road', speed: 50, tiles: false, oncoming: false, preceding: false, trafficDensity: 0, trafficLogic: false }); u.redrawSpec(); });
    };
    await page.evaluate(() => localStorage.removeItem('flux/driveMore')); await ready();
    const more = page.locator('.drive-more');
    ok('UX1 More starts collapsed', !await more.evaluate((e) => e.open));
    await page.locator('[data-anim=animate]').click();
    await page.locator('[data-anim=play]').click(); // freeze the picture while inspecting layout
    const controls = await page.evaluate(() => [...RF.UI.driveBar.querySelectorAll('button,input,select')].map((e) => e.dataset.dv || e.dataset.anim || e.dataset.game));
    ok('UX1 all original drive controls remain', ['scene','shape','wet','wetSheen','onMode','expMode','evm','ev','evp','glare','people','animals','signs','oncoming','preceding','animate','popout','tiles','toggle','play','fit-controls','large-card','speed','traffic-logic','gap','street-lamps','c-people','c-animals','c-signs','c-posts','c-veg','c-obstacle','c-rpm','c-tex','c-wild','c-mt','seed','dice','density','cline','traffic-density','reset-flashes'].every((k) => controls.includes(k)), controls);
    for (const width of [360, 390, 430, 1500]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(() => { RF.UI.setPane('result', 'activate'); document.querySelector('.result-pane').classList.add('expanded'); RF.UI.redrawSpec(); });
      for (const popout of [false, true]) {
        if (popout) await page.locator('[data-anim=popout]').click();
        const layout = await page.evaluate(() => {
          const bar = RF.UI.driveBar, p = bar.querySelector('.drive-primary'), r = bar.getBoundingClientRect(), c = [...p.children].map((e) => e.getBoundingClientRect());
          return { left: r.left, right: r.right, width: innerWidth, rowHeight: p.getBoundingClientRect().height, spread: Math.max(...c.map((e) => e.top)) - Math.min(...c.map((e) => e.top)), closed: !bar.querySelector('details').open, extraVisible: bar.querySelector('[data-dv=shape]').getClientRects().length > 0, primary: [...p.querySelectorAll('button,input,select')].map((e) => e.dataset.dv || e.dataset.anim || e.dataset.game) };
        });
        ok('UX1 one scrollable primary row, extras collapsed ' + width + (popout ? ' large' : ' inline'), layout.left >= 0 && layout.right <= width && layout.rowHeight < 60 && layout.spread < 15 && layout.closed && !layout.extraVisible && ['scene','speed','toggle','glare','oncoming','preceding','animate','play','popout'].every((k) => layout.primary.includes(k)), layout);
        await page.locator('.drive-more > summary').click();
        ok('UX1 More exposes extras ' + width + (popout ? ' large' : ' inline'), await page.locator('[data-dv=shape]').isVisible() && await page.locator('[data-anim=traffic-logic]').isVisible());
        if (shots) await page.screenshot({ path: path.join(shots, width + (popout ? '-large' : '-inline') + '-more.png') });
        await page.locator('.drive-more > summary').click();
        if (popout) await page.locator('[data-anim=popout]').click();
      }
    }
    await page.setViewportSize({ width: 1500, height: 950 }); await page.locator('.drive-more > summary').click();
    await page.waitForFunction(() => localStorage.getItem('flux/driveMore') === 'true');
    await page.reload(); await ready();
    ok('UX1 More remembers open across reload', await more.evaluate((e) => e.open));
    await page.locator('[data-anim=animate]').click(); await page.locator('[data-anim=play]').click();
    await page.locator('[data-anim=traffic-logic]').click();
    const speed = await page.evaluate(() => {
      const a = RF.DriveAnim._, st = a.S(RF.UI); a.advanceCamera(st, .05); a.frame(); const initial = st.camera.v * 3.6;
      RF.UI.dvOpts.speed = 130; st.camera = null; a.advanceCamera(st, .05); a.frame();
      return { initial, limited: st.camera.v * 3.6, label: RF.UI.driveBar.querySelector('[data-anim=speedlab]').textContent, aim: RF.UI.driveBar.querySelector('[data-dv-aim]').textContent };
    });
    ok('UX1 toggling logic starts at speed; actual limit appears by slider', Math.abs(speed.initial - 50) < .01 && Math.abs(speed.limited - 80) < .01 && /130 km\/h.*actual 80\.0 km\/h/.test(speed.label), speed);
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
    ok('UX1 touch hold brakes and releases; selection/menu defaults suppressed', touch.start && touch.end && touch.menu && touch.panel && touch.held && touch.released && touch.css.every((s) => s.select === 'none') && touch.css[0].action === 'none' && touch.css[1].action === 'manipulation', touch);
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
    ok('UX1 no page errors', errors.length === 0, errors);
    console.log('Manual iOS Safari check still required: hold Brake for 2+ seconds, slide off, release, scroll lobby/card. Synthetic Chromium touch cannot prove native callout suppression.');
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all UX1 page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
