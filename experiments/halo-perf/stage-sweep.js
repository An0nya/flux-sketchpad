// Throwaway: load a flux-state save, then run "Time this frame" (GST2) with one feature changed at a time, plus objectWork().
// node stage-sweep.js <port> <state.json> <out.jsonl>     env: CW/CH (canvas css px), VARS (JSON list of [name, {opts}])
const fs = require('fs');
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const [port, STATE, OUT] = [+process.argv[2], process.argv[3], process.argv[4]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VARIANTS = process.env.VARS ? JSON.parse(process.env.VARS) : [
  ['baseline', {}],
  ['halo off', { trafficHalo: 0 }],
  ['traffic beams off', { trafficBeams: false }],
  ['crest+shadows off', { crestOcclusion: 'off', trafficShadows: 'off' }],
  ['sheen off', { surfaceSheen: false }],
  ['lampPitch off', { lampPitch: false }],
  ['leafy off', { leafyFoliage: false }],
  ['models off', { detailedModels: false }],
  ['signs off', { signs: false }],
  ['SS2', { samples: '2' }],
  ['baseline again', {}],
];
(async () => {
  const browser = await pw.chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'].concat(process.env.UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []) });
  const errs = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene && window.RF?.DriveAnim, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const dump = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    dump.options = Object.assign({}, dump.options, { debugTimings: true, gpuStages: true, gpuRenderer: true, dynamicResolution: false, qualityGovernor: 'off' });
    const msg = await page.evaluate((d) => { const V = RF.DriveAnim._.V; return RF.DriveAnim.loadState(RF.UI, d, (ui, k, v) => V.setOwn(k, v)); }, dump);
    console.log('load:', msg);
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    await sleep(2000);
    if (process.env.CW) await page.evaluate(([w, h]) => { const p = RF.DriveAnim._.V.canvas.parentElement; for (const el of [p, p.closest('.canvas-wrap, .dp-stage')].filter(Boolean)) { el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.flex = 'none'; } dispatchEvent(new Event('resize')); }, [+process.env.CW, +process.env.CH]);
    await sleep(3000);
    const info = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas, gl = c.getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?', w: c.width, h: c.height, stats: RF.DriveAnim.stats().renderer }; });
    console.log('env:', JSON.stringify(info));
    if (process.env.CW && (info.w < 0.9 * +process.env.CW || !(+process.env.CH > 0))) throw Error('canvas is ' + info.w + 'x' + info.h + ', asked for CW=' + process.env.CW + ' CH=' + process.env.CH);
    const base = dump.options;
    for (const [name, ch] of VARIANTS) {
      const undo = Object.fromEntries(Object.keys(ch).map((k) => [k, base[k]]));
      await page.evaluate((ch) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(ch)) if (RF.UI.dvOpts[k] !== v) V.setOwn(k, v); }, ch);
      await sleep(2500);   // let shaders compile and caches settle
      const r = await page.evaluate(async () => {
        const A = RF.DriveAnim._, V = A.V;
        const ring = await A.timeFrame();
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const names = []; for (const q of ring || []) for (const n of q.order) if (!names.includes(n)) names.push(n);
        const stages = Object.fromEntries(names.map((n) => [n, +mean(ring.map((q) => q.ms[n] || 0)).toFixed(2)]));
        const ss = +(RF.UI.dvOpts.samples) || 1;
        let work = null; try { work = V.three.objectWork(V.p, ss); } catch (e) { work = { err: String(e) }; }
        return { kept: ring ? ring.length : 0, probe: ring && ring.length ? +mean(ring.map((q) => q.total)).toFixed(2) : null, stages, real: V.timeRun && V.timeRun.real, work, canvas: [V.canvas.width, V.canvas.height], text: A.timeText ? null : null };
      });
      const row = { save: STATE.split('/').pop(), name, ch, ...r };
      console.log(JSON.stringify(row));
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
      await page.evaluate((b) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(b)) V.setOwn(k, v); }, undo);
    }
  } finally { if (errs.length) console.log('page errors:', errs.slice(0, 5)); await browser.close(); }
})();
