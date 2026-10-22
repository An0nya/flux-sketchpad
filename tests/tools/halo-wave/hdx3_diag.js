// HDX3 step 1 (diagnosis), throwaway. Per grid point: GPU raw bins (haloProbe at the NDC cell), exact CPU per-bin integrals along the CELL ray
// (copy of trafficHalo with a start parameter: s0 = 0.5 m, matching the GPU bin 0), exact CPU running total along the pixel ray to sEnd (s0 = 0.5),
// the old reference (D.trafficHalo, s0 = min(1, S/4)), and haloLookup applied to exact per-bin values (lookup test).
// node hdx3_diag.js <port> <outDir> <tag>      (table build = whatever is loaded: adaptive by default)
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +process.argv[2], OUT = process.argv[3], TAG = process.argv[4] || 'adaptive';
const DS = (process.env.DS ? process.env.DS.split(',').map(Number) : [80, 60, 50, 40, 30]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const PAGE_LIB = `
  window.hdx3 = {
    refInt(D, p, ray, sA, sB, sources, N, jit, steps) {
      const out = [0, 0, 0]; if (!(sB > sA) || !(sA > 0)) return out;
      const sig = D.sigmaOf((p && p.look) || {}), eye = p.eye, rx = ray[0], ry = ray[1], rz = ray[2], rMin = (D.SCAT ? D.SCAT.rMin : 0.3);
      const near = sources.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, N);
      const beam = p.src && near.some((q) => !q.L.beam) ? D.trafficBeam(p) : null;
      const q = Math.pow(sB / sA, 1 / steps), tint0 = null;
      for (const { L } of near) {
        if (!L.beam && !beam) continue;
        const tint = L.tint || [1, 1, 1];
        for (let k = 0; k < steps; k++) {
          const a = sA * Math.pow(q, k), s = a * Math.pow(q, jit), w = a * q - a, Tv = Math.exp(-sig * s);
          const Px = eye[0] + s * rx, Py = eye[1] + s * ry, Pz = eye[2] + s * rz;
          const I = D.trafficAt(L, beam, Px, Py, Pz); if (!(I > 0)) continue;
          const dx = Px - L.x, dy = Py - L.y, dz = Pz - L.z, r2 = dx * dx + dy * dy + dz * dz; if (!(r2 > 0)) continue;
          const r = Math.sqrt(r2), cos = -(dx * rx + dy * ry + dz * rz) / r, E = I / Math.max(r2, rMin * rMin);
          const v = sig * D.scatterPhase(cos) * E * Math.exp(-sig * r) * Tv * w;
          if (!Number.isFinite(v)) continue;
          out[0] += v * tint[0]; out[1] += v * tint[1]; out[2] += v * tint[2];
        }
      }
      return out;
    },
  };`;
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
    await page.evaluate(PAGE_LIB);
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = async () => page.evaluate(() => { const S = RF.DriveAnim._.V.three.haloState(), e = RF.DriveAnim._.V.p.eye; return S.lamps.length ? S.lamps[0].lamp[0] - e[0] : null; });
    const place = async (target) => {
      for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700); }
      return lampDist();
    };
    const out = { tag: TAG, runs: [] };
    for (const D of DS) {
      const pl = await place(D); if (pl === null) { log('no lamp', D); continue; }
      await sleep(600);
      const run = await page.evaluate(async () => {
        const V = RF.DriveAnim._.V, D = RF.Drive, p = V.p, th = V.three, S = th.haloState(), e = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360), W = p.w, H = p.h, ratio = H / W;
        const mod = await import('/js/drive-three-halo.js'), H3 = window.hdx3;
        const lamps = S.lamps.map((l) => ({ x: l.lamp[0], y: l.lamp[1], z: l.lamp[2], nx: l.nx, ny: l.ny, w: l.w === undefined ? 1 : l.w }));
        const L0 = S.lamps[0].lamp, dEu = Math.hypot(L0[0] - e[0], L0[1] - e[1], L0[2] - e[2]);
        const edges = Array.from(mod.haloEdgesFor(dEu)), SMAX = D.SCAT ? D.SCAT.S_MAX : 120;
        const par = Object.assign({}, p, { look: Object.assign({}, p.look, { trafficHalo: 4 }), trafficBeams: true });
        const [tw, tb] = S.tab, dx = L0[0] - e[0], dy = L0[1] - e[1], dz = L0[2] - e[2];
        const lampCol = (-(dy / dx) / tanH + 1) / 2 * 476 - 0.5, lampRow = (1 - (dz / dx) / (tanH * ratio)) / 2 * 268 - 0.5;
        const pts = [];
        for (let c = Math.round(lampCol) - 80; c <= Math.round(lampCol) + 80; c += 8) for (let r = Math.ceil(lampRow) + 1; r <= 266; r += 6) {
          const sx = (c + 0.5) / 476 * 2 - 1, sy = 1 - (r + 0.5) / 268 * 2;
          const d0 = [1, -sx * tanH, sy * tanH * ratio], n = Math.hypot(...d0); if (d0[2] >= 0) continue;
          const dir = d0.map((v) => v / n), sEnd = -e[2] / dir[2]; if (!(sEnd > 0.5)) continue;
          // cell containing the pixel, and its centre ray (the ray the table cell integrates along)
          const cx = Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), cy = Math.min(tb - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * tb)));
          const csx = (cx + 0.5) / tw * 2 - 1, csy = (cy + 0.5) / tb * 2 - 1;
          const cd0 = [1, -csx * tanH, csy * tanH * ratio], cn = Math.hypot(...cd0), cdir = cd0.map((v) => v / cn);
          const probe = th.haloProbe(sx, sy);                          // raw GPU bins of the cell (nearest cell)
          const exactBins = []; let lo = 0.5;
          for (let k = 0; k < edges.length; k++) { const hi = Math.min(edges[k], SMAX); exactBins.push(H3.refInt(D, par, cdir, lo, hi, lamps, 4, 0.5, 256)); lo = edges[k]; }
          const gpuBins = probe.map((b) => b[0] + b[1] + b[2]);
          const sum = (v) => v[0] + v[1] + v[2];
          const gpuRaw = mod.haloLookup(probe, sEnd, edges).reduce((a, b) => a + b, 0);
          const lookExact = mod.haloLookup(exactBins, sEnd, edges).reduce((a, b) => a + b, 0);
          const exactCellTotal = sum(H3.refInt(D, par, cdir, 0.5, Math.min(sEnd, SMAX), lamps, 4, 0.5, 256));
          const cpuPixNew = sum(H3.refInt(D, par, dir, 0.5, Math.min(sEnd, SMAX), lamps, 4, 0.5, 256));
          D.HALO.steps = 32; const cpuPixOld = sum(D.trafficHalo(dir, sEnd, lamps, 4, par, 0.5)); D.HALO.steps = 32;
          pts.push({ c, r, sEnd: +sEnd.toFixed(3), cx, cy, gpuBins, exactBins: exactBins.map(sum), gpuRaw, lookExact, exactCellTotal, cpuPixNew, cpuPixOld });
        }
        return { D: dEu, edges, pts, tab: [tw, tb], lampCol, lampRow };
      });
      log('D', D, 'edges', run.edges.map((x) => x.toFixed(1)).join(','), 'points', run.pts.length, 'tab', run.tab.join('x'));
      out.runs.push(run);
    }
    fs.writeFileSync(OUT + '/diag_' + TAG + '.json', JSON.stringify(out));
    log('wrote', OUT + '/diag_' + TAG + '.json', 'errors', errs.slice(0, 3));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
