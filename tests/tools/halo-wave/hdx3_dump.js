// HDX3 addendum, step 0 (one browser run): dump exact CPU cumulative curves for each grid ray (cell ray, s0 = 0.5, N=4 lamps, jit 0.5).
// Nodes: 256 log-spaced intervals on [0.5, 120]; cum[j] = integral 0.5..node_j (midpoint samples, 256 steps per node pair via sample sum).
// Also exact C(sEnd) at the pixel's end distance by refInt (256 steps). Writes Float32 binary + JSON header.
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +process.argv[2], OUT = process.argv[3];
const DS = [80, 60, 50, 40, 30];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIB = fs.readFileSync(__dirname + '/hdx3_diag.js', 'utf8').split('const PAGE_LIB = `')[1].split('`;')[0];
const NODES = 256;
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
    await page.evaluate(LIB);
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = async () => page.evaluate(() => { const S = RF.DriveAnim._.V.three.haloState(), e = RF.DriveAnim._.V.p.eye; return S.lamps.length ? S.lamps[0].lamp[0] - e[0] : null; });
    const place = async (target) => { for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 1.5) return d;
      await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700); } return lampDist(); };
    const header = { nodes: NODES, runs: [] }; const bufs = [];
    for (const D of DS) {
      if ((await place(D)) === null) continue; await sleep(600);
      const run = await page.evaluate(async (NODES) => {
        const V = RF.DriveAnim._.V, D = RF.Drive, p = V.p, S = V.three.haloState(), e = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360), ratio = p.h / p.w;
        const mod = await import('/js/drive-three-halo.js'), H3 = window.hdx3;
        const lamps = S.lamps.map((l) => ({ x: l.lamp[0], y: l.lamp[1], z: l.lamp[2], nx: l.nx, ny: l.ny, w: l.w === undefined ? 1 : l.w }));
        const L0 = S.lamps[0].lamp, dEu = Math.hypot(L0[0] - e[0], L0[1] - e[1], L0[2] - e[2]);
        const par = Object.assign({}, p, { look: Object.assign({}, p.look, { trafficHalo: 4 }), trafficBeams: true });
        const sig = D.sigmaOf(par.look), rMin = D.SCAT ? D.SCAT.rMin : 0.3, rx0 = null;
        // node cumulative for one ray: samples at log midpoints of each node interval, weight = a*(q-1)
        const nodeCum = (ray) => {
          const sA = 0.5, sB = 120, q = Math.pow(sB / sA, 1 / NODES), rx = ray[0], ry = ray[1], rz = ray[2], eye = e;
          const near = lamps.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 4);
          const beam = par.src && near.some((x) => !x.L.beam) ? D.trafficBeam(par) : null;
          const v = new Float64Array(NODES);
          for (const { L } of near) { if (!L.beam && !beam) continue; const tint = L.tint || [1, 1, 1];
            for (let k = 0; k < NODES; k++) { const a = sA * Math.pow(q, k), s = a * Math.pow(q, 0.5), w = a * q - a, Tv = Math.exp(-sig * s);
              const Px = eye[0] + s * rx, Py = eye[1] + s * ry, Pz = eye[2] + s * rz; const I = D.trafficAt(L, beam, Px, Py, Pz); if (!(I > 0)) continue;
              const dx = Px - L.x, dy = Py - L.y, dz = Pz - L.z, r2 = dx * dx + dy * dy + dz * dz; if (!(r2 > 0)) continue;
              const r = Math.sqrt(r2), cos = -(dx * rx + dy * ry + dz * rz) / r, E = I / Math.max(r2, rMin * rMin);
              const val = sig * D.scatterPhase(cos) * E * Math.exp(-sig * r) * Tv * w; if (Number.isFinite(val)) v[k] += val * (tint[0] + tint[1] + tint[2]) / 3; } }
          const cum = new Float64Array(NODES + 1); for (let k = 0; k < NODES; k++) cum[k + 1] = cum[k] + v[k];
          return cum;   // cum[j] = integral 0.5 .. 0.5*(240)^(j/NODES), sum of RGB-mean
        };
        const f32 = [], pts = [];
        const lampCol = (-((L0[1] - e[1]) / (L0[0] - e[0])) / tanH + 1) / 2 * 476 - 0.5, lampRow = (1 - ((L0[2] - e[2]) / (L0[0] - e[0])) / (tanH * ratio)) / 2 * 268 - 0.5;
        for (let c = Math.round(lampCol) - 80; c <= Math.round(lampCol) + 80; c += 8) for (let r = Math.ceil(lampRow) + 1; r <= 266; r += 6) {
          const sx = (c + 0.5) / 476 * 2 - 1, sy = 1 - (r + 0.5) / 268 * 2;
          const d0 = [1, -sx * tanH, sy * tanH * ratio], n = Math.hypot(...d0); if (d0[2] >= 0) continue;
          const sEnd = -e[2] / (d0[2] / n); if (!(sEnd > 0.5)) continue;
          const tw = 160, tb = 90; const cx = Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), cy = Math.min(tb - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * tb)));
          const csx = (cx + 0.5) / tw * 2 - 1, csy = (cy + 0.5) / tb * 2 - 1;
          const cd0 = [1, -csx * tanH, csy * tanH * ratio], cn = Math.hypot(...cd0), cdir = cd0.map((v) => v / cn);
          const sum = (v) => v[0] + v[1] + v[2];
          const exact = sum(H3.refInt(D, par, cdir, 0.5, Math.min(sEnd, 120), lamps, 4, 0.5, 256));
          pts.push({ sEnd, exact, cum: Array.from(nodeCum(cdir)) });
        }
        // the exact pixel-ray end value is not needed for the bake-off; ground truth is exact on the cell ray.
        return { D: dEu, pts, edges: Array.from(mod.haloEdgesFor(dEu)) };
      }, NODES);
      header.runs.push({ D: run.D, edges: run.edges, n: run.pts.length, sEnd: run.pts.map((p) => p.sEnd), exact: run.pts.map((p) => p.exact) });
      const flat = new Float32Array(run.pts.length * (NODES + 1)); run.pts.forEach((p, i) => flat.set(p.cum, i * (NODES + 1)));
      bufs.push(Buffer.from(flat.buffer));
      console.log('D', D, 'points', run.pts.length, 'edges', run.edges.map((x) => x.toFixed(1)).join(','));
    }
    fs.writeFileSync(OUT + '/dump.json', JSON.stringify(header));
    fs.writeFileSync(OUT + '/dump_cum.f32', Buffer.concat(bufs));
    console.log('wrote dump');
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
