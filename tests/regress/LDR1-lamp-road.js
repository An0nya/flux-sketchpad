// LDR1 page checks: road lighting under street lamps (LAMP-DIST, option lampRoad 'table' vs 'off'), GPU drive view, urban tile at night, sodium.
//  1. the table pattern on the ground (pure, from js/lamp-dist.js): the street-side pool is brighter than the house-side pool at the same distance,
//     and the total ground illuminance over a disc of 6 mounting heights is reported against the flat point source (factor 1).
//  2. off: off after table equals the first off frame (bytes); if a main port is given, off equals main (bytes).
//  3. table: the frame changes (road pixels move); no page errors.
//  4. screenshots (SHOTS=<dir>): sodium off/table, LED off/table, class II and class V (table), each frame in its own file.
// Run: python3 tests/serve.py <port> ; PLAYWRIGHT=... node tests/regress/LDR1-lamp-road.js <port> [mainPort]   (env SHOTS=<dir>)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8985), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SHOTS = process.env.SHOTS || '';
async function open(p) {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + p + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.setViewportSize({ width: 1920, height: 1400 }); await sleep(1500);
  await page.evaluate(() => {
    const u = RF.UI, D = RF.DriveAnim;
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, lampRoad: 'off', lampClass: 'III', wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, glare: 'off', onMode: 'generic', tiles: true, streetLamps: 'sodium' });
    const tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban');
    Object.assign(u.dvAnim, { view: 'anim', dist: tile.s0 + 55, t: 2, playing: false });
    u.redrawSpec();
  });
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  return { browser, page };
}
const frame = async (page) => {
  await sleep(700);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  return page.locator('canvas[data-sl-drive="1"]').screenshot();
};
const setOpt = (page, k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]).then(() => sleep(1000));

(async () => {
  let A = null;
  try {
    // 1. pure table pattern on the ground, one lamp at the origin, mounting height 6.85 m, street side = +x
    A = await open(port);
    const { page } = A;
    const renderer = await page.evaluate(() => RF.DriveAnim.stats().renderer);
    ok('LDR1 GPU renderer is on', renderer === 'three', renderer);
    const pattern = await page.evaluate(async () => {
      const m = await import('/js/lamp-dist.js');
      const H = 6.85, st = [1, 0];
      const E = (x, y, f) => { const r2 = x * x + y * y + H * H, r = Math.sqrt(r2); return f(x, y) * H / (r2 * r); };   // cos(theta) / r^2 on flat ground (lamp at height H)
      const fac = (x, y) => { const v = [x, y, -H], rr = Math.hypot(...v), g = Math.acos(-v[2] / rr) * 180 / Math.PI; return m.roadFactorAt('III', 'sodium', g, m.phiOf(st, [x, y])); };
      const flat = () => 1;
      const d = 14.7;   // ~ H tan 65 deg, the lobe peak
      const street = E(d, 0, fac), house = E(-d, 0, fac), streetOff = E(d, 0, flat), houseOff = E(-d, 0, flat);
      // total ground illuminance over a disc of radius 6 H (flux-like sum on a polar grid), table vs flat
      let tT = 0, tO = 0;
      for (let rr = 0.05; rr < 6 * H; rr += 0.1) for (let a = 0; a < 360; a += 2) {
        const x = rr * Math.cos(a * Math.PI / 180), y = rr * Math.sin(a * Math.PI / 180), dA = 0.1 * rr * (2 * Math.PI / 180);   // area element r dr dtheta
        tT += E(x, y, fac) * dA; tO += E(x, y, flat) * dA;
      }
      // flux conservation: mean of the factor over the lower hemisphere (1 deg grid) must be 1 (the table is normalised to the lamp lumens)
      let hemi = 0; for (let g = 0.5; g < 90; g += 1) for (let p = 0.5; p < 360; p += 1) hemi += m.roadFactorAt('III', 'sodium', g, p) * Math.sin(g * Math.PI / 180) * (Math.PI / 180) ** 2;
      return { street, house, streetOff, houseOff, ratio: tT / tO, hemiMean: hemi / (2 * Math.PI), peakDeg: 65 };
    });
    ok('LDR1 pattern: street-side pool at the lobe peak is brighter than the house side (same distance)', pattern.street > 2 * pattern.house, 'street ' + pattern.street.toExponential(3) + ', house ' + pattern.house.toExponential(3) + ', ratio ' + (pattern.street / pattern.house).toFixed(2) + ' (flat: 1.00)');
    ok('LDR1 pattern: flux conservation, mean factor over the lower hemisphere is 1 (within 2 percent)', Math.abs(pattern.hemiMean - 1) < 0.02, 'hemisphere mean ' + pattern.hemiMean.toFixed(4));
    // INFO, not asserted: a 6-mounting-height ground disc does not contain all the flux (its gamma reaches about 80 deg), and the lobe peak at 65 deg lies inside it.
    console.log('[INFO] LDR1 ground disc of radius 6 mounting heights: table / flat illuminance = ' + pattern.ratio.toFixed(3) + ' (not a conservation test; see the hemisphere check)');
    // 2. off, table, off again
    const off1 = await frame(page);
    await setOpt(page, 'lampRoad', 'table');
    const tab = await frame(page);
    await setOpt(page, 'lampRoad', 'off');
    const off2 = await frame(page);
    ok('LDR1 off after table equals the first off frame (bytes)', sha(off2) === sha(off1), sha(off2).slice(0, 12) + ' vs ' + sha(off1).slice(0, 12));
    const diff = await page.evaluate(async ({ a, b }) => {
      const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
      const A = await load(a), B = await load(b); let changed = 0, brighter = 0, darker = 0, sumA = 0, sumB = 0;
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
        const k = 4 * (y * A.w + x); let any = false;
        for (let c = 0; c < 3; c++) { sumA += A.d[k + c]; sumB += B.d[k + c]; if (A.d[k + c] !== B.d[k + c]) any = true; }
        if (any) { changed++; const dl = (B.d[k] + B.d[k + 1] + B.d[k + 2]) - (A.d[k] + A.d[k + 1] + A.d[k + 2]); if (dl > 0) brighter++; else if (dl < 0) darker++; }
      }
      return { changed, brighter, darker, meanA: sumA / (A.w * A.h * 3), meanB: sumB / (A.w * A.h * 3) };
    }, { a: off1.toString('base64'), b: tab.toString('base64') });
    ok('LDR1 table changes the frame (road pixels under the lamps)', diff.changed > 0, 'changed ' + diff.changed + ' px (brighter ' + diff.brighter + ', darker ' + diff.darker + '); mean level off ' + diff.meanA.toFixed(2) + ', table ' + diff.meanB.toFixed(2));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, 'road-sodium-off.png'), off1);
      fs.writeFileSync(path.join(SHOTS, 'road-sodium-table-III.png'), tab);
      await setOpt(page, 'lampRoad', 'table'); await setOpt(page, 'lampClass', 'II'); fs.writeFileSync(path.join(SHOTS, 'road-sodium-table-II.png'), await frame(page));
      await setOpt(page, 'lampClass', 'V'); fs.writeFileSync(path.join(SHOTS, 'road-sodium-table-V.png'), await frame(page));
      await setOpt(page, 'lampClass', 'III'); await setOpt(page, 'streetLamps', 'led'); fs.writeFileSync(path.join(SHOTS, 'road-led-table-III.png'), await frame(page));
      await setOpt(page, 'lampRoad', 'off'); fs.writeFileSync(path.join(SHOTS, 'road-led-off.png'), await frame(page));
      await setOpt(page, 'streetLamps', 'sodium');
    }
    if (mainPort) {
      await A.browser.close(); A = null;
      const M = await open(mainPort);
      const mOff = await frame(M.page);
      ok('LDR1 off equals main (bytes)', sha(mOff) === sha(off1), 'main ' + sha(mOff).slice(0, 12) + ', branch ' + sha(off1).slice(0, 12));
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'road-sodium-main-off.png'), mOff);
      await M.browser.close();
    }
    ok('LDR1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('LDR1 ran to completion', false, String(e && e.message || e));
  } finally { if (A) await A.browser.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`LDR1: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
