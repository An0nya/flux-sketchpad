// TB: Mountain pass prototype note must not cover the scene. Needs a server: python3 tests/serve.py <port>; node tests/regress/TB-touge-banner.js <port>
// Positive control: point the same script at main's build (served from a detached worktree of 40107ef) and the coverage/gone checks must FAIL.
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8796);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };

// The visible prototype note, whichever element carries it (new: data-anim=proto-notice; main: the shared data-anim=notice).
const probe = () => {
  const V = RF.DriveAnim._.V, c = V.canvas.getBoundingClientRect(), area = c.width * c.height;
  const n = [...document.querySelectorAll('[data-anim=notice],[data-anim=proto-notice]')].find(e => /Mountain pass/.test(e.textContent));
  if (!n) return { present: false, visible: false, coverage: 0, canvas: [c.width, c.height] };
  const r = n.getBoundingClientRect(), ix = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left)), iy = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
  const visible = !n.hidden && getComputedStyle(n).display !== 'none' && +getComputedStyle(n).opacity > 0;
  return { present: true, visible, text: n.textContent, opacity: getComputedStyle(n).opacity, box: [Math.round(r.width), Math.round(r.height)], coverage: visible ? +(ix * iy / area).toFixed(4) : 0, canvas: [Math.round(c.width), Math.round(c.height)] };
};

async function viewport(browser, w, h, popout) {
  const tag = w + 'x' + h + (popout ? ' popout ' : ' inline ');
  const page = await browser.newPage({ viewport: { width: w, height: h } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  await page.evaluate(s => RF.UI.loadScene(RF.State.deserialize(s), 'TB fixture'), scene);
  await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
  if (popout) await page.evaluate(() => TGPage.ready());   // drive view popped out, Mountain pass on, GPU renderer (throws if GPU unavailable)
  else await page.evaluate(async () => {   // inline drive view (the layout where the owner saw the banner over the scene)
    const u = await P1Page.ready();
    Object.assign(u.dvOpts, { scene: 'road', mountainPass: true, tiles: false, gpuRenderer: true, ambient: 0, mt: false, wet: false, wetSheen: false, tex: false, trafficLogic: false, oncoming: false, preceding: false, detailedModels: true, dynamicResolution: false });
    u.dvAnim.dist = 125; u.redrawSpec(); await P1Page.select(true);
    if (RF.DriveAnim.stats().renderer !== 'three') throw Error('GPU unavailable: ' + RF.DriveAnim.stats().gpuFailure);
  });
  // First-visit guide covers the drive bar; dismiss it as a first-time user would (same as UX1/RB).
  await page.evaluate(() => { if (!document.getElementById('first-guide').hidden) document.getElementById('guide-close').click(); });
  const redraw = () => page.evaluate(() => { RF.UI.redrawSpec(); RF.DriveAnim._.frame(); });

  const start = await page.evaluate(probe);
  console.log(tag + 'start ' + JSON.stringify(start));
  ok(tag + 'prototype note visible at start', start.visible && /prototype/.test(start.text), start);
  ok(tag + 'prototype note covers < 8% of canvas at start', start.coverage < 0.08, { coverage: start.coverage });

  // 7 s covers the 6 s hold plus the fade; keep redrawing so the per-frame path runs as in real use.
  for (let t = 0; t < 35; t++) { await redraw(); await page.waitForTimeout(200); }
  const gone = await page.evaluate(probe);
  ok(tag + 'prototype note gone after fade (hidden or opacity 0)', !gone.visible, gone);

  // Stays gone for 3 s more, with redraws (a per-frame say() must not resurrect it).
  let back = null;
  for (let t = 0; t < 15 && !back; t++) { await redraw(); await page.waitForTimeout(200); const p = await page.evaluate(probe); if (p.visible) back = p; }
  ok(tag + 'prototype note stays gone for 3 s of redraws', !back, back || {});
  ok(tag + 'no page errors', errors.length === 0, errors);
  await page.close();
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  try {
    await viewport(browser, 428, 926, false);
    await viewport(browser, 428, 926, true);
    await viewport(browser, 1280, 800, true);
  } finally { await browser.close(); }
  console.log(fails ? 'TB FAIL: ' + fails + ' check(s) failed' : 'TB PASS');
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
