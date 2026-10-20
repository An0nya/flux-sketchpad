// DC page checks. Serve the worktree first: python3 tests/serve.py <port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/DC-drive-controls.js <port>
// Checks: the view-angle select is in the drive bar (one copy, with 30), choosing 30 changes the rendered view (screenshots saved for 30 and 60);
// the traffic range select at density 3 on the road scene shows more cars at 600 m than at 230 m; the eye stays fixed at 45 and 60 (the telephoto
// dolly was removed, so there is no dolly button); no page or console errors (favicon.ico 404 ignored).
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8943);
const REPORTS = process.env.DC_REPORTS || '/Users/anya/Projects/flux-sketchpad/.claude/briefs/reports';
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({});
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ')));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
    // rural road, oncoming and preceding traffic, scripted traffic (not logic), CPU-safe settings; animation paused so the test drives the clock
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, dynamicResolution: false, gpuRenderer: false, scene: 'road', trafficDensity: 3, oncoming: true, preceding: true, trafficLogic: false, fov: 60 })); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'DC fixture'); u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p, null, { timeout: 120000 });
    await page.evaluate(() => { window.DC = { frame: () => RF.DriveAnim._.frame(), V: () => RF.DriveAnim._.V }; });
    const settle = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await sleep(150); };
    // element screenshot of the drive canvas (a viewport clip goes wrong when the page is scrolled)
    const canvasShot = async (file) => { const h = await page.evaluateHandle(() => RF.DriveAnim._.V.canvas); await h.asElement().scrollIntoViewIfNeeded(); return h.asElement().screenshot({ path: REPORTS + '/' + file }); };

    // 1. view angle: one select in the drive bar, with 30 as a choice; starts at 60
    const fov = await page.evaluate(() => { const s = document.querySelector('select[data-dv=fov]'); return s && { values: [...s.options].map((o) => o.value), value: s.value, inBar: !!s.closest('.drive-tools') }; });
    ok('view angle: select in the drive bar offers 30; starts at 60', !!fov && fov.values.includes('30') && fov.value === '60' && fov.inBar, fov);
    ok('view angle: one copy on the page (no sidebar duplicate)', (await page.evaluate(() => document.querySelectorAll('[data-dv=fov]').length)) === 1);
    await settle();
    const shot60 = await canvasShot('dc-fov-60.png');   // More closed: the expanded bar would cover the canvas
    // the view angle and traffic range live under "More": open it the way a user does, choose 30, then close it again
    await page.evaluate(() => { const m = document.querySelector('.drive-more'); if (!m.open) m.querySelector('summary').click(); });
    await sleep(300);
    await page.selectOption('select[data-dv=fov]', '30');
    await page.waitForFunction(() => RF.DriveAnim._.V.p.hfov === 30, null, { timeout: 30000 });
    await page.evaluate(() => window.DC.frame());
    await page.evaluate(() => { const m = document.querySelector('.drive-more'); if (m.open) m.querySelector('summary').click(); });
    await sleep(300); await settle();
    const shot30 = await canvasShot('dc-fov-30.png');
    ok('view angle 30 is selected and the view is re-rendered at 30°', await page.evaluate(() => RF.DriveAnim._.V.p.hfov === 30));
    ok('view angle: the rendered picture changes between 60 and 30', !shot60.equals(shot30), { bytes60: shot60.length, bytes30: shot30.length });
    await page.evaluate(() => { const sel = document.querySelector('select[data-dv=fov]'); sel.value = '60'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => RF.DriveAnim._.V.p.hfov === 60, null, { timeout: 30000 });

    // 2. traffic range: density 3 on the road scene; count the cars the scripted path draws at a fixed place and time
    await page.evaluate(() => { const d = document.querySelector('[data-anim=traffic-density]'); d.value = '3'; d.dispatchEvent(new Event('change', { bubbles: true })); });
    const count = (range) => page.evaluate(async (r) => {
      const sel = document.querySelector('[data-anim=traffic-range]'); sel.value = String(r); sel.dispatchEvent(new Event('change', { bubbles: true }));
      window.DC.frame(); const V = RF.DriveAnim._.V, cars = RF.DriveAnim._.trafficCars(V.src, 0, 0);
      return { range: V.info.o.trafficRange, cull: V.src.traffic.cull, cars: cars.length, far: cars.filter((c) => c.rel > 230).length };
    }, range);
    const c230 = await count(230), c600 = await count(600);
    ok('traffic range 230: window is 230 m', c230.cull === 230 && c230.range === 230, c230);
    ok('traffic range 600: window is 600 m', c600.cull === 600 && c600.range === 600, c600);
    ok('traffic range: 600 m shows more cars than 230 m at density 3 (and cars beyond 230 m)', c600.cars > c230.cars && c600.far > 0 && c230.far === 0, { at230: c230.cars, at600: c600.cars, beyond230at600: c600.far });
    await count(400);

    // 3. fixed eye: no dolly control; the view angle moves the lens, not the eye
    await page.evaluate(() => { const m = document.querySelector('.drive-more'); if (!m.open) m.querySelector('summary').click(); });
    await sleep(300);
    ok('no telephoto dolly button in the drive bar', (await page.evaluate(() => !document.querySelector('[data-anim=telephoto-dolly]'))));
    const eye = () => page.evaluate(() => RF.DriveAnim._.V.p.eye.slice());
    const setFov = (v) => page.evaluate((x) => { const s = document.querySelector('select[data-dv=fov]'); s.value = String(x); s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await setFov(45);
    await page.waitForFunction(() => RF.DriveAnim._.V.p.hfov === 45, null, { timeout: 30000 });
    const eye45 = await eye();
    ok('view angle 45: eye is the fixed eye (no move)', eye45[0] === -2 && eye45[1] === 0.37 && eye45[2] === 1.2, eye45);
    await setFov(60);
    await page.waitForFunction(() => RF.DriveAnim._.V.p.hfov === 60, null, { timeout: 30000 });
    const eye60 = await eye();
    ok('view angle 60: eye is the fixed eye (no move)', eye60[0] === -2 && eye60[1] === 0.37 && eye60[2] === 1.2, eye60);

    ok('no page or console errors', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + ' DC page check(s) FAILED' : 'all DC page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('[FAIL] DC harness: ' + (e && e.stack || e)); process.exit(1); });
