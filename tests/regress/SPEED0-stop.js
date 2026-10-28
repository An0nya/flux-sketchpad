// SPEED0: the speed slider reaches 0 (option speed min 0, step 1). Playing at 0 on the pass and the flat road, with traffic logic on and off: our car stops (distance and speed
// stay 0 over 2.5 s, after braking from 30 km/h), the clock and the oncoming cars keep moving (positive control: they move at 0 as they do at 30), no page errors.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/SPEED0-stop.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear()); page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'SPEED0'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' }); await page.evaluate(() => TGPage.ready()); await sleep(1500);
    const slider = await page.evaluate(() => { const s = document.querySelector('[data-anim="speed"]'); return [s.min, s.step]; });
    ok('speed slider reaches 0 in 1 km/h steps', slider[0] === '0' && slider[1] === '1', slider);
    const rows = [];
    for (const pass of [true, false]) for (const logic of [false, true]) {
      await page.evaluate(([pass, logic]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ mountainPass: pass, trafficLogic: logic, oncoming: true, trafficBeams: true, speed: 30 })) V.setOwn(k, v); }, [pass, logic]);
      const snap = () => page.evaluate(() => { const st = RF.UI.dvAnim, tr = RF.DriveAnim._.V.src.traffic.state; return { d: st.dist, t: st.t, v: st.camera ? st.camera.v : null, cars: tr ? tr.cars.map((c) => [c.id, c.x]) : [] }; });
      const moved = (a, b) => b.cars.some(([id, x]) => { const o = a.cars.find((c) => c[0] === id); return o && Math.abs(o[1] - x) > 1; });
      await page.evaluate(() => { RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }); await sleep(2500);
      const m0 = await snap(); await sleep(1500); const m1 = await snap();   // at 30 km/h: the control
      await page.evaluate(() => RF.DriveAnim._.V.setOwn('speed', 0)); await sleep(6000);
      const s0 = await snap(); await sleep(2500); const s1 = await snap(); await page.evaluate(() => { RF.UI.dvAnim.playing = false; });
      rows.push({ pass, logic, at30: +(m1.d - m0.d).toFixed(2), at0: +(s1.d - s0.d).toFixed(3), v0: s1.v, dT: +(s1.t - s0.t).toFixed(2), carsMove30: logic ? moved(m0, m1) : null, carsMove0: logic ? moved(s0, s1) : null });
    }
    ok('at 0 our car stops (pass + flat, logic on + off) while the clock runs; at 30 it moves > 1 m in 1.5 s (control; the pass slows for bends)', rows.every((r) => r.at30 > 1 && Math.abs(r.at0) < 1e-6 && (r.v0 === null || r.v0 === 0) && r.dT > 2), rows);
    ok('traffic keeps moving at 0 (logic on, where cars are simulated): as at 30 (control)', rows.filter((r) => r.logic).every((r) => r.carsMove30 && r.carsMove0), rows.filter((r) => r.logic));
  } catch (e) { errors.push(String(e && e.stack || e)); }
  ok('no page errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  const n = checks.filter(Boolean).length; console.log(n === checks.length ? 'ALL PASS ' + n : 'FAILED ' + (checks.length - n) + ' of ' + checks.length);
  process.exit(n === checks.length ? 0 : 1);
})();
