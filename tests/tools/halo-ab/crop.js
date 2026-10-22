// HALO-AB pass-by crops: one bin count N per run, one car placed so its rel distance is D m, halo 16, screenshot the drive canvas.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs');
const port = +process.argv[2], N = process.argv[3], DS = process.argv[4].split(','), OUTDIR = process.argv[5];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const B0 = {
  scene: 'road', wet: false, wetSheen: false, wetModel: 'legacy', glare: 'off', visibility: null,
  scatter: 0, scatterMode: 'direct', scatterCache: 'off', scatterBlur: 'off', scatterRes: 'half', scatterQuality: 'steps',
  scatterCycle: 0, scatterCycleFade: 'off', scatterNearBias: 0, scatterBinCounts: '', trafficHalo: 0,
  trafficBeams: false, oncoming: false, preceding: false, trafficDensity: 1, density: 0.5, veg: false, leafyFoliage: false,
  detailedModels: false, mt: false, gpuRenderer: true, dynamicResolution: false, debugTimings: false, fpsCounter: false,
  trafficLogic: false, surfaceSheen: false, lampPitch: false, afs: false, corneringLamps: false, mountainPass: false,
};
const CFG = { visibility: 3000, oncoming: true, preceding: true, trafficBeams: true, trafficDensity: 1, onMode: 'generic', trafficHalo: 16 };
const shoot = async ({ base, cfg, D }) => {
  const sleepIn = (ms) => new Promise((r) => setTimeout(r, ms));
  const u = RF.UI, Dv = RF.DriveAnim, a = Dv._, V = a.V, S = a.S, o = u.dvOpts;
  Object.assign(o, base, cfg);
  u.redrawSpec(); await sleepIn(2500);
  for (let i = 0; i < 5; i++) a.frame();
  const st = S(u), t = st.t, d0 = st.dist, L = +o.trafficLightRange || 150;
  let best = null;
  for (let s0 = 0; s0 < 3000; s0 += 0.5) {
    const cs = a.trafficCars(V.src, s0, t).filter((c) => c.rel >= 0 && c.rel <= L);
    const dev = cs.length ? Math.min(...cs.map((c) => Math.abs(c.rel - D))) : 1e9;
    if (!best || dev < best.dev) best = { s0, dev, n: cs.length };
    if (dev < 0.25) break;
  }
  st.dist = best.s0;
  for (let i = 0; i < 6; i++) a.frame();
  const cs = a.trafficCars(V.src, st.dist, t).filter((c) => c.rel >= 0 && c.rel <= L).map((c) => +c.rel.toFixed(2));
  const r = V.canvas.getBoundingClientRect();
  st.dist = d0;
  return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, canvasPx: V.canvas.width + 'x' + V.canvas.height, startDist: best.s0, relHit: best.dev, carsRel: cs, haloN: null };
};
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 912, height: 513 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html?halobins=' + N);
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => UX2Page.ready());
    await sleep(1500);
    await page.evaluate(async () => {
      const b = document.querySelector('[data-anim="popout"]');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
      for (let i = 0; i < 50 && !RF.DriveAnim._.S(RF.UI).popout; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500));
    });
    const haloN = await page.evaluate(async () => (await import('/js/drive-three-shaders.js')).HALO_N);
    log('HALO_N in page:', haloN, 'N requested:', N);
    for (const D of DS) {
      const res = await page.evaluate(shoot, { base: B0, cfg: CFG, D: +D });
      res.haloN = haloN;
      const box = res.rect;
      const full = OUTDIR + '/N' + N + '_D' + D + '_full.png';
      await page.screenshot({ path: full, clip: box });
      // lower-centre crop of the canvas: the road below the lamp row, where the pass-by wave showed
      const cx = box.x + box.width / 2 - 150, cy = box.y + box.height * 0.45;
      await page.screenshot({ path: OUTDIR + '/N' + N + '_D' + D + '_crop.png', clip: { x: cx, y: cy, width: 300, height: Math.min(260, box.y + box.height - cy) } });
      log('N', N, 'D', D, JSON.stringify({ startDist: res.startDist, relHit: res.relHit, carsRel: res.carsRel, canvasPx: res.canvasPx, haloN }));
      fs.appendFileSync(OUTDIR + '/crops.jsonl', JSON.stringify({ N, D: +D, ...res, full, crop: OUTDIR + '/N' + N + '_D' + D + '_crop.png' }) + '\n');
    }
    log('page errors:', errors.length, errors.slice(0, 3));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
