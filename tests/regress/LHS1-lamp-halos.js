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
    // 5. LAMP-HALO-CONE: exported curve data, and the probe at three eye positions for one street lamp (no draw)
    const cone = await page.evaluate(async () => {
      const m = await import('/js/drive-three-lamphalo.js'), T3 = RF.DriveAnim._.V.three;
      const out = { sodiumFlux: m.LAMP_CURVES.sodium.fluxCheck, ledFlux: m.LAMP_CURVES.led.fluxCheck, plateau: m.LAMP_CURVES.sodium.plateau, at80: m.coneIntensity('sodium', 80), at85: m.coneIntensity('sodium', 85), ledAt80: m.coneIntensity('led', 80) };
      const tb = m.LAMP_CURVES.sodium.table; let s = 0;   // independent check: trapezoid over the exported 1-degree table
      for (let i = 0; i < tb.length - 1; i++) { const a = tb[i][0] * Math.PI / 180, b = tb[i + 1][0] * Math.PI / 180; s += (tb[i][1] * Math.sin(a) + tb[i + 1][1] * Math.sin(b)) / 2 * (b - a); }
      out.tableFlux = 2 * Math.PI * s;
      const lamps = T3.lampHaloStreetLamps(), L = lamps[0];
      const near = { x: L.x - 7, y: L.y, z: 1.2 }, far = { x: L.x - 165, y: L.y, z: 1.2 }, behind = { x: Math.max(...lamps.map((l) => l.x)) + 5, y: L.y, z: 1.2 };
      const find = (list, eye) => { const rExp = Math.hypot(L.x - eye.x, L.y - eye.y, L.z - eye.z); return (list || []).find((c) => Math.abs(c.r - rExp) < 0.01) || null; };
      out.near = find(T3.lampHaloProbe(near), near); out.far = find(T3.lampHaloProbe(far), far);
      out.behindCount = (T3.lampHaloProbe(behind) || []).length; out.lampCount = lamps.length;
      return out;
    });
    ok('LHS1 cone: exported curve integrates to the lamp lumens (sodium and LED, 1000 lm per klm)', Math.abs(cone.sodiumFlux - 1000) < 1 && Math.abs(cone.ledFlux - 1000) < 1 && Math.abs(cone.tableFlux - 1000) < 20, 'sodium ' + cone.sodiumFlux + ', led ' + cone.ledFlux + ', 1-deg table ' + cone.tableFlux.toFixed(1) + ', plateau ' + cone.plateau + ' cd/klm');
    ok('LHS1 cone: intensity falls off: 100 cd/klm at 80 deg (sodium), below the plateau; 0 at 85 deg', Math.abs(cone.at80 - 100) < 1e-6 && cone.at85 === 0 && cone.at80 < 0.6 * cone.plateau, 'at80 ' + cone.at80 + ', at85 ' + cone.at85 + ', plateau ' + cone.plateau);
    ok('LHS1 cone: near lamp (gamma ~50 deg) is listed with I > 0', !!(cone.near && cone.near.I > 0), JSON.stringify(cone.near));
    ok('LHS1 cone: far lamp (gamma ~88 deg, 165 m) adds nothing: not listed', cone.far === null, JSON.stringify(cone.far));
    ok('LHS1 cone: a lamp behind the viewer adds nothing (probe lists none)', cone.behindCount === 0, 'listed ' + cone.behindCount + ' of ' + cone.lampCount + ' lamps');
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
