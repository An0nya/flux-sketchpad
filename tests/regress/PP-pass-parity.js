// PP: the pass with detailed models on. Claude: python3 tests/serve.py 8942; PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/PP-pass-parity.js 8942
// Checks: no page or shader errors; traffic cars are detailed meshes when the toggle is on (and not when off); street lamps show in a stretch.
// Screenshots: lamp stretch at night, and a detailed car on the pass, into the flux-sketchpad briefs reports folder.
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8942);
const SHOTS = process.env.PP_SHOTS || '/Users/anya/Projects/flux-sketchpad/.claude/briefs/reports';
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  let fails = 0;
  const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon\.ico/.test(m.location().url || '')) errors.push('console: ' + t); if (/shader|ERROR: 0:/i.test(t)) errors.push('shader: ' + t); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate(s => RF.UI.loadScene(RF.State.deserialize(s), 'PP fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/drive-three-page.js' });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(async () => {
      const u = await P1Page.ready(), A = RF.DriveAnim, V = A._.V;
      Object.assign(u.dvOpts, { scene: 'road', mountainPass: true, gpuRenderer: true, detailedModels: true, deerBehaviour: true, streetLamps: 'sodium', oncoming: true, preceding: true, trafficLogic: false, animals: true, people: true, posts: true, signs: true, veg: true, obstacle: false, wet: false, tex: false, ambient: 0, glare: 'off', mt: false, afs: false, corneringLamps: false, trafficBeams: false, surfaceSheen: false, lampPitch: false, dynamicResolution: false });
      window.PP = { u, A, V };
    });
    // Let the pass build with detailed models on, and wait for the GPU mesh assets (modelState().ready).
    await page.waitForFunction(() => { const V = RF.DriveAnim._.V; return V.three && V.three.modelState().ready; }, null, { timeout: 60000 }).catch(() => {});
    const pick = await page.evaluate(() => {
      const { u, A, V } = window.PP; u.dvAnim.playing = false;
      // A dist where a traffic car sits 40 to 120 m ahead, and a lamp stretch that starts 60 m ahead.
      let carDist = null;
      for (let d = 0; d < 1600 && carDist === null; d += 10) { const cars = A.trafficCars(V.src, d, 0); if (cars.some(c => c.rel > 40 && c.rel < 120)) carDist = d; }
      const seed = (V.src.traffic && V.src.traffic.seed) || 0;
      let lampDist = null;
      for (let d = 0; d < 1600 && lampDist === null; d += 10) if (RF.Touge.lampSpots(d, seed).some(c => c.rel >= 60 && c.rel <= 200)) lampDist = d;
      return { carDist, lampDist: lampDist || 0 };
    });
    // Detailed on: traffic cars are mesh cars.
    await page.evaluate(d => { const { u, A, V } = window.PP; u.dvAnim.dist = d; u.redrawSpec(); A._.frame(); }, pick.carDist || 0);
    const onState = await page.evaluate(() => RF.DriveAnim._.V.three.modelState());
    ok('PP mesh cars on: traffic cars drawn as detailed meshes on the pass', onState.cars > 0 && onState.triangles > 0, { cars: onState.cars, triangles: onState.triangles, ready: onState.ready, error: onState.error });
    await page.evaluate(() => { const { u, A, V } = window.PP; u.dvOpts.detailedModels = true; });
    // Car screenshot (detailed car on the pass).
    await page.screenshot({ path: path.join(SHOTS, 'pp-detailed-car.png') });
    // Detailed off: primitive cars, no mesh cars.
    await page.evaluate(d => { const { u, A, V } = window.PP; u.dvOpts.detailedModels = false; u.dvAnim.dist = d; u.redrawSpec(); A._.frame(); }, pick.carDist || 0);
    const offState = await page.evaluate(() => RF.DriveAnim._.V.three.modelState());
    ok('PP mesh cars off: no detailed mesh cars when the toggle is off', offState.cars === 0, { cars: offState.cars });
    // Lamps: visible in a stretch with lamps on, none with lamps off.
    await page.evaluate(d => { const { u, A, V } = window.PP; u.dvOpts.detailedModels = true; u.dvAnim.dist = d; u.redrawSpec(); A._.frame(); }, pick.lampDist);
    const lampsOn = await page.evaluate(d => { const { V, A } = window.PP; const w = A.tileWorld(V.p, d, 0, null); return w.objects.filter(o => o.cls === 'street-lamp').length; }, pick.lampDist);
    ok('PP lamps: street lamps visible in a stretch on the pass', lampsOn > 0, { lampsOn, lampDist: pick.lampDist });
    await page.screenshot({ path: path.join(SHOTS, 'pp-lamps-night.png') });
    await page.evaluate(() => { window.PP.u.dvOpts.streetLamps = 'off'; window.PP.u.redrawSpec(); });
    const lampsOff = await page.evaluate(d => { const { V, A } = window.PP; V.src.tiles.lamps = 'off'; return A.tileWorld(V.p, d, 0, null).objects.filter(o => o.cls === 'street-lamp').length; }, pick.lampDist);
    ok('PP lamps: none with street lamps off (control)', lampsOff === 0, { lampsOff });
    await page.evaluate(() => { window.PP.V.src.tiles.lamps = 'sodium'; });
    const errs = errors;
    ok('PP no page errors or shader errors on the pass with detailed models on', errs.length === 0, errs.slice(0, 5));
    await page.evaluate(() => RF.DriveAnim._.frame());
    console.log(fails ? fails + ' FAILED' : 'all PP page checks passed');
  } finally { await browser.close(); }
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
