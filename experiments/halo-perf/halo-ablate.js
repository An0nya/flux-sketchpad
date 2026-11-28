// Throwaway: load a flux-state save, then time frames and the halo table build with one halo feature changed at a time.
// node halo-ablate.js <port> <state.json> <out.jsonl>
const fs = require('fs');
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const [port, STATE, OUT] = [+process.argv[2], process.argv[3], process.argv[4]];
const NF = +(process.env.NF || 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VARIANTS = process.env.VARS ? JSON.parse(process.env.VARS) : [
  ['baseline', {}],
  ['halo off', { trafficHalo: 0 }],
  ['moment off', { haloMoment: 'off' }],
  ['crossingRefine off', { haloCrossingRefine: 0 }],
  ['refineNeighbour off', { haloRefineNeighbour: 'off' }],
  ['coneEqui off', { haloConeEqui: 'off' }],
  ['polar off', { haloPolar: 'off' }],
  ['conePass off', { haloConePass: 'off' }],
  ['jitter off', { haloJitter: 'off' }],
  ['blur off', { haloBlur: 'off', haloDepthBlur: 'off' }],
  ['crestOcclusion off', { crestOcclusion: 'off' }],
  ['shadows off', { trafficShadows: 'off' }],
  ['cull off', { scatterCull: 'off' }],
  ['all 4 newer off', { haloMoment: 'off', haloCrossingRefine: 0, haloRefineNeighbour: 'off', haloConeEqui: 'off' }],
];
(async () => {
  const browser = await pw.chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    await page.addInitScript('globalThis.SL_HALO_TIMING = 1;');
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    const cons = [], pend = new Set(); page.on('console', (m) => cons.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('request', (r) => pend.add(r.url())); page.on('requestfinished', (r) => pend.delete(r.url())); page.on('requestfailed', (r) => { pend.delete(r.url()); cons.push('FAILED ' + r.url() + ' ' + (r.failure() || {}).errorText); });
    // Test-only patch, served in place of js/drive-three.js (the file on disk is not changed):
    // SL_HALO_NOREAD: build the table, then switch the lookup off (frame = build, no read).
    // SL_HALO_FREEZE: build once, then keep reading that table without rebuilding (frame = read, no build).
    const ANCHOR = 'if (!p.airHold) halo.build(p, world, occ, sm); else {';
    await page.route('**/js/drive-three.js', async (route) => {
      const res = await route.fetch(); let src = await res.text();
      if (src.split(ANCHOR).length !== 2) throw Error('patch anchor not found exactly once');
      src = src.replace(ANCHOR, 'if (!p.airHold && globalThis.SL_HALO_FREEZE && halo._frozen) {} else if (!p.airHold) { halo.build(p, world, occ, sm); halo._frozen = 1; if (globalThis.SL_HALO_NOREAD) u.haloOn.value = 0; } else {');
      await route.fulfill({ response: res, body: src, headers: { ...res.headers(), 'content-type': 'text/javascript' } });
    });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    try { await page.waitForFunction(() => window.RF?.UI?.loadScene && window.RF?.DriveAnim, null, { timeout: 60000 }); }
    catch (e) { console.log('LOAD TIMEOUT. errors:', errs, '\nconsole:', cons.slice(-20), '\npending:', [...pend], '\nRF keys:', await page.evaluate(() => Object.keys(window.RF || {}))); throw e; }
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const dump = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const msg = await page.evaluate((d) => { const V = RF.DriveAnim._.V; return RF.DriveAnim.loadState(RF.UI, d, (ui, k, v) => V.setOwn(k, v)); }, dump);
    console.log('load:', msg);
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    await sleep(2000);
    if (process.env.CW) {   // force the canvas container to CW x CH css px, so the sim size matches a target device
      await page.evaluate(([w, h]) => { const p = RF.DriveAnim._.V.canvas.parentElement; for (const el of [p, p.closest('.canvas-wrap, .dp-stage')].filter(Boolean)) { el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.flex = 'none'; } dispatchEvent(new Event('resize')); }, [+process.env.CW, +process.env.CH]);
    }
    await sleep(3000);
    const info = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas, gl = c.getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?', w: c.width, h: c.height, stats: RF.DriveAnim.stats().renderer }; });
    console.log('env:', JSON.stringify(info));
    const base = dump.options;
    for (const [name, ch, glob] of VARIANTS) {
      await page.evaluate((g) => { delete globalThis.SL_HALO_NOREAD; delete globalThis.SL_HALO_FREEZE; const V = RF.DriveAnim._.V; Object.assign(globalThis, g || {}); }, glob || {});
      await page.evaluate(([b, ch]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(Object.assign({}, b, ch))) if (RF.UI.dvOpts[k] !== v) V.setOwn(k, v); V.setOwn('playing', false); }, [Object.fromEntries(Object.keys(ch).map((k) => [k, base[k]])), ch]);
      await sleep(2500);
      const r = await page.evaluate(async (NF) => {
        const A = RF.DriveAnim._, V = A.V, gl = V.canvas.getContext('webgl2'), px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const fr = [], hm = [], pm = [];
        for (let i = 0; i < NF + 5; i++) { sync(); const t0 = performance.now(); A.frame(); sync(); const ms = performance.now() - t0; const hs = V.three && V.three.haloState ? V.three.haloState() : null; if (i >= 5) { fr.push(ms); hm.push(hs && hs.on ? hs.ms : NaN); pm.push(hs && hs.on ? hs.msPolar : NaN); } await new Promise((r) => setTimeout(r, 5)); }
        const hs = V.three && V.three.haloState ? V.three.haloState() : {};
        const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
        return { frameMs: med(fr), haloMs: med(hm), polarMs: med(pm), canvas: [V.canvas.width, V.canvas.height], passes: hs.passes, lamps: hs.lamps && hs.lamps.length, tab: hs.tab, bins: hs.bins, polars: hs.polars, on: hs.on };
      }, NF);
      const row = { name, ch, ...r };
      console.log(JSON.stringify(row));
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
      await page.evaluate((b) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(b)) V.setOwn(k, v); }, Object.fromEntries(Object.keys(ch).map((k) => [k, base[k]])));
    }
    if (errs.length) console.log('page errors:', errs.slice(0, 5));
  } finally { await browser.close(); }
})();
