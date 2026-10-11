// G14: chrome heights do not change when a solve starts, and the two map squares sit at the same height.
// node tests/regress/G14-chrome-stable.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8824);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), errors = [];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  ok('page identifies as Flux', await page.evaluate(() => !!(window.RF && RF.UI)));
  await page.waitForTimeout(1500);
  // the map squares are centred in their canvas boxes, so compare the centres
  const tops = () => page.evaluate(() => { const t = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return Math.round(r.top + r.height / 2); }; return { left: t('left-canvas'), heat: t('heat-canvas') }; });
  let t = await tops();
  ok('Paint: Editor and Result map squares sit at the same height', Math.abs(t.left - t.heat) <= 1, JSON.stringify(t));
  // sample rects every frame while a solve runs
  await page.evaluate(() => {
    const sels = { footer: '#footer', gen: '#btn-generate-top', left: '#left-canvas', heat: '#heat-canvas', scene: '#scene-canvas', surf: '#surface-canvas' };
    window.__r = {}; window.__seen = false;
    const snap = () => { if (RF.UI.solving) window.__seen = true;
      for (const [k, s] of Object.entries(sels)) { const r = document.querySelector(s).getBoundingClientRect(); (window.__r[k] = window.__r[k] || new Set()).add([r.width, r.height].map(Math.round).join('x')); }
      window.__raf = requestAnimationFrame(snap); };
    snap();
  });
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(window.__r).map(([k, v]) => [k, [...v][0]])));
  await page.click('#btn-generate-top');
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(800);
  const res = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return { seen: window.__seen, r: Object.fromEntries(Object.entries(window.__r).map(([k, v]) => [k, [...v]])) }; });
  ok('a solve was observed', res.seen);
  for (const k of Object.keys(res.r)) ok('size of ' + k + ' is the same before, during and after the solve', res.r[k].length === 1, res.r[k].join(' | '));
  await page.evaluate(() => RF.UI.setMode('D')); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(1200);
  t = await tops();
  ok('Spec: Editor and Result map squares sit at the same height', Math.abs(t.left - t.heat) <= 1, JSON.stringify(t));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
