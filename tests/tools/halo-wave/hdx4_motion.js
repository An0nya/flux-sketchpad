// HDX4 step 1 capture (throwaway harness). Fixed eye, one oncoming car, open road, air beam off (scatter 0), glare off, tex off, halo 4.
// Per frame: a halo-ON and a halo-OFF screenshot of the whole canvas (the difference is the halo alone: car body and road cancel).
// node hdx4_motion.js <port> <outDir> <fog> <D> <sweep: fwd|side> [glare: 0|1]
// fwd  : the car comes 0.05 m closer per frame (lamp-eye distance, sign checked on the first step), 40 frames.
// side : the eye slides sideways 0.02 m per frame (RF.Drive.eyeFor patched; equivalent to the car moving across by 2 cm), 40 frames.
// Writes <outDir>/meta.json (per frame: lamp distance, eye, lamp pixel, canvas size, table size, lamp count) and on_<i>.png / off_<i>.png.
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const [port, OUT, FOG, DT, SWEEP, GLARE] = [+(process.argv[2] || 8994), process.argv[3], +(process.argv[4] || 60), +(process.argv[5] || 40), process.argv[6] || 'fwd', process.argv[7] === '1'];
const NF = +(process.env.NF || 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    if (process.env.HDIV) await page.addInitScript('globalThis.SL_HALO_DIV = ' + (+process.env.HDIV) + ';');
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', GLARE], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', FOG]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = () => page.evaluate(() => { const S = RF.DriveAnim._.V.three.haloState(), e = RF.DriveAnim._.V.p.eye; return S.lamps.length ? S.lamps[0].lamp[0] - e[0] : null; });
    const place = async (target) => {
      for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700); }
      return lampDist();
    };
    const pl = await place(DT); if (pl === null) { log('no lamp at', DT); process.exitCode = 2; return; }
    await sleep(600);
    // the eye at the start of the sweep; for side, the patch reads a global frame index
    await page.evaluate((side) => { const V = RF.DriveAnim._.V; globalThis.__e0 = V.p.eye.slice(); globalThis.__k = 0; if (side) { RF.Drive.eyeFor = () => [globalThis.__e0[0], globalThis.__e0[1] + 0.02 * globalThis.__k, globalThis.__e0[2]]; } }, SWEEP === 'side');
    // sign of the forward step: one +0.05 nudge, read the lamp distance, then undo it
    let sgn = 1;
    if (SWEEP === 'fwd') {
      const d0 = await lampDist(); await page.evaluate(() => { const st = RF.DriveAnim._.S(RF.UI); st.dist += 0.05; RF.DriveAnim._.frame(); }); await sleep(700);
      const d1 = await lampDist(); sgn = d1 < d0 ? 1 : -1;
      await page.evaluate(() => { const st = RF.DriveAnim._.S(RF.UI); st.dist -= 0.05; RF.DriveAnim._.frame(); }); await sleep(700);
      log('forward sign', sgn, 'd0', d0.toFixed(4), 'd1', d1.toFixed(4));
    }
    if (process.env.HDIV) log('table div override', process.env.HDIV);
    const shot = async (name) => { await sleep(1200); fs.writeFileSync(OUT + '/' + name + '.png', await page.locator('canvas[data-sl-drive="1"]').screenshot()); };
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
    const meta = { fog: FOG, D: DT, sweep: SWEEP, glare: GLARE, sign: sgn, frames: [] };
    for (let i = 0; i < NF; i++) {
      if (SWEEP === 'fwd') await page.evaluate((s) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += 0.05 * s; RF.DriveAnim._.frame(); }, sgn);
      else if (SWEEP === 'side') await page.evaluate((k) => { globalThis.__k = k; RF.DriveAnim._.frame(); }, i + 1);
      else await page.evaluate(() => RF.DriveAnim._.frame());   // static: the same pose every frame (noise-floor control)
      await sleep(900);
      const info = await page.evaluate(() => { const V = RF.DriveAnim._.V, S = V.three.haloState(), e = V.p.eye, tanH = Math.tan(V.p.hfov * Math.PI / 360), W = V.p.w, H = V.p.h, c = V.canvas;
        const L = S.lamps.length ? S.lamps[0].lamp : null; const dx = L ? L[0] - e[0] : 0;
        const col = L ? (-((L[1] - e[1]) / dx) / tanH + 1) / 2 * W - 0.5 : null, row = L ? (1 - ((L[2] - e[2]) / dx) / (tanH * H / W)) / 2 * H - 0.5 : null;
        return { dLamp: dx, eye: e.slice(), lampsN: S.lamps.length, tab: S.tab, W, H, cw: c.width, ch: c.height, col, row, halo: V.p.look && V.p.look.trafficHalo, hfov: V.p.hfov }; });
      await shot('on_' + i);
      await setOpt('trafficHalo', 0); await page.evaluate(() => RF.DriveAnim._.frame()); await sleep(900);
      await shot('off_' + i);
      await setOpt('trafficHalo', 4); await page.evaluate(() => RF.DriveAnim._.frame()); await sleep(300);
      meta.frames.push(info);
      if (i % 5 === 0) log('frame', i, 'dLamp', info.dLamp.toFixed(3), 'eyeY', info.eye[1].toFixed(3), 'lamps', info.lampsN, 'tab', info.tab.join('x'));
    }
    fs.writeFileSync(OUT + '/meta.json', JSON.stringify(meta));
    log('wrote', OUT, 'errors', errs.slice(0, 3));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
