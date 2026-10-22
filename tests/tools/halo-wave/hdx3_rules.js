// HDX3 step 2 offline rule search (throwaway). Uses EXACT per-bin CPU integrals (cell ray, s0 = 0.5, 256 steps) at several edge sets, and
// the exact running total at each point's sEnd (cell ray). Each rule maps (exact bins, edges, sEnd) -> running total; compare with the exact total.
// node hdx3_rules.js <port> <outDir> : runs the page (one browser) and writes rules.json, then prints stats.
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +process.argv[2], OUT = process.argv[3];
const DS = [80, 60, 50, 40, 30];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIB = fs.readFileSync(__dirname + '/hdx3_diag.js', 'utf8').split('const PAGE_LIB = `')[1].split('`;')[0];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    await page.evaluate(LIB.replace(/^\s*window\.hdx3 = \{/, 'window.hdx3 = {'));
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = async () => page.evaluate(() => { const S = RF.DriveAnim._.V.three.haloState(), e = RF.DriveAnim._.V.p.eye; return S.lamps.length ? S.lamps[0].lamp[0] - e[0] : null; });
    const place = async (target) => { for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
      await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700); } return lampDist(); };
    const out = [];
    for (const D of DS) {
      if ((await place(D)) === null) continue; await sleep(600);
      const run = await page.evaluate(async () => {
        const V = RF.DriveAnim._.V, D = RF.Drive, p = V.p, S = V.three.haloState(), e = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360), ratio = p.h / p.w;
        const mod = await import('/js/drive-three-halo.js'), H3 = window.hdx3;
        const lamps = S.lamps.map((l) => ({ x: l.lamp[0], y: l.lamp[1], z: l.lamp[2], nx: l.nx, ny: l.ny, w: l.w === undefined ? 1 : l.w }));
        const L0 = S.lamps[0].lamp, dEu = Math.hypot(L0[0] - e[0], L0[1] - e[1], L0[2] - e[2]);
        const par = Object.assign({}, p, { look: Object.assign({}, p.look, { trafficHalo: 4 }), trafficBeams: true });
        const SMAX = 120;
        const sets = { adaptive: Array.from(mod.haloEdgesFor(dEu)), ladder: [8, 14, 22, 34, 60, 120] };
        sets.fine12 = Array.from({ length: 12 }, (_, k) => 0.5 * Math.pow(240, (k + 1) / 12));
        sets.fine12[11] = 120;
        for (const nb of [8, 16, 24]) { const E = Array.from({ length: nb }, (_, k) => 0.5 * Math.pow(240, (k + 1) / nb)); E[nb - 1] = 120; sets['fine' + nb] = E; }
        const dx = L0[0] - e[0], dy = L0[1] - e[1], dz = L0[2] - e[2];
        const lampCol = (-(dy / dx) / tanH + 1) / 2 * 476 - 0.5, lampRow = (1 - (dz / dx) / (tanH * ratio)) / 2 * 268 - 0.5;
        const pts = [];
        for (let c = Math.round(lampCol) - 80; c <= Math.round(lampCol) + 80; c += 8) for (let r = Math.ceil(lampRow) + 1; r <= 266; r += 6) {
          const sx = (c + 0.5) / 476 * 2 - 1, sy = 1 - (r + 0.5) / 268 * 2;
          const d0 = [1, -sx * tanH, sy * tanH * ratio], n = Math.hypot(...d0); if (d0[2] >= 0) continue;
          const sEnd = -e[2] / (d0[2] / n); if (!(sEnd > 0.5)) continue;
          const tw = 160, tb = 90; const cx = Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), cy = Math.min(tb - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * tb)));
          const csx = (cx + 0.5) / tw * 2 - 1, csy = (cy + 0.5) / tb * 2 - 1;
          const cd0 = [1, -csx * tanH, csy * tanH * ratio], cn = Math.hypot(...cd0), cdir = cd0.map((v) => v / cn);
          const rec = { sEnd, exactTotal: 0, bins: {} };
          const sumv = (v) => v[0] + v[1] + v[2];
          rec.exactTotal = sumv(H3.refInt(D, par, cdir, 0.5, Math.min(sEnd, SMAX), lamps, 4, 0.5, 256));
          for (const name of Object.keys(sets)) { const E = sets[name]; const bins = []; let lo = 0.5;
            for (let k = 0; k < E.length; k++) { const hi = Math.min(E[k], SMAX); bins.push(sumv(H3.refInt(D, par, cdir, lo, hi, lamps, 4, 0.5, 256))); lo = E[k]; }
            rec.bins[name] = bins; }
          pts.push(rec);
        }
        return { D: dEu, sets, pts };
      });
      out.push(run); console.log('D', D, 'points', run.pts.length);
    }
    fs.writeFileSync(OUT + '/rules_exact.json', JSON.stringify(out));
    console.log('wrote', OUT + '/rules_exact.json');
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
