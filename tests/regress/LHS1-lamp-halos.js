// LHS1 page checks: lamp halos (LAMP-HALO-SPRITES, option lampHalos) on the GPU drive renderer, urban tile at night, sodium street lamps.
//  1. off: the frame is the same bytes as the first off frame taken after an on frame (off after on = first off). If a main port is given
//     (argv[3]), the off frame also equals the main build's off frame byte for byte (the option adds no change when off).
//  2. on: at least one lamp is listed; the on frame never darkens a pixel (on >= off in every channel) and changes some pixels;
//     every changed pixel lies within the sprite radius of a listed lamp (radius from the lamp's own thMax, with a 1.6x margin and 40 px slack).
//  3. the option select is in the More panel; no page errors.
//  4. GPU time of the halo pass alone (timer query, headless software-or-M4 as the browser gives it), reported not asserted.
// Run: python3 tests/serve.py <port> ; PLAYWRIGHT=... node tests/regress/LHS1-lamp-halos.js <port> [mainPort]   (env SHOTS=<dir> saves the frames)
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
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, lampHalos: 'off', wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, glare: 'off', onMode: 'generic', tiles: true, streetLamps: 'sodium' });
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
const setLH = (page, v) => page.evaluate((v) => RF.DriveAnim._.V.setOwn('lampHalos', v), v).then(() => sleep(1000));

(async () => {
  let A = null;
  try {
    A = await open(port);
    const { page } = A;
    const renderer = await page.evaluate(() => RF.DriveAnim.stats().renderer);
    const rs = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    console.log('renderer ' + renderer + ', GPU: ' + rs + ', canvas ' + (await page.evaluate(() => [RF.DriveAnim._.V.p.w, RF.DriveAnim._.V.p.h])).join('x'));
    ok('LHS1 GPU renderer is on', renderer === 'three', renderer);
    // 1. off, then on, then off again
    const off1 = await frame(page);
    await setLH(page, 'on');
    const on = await frame(page);
    const lh = await page.evaluate(() => RF.DriveAnim._.V.three.lampHaloState());
    const street = (lh.lamps || []).filter((l) => l.kind === 'street');
    ok('LHS1 on: street lamps listed (sodium)', street.length >= 1 && lh.kind === 'sodium', 'lamps ' + (lh.lamps || []).length + ', kind ' + lh.kind + ', nearest r ' + (street[0] ? street[0].r : 'none'));
    await setLH(page, 'off');
    const off2 = await frame(page);
    ok('LHS1 off after on equals the first off frame (bytes)', sha(off2) === sha(off1), sha(off2).slice(0, 12) + ' vs ' + sha(off1).slice(0, 12));
    // 2. on adds only brightening pixels, all near listed lamps
    const pix = await page.evaluate(async ({ a, b, lamps, tanH, W, H }) => {
      const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
      const A = await load(a), B = await load(b);
      let dark = 0, changed = 0, outside = 0, maxd = 0;
      const pxPerDeg = (W / 2) / tanH * Math.PI / 180;
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
        const k = 4 * (y * A.w + x);
        let anyDiff = false;
        for (let c = 0; c < 3; c++) { const dd = B.d[k + c] - A.d[k + c]; if (dd < 0) dark++; if (dd !== 0) { anyDiff = true; maxd = Math.max(maxd, dd); } }
        if (!anyDiff) continue;
        changed++;
        // pixel centre in NDC, top row = top of the picture
        const nx = (x + 0.5) / A.w * 2 - 1, ny = 1 - (y + 0.5) / A.h * 2;
        let near = false;
        for (const l of lamps) {
          const lx = (l.sx + 1) / 2 * A.w - 0.5, ly = (1 - l.sy) / 2 * A.h - 0.5;   // lamp centre, pixels (top-left origin)
          const R = 1.6 * l.thMax * pxPerDeg + 40;
          if (Math.hypot(x - lx, y - ly) <= R) { near = true; break; }
        }
        if (!near) outside++;
      }
      return { w: A.w, h: A.h, dark, changed, outside, maxd };
    }, { a: off1.toString('base64'), b: on.toString('base64'), lamps: lh.lamps || [], tanH: lh.tanH, W: lh.w, H: lh.h });
    ok('LHS1 on never darkens a pixel', pix.dark === 0, 'darkened channels ' + pix.dark + ' of ' + pix.w + 'x' + pix.h);
    ok('LHS1 on changes some pixels', pix.changed > 0, 'changed pixels ' + pix.changed + ', max step ' + pix.maxd + ' (8-bit)');
    ok('LHS1 every changed pixel lies near a listed lamp', pix.changed > 0 && pix.outside === 0, 'outside the sprite radius: ' + pix.outside);
    // 3. the option is in More and reads back
    const ui = await page.evaluate(() => { const s = document.querySelector('[data-dv="lampHalos"]'); return s ? { value: s.value, inMore: !!s.closest('.drive-more'), title: (s.title || '').slice(0, 40) } : null; });
    ok('LHS1 option select (data-dv=lampHalos) is in the More panel', !!(ui && ui.inMore), JSON.stringify(ui));
    // 5. LAMP-DIST (replaces LAMP-HALO-CONE): the shared distribution table (js/lamp-dist.js), checked on a 1-degree grid (independent of the 5 x 15 grid it is built on)
    const dist = await page.evaluate(async () => {
      const m = await import('/js/lamp-dist.js'), T3 = RF.DriveAnim._.V.three, out = { flux: {}, aboveMax: 0, classVDev: 0, peakG: {}, streetVsHouse: null, floorFar: null, peakIII: null };
      for (const c of m.CLASSES) for (const k of m.KINDS) {
        let s = 0, aboveMax = 0;
        for (let g = 0.5; g < 90; g += 1) for (let p = 0.5; p < 360; p += 1) s += m.distAt(c, k, g, p) * Math.sin(g * Math.PI / 180) * (Math.PI / 180) ** 2;
        out.flux[c + '/' + k] = s;
        for (let p = 0; p < 360; p += 15) aboveMax = Math.max(aboveMax, m.distAt(c, k, 90.5, p), m.distAt(c, k, 91, p), m.distAt(c, k, 120, p));
        out.aboveMax = Math.max(out.aboveMax, aboveMax);
      }
      for (const k of m.KINDS) for (let p = 0; p < 360; p += 15) out.classVDev = Math.max(out.classVDev, Math.abs(m.distAt('V', k, 65, p) - m.distAt('V', k, 65, 0)));
      for (const c of m.CLASSES) for (const k of m.KINDS) { let bg = 0, bv = -1; for (let g = 0; g <= 90; g += 1) { const v = m.distAt(c, k, g, 0); if (v > bv) { bv = v; bg = g; } } out.peakG[c + '/' + k] = bg; }
      out.streetVsHouse = [m.distAt('III', 'sodium', 65, 0), m.distAt('III', 'sodium', 65, 180)];
      out.floorFar = m.spriteDistAt('III', 'sodium', 88, 0); out.peakIII = m.LAMP_DIST.peak['III/sodium'];
      const lamps = T3.lampHaloStreetLamps(), L = lamps[0];
      const near = { x: L.x - 7, y: L.y, z: 1.2 }, far = { x: L.x - 165, y: L.y, z: 1.2 }, behind = { x: Math.max(...lamps.map((l) => l.x)) + 5, y: L.y, z: 1.2 };
      const find = (list, eye) => { const rExp = Math.hypot(L.x - eye.x, L.y - eye.y, L.z - eye.z); return (list || []).find((c) => Math.abs(c.r - rExp) < 0.01) || null; };
      out.near = find(T3.lampHaloProbe(near), near); out.far = find(T3.lampHaloProbe(far), far);
      out.behindCount = (T3.lampHaloProbe(behind) || []).length; out.lampCount = lamps.length;
      return out;
    });
    const fl = Object.values(dist.flux), fluxErr = Math.max(...fl.map((v) => Math.abs(v - 1000) / 1000));
    ok('LHS1 table: every class and kind integrates to the lamp lumens (1000 lm per klm) on a 1-degree grid, within 2 percent', fluxErr < 0.02, 'worst error ' + (100 * fluxErr).toFixed(3) + ' %, sodium III ' + dist.flux['III/sodium'].toFixed(1));
    ok('LHS1 table: zero above horizontal (gamma > 90), for every class, kind and azimuth', dist.aboveMax === 0 && dist.floorFar !== null, 'max above horizontal ' + dist.aboveMax);
    ok('LHS1 table: peak of the batwing lobe at 60-75 deg (street side, all classes and kinds)', Object.values(dist.peakG).every((g) => g >= 60 && g <= 75), JSON.stringify(dist.peakG));
    ok('LHS1 table: street side brighter than house side at the peak angle (class III sodium)', dist.streetVsHouse[0] > 1.5 * dist.streetVsHouse[1], 'street ' + dist.streetVsHouse[0].toFixed(1) + ', house ' + dist.streetVsHouse[1].toFixed(1) + ' cd/klm');
    ok('LHS1 table: class V is symmetric (no dependence on azimuth)', dist.classVDev < 1e-9, 'max deviation ' + dist.classVDev);
    ok('LHS1 sprite floor: at 88 deg (sodium III) the sprite value is 4 percent of the peak (not zero), table itself is 0', Math.abs(dist.floorFar - 0.04 * dist.peakIII) < 1e-6, 'floor ' + dist.floorFar.toFixed(2) + ' cd/klm, peak ' + dist.peakIII.toFixed(1));
    ok('LHS1 cone: near lamp (gamma ~50 deg) is listed with I > 0', !!(dist.near && dist.near.I > 0), JSON.stringify(dist.near));
    ok('LHS1 cone: far lamp (gamma ~88 deg, 165 m) is listed, dim (floor only, I <= 4 percent of peak lamp lumens)', !!(dist.far && dist.far.I > 0 && dist.far.I <= 0.04 * dist.peakIII * 9 * 1.01), JSON.stringify(dist.far));
    ok('LHS1 cone: a lamp behind the viewer adds nothing (probe lists none)', dist.behindCount === 0, 'listed ' + dist.behindCount + ' of ' + dist.lampCount + ' lamps');
    // 4. GPU time of the halo pass, reported
    await setLH(page, 'on'); await frame(page);
    const t = await page.evaluate(() => RF.DriveAnim._.V.three.timeLampHalo(8)).catch((e) => ({ gpuMs: null, reason: String(e) }));
    console.log('timing (halo pass only, GPU timer, reported not asserted): ' + JSON.stringify(t));
    await setLH(page, 'off');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'branch-off.png'), off1); fs.writeFileSync(path.join(SHOTS, 'branch-on.png'), on); }
    if (mainPort) {
      await A.browser.close(); A = null;
      const M = await open(mainPort);
      const mOff = await frame(M.page);
      ok('LHS1 off equals main (bytes)', sha(mOff) === sha(off1), 'main ' + sha(mOff).slice(0, 12) + ', branch ' + sha(off1).slice(0, 12));
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'main-off.png'), mOff);
      await M.browser.close();
    }
    ok('LHS1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('LHS1 ran to completion', false, String(e && e.message || e));
  } finally { if (A) await A.browser.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`LHS1: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
