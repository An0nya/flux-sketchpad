// CD page checks. Load UX2-drive-ux.js first to reuse its actual overlap helper.
(function (root) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const settle = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await sleep(100); };
  // Every option in the former static bar, mapped to its single surviving control.
  const oldOptions = {
    scene: '[data-dv=scene]', shape: '[data-dv=shape]', wet: '[data-dv=wet]', wetSheen: '[data-dv=wetSheen]',
    onMode: '[data-dv=onMode]', expMode: '[data-dv=expMode]', evm: '[data-dv=evm]', ev: '[data-dv=ev]', evp: '[data-dv=evp]',
    glare: '[data-dv=glare]', people: '[data-anim=c-people]', animals: '[data-anim=c-animals]', signs: '[data-anim=c-signs]',
    oncoming: '[data-dv=oncoming]', preceding: '[data-dv=preceding]'
  };
  async function run(port) {
    const checks = [], layouts = [], errors = [], ok = (name, pass, detail) => {
      checks.push({ name, pass: !!pass, detail }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
    };
    const onError = e => errors.push(String(e.error || e.reason || e.message)), originalError = console.error;
    addEventListener('error', onError); addEventListener('unhandledrejection', onError);
    console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError.apply(console, args); };
    try {
      ok('CD expected Flux page and port', !!root.RF?.UI && location.port === String(port));
      if (location.port !== String(port)) throw Error('CD wrong page');
      const initial = JSON.parse(localStorage.getItem('flux/driveView') || '{}');
      const u = await UX2Page.ready(), D = RF.DriveAnim, a = D._, V = a.V;
      // The standalone runner seeds a real legacy preference before navigation. External
      // page runners can run without it; the live preference migration below is mandatory too.
      if (initial.view === 'still' || initial.view === 'static') {
        const migrated = JSON.parse(localStorage.getItem('flux/driveView'));
        ok('CD startup legacy preference becomes paused animate', u.dvAnim.view === 'anim' && !u.dvAnim.playing && !V.canvas.hidden && migrated.view === 'anim' && migrated.playing === false);
        ok('CD startup migration preserves unrelated preferences', migrated.ev === initial.ev && migrated.seed === initial.seed);
      }
      if (u.dvAnim.popout) D.closePop(u);
      Object.assign(u.dvOpts, { scene: 'road', mountainPass: false, tiles: false, wild: false, gpuRenderer: false, mt: false, trafficLogic: false, oncoming: false, preceding: false, people: true, animals: true, signs: true, expMode: 'fixed', onMode: 'symmetric', glare: 'off', wet: true, wetSheen: false, detailedModels: false, dynamicResolution: false, fpsCounter: false, debugTimings: false });
      Object.assign(u.dvAnim, { view: 'anim', playing: false, dist: 0, total: 0, t: 0 }); u.rvOpts.shape = 'straight'; u.redrawSpec(); await settle();
      const trace = u.run.ctx, opticalScene = RF.State.serialize(u.store.scene), more = u.driveBar.querySelector('.drive-more');
      const all = selector => [...new Set([...u.driveBar.querySelectorAll(selector), ...u.driveExtras.querySelectorAll(selector)])];
      const get = selector => all(selector)[0];
      ok('CD no static-mode control or duplicate class switches', !document.querySelector('[data-anim=animate],[data-dv=people],[data-dv=animals],[data-dv=signs],[data-anim=mountain-pass]'));
      more.open = true; D.layoutControls(u); await settle();
      for (const [key, selector] of Object.entries(oldOptions)) {
        const controls = all(selector);
        ok('CD former static option reachable exactly once: ' + key, controls.length === 1 && controls[0].checkVisibility() && !controls[0].disabled, selector);
      }
      // Invoke the actual controls and check that they change their shared option.
      for (const key of ['wet', 'wetSheen', 'oncoming', 'preceding']) {
        const before = u.dvOpts[key]; get(oldOptions[key]).click();
        ok('CD merged control works: ' + key, u.dvOpts[key] === !before && get(oldOptions[key]).getAttribute('aria-pressed') === String(!before));
        get(oldOptions[key]).click();
      }
      for (const [key, cls] of [['people', 'person'], ['animals', 'deer'], ['signs', 'sign']]) {
        const count = () => V.src.objects.filter(o => o.cls === cls).length;
        const before = count(); get(oldOptions[key]).click();
        ok('CD merged class switch affects rendered source: ' + key, before > 0 && !u.dvOpts[key] && count() === 0, { before, after: count() });
        get(oldOptions[key]).click(); ok('CD class restored: ' + key, count() === before && u.dvOpts[key]);
      }
      const change = (selector, value) => { const e = get(selector); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); };
      change(oldOptions.onMode, 'manual'); ok('CD headlamp selection works', u.dvOpts.onMode === 'manual');
      get(oldOptions.expMode).click(); ok('CD exposure mode works', u.dvOpts.expMode === 'auto');
      get(oldOptions.expMode).click(); get(oldOptions.expMode).click();
      get(oldOptions.ev).click(); get(oldOptions.evm).click(); ok('CD EV darker works', u.dvOpts.ev === .5);
      get(oldOptions.evp).click(); ok('CD EV brighter works', u.dvOpts.ev === 1);
      get(oldOptions.ev).click(); ok('CD EV reset works', u.dvOpts.ev === 1);
      get(oldOptions.glare).click(); ok('CD glare works', u.dvOpts.glare === 'dry-low'); get(oldOptions.glare).click(); get(oldOptions.glare).click(); get(oldOptions.glare).click();
      const shape = u.rvOpts.shape; get(oldOptions.shape).click(); ok('CD bend selection works', u.rvOpts.shape !== shape && !!V.p.A);
      u.rvOpts.shape = 'straight'; u.redrawSpec();
      for (const scene of ['road', 'forest', 'city', 'intersection']) {
        change(oldOptions.scene, scene); await settle();
        ok('CD fixed scene uses paused animated renderer: ' + scene, u.dvOpts.scene === scene && !V.src.tiles && !V.canvas.hidden && u.dvAnim.view === 'anim' && !u.dvAnim.playing && V.srcArgs[0] === scene);
        if (scene === 'intersection') ok('CD fixed intersection keeps cross street and markings', !!V.src.cross && a.fixedIntersection(V.src, 0).crossings.length === 1 && a.fixedIntersection(V.src, 0).markings.some(m => m.skip));
      }
      change(oldOptions.scene, '__pass'); ok('CD Mountain pass has one scene selector', u.dvOpts.mountainPass && get(oldOptions.scene).value === '__pass');
      change(oldOptions.scene, 'road'); ok('CD scene selector exits Mountain pass', !u.dvOpts.mountainPass && u.dvOpts.scene === 'road');
      // Exercise both legacy spellings through the same loader used at startup. Preserve
      // the fixture's runtime object so existing button callbacks remain valid.
      for (const view of ['still', 'static']) {
        localStorage.setItem('flux/driveView', JSON.stringify({ view, playing: true, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false }));
        u.dvOpts = null; Object.assign(u.dvAnim, { view, playing: true, dist: 17, t: 3 }); u.redrawSpec(); await settle();
        const stored = JSON.parse(localStorage.getItem('flux/driveView'));
        ok('CD saved ' + view + ' preference loads paused without losing settings', u.dvAnim.view === 'anim' && !u.dvAnim.playing && u.dvAnim.dist === 17 && u.dvAnim.t === 3 && !V.canvas.hidden && u.dvOpts.ev === 2.5 && u.dvOpts.seed === 19 && stored.view === 'anim' && stored.playing === false);
      }
      const play = get('[data-anim=play]');
      more.open = false; D.layoutControls(u); play.click(); await sleep(600);
      ok('CD Play advances distance and time', u.dvAnim.playing && u.dvAnim.dist > 17 && u.dvAnim.t > 3 && JSON.parse(localStorage.getItem('flux/driveView')).playing === true);
      play.click(); await settle(); const frozen = { dist: u.dvAnim.dist, t: u.dvAnim.t }; await sleep(500);
      ok('CD Pause freezes distance and time with renderer visible', !u.dvAnim.playing && u.dvAnim.dist === frozen.dist && u.dvAnim.t === frozen.t && !V.canvas.hidden && !D.stats().running && JSON.parse(localStorage.getItem('flux/driveView')).playing === false, frozen);
      D.openPop(u); await settle(); D.closePop(u); await settle();
      ok('CD large view preserves pause and position', !u.dvAnim.playing && u.dvAnim.dist === frozen.dist && u.dvAnim.t === frozen.t);
      for (const popout of [false, true]) {
        if (popout) D.openPop(u);
        for (const open of [false, true]) for (const fit of [true, false]) {
          more.open = open; u.dvOpts.fitControls = fit; u.redrawSpec(); await settle(); D.layoutControls(u); await settle();
          const m = UX2Page.measure(); layouts.push({ popout, open, fit, ...m });
          ok('CD no overlap at ' + innerWidth + ' ' + JSON.stringify({ popout, open, fit }), m.collisions.length === 0 && m.clipped.length === 0 && m.wrap && m.extrasFit && m.within && m.below && m.debugBelow, m);
        }
        if (popout) D.closePop(u);
      }
      more.open = false; D.layoutControls(u);
      ok('CD original optical scene remains unchanged and round-trips', RF.State.serialize(u.store.scene) === opticalScene && RF.State.serialize(RF.State.deserialize(opticalScene)) === opticalScene && u.run.ctx === trace && !u.solving);
      ok('CD no console errors during migration and interactions', errors.length === 0, errors);
      return { pass: checks.every(c => c.pass), checks, layouts, oldOptions, viewport: [innerWidth, innerHeight] };
    } finally {
      removeEventListener('error', onError); removeEventListener('unhandledrejection', onError); console.error = originalError;
    }
  }
  root.CDPage = { run, oldOptions };
  if (typeof module !== 'undefined') module.exports = root.CDPage;
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof require !== 'undefined' && require.main === module) (async () => {
  const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
  const port = +(process.argv[2] || 8776), browser = await pw.chromium.launch({ channel: 'chromium' }); let failed = false;
  try {
    for (const width of [360, 1280]) for (const view of ['still', 'static']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, hasTouch: width === 360 });
      const page = await context.newPage(), errors = [];
      // The test server has no favicon. Satisfy only that browser-owned request so
      // console failures remain strict for every application resource.
      await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
      page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript(view => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view, playing: true, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false })); }, view);
      await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene);
      await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.addScriptTag({ url: '/tests/regress/CD-controls-dedupe.js' });
      const result = await page.evaluate(port => CDPage.run(port), port);
      for (const c of result.checks) console.log((c.pass ? '[PASS] ' : '[FAIL] ') + c.name + (!c.pass && c.detail ? ' — ' + JSON.stringify(c.detail) : ''));
      console.log((errors.length ? '[FAIL] ' : '[PASS] ') + 'CD no page/console errors from navigation ' + JSON.stringify(errors));
      failed ||= !result.pass || errors.length > 0; await context.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? 'CD FAILED' : 'all CD page checks passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
