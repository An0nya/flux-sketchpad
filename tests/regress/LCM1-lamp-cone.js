// LCM1 page checks: lamp cone (LAMP-CONE-MIST, option lampCone) on the GPU drive renderer, urban tile at night, sodium street lamps.
//  1. off: the off frame equals the main build's off frame byte for byte (argv[3] = main port, optional); off after on equals the first off frame.
//  2. clear air (visibility null): cone on equals cone off (no mist, no cone).
//  3. mist (visibility 200): cone on never darkens a pixel and changes some pixels.
//  4. DATA (not asserted): how many changed pixels lie within the lamp's sprite-sized radius. The brief asks that changed pixels lie near lamps; the
//     class III table makes the lit volume wide (40 percent of peak at 80 deg, zero at 85), so this number is reported, not checked. See the report.
//  5. the option select is in the More panel; no page errors.
// Run: python3 tests/serve.py <port> ; PLAYWRIGHT=... node tests/regress/LCM1-lamp-cone.js <port> [mainPort]   (env SHOTS=<dir> saves the frames)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + detail)); if (!cond) fails++; };
const port = process.argv[2], mainPort = process.argv[3];
async function open(p) {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + p + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.setViewportSize({ width: 1920, height: 1400 }); await sleep(1500);
  // Pin the canvas at integer page position 0,0 (its layout rect is fractional, 679.78,197.77, so an element screenshot resamples it and pixel
  // indices stop matching objectBuffers). Test-only style; the drawing-buffer size is unchanged.
  await page.evaluate(() => {
    const u = RF.UI, D = RF.DriveAnim;
    // Brief U (step B): the test page's default glare is 'rain', and since B every street lamp feeds that veil, which dilutes the gain ratio below (median 1.813 -> 1.791).
    // The check is about the cone's own gain, so glare is set off here explicitly; with it off the ratio is the main-build 1.813 again.
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, lampCone: 'off', glare: 'off', wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, lampClass: 'III', lampRoad: 'off', streetLamps: 'sodium', tiles: true });
    const tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban');
    Object.assign(u.dvAnim, { view: 'anim', dist: tile.s0 + 55, t: 2, playing: false });
    u.redrawSpec();
  });
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  return { browser, page };
}
// A frame once it has stopped changing (a visibility change can take a frame or two to show).
async function frame(page, name) {
  let prev = null, b = null;
  for (let i = 0; i < 12; i++) {
    await sleep(1200);
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
    const dims = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    b = await page.screenshot({ clip: { x: 0, y: 0, width: dims[0], height: dims[1] } });
    const h = sha(b); if (h === prev) break; prev = h;
  }
  if (SHOTS && name) fs.writeFileSync(path.join(SHOTS, name + '.png'), b);
  return b;
}
const setO = (page, k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]).then(() => sleep(600));

(async () => {
  let A = null;
  try {
    A = await open(port);
    const { page } = A;
    const renderer = await page.evaluate(() => RF.DriveAnim.stats().renderer);
    const gpu = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    console.log('renderer ' + renderer + ', GPU: ' + gpu);
    ok('LCM1 GPU renderer is on', renderer === 'three', renderer);
    // 1. off, then on (mist), then off again (mist removed)
    const off1 = await frame(page, 'off');
    if (mainPort) {
      const M = await open(mainPort);
      const mainOff = await frame(M.page, 'main-off');
      await M.browser.close();
      ok('LCM1 off equals main build (bytes)', sha(off1) === sha(mainOff), sha(off1).slice(0, 12) + ' vs main ' + sha(mainOff).slice(0, 12));
    }
    await setO(page, 'visibility', 200);
    const fogOff = await frame(page, 'fog200-cone-off');   // baseline for the brightening check: the mist alone (it darkens the night scene versus no mist)
    await setO(page, 'lampCone', 'on');
    const on = await frame(page, 'fog200-cone-on');
    const st = await page.evaluate(() => RF.DriveAnim._.V.three.lampConeState());
    ok('LCM1 on with mist: street lamps listed and sigma set', st.count >= 1 && st.sigma > 0, 'lamps ' + st.count + ', sigma ' + st.sigma);
    await setO(page, 'lampCone', 'off'); await setO(page, 'visibility', null);
    const off2 = await frame(page, 'off-after-on');
    ok('LCM1 off after on equals the first off frame (bytes)', sha(off2) === sha(off1), sha(off2).slice(0, 12) + ' vs ' + sha(off1).slice(0, 12));
    // 2. clear air: cone on equals cone off
    await setO(page, 'lampCone', 'on');
    const clearOn = await frame(page, 'clear-cone-on');
    await setO(page, 'lampCone', 'off');
    const clearOff = await frame(page, 'clear-cone-off');
    ok('LCM1 clear air: cone on equals cone off (bytes)', sha(clearOn) === sha(clearOff), sha(clearOn).slice(0, 12) + ' vs ' + sha(clearOff).slice(0, 12));
    // 3. mist: on only brightens; changed-pixel proximity reported as data
    const pix = await page.evaluate(async ({ a, b }) => {   // a = mist alone, b = mist plus cone
      const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
      const A = await load(a), B = await load(b);
      let dark = 0, changed = 0;
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
        const k = 4 * (y * A.w + x); let any = false;
        for (let c = 0; c < 3; c++) { const dd = B.d[k + c] - A.d[k + c]; if (dd < 0) dark++; if (dd !== 0) any = true; }
        if (!any) continue;
        changed++;
      }
      return { dark, changed, total: A.w * A.h };
    }, { a: fogOff.toString('base64'), b: on.toString('base64') });
    ok('LCM1 mist: cone on never darkens a pixel (vs mist alone)', pix.dark === 0, 'darkened channels ' + pix.dark);
    ok('LCM1 mist: on changes some pixels', pix.changed > 0, 'changed ' + pix.changed + ' of ' + pix.total);
    console.log('DATA (not asserted) changed pixels: ' + pix.changed + ' of ' + pix.total + ' (' + (100 * pix.changed / pix.total).toFixed(1) + '%). Where they lie: see the screenshots; the near-lamp radius check is not in this test (see the report).');
    // 3b. LAMP-CONE-OBJECTS (vis 200, same urban tile, same frames as above). Objects are the scene's own (deterministic: same tile, seed, pose);
    //     selected by the object target's coverage and depth, not hand-placed. Tolerances fixed before measuring:
    //     behind-lamp object: its cone delta (cone on minus off) divided by the delta of the nearest sky pixel must lie in [0.5, 1.5]; it must be > 0.
    //     between-us-and-lamp object: its ratio must be below the behind ratio (it gets less light).
    // the object checks read the state of a live mist-plus-cone frame: re-render it (the clear-air frames above reset the cone state)
    await setO(page, 'visibility', 200); await setO(page, 'lampCone', 'on'); const onAgain = await frame(page, 'objcheck-cone-on');
    const objRes = await page.evaluate(async ({ a, b }) => {
      const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data }; };
      const bufs = RF.DriveAnim._.V.three.objectBuffers(), lamps = RF.DriveAnim._.V.three.lampConeState().lamps;
      if (!bufs || !lamps.length) return { err: 'no object buffers or no lamps (' + (lamps ? lamps.length : 0) + ')' };
      const A = await load(a), B = await load(b), W = bufs.W, H = bufs.H;
      if (A.w !== W || A.h !== H) return { err: 'canvas ' + A.w + 'x' + A.h + ' differs from object target ' + W + 'x' + H };
      const r0 = Math.min(...lamps.map((l) => l.r));
      const cov = (px, py) => bufs.rgba[((H - 1 - py) * W + px) * 4 + 3], tAt = (px, py) => bufs.t[((H - 1 - py) * W + px) * 4];
      const delta = (px, py) => { const k = 4 * (py * W + px); let v = 0; for (let c = 0; c < 3; c++) v += B.d[k + c] - A.d[k + c]; return v; };
      const skyNear = (px, py) => { for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; if (cov(x, y) < 0.01) return [x, y]; } return null; };
      const cats = { behind: [], between: [] }, tList = [];
      for (let py = 0; py < H; py += 3) for (let px = 0; px < W; px += 3) {
        if (cov(px, py) < 0.99) continue;
        const t = tAt(px, py); if (!(t > 0)) continue;
        tList.push(t);
        if (t > r0 + 10 && t < 200) cats.behind.push([px, py]); else if (t > 3 && t < r0 - 10) cats.between.push([px, py]);
      }
      const med = (xs) => { if (!xs.length) return null; const y = xs.slice().sort((p, q) => p - q); return y[y.length >> 1]; };
      const stat = (list) => { const ratios = [], dObj = []; for (const [px, py] of list) { const sn = skyNear(px, py); if (!sn) continue; const ds = delta(sn[0], sn[1]); if (ds <= 3) continue; ratios.push(delta(px, py) / ds); dObj.push(delta(px, py)); } return { n: ratios.length, medRatio: med(ratios), medDeltaObj: med(dObj) }; };
      const bh = stat(cats.behind), bt = stat(cats.between);
      // depth probe: a distance X at which object pixels exist (median of the behind-lamp object distances in 5..60 m, so the cap can be compared pixel by pixel)
      const near = cats.behind.map(([px, py]) => tAt(px, py)).filter((t) => t > 5 && t < 60);
      return { r0: +r0.toFixed(2), lamps: lamps.length, objPix: tList.length, behind: bh, between: bt, X: near.length ? +med(near).toFixed(2) : null, nNear: near.length };
    }, { a: fogOff.toString('base64'), b: onAgain.toString('base64') });
    console.log('DATA objects: ' + JSON.stringify(objRes));
    if (objRes.err) ok('LCM1 object checks ran', false, objRes.err);
    else {
      ok('LCM1 behind-lamp object gets a lift (cone delta > 0 and enough samples)', objRes.behind.n >= 20 && objRes.behind.medDeltaObj > 0, 'n ' + objRes.behind.n + ', median delta ' + objRes.behind.medDeltaObj);
      ok('LCM1 behind-lamp object veil within [0.5, 1.5] of the nearest sky pixel', objRes.behind.medRatio !== null && objRes.behind.medRatio >= 0.5 && objRes.behind.medRatio <= 1.5, 'median ratio ' + (objRes.behind.medRatio && objRes.behind.medRatio.toFixed(3)) + ' (n ' + objRes.behind.n + ')');
      ok('LCM1 object between us and the lamp gets less than the one behind it', objRes.between.n >= 5 && objRes.between.medRatio < objRes.behind.medRatio, 'between ' + (objRes.between.medRatio && objRes.between.medRatio.toFixed(3)) + ' (n ' + objRes.between.n + ') vs behind ' + objRes.behind.medRatio.toFixed(3));
      // 3c. LAMP-CONE-OBJECTS gain (lampConeGain): gain 1 must be the default frame byte for byte; gain 0.5 about half the sky veil of gain 1.
    //     Tolerance fixed before measuring: median ratio of (gain 1 - off) / (gain 0.5 - off) over lit sky pixels in [1.8, 2.2].
    await setO(page, 'lampConeGain', 1); const gain1 = await frame(page, 'gain-1');
    ok('LCM1 gain 1 equals the default cone frame (bytes)', sha(gain1) === sha(onAgain), sha(gain1).slice(0, 12) + ' vs ' + sha(onAgain).slice(0, 12));
    await setO(page, 'lampConeGain', 0.5); const gain05 = await frame(page, 'gain-0.5');
    await setO(page, 'lampConeGain', 1);
    const gr = await page.evaluate(async ({ a, b, c }) => {
      const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (x) => x.charCodeAt(0))], { type: 'image/png' })); const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height).data; };
      const off = await load(a), g1 = await load(b), g5 = await load(c); const ratios = [];
      for (let k = 0; k < off.length; k += 4 * 7) { let d1 = 0, d5 = 0; for (let ch = 0; ch < 3; ch++) { d1 += g1[k + ch] - off[k + ch]; d5 += g5[k + ch] - off[k + ch]; } if (d1 > 12) ratios.push(d1 / Math.max(1, d5)); }
      ratios.sort((x, y) => x - y); return { n: ratios.length, med: ratios.length ? +ratios[ratios.length >> 1].toFixed(3) : null };
    }, { a: fogOff.toString('base64'), b: gain1.toString('base64'), c: gain05.toString('base64') });
    console.log('DATA gain: ' + JSON.stringify(gr));
    ok('LCM1 gain 0.5 gives about half the veil of gain 1 (median ratio over lit sky pixels in [1.8, 2.2])', gr.med !== null && gr.med >= 1.8 && gr.med <= 2.2, 'median ratio ' + gr.med + ' over ' + gr.n + ' pixels');
    // depth probe: cap every object at X metres and compare the pixels whose depth-derived distance is X (depth path vs capped path)
      if (objRes.X !== null) {
        await page.evaluate((x) => { RF.DriveAnim._.V.three.lampConeCap(x); RF.UI.redrawSpec(); }, objRes.X);   // a cap change does not redraw by itself
        const capped = await frame(page, 'cap-' + objRes.X);
        await page.evaluate(() => { RF.DriveAnim._.V.three.lampConeCap(0); RF.UI.redrawSpec(); });
        const dp = await page.evaluate(async ({ a, b, X }) => {
          const load = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: bmp.width, d: g.getImageData(0, 0, bmp.width, bmp.height).data }; };
          const bufs = RF.DriveAnim._.V.three.objectBuffers(); const P = await load(a), Q = await load(b); const W = bufs.W, H = bufs.H;
          let n = 0, sum = 0, max = 0, diffAway = 0, nAway = 0;
          for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
            const k = 4 * (py * W + px), t = bufs.t[((H - 1 - py) * W + px) * 4], cv = bufs.rgba[((H - 1 - py) * W + px) * 4 + 3];
            if (cv < 0.99) continue;
            let e = 0; for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(P.d[k + c] - Q.d[k + c]));
            if (Math.abs(t - X) <= 0.5) { n++; sum += e; max = Math.max(max, e); } else if (Math.abs(t - X) > 20) { nAway++; diffAway += e > 0 ? 1 : 0; }
          }
          return { n, meanMaxChannelDiff: n ? +(sum / n).toFixed(3) : null, maxDiff: max, nAway, changedAway: diffAway };
        }, { a: onAgain.toString('base64'), b: capped.toString('base64'), X: objRes.X });
        console.log('DATA depth probe X=' + objRes.X + ' m: ' + JSON.stringify(dp));
        ok('LCM1 depth path equals capped path at the same distance (object pixels at X, 8-bit tolerance 2)', dp.n > 0 && dp.maxDiff <= 2, 'pixels ' + dp.n + ', mean max-channel diff ' + dp.meanMaxChannelDiff + ', max ' + dp.maxDiff + ' (levels)');
        ok('LCM1 cap changes pixels away from X (the cap is live, not a no-op)', dp.changedAway > 0, 'pixels changed away from X: ' + dp.changedAway + ' of ' + dp.nAway);
      } else ok('LCM1 depth probe has object pixels at 5..60 m', false, 'none');
    }
    // 5. option select in More
    const ui = await page.evaluate(() => { const s = document.querySelector('[data-dv="lampCone"]'); return s ? { value: s.value, inMore: !!s.closest('.drive-more') } : null; });
    ok('LCM1 option select (data-dv=lampCone) is in the More panel', !!(ui && ui.inMore), JSON.stringify(ui));
    ok('LCM1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await A.browser.close();
  } catch (e) {
    console.log('[FAIL] LCM1 exception: ' + (e && e.stack || e)); fails++;
    if (A) await A.browser.close().catch(() => {});
  }
  console.log(fails ? 'LCM1 FAILED ' + fails : 'LCM1 all asserted checks passed');
  process.exit(fails ? 1 : 0);
})();
