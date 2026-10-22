// HALO-WAVE-diag throwaway measurement (not a gate, not committed to js/).
// Usage: node measure.js <port> <outDir> [tag] [edgesMode]   edgesMode: 'theory' (default) | 'ladder'
// For each target distance D (lamp forward distance, m) it renders halo-on (trafficHalo 4) and halo-off frames
// and saves them as PNG; the analysis (luminance per row, halo difference, edges) is done in the page.
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991), OUT = process.argv[3], TAG = process.argv[4] || 'theory', MODE = process.argv[5] || 'theory';
const DS = (process.env.DS ? process.env.DS.split(',').map(Number) : [100,95,90,85,80,75,70,65,60,55,50,45,40,35,30]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    // scene: open road, thin haze (fog 60 as in SL-traffic-halo.js), glare/sheen/grain/air beam off, one oncoming car
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) {
      await setOpt(k, v);
    }
    const setup = await page.evaluate(() => { const o = RF.UI.dvOpts; return { glare: o.glare, tex: o.tex, tiles: o.tiles, speed: o.speed, wetSheen: o.wetSheen, scatter: o.scatter, visibility: o.visibility, trafficHalo: o.trafficHalo, scene: o.scene }; });
    log('setup', JSON.stringify(setup));
    // show the canvas at its render size (640x360) so the screenshot is not resampled (the pane shows it at 477x269)
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    log('canvas', await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; const r = c.getBoundingClientRect(); return [c.width, c.height, r.width, r.height]; }));
    if (MODE === 'ladder') { await page.evaluate(() => { globalThis.__HALO_EDGES = [8, 14, 22, 34, 60, 120]; }); log('CONTROL: fixed ladder forced'); }
    await setOpt('trafficHalo', 4); await sleep(800);
    const eyeNow = () => page.evaluate(() => RF.DriveAnim._.V.p.eye);
    const haloState = () => page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    const lampDist = async () => { const s = await haloState(); const e = await eyeNow(); return s.lamps.length ? s.lamps[0].lamp[0] - e[0] : null; };
    const place = async (target) => {
      for (let i = 0; i < 8; i++) {
        const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700);
      }
      return lampDist();
    };
    const shot = async (name) => { await sleep(2200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1')); const buf = await page.locator('canvas[data-sl-drive="1"]').screenshot(); fs.writeFileSync(OUT + '/' + name + '.png', buf); return buf.toString('base64'); };
    const meta = async () => page.evaluate(async () => {
      const V = RF.DriveAnim._.V, p = V.p, S = V.three.haloState(), mod = await import('/js/drive-three-halo.js');
      const eye = p.eye, L = S.lamps.length ? S.lamps[0].lamp : null;
      const dEu = L ? Math.hypot(L[0] - eye[0], L[1] - eye[1], L[2] - eye[2]) : null, dFw = L ? L[0] - eye[0] : null;
      const edges = dEu !== null ? mod.haloEdgesFor(dEu) : null;
      return { eye, w: p.w, h: p.h, hfov: p.hfov, pitch: p.pitch, yaw: p.yaw, lamps: S.lamps.length, lamp0: L, dFw, dEu, edges, passes: S.passes, tab: S.tab, on: S.on, global: globalThis.__HALO_EDGES || null };
    });
    const rows = [];
    for (const D of DS) {
      const d0 = await lampDist();
      const pl = await place(D);
      if (pl === null) { log('D', D, 'no lamp in range; skipping'); rows.push({ D, skipped: 'no lamp' }); continue; }
      await sleep(600);
      const m = await meta();
      const on = await shot('on_D' + D);
      await setOpt('trafficHalo', 0); await sleep(800);
      const off = await shot('off_D' + D);
      await setOpt('trafficHalo', 4); await sleep(800);
      const m2 = await meta();
      log('D', D, 'placed', pl.toFixed(2), 'lamps', m.lamps, 'dFw', m.dFw && m.dFw.toFixed(2), 'dEu', m.dEu && m.dEu.toFixed(2), 'edges', m.edges && m.edges.map((x) => x.toFixed(2)).join(','), 'dFw after', m2.dFw && m2.dFw.toFixed(2));
      rows.push({ D, placed: pl, meta: m, metaAfter: m2, on, off });
    }
    // analysis in the page: per-column luminance and halo delta, plus the lamp column (from the lamp's world position)
    const ana = await page.evaluate(async (rows) => {
      const dec = async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; };
      const out = [];
      for (const r of rows) {
        if (!r.on) { out.push(r); continue; }
        const A = await dec(r.on), B = await dec(r.off), W = A.w, H = A.h, eye = r.meta.eye, tanH = Math.tan(r.meta.hfov * Math.PI / 360);
        const lum = (d, x, y) => { const i = (y * W + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
        const L = r.meta.lamp0; let lampCol = null, lampRow = null;
        if (L) { const dx = L[0] - eye[0]; const sx = -(L[1] - eye[1]) / (dx * tanH), sy = (L[2] - eye[2]) / (dx * tanH * H / W); lampCol = (sx + 1) / 2 * W - 0.5; lampRow = (1 - sy) / 2 * H - 0.5; }
        const cols = lampCol === null ? [] : [Math.round(lampCol), Math.round(lampCol) - 30, Math.round(lampCol) + 30];
        const prof = cols.map((cx) => { const on = [], off = []; for (let y = 0; y < H; y++) { on.push(lum(A.d, cx, y)); off.push(lum(B.d, cx, y)); } return { cx, on, off, delta: on.map((v, i) => v - off[i]) }; });
        // whole-frame halo change (on minus off), and its mean abs over the road area below the lamp
        let tot = 0, n = 0; for (let i = 0; i < A.d.length; i += 4) { tot += Math.abs(lum(A.d, (i / 4) % W, Math.floor(i / 4 / W)) - lum(B.d, (i / 4) % W, Math.floor(i / 4 / W))); n++; }
        out.push({ D: r.D, placed: r.placed, lampCol, lampRow, W, H, eye, tanH, prof, meanAbsDiff: tot / n, meta: r.meta, metaAfter: r.metaAfter });
      }
      return out;
    }, rows);
    fs.writeFileSync(OUT + '/analysis_' + TAG + '.json', JSON.stringify(ana));
    log('wrote analysis', OUT + '/analysis_' + TAG + '.json', 'errors', errs.slice(0, 3));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
