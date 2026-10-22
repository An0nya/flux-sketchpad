// PM: detailed mesh cars on the pass. Claude: python3 tests/serve.py 8961; PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/PM-pass-mesh.js 8961
// Checks: an oncoming car's detailed body draws on the pass at 40, 20 and 10 m (pixels change when the car is on vs off, same eye and frame);
// the body at 40 m stays above a floor (the pre-fix value was 78 px; the flat z=0 clip removal alone gave 136);
// no page or shader errors with detailed models on. Deer and animals are off so a deer does not hide the car.
// Coverage measure: pixels whose RGB sum changes when the car is removed. Luminance can be near zero for a dark body, so 0 means not drawn, not invisible.
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8961);
const REPO = path.join(__dirname, '../..');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
  let fails = 0;
  const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon\.ico|Failed to load resource/.test(t)) errors.push('console: ' + t); if (m.type() !== 'info' && /shader|ERROR: 0:/i.test(t)) errors.push('shader: ' + t); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate(s => RF.UI.loadScene(RF.State.deserialize(s), 'PM fixture'), fs.readFileSync(path.join(REPO, 'tests/fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/drive-three-page.js' });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(async () => {
      const u = await P1Page.ready(), A = RF.DriveAnim, V = A._.V;
      Object.assign(u.dvOpts, { samples: 'auto', scene: 'road', mountainPass: true, gpuRenderer: true, detailedModels: true, deerBehaviour: false, streetLamps: 'sodium', oncoming: true, preceding: false, trafficLogic: false, animals: false, people: true, posts: true, signs: true });
      window.PM = { u, A, V };
    });
    await page.waitForFunction(() => { const V = RF.DriveAnim._.V; return V.three && V.three.modelState().ready; }, null, { timeout: 60000 }).catch(() => {});
    // The car stays at one road position: dist = 193.25 - (rel - 5) puts oncoming:0 at rel metres ahead of the eye.
    const r = await page.evaluate(() => {
      const { u, A, V } = window.PM; u.dvAnim.playing = false;
      const W = V.p.w, H = V.p.h, tanH = Math.tan(V.p.hfov * Math.PI / 360), tanV = tanH * H / W, eye = V.p.eye;
      const out = {};
      for (const T of [40, 20, 10]) {
        const d = 193.25 - (T - 5);
        u.dvOpts.oncoming = true; u.dvAnim.dist = d; u.redrawSpec(); A._.frame();
        const on = V.gl.readCanvas();
        u.dvOpts.oncoming = false; u.redrawSpec(); A._.frame();
        const off = V.gl.readCanvas();
        const n = on.length / 4, cw = Math.round(Math.sqrt(n * W / H)), ch = n / cw;
        let changed = 0;
        for (let i = 0; i < n; i++) { const k = 4 * i; if (Math.abs(on[k] - off[k]) + Math.abs(on[k + 1] - off[k + 1]) + Math.abs(on[k + 2] - off[k + 2]) > 0) changed++; }
        out[T] = { changed, canvas: [cw, ch] };
      }
      u.dvOpts.oncoming = true; u.redrawSpec(); A._.frame();
      return out;
    });
    console.log(JSON.stringify(r));
    ok('PM body drawn at 40 m (changed pixels > 0 with the car on vs off)', r[40].changed > 0, { changed: r[40].changed });
    ok('PM body drawn at 20 m (changed pixels > 0)', r[20].changed > 0, { changed: r[20].changed });
    ok('PM body drawn at 10 m (changed pixels > 0)', r[10].changed > 0, { changed: r[10].changed });
    ok('PM body at 40 m above the pre-fix floor of 78 px', r[40].changed >= 100, { changed: r[40].changed, floor: 100 });
    // Control: detailed models off, no mesh cars.
    await page.evaluate(() => { window.PM.u.dvOpts.detailedModels = false; window.PM.u.redrawSpec(); window.PM.A._.frame(); });
    const off = await page.evaluate(() => RF.DriveAnim._.V.three.modelState().cars);
    ok('PM control: no mesh cars with detailed models off', off === 0, { cars: off });
    await page.evaluate(() => { window.PM.u.dvOpts.detailedModels = true; window.PM.u.redrawSpec(); window.PM.A._.frame(); });
    ok('PM no page errors or shader errors on the pass with detailed models on', errors.length === 0, errors.slice(0, 5));
  } finally { await browser.close(); }
  if (fails) { console.log(fails + ' check(s) failed'); process.exit(1); }
  console.log('PM-pass-mesh: all checks passed');
})().catch(e => { console.error('PM-pass-mesh crashed', e); process.exit(1); });
