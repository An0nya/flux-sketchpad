// Native port of tests/regress/SPEED0-stop.js (the adapter skips that script while this file exists).
// The speed slider reaches 0. Playing at 0 on the pass and the flat road, traffic logic on and off: our car stops (distance and
// speed stay 0 over 2.5 s after braking from 30 km/h) while the clock and the oncoming cars keep moving (control: as at 30).
const { test, expect, loadScene } = require('../fixtures.js');
test.use({ viewport: { width: 912, height: 760 } });

test('SPEED0: our car stops at speed 0, the clock and traffic do not', async ({ app: page, pageErrors, consoleErrors }) => {
  await loadScene(page, 'MG2-default-lamp.json', 'SPEED0');
  await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
  await page.evaluate(() => TGPage.ready()); await page.waitForTimeout(1500);
  const slider = await page.evaluate(() => { const s = document.querySelector('[data-anim="speed"]'); return [s.min, s.step]; });
  expect.soft(slider, 'speed slider reaches 0 in 1 km/h steps').toEqual(['0', '1']);

  const snap = () => page.evaluate(() => { const st = RF.UI.dvAnim, tr = RF.DriveAnim._.V.src.traffic.state; return { d: st.dist, t: st.t, v: st.camera ? st.camera.v : null, cars: tr ? tr.cars.map((c) => [c.id, c.x]) : [] }; });
  const moved = (a, b) => b.cars.some(([id, x]) => { const o = a.cars.find((c) => c[0] === id); return o && Math.abs(o[1] - x) > 1; });
  for (const pass of [true, false]) for (const logic of [false, true]) {
    await test.step(`pass=${pass} logic=${logic}`, async () => {
      await page.evaluate(([pass, logic]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ mountainPass: pass, trafficLogic: logic, oncoming: true, trafficBeams: true, speed: 30 })) V.setOwn(k, v); }, [pass, logic]);
      await page.evaluate(() => { RF.UI.dvAnim.playing = true; RF.UI.redrawSpec(); }); await page.waitForTimeout(2500);
      const m0 = await snap(); await page.waitForTimeout(1500); const m1 = await snap();   // at 30 km/h: the control
      await page.evaluate(() => RF.DriveAnim._.V.setOwn('speed', 0)); await page.waitForTimeout(6000);
      const s0 = await snap(); await page.waitForTimeout(2500); const s1 = await snap();
      await page.evaluate(() => { RF.UI.dvAnim.playing = false; });
      expect.soft(m1.d - m0.d, 'at 30 our car moves > 1 m in 1.5 s (control)').toBeGreaterThan(1);
      expect.soft(Math.abs(s1.d - s0.d), 'at 0 our car stops').toBeLessThan(1e-6);
      if (s1.v !== null) expect.soft(s1.v, 'at 0 the camera speed is 0').toBe(0);
      expect.soft(s1.t - s0.t, 'the clock keeps running at 0').toBeGreaterThan(2);
      if (logic) {
        expect.soft(moved(m0, m1), 'traffic moves at 30 (control)').toBe(true);
        expect.soft(moved(s0, s1), 'traffic keeps moving at 0').toBe(true);
      }
    });
  }
  expect([...pageErrors, ...consoleErrors], 'no page errors').toEqual([]);
});
