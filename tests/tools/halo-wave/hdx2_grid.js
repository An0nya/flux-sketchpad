// HDX2 throwaway: per-pixel GPU table readback vs CPU reference (D.trafficHalo, 32 steps, jit 0.5, N=4) on a road grid below the lamp.
// node hdx2_grid.js <port> <outDir> <mode: adaptive|ladder>
// For each D: place the car, screenshot halo-on (for the table + gpu) and halo-off (mask: car body = off luminance >= 200), write grid JSON.
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991), OUT = process.argv[3], MODE = process.argv[4] || 'adaptive';
const DS = (process.env.DS ? process.env.DS.split(',').map(Number) : [80, 60, 50, 40, 30]);
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
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    if (MODE === 'ladder') await page.evaluate(() => { globalThis.__HALO_EDGES = [8, 14, 22, 34, 60, 120]; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = async () => page.evaluate(() => { const S = RF.DriveAnim._.V.three.haloState(), e = RF.DriveAnim._.V.p.eye; return S.lamps.length ? S.lamps[0].lamp[0] - e[0] : null; });
    const place = async (target) => {
      for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700); }
      return lampDist();
    };
    const shot = async (name) => { await sleep(2200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1')); fs.writeFileSync(OUT + '/' + name + '.png', await page.locator('canvas[data-sl-drive="1"]').screenshot()); };
    const out = { mode: MODE, runs: [] };
    for (const D of DS) {
      const pl = await place(D); if (pl === null) { log('no lamp at', D); continue; }
      await sleep(600);
      // grid + GPU readback + CPU reference, all in the page, while the halo table of this frame is live
      const grid = await page.evaluate(async (args) => {
        const V = RF.DriveAnim._.V, D = RF.Drive, p = V.p, th = V.three, S = th.haloState(), e = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360), W = p.w, H = p.h, ratio = H / W;
        const mod = await import('/js/drive-three-halo.js');
        const lamps = S.lamps.map((l) => ({ x: l.lamp[0], y: l.lamp[1], z: l.lamp[2], nx: l.nx, ny: l.ny, w: l.w === undefined ? 1 : l.w }));
        const L0 = S.lamps[0].lamp, dEu = Math.hypot(L0[0] - e[0], L0[1] - e[1], L0[2] - e[2]);
        const edges = Array.from(mod.haloEdgesFor(dEu));
        const par = Object.assign({}, p, { look: Object.assign({}, p.look, { trafficHalo: 4 }), trafficBeams: true });
        D.HALO.steps = 32;
        const Wb = 476, Hb = 268, dx = L0[0] - e[0], dy = L0[1] - e[1], dz = L0[2] - e[2];
        const lampCol = (-(dy / dx) / tanH + 1) / 2 * Wb - 0.5, lampRow = (1 - (dz / dx) / (tanH * ratio)) / 2 * Hb - 0.5;
        const pts = [];
        for (let c = Math.round(lampCol) - 80; c <= Math.round(lampCol) + 80; c += 8) for (let r = Math.ceil(lampRow) + 1; r <= Hb - 2; r += 6) {
          const sx = (c + 0.5) / Wb * 2 - 1, sy = 1 - (r + 0.5) / Hb * 2;
          const d0 = [1, -sx * tanH, sy * tanH * ratio], n = Math.hypot(...d0); if (d0[2] >= 0) continue;
          const dir = d0.map((v) => v / n), sEnd = -e[2] / dir[2];                 // ground hit distance along the unit ray
          if (!(sEnd > 0.5)) continue;
          const bins = th.haloProbe(sx, sy), g = mod.haloLookup(bins, sEnd, edges);
          const gpu = g[0] + g[1] + g[2];
          const cc = D.trafficHalo(dir, sEnd, lamps, 4, par, 0.5), cpu = cc[0] + cc[1] + cc[2];
          // convergence: 256 steps at jit 0.5, and the mean over 8 jitter offsets at 32 steps (the log spacing is jitter-sensitive)
          D.HALO.steps = 256; const c256 = D.trafficHalo(dir, sEnd, lamps, 4, par, 0.5); D.HALO.steps = 32;
          let jsum = 0; for (let j = 0; j < 8; j++) { const cj = D.trafficHalo(dir, sEnd, lamps, 4, par, (j + 0.5) / 8); jsum += cj[0] + cj[1] + cj[2]; }
          pts.push({ c, r, sEnd: +sEnd.toFixed(3), gpu, cpu, cpu256: c256[0] + c256[1] + c256[2], cpuJ: jsum / 8 });
        }
        return { D: dEu, dFw: dx, lampCol, lampRow, edges, pts, tab: S.tab, lamps: lamps.length, eye: e, hfov: p.hfov, h: H, w: W };
      }, null);
      log('D', D, 'placed', pl.toFixed(2), 'dEu', grid.D.toFixed(2), 'edges', grid.edges.map((x) => x.toFixed(1)).join(','), 'points', grid.pts.length, 'tab', grid.tab.join('x'));
      await shot('on_D' + D);
      await setOpt('trafficHalo', 0); await sleep(800); await shot('off_D' + D);
      await setOpt('trafficHalo', 4); await sleep(800);
      out.runs.push(grid);
    }
    fs.writeFileSync(OUT + '/grid_' + MODE + '.json', JSON.stringify(out));
    log('wrote', OUT + '/grid_' + MODE + '.json', 'errors', errs.slice(0, 3));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
