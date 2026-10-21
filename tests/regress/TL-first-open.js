// TL: the first-open timeline for the Drive view. Opening Drive (from another display) writes one console.info line of JSON with marks in ms from the click;
// with debugTimings on, the readout text appears in the drive area. Headless (software GL): the times say nothing about the owner's GPU, only the order.
// Run:
//   python3 tests/serve.py <port> &  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/TL-first-open.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [], lines = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'info' && t.startsWith('{"kind":"drive-timeline"')) lines.push(t); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    // Drive is the default view on load; switch away first so the click below is the open being timed
    await page.evaluate(() => RF.UI.setDisplay('hits')); await sleep(800);
    const before = lines.length;
    await page.click('#heat-display button[data-disp="drive"]');
    // the open event closes on the frame after its GPU sync, or at the 6 s timeout
    let open = null;
    for (let i = 0; i < 40 && !open; i++) {
      await sleep(500);
      open = lines.slice(before).map((l) => JSON.parse(l)).find((r) => r.event === 'open') || null;
    }
    ok('TL an open event is logged after the Drive click', !!open, open ? open.reason : 'no drive-timeline line within 20 s');
    if (open) {
      console.log('TL raw open line: ' + JSON.stringify(open));
      const at = (name) => open.marks.find((m) => m.m === name);
      const t0 = at('t0 open'), f1 = at('frame 1 submitted'), g1 = at('frame 1 GPU done');
      ok('TL t0 is the first mark', t0 && t0.ms === 0, JSON.stringify(t0));
      ok('TL marks are non-decreasing', open.marks.every((m, i) => i === 0 || m.ms >= open.marks[i - 1].ms), open.marks.map((m) => m.m + ' ' + m.ms).join(' | '));
      ok('TL the first frame is submitted after the click', !!f1 && f1.ms > 0, f1 ? f1.ms + ' ms' : 'no frame 1 mark');
      if (g1) ok('TL the GPU-done mark comes after the first frame submit', g1.ms > f1.ms, f1.ms + ' -> ' + g1.ms);
      else ok('TL the GPU-done mark is absent (no GPU sync this event: CPU renderer or GPU frame not reached)', true, 'frames: ' + open.frames.join(','));
      const ren = open.marks.find((m) => m.m === 'GL context and shaders created' || m.m === 'three renderer created');
      if (ren) ok('TL the renderer is created between t0 and the first frame', ren.ms <= f1.ms, ren.m + ' ' + ren.ms + ' vs frame 1 ' + f1.ms);
      else ok('TL no renderer creation in this open (already built on load)', true, 'marks: ' + open.marks.map((m) => m.m).join(', '));
      ok('TL the canvas size is positive', !!open.canvasPx && open.canvasPx[0] > 0 && open.canvasPx[1] > 0, JSON.stringify(open.canvasPx));
    }
    ok('TL debugTimings is off: no readout text in the page', !(await page.evaluate(() => document.body.innerText.includes('first-open timeline'))));
    // turn debugTimings on through the drive toolbar; the label refreshes on the next sync
    await page.evaluate(() => { const d = document.querySelector('details.drive-more'); if (d) d.open = true; }); await sleep(300);   // the debug toggle lives in the closed "more" disclosure
    await page.click('[data-anim="debug-timings"]'); await sleep(1200);
    const shown = await page.evaluate(() => document.body.innerText.includes('first-open timeline'));
    ok('TL with debugTimings on, the readout appears in the drive area', shown);
    ok('TL nothing throws', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' TL checks FAILED' : 'all TL checks passed'); process.exit(fails ? 1 : 0);
})();
