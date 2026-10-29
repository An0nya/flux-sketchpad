// HDX7 / OHQ page checks: the oncoming headlamp scatter quality levels on the GPU drive renderer (fog 60, one oncoming car about 35 m away, as SL-traffic-halo).
//  1. low, medium, high, xhigh, max each apply (OHQ, 10-29): bins 6 / 12 / 24 / 32 / 32, no polar table at low and medium, one or more (auto) above,
//     the select reads back the level, and the frame changes from scatter off. A level never turns the scatter on (trafficHalo stays as set);
//  2. the preset round-trips through the saved drive view (localStorage flux/driveView) and the select reads back the level;
//  3. the table never exceeds the GPU texture width: N tiles x cells per tile <= MAX_TEXTURE_SIZE at 912, 1378 and 1920 px canvases (preset high);
//     and a forced narrow case (divisor 1.4, 32 bins) reports the clamp;
//  4. the halo gain changes the frame (x4 vs x1); no page errors.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/HDX7-halo-levels.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8985);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function frame(page) {
  await sleep(2200);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  return page.locator('canvas[data-sl-drive="1"]').screenshot();
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const st0 = await page.evaluate(() => ({ renderer: RF.DriveAnim.stats().renderer, gpuFailure: RF.DriveAnim.stats().gpuFailure || '' }));
    ok('HDX7 GPU renderer is on (no GPU failure)', st0.renderer === 'three' && !st0.gpuFailure, JSON.stringify(st0));
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    const haloState = () => page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const maxTex = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return g.getParameter(g.MAX_TEXTURE_SIZE); });
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    await setOpt('visibility', 60); await sleep(800);
    const setQuality = async (name) => { await page.evaluate((n) => { const s = document.querySelector('[data-dv="haloQuality"]'); s.value = n; s.dispatchEvent(new Event('change', { bubbles: true })); }, name); await sleep(1200); };
    const lampDist = async () => { const s = await haloState(); const e = await page.evaluate(() => RF.DriveAnim._.V.p.eye); return s.lamps.length ? s.lamps[0].lamp[0] - e[0] : null; };
    const place = async (target) => {
      await setOpt('trafficHalo', 16); await sleep(800);
      for (let i = 0; i < 6; i++) {
        const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 3) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700);
      }
      return lampDist();
    };
    const dA = await place(35); ok('HDX7 fixture: an oncoming lamp pair at about 35 m (fog 60)', dA !== null && Math.abs(dA - 35) < 6, 'lamp distance ' + (dA === null ? 'none' : dA.toFixed(1)));
    await setOpt('trafficHalo', 0); await sleep(400);
    const offPng = await frame(page); const offState = await haloState();
    ok('HDX7 scatter off: no table', offState.on === 0 && offState.passes === 0, JSON.stringify({ on: offState.on, passes: offState.passes }));
    await setQuality('low'); const offStill = await page.evaluate(() => +RF.UI.dvOpts.trafficHalo);
    ok('OHQ picking a level with the scatter off leaves it off', offStill === 0, 'trafficHalo ' + offStill);
    await setOpt('trafficHalo', 16); await sleep(800);
    const expect = { low: [6, 0], medium: [12, 0], high: [24, 1], xhigh: [32, 1], max: [32, 1] };   // [bins, polar tables at least (exactly 0 for low and medium)]
    const hashes = {};
    for (const name of ['low', 'medium', 'high', 'xhigh', 'max']) {
      await setQuality(name);
      const s = await haloState(), png = await frame(page), [bins, polars] = expect[name];
      hashes[name] = sha(png);
      const sel = await page.evaluate(() => document.querySelector('[data-dv="haloQuality"]').value);
      ok('OHQ preset ' + name + ': bins ' + bins + ', polar tables ' + (polars ? '>= ' + polars : '0'), s.bins === bins && (polars ? s.polars >= polars : s.polars === 0) && s.on === 1 && sel === name,
        JSON.stringify({ bins: s.bins, polars: s.polars, on: s.on, passes: s.passes, tab: s.tab, polarNote: s.polarNote, select: sel }));
      ok('HDX7 preset ' + name + ': the frame differs from halo off', hashes[name] !== sha(offPng));
    }
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('flux/driveView') || '{}'); } catch (e) { return {}; } });
    ok('OHQ round trip: the saved drive view holds the max preset keys', saved.haloBins === 32 && saved.haloPolar === 'auto' && saved.haloPolarBand === '256x64' && saved.shadowRes === '2048x1024' && saved.haloCars === 8 && +saved.trafficHalo === 16, JSON.stringify({ haloBins: saved.haloBins, haloPolar: saved.haloPolar, haloPolarLamps: saved.haloPolarLamps, trafficHalo: saved.trafficHalo }));
    // 3. texture width at three canvas widths (high = 24 bins), then a forced narrow case
    for (const W of [912, 1378, 1920]) {
      await page.setViewportSize({ width: W, height: 1000 }); await sleep(1500);
      await setQuality('high'); await sleep(600);
      const s = await haloState(), pw_ = await page.evaluate(() => RF.DriveAnim._.V.p.w);
      ok('HDX7 texture width at canvas ' + W + ' px (24 bins): tile x bins <= ' + maxTex, s.tab && s.tab[0] * s.bins <= maxTex && s.bins === 24, JSON.stringify({ canvasW: pw_, tab: s.tab, width: s.tab && s.tab[0] * s.bins, clamp: s.tabClamp }));
    }
    await setOpt('haloDiv', 1.4); await setOpt('haloBins', 32); await sleep(900);
    const sN = await haloState();
    ok('HDX7 forced narrow table (divisor 1.4, 32 bins): width fits and the clamp is reported when it binds', sN.tab && sN.tab[0] * sN.bins <= maxTex && (sN.tabClamp === null || sN.tabClamp.used === sN.tab[0]), JSON.stringify({ bins: sN.bins, tab: sN.tab, width: sN.tab && sN.tab[0] * sN.bins, clamp: sN.tabClamp }));
    await setOpt('haloDiv', 0); await setOpt('haloBins', 24); await sleep(600);
    // 4. gain
    await setQuality('high'); await setOpt('haloGain', 1); const g1 = await frame(page);
    await setOpt('haloGain', 4); await sleep(500); const g4 = await frame(page);
    ok('HDX7 halo gain x4 changes the frame against x1', sha(g1) !== sha(g4));
    await setOpt('trafficHalo', 0);
    ok('HDX7 no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' of ' + checks.length + ' HDX7 checks FAILED' : 'all ' + checks.length + ' HDX7 page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('harness error', e); process.exit(1); });
