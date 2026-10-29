// TL2 page checks: the 'traffic light range' and 'nearest cars' selects exist in the drive bar, the choice is stored, and changing
// either one redraws the road with no page or console errors. Serve first: python3 tests/serve.py <port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/TL2-traffic-light-range.js <port>
// Runs the GPU renderer (when the browser has WebGL2) so the 16/32-car uniform arrays are compiled; a GPU failure is reported.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8943);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ')));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, dynamicResolution: false, gpuRenderer: true, scene: 'road', trafficDensity: 3, oncoming: true, preceding: true, trafficLogic: false, trafficBeams: true, fov: 60 })); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'TL2 fixture'); u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p, null, { timeout: 120000 });
    await page.evaluate(() => { window.TL = { frame: () => RF.DriveAnim._.frame(), V: () => RF.DriveAnim._.V }; });
    const frame = () => page.evaluate(() => window.TL.frame());
    const pick = (attr, value) => page.evaluate(([a, v]) => { const s = document.querySelector('[data-anim=' + a + ']'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [attr, value]);
    const stored = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('flux/driveView') || '{}'); } catch (e) { return {}; } });

    // 1. the selects exist with the right choices, and start at the defaults
    const sel = await page.evaluate(() => {
      const r = document.querySelector('[data-anim=traffic-light-range]'), n = document.querySelector('[data-anim=traffic-nearest]');
      return r && n && { range: [...r.options].map((o) => o.value), rangeValue: r.value, near: [...n.options].map((o) => o.value), nearValue: n.value, inBar: !!r.closest('.drive-tools') };
    });
    ok('TL2 both selects are in the drive bar, with 150/160/250/400/cars (160: OHR range row, 10-29) and 8/16/32', !!sel && sel.range.join() === '150,160,250,400,cars' && sel.near.join() === '8,16,32' && sel.inBar, sel);
    ok('TL2 defaults: light 150 m, nearest 8 cars', !!sel && sel.rangeValue === '150' && sel.nearValue === '8');
    await page.waitForFunction(() => TL.V().three || TL.V().gpuFailure, null, { timeout: 120000 }).catch(() => {});   // the GPU module loads async
    await frame();
    const off = await page.evaluate(() => ({ gpu: !!TL.V().three, failed: !!TL.V().gpuFailure }));
    ok('TL2 GPU renderer is on for this run (shader arrays compiled)', off.gpu && !off.failed, off);

    // 2. changing the range redraws, is stored, and reaches the renderer params
    await pick('traffic-light-range', '250');
    await frame();
    const r250 = await page.evaluate(() => ({ light: TL.V().p.lightRange, stored: null }));
    const st250 = await stored();
    ok('TL2 range 250 is stored and reaches the renderer', st250.trafficLightRange === '250' && r250.light === 250, { stored: st250.trafficLightRange, light: r250.light });

    // 3. 'cars' follows the traffic range, never beyond it; 16 and 32 nearest cars redraw too
    await pick('traffic-light-range', 'cars');
    await frame();
    const rc = await page.evaluate(() => ({ light: TL.V().p.lightRange, cull: TL.V().src.traffic.cull }));
    ok('TL2 "as far as cars spawn" equals the traffic range (never more)', rc.light === rc.cull && rc.light <= 400, rc);
    await pick('traffic-nearest', '16');
    await frame();
    const n16 = await page.evaluate(() => ({ cars: TL.V().p.lightCars, failed: !!TL.V().gpuFailure }));
    ok('TL2 nearest 16 redraws the GPU road without a shader failure', n16.cars === 16 && !n16.failed, n16);
    await pick('traffic-nearest', '32');
    await frame();
    const n32 = await page.evaluate(() => ({ cars: TL.V().p.lightCars, failed: !!TL.V().gpuFailure, data: document.querySelector('[data-anim=gpu-renderer]').hasAttribute('data-failed') }));
    ok('TL2 nearest 32 redraws the GPU road without a shader failure', n32.cars === 32 && !n32.failed && !n32.data, n32);
    const s = await stored();
    ok('TL2 nearest 32 is stored', s.trafficNearest === '32' && s.trafficLightRange === 'cars', { nearest: s.trafficNearest, range: s.trafficLightRange });

    // 4. back to the defaults
    await pick('traffic-light-range', '150'); await pick('traffic-nearest', '8'); await frame();
    ok('TL2 back to 150 m and 8 cars redraws', (await page.evaluate(() => TL.V().p.lightRange === 150 && TL.V().p.lightCars === 8)));
    ok('no page or console errors', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + ' TL2 page check(s) FAILED' : 'all TL2 page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('[FAIL] TL2 harness: ' + (e && e.stack || e)); process.exit(1); });
