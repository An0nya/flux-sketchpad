// FEATURE-COST probe: ms per drive-view frame for each option, on the GPU drive renderer.
// Run from the worktree root, server already up:
//   node tests/tools/feature-cost/fcost-probe.js <port> <out.jsonl> <road|forest>
// Timing: per sample the sim advances 0.23 m, RF.DriveAnim._.frame() runs, then a 1-px readPixels on the drive
// canvas's GL context forces the GPU to finish (a hard sync) before the clock stops. 30 warm-up, 120 timed frames.
// Car state: the cars in range are counted per frame (oncoming + preceding, within trafficLightRange m). For the
// zero / one / four states the start distance is scanned so the count matches the target for the largest share of
// the frames; the realised share and count histogram are written, so a state that could not be held is visible.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs');
const port = +process.argv[2], OUT = process.argv[3], SET = process.argv[4] || 'ab';
if (!port || !OUT) { console.error('usage: fcost-probe.js <port> <out.jsonl> <road|forest>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// B0: every optional effect off, objects low (scenery density 0.5). Every config applies all of B0, then its own keys.
const B0 = {
  scene: SET === 'forest' ? 'forest' : 'road', wet: false, wetSheen: false, wetModel: 'legacy', glare: 'off', visibility: null,
  scatter: 0, scatterMode: 'direct', scatterCache: 'off', scatterBlur: 'off', scatterRes: 'half', scatterQuality: 'steps',
  scatterCycle: 0, scatterCycleFade: 'off', scatterNearBias: 0, scatterBinCounts: '', trafficHalo: 0,
  trafficBeams: false, oncoming: false, preceding: false, trafficDensity: 1, density: 0.5, veg: false, leafyFoliage: false,
  detailedModels: false, mt: false, gpuRenderer: true, dynamicResolution: false, debugTimings: false, fpsCounter: false,
  trafficLogic: false, surfaceSheen: false, lampPitch: false, afs: false, corneringLamps: false, mountainPass: false,
};
const H = { oncoming: true, preceding: true, trafficBeams: true };      // traffic with its beam-producing lamps
const MAXED = { wet: true, wetSheen: true, wetModel: 'ggx', glare: 'rain', detailedModels: true, leafyFoliage: true, veg: true,
  density: 3, visibility: 3000, air: 'high', trafficHalo: 16, ...H, trafficDensity: 3, surfaceSheen: true, lampPitch: true, afs: true, corneringLamps: true };
const HALO = { visibility: 3000, ...H, trafficDensity: 3 };              // halo needs haze (sigma > 0) and traffic beams

// The page side: applies a config, settles, finds a start distance for the car state, times the frames, optionally
// reads the breakdown. Self-contained (it is serialised into the page).
const measure = async ({ base, cfg, state, breakdown, pin, tableOnly }) => {
  globalThis.HALO_TABLE_ONLY = !!tableOnly;
  const sleepIn = (ms) => new Promise((r) => setTimeout(r, ms));
  const u = RF.UI, D = RF.DriveAnim, a = D._, V = a.V, S = a.S, o = u.dvOpts;
  const syncNow = () => {
    const ctx = V.three && typeof V.three.getContext === 'function' ? V.three.getContext() : (V.gl && V.gl.gl);
    if (ctx) { const px = new Uint8Array(4); ctx.bindFramebuffer(ctx.FRAMEBUFFER, null); ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); }
    else V.gl.sync();
    return ctx ? 'three-context' : 'V.gl.sync';
  };
  Object.assign(o, base, cfg);
  if (cfg.air) { Object.assign(o, RF.Drive.airLevelBundle(cfg.air)); if (o.visibility == null) o.visibility = 3000; }
  u.redrawSpec(); await sleepIn(2500);
  if (pin) V.pinSS = pin; else delete V.pinSS;   // SS test: pinSS 1 freezes the objects pass at 1 sample; default leaves ssNow() to decide
  for (let i = 0; i < 5; i++) a.frame();
  let pend = 0;
  for (let n = 0; n < 4000 && o.scatterMode === 'table' && o.scatter > 0 && globalThis.SD_SCATTER && globalThis.SD_SCATTER.pending > 0; n++) { a.frame(); pend++; }
  const L = +o.trafficLightRange || 150;
  const count = (d, t) => (V.src ? a.trafficCars(V.src, d, t).filter((c) => c.rel >= 0 && c.rel <= L).length : 0);
  const st = S(u), t = st.t, d0 = st.dist;
  const target = state === 'zero' ? 0 : state === 'one' ? 1 : state === 'four' ? 4 : null;
  let start = d0, share = null;
  if (target !== null) {
    let best = { d: d0, f: -1 };
    for (let s0 = 0; s0 < 3000; s0 += 2) {
      let hit = 0; for (let j = 1; j <= 150; j++) if (count(s0 + 0.23 * j, t) === target) hit++;
      const f = hit / 150; if (f > best.f) best = { d: s0, f }; if (f >= 0.999) break;
    }
    start = best.d; share = best.f;
  }
  const ms = [], counts = [];
  const sync = () => syncNow();
  let via = null;
  for (let j = 1; j <= 150; j++) {
    st.dist = start + 0.23 * j;
    if (j <= 30) { a.frame(); via = sync(); continue; }
    const c = count(st.dist, st.t);
    const t0 = performance.now(); a.frame(); sync(); ms.push(performance.now() - t0); counts.push(c);
  }
  st.dist = d0;
  const sorted = ms.slice().sort((x, y) => x - y), n = sorted.length;
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95 = sorted[Math.min(n - 1, Math.floor(0.95 * (n - 1)))];
  const hist = {}; counts.forEach((c) => { hist[c] = (hist[c] || 0) + 1; });
  const stats = D.stats();
  const res = {
    renderer: stats.renderer, gpuFailure: stats.gpuFailure || '', syncVia: via, pendingTableFrames: pend,
    canvasPx: V.canvas.width + 'x' + V.canvas.height, drivePx: V.p ? V.p.w + 'x' + V.p.h : null,
    n, medianMs: med, p95Ms: p95, meanMs: ms.reduce((x, y) => x + y, 0) / n,
    carsTarget: state || null, carsShare: share, carsHist: hist, carsMin: Math.min(...counts), carsMax: Math.max(...counts),
    startDist: start, lightRange: L, tableFill: pend, ssStat: stats.ss, pinSS: V.pinSS || null, viewport: innerWidth + 'x' + innerHeight, sceneCfg: o.scene,
  };
  if (breakdown) {
    o.debugTimings = true; u.redrawSpec(); await sleepIn(2500);
    for (let i = 0; i < 60; i++) { st.dist = start + 0.23 * (200 + i); a.frame(); sync(); }
    const bm = D.stats().breakdownMean || {};
    const comp = {}; for (const [k, v] of Object.entries(bm.components || {})) comp[k] = +(+v.ms).toFixed(3);
    res.breakdownMs = comp; res.breakdownFrameMs = bm.frameMs != null ? +(+bm.frameMs).toFixed(3) : null;
    res.breakdownRaw = JSON.stringify(bm).slice(0, 2500);
    o.debugTimings = false; u.redrawSpec(); await sleepIn(2500);
    st.dist = d0;
  }
  return res;
};

const CONFIGS = [];
// Car state sets the traffic density too: a 150 m window at density 3 never had zero cars in the scan (see the notes),
// so zero uses 0.5 cars per 300 m per lane, one uses 1, four uses 3. The state's density wins over the config's.
const STATE_DENSITY = { zero: 0.5, one: 1, four: 3 };
const add = (id, group, cfg, state, extra) => CONFIGS.push(Object.assign({ id, group, cfg: state ? { ...cfg, trafficDensity: STATE_DENSITY[state] } : cfg, state: state || null }, extra || {}));
if (SET === 'ss') {
  // SS test: sim width <= 1100 so ssNow() is not forced to 1. Each scene/state run twice: pinSS 1, and the default (2).
  const SS_CASES = [['F-maxed-nocar', { ...MAXED, scene: 'forest' }, 'zero'], ['R-maxed-onecar', { ...MAXED, scene: 'road' }, 'one']];
  for (const [id, cfg, state] of SS_CASES) {
    add('SS1-' + id, 'ss', { ...cfg }, state, { pin: 1 });
    add('SSdef-' + id, 'ss', { ...cfg }, state, { pin: null });
  }
} else if (SET === 'road') {
  add('B0', 'base', {});
  add('haze', 'air', { visibility: 3000 });
  add('glare-rain', 'glare', { glare: 'rain' });
  add('detailedModels', 'objects', { detailedModels: true });
  add('veg-only', 'objects', { veg: true });
  add('leafyFoliage', 'objects', { veg: true, leafyFoliage: true });
  add('density-1.5', 'objects', { density: 1.5 });
  add('density-3', 'objects', { density: 3 });
  for (const lv of ['baseline', 'low', 'medium', 'high', 'max']) add('air-' + lv, 'air', { air: lv });
  add('traffic-cars-only', 'traffic', { oncoming: true, preceding: true, trafficDensity: 1 });
  add('traffic-beams-low', 'traffic', { ...H, trafficDensity: 0.5 });
  add('traffic-beams-high', 'traffic', { ...H, trafficDensity: 3 });
  for (const s of ['zero', 'one', 'four']) {
    add('halo0-' + s, 'halo', { ...HALO, trafficHalo: 0 }, s);
    add('halo4-' + s, 'halo', { ...HALO, trafficHalo: 4 }, s);
    add('halo16-' + s, 'halo', { ...HALO, trafficHalo: 16 }, s);
  }
  for (const s of ['zero', 'one', 'four']) add('MAXED-' + s, 'maxed', MAXED, s, { breakdown: true });
  add('B0-end', 'base', {});
} else if (SET === 'forest') {
  add('F-B0', 'base', {});
  add('F-haze', 'air', { visibility: 3000 });
  add('F-glare-rain', 'glare', { glare: 'rain' });
  add('F-leafyFoliage', 'objects', { veg: true, leafyFoliage: true });
  add('F-density-3', 'objects', { density: 3 });
  add('F-air-high', 'air', { air: 'high' });
  add('F-traffic-beams-high', 'traffic', { ...H, trafficDensity: 3 });
  for (const s of ['zero', 'one', 'four']) {
    add('F-halo0-' + s, 'halo', { ...HALO, trafficHalo: 0 }, s);
    add('F-halo4-' + s, 'halo', { ...HALO, trafficHalo: 4 }, s);
    add('F-halo16-' + s, 'halo', { ...HALO, trafficHalo: 16 }, s);
  }
  for (const s of ['zero', 'one', 'four']) add('F-MAXED-' + s, 'maxed', MAXED, s, { breakdown: true });
  add('F-B0-end', 'base', {});
}

// REVERSE=1 runs the list back to front (a second pass in the other order); the first and last rows are both B0 (drift check).
if (SET === 'ab' || SET === 'ab2') {
  // HALO-AB: road, haze 3000, oncoming + preceding traffic with beams, generic wide oncoming beam, three cars: one or four in range.
  const AB = { ...HALO, onMode: 'generic' };
  for (const s of ['one', 'four']) {
    add('off-' + s, 'ab', { ...AB, trafficHalo: 0 }, s);
    for (const n of [4, 16]) {
      if (SET === 'ab') add('tbl' + n + '-' + s, 'ab', { ...AB, trafficHalo: n }, s, { tableOnly: true });
      add('halo' + n + '-' + s, SET, { ...AB, trafficHalo: n }, s);
    }
  }
}
if (process.env.REVERSE) CONFIGS.reverse();

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const emit = (row) => fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  try {
    const page = await (await browser.newContext({ viewport: { width: +process.env.VW || 1444, height: +process.env.VH || 812 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html' + (process.env.HALOBINS ? '?halobins=' + process.env.HALOBINS : ''));
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => UX2Page.ready());
    await sleep(1500);
    // the owner's reference size is the large Drive view (full window); the inline pane is too small to measure
    const popped = await page.evaluate(async () => {
      const b = document.querySelector('[data-anim="popout"]');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
      for (let i = 0; i < 50 && !RF.DriveAnim._.S(RF.UI).popout; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500));
      return { popout: !!RF.DriveAnim._.S(RF.UI).popout, canvasPx: RF.DriveAnim._.V.canvas.width + 'x' + RF.DriveAnim._.V.canvas.height };
    });
    log('large view:', JSON.stringify(popped));
    const env = await page.evaluate(() => {
      const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
      const e = g && g.getExtension('WEBGL_debug_renderer_info');
      const drive = RF.DriveAnim._.V.three && RF.DriveAnim._.V.three.getContext ? RF.DriveAnim._.V.three.getContext() : null;
      const e2 = drive && drive.getExtension('WEBGL_debug_renderer_info');
      return { unmaskedFresh: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null, unmaskedDriveCanvas: e2 ? drive.getParameter(e2.UNMASKED_RENDERER_WEBGL) : null, ua: navigator.userAgent, viewport: [innerWidth, innerHeight] };
    });
    log('UNMASKED_RENDERER_WEBGL (fresh context):', env.unmaskedFresh);
    log('UNMASKED_RENDERER_WEBGL (drive canvas):', env.unmaskedDriveCanvas);
    const haloN = await page.evaluate(async () => (await import('/js/drive-three-shaders.js')).HALO_N);
    log('HALO_N (bins in use):', haloN);
    emit({ type: 'env', set: SET, port, popped, haloN, ...env, startedAt: new Date().toISOString() });
    for (const c of CONFIGS) {
      const t0 = Date.now();
      try {
        const r = await page.evaluate(measure, { base: B0, cfg: c.cfg, state: c.state, breakdown: !!c.breakdown, pin: c.pin || null, tableOnly: !!c.tableOnly });
        const row = { type: 'row', set: SET, id: c.id, group: c.group, state: c.state, cfg: c.cfg, ...r, wallS: (Date.now() - t0) / 1000 };
        emit(row);
        log(c.id.padEnd(20), 'med', r.medianMs.toFixed(2), 'p95', r.p95Ms.toFixed(2), 'px', r.canvasPx, r.renderer, 'cars', r.carsMin + '-' + r.carsMax, 'share', r.carsShare);
      } catch (e) {
        emit({ type: 'error', set: SET, id: c.id, error: String(e).slice(0, 500) });
        log('FAILED', c.id, String(e).slice(0, 200));
      }
    }
    emit({ type: 'end', set: SET, pageErrors: errors.slice(0, 20), endedAt: new Date().toISOString() });
    log('done; page errors:', errors.length);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
