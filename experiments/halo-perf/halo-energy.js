// Throwaway: does the polar setting change how much halo light reaches the screen? It should not (it changes how the glow is stored).
// For each variant: HDR frame with the halo on minus the same frame with the halo off = the halo's own light. Sum its luminance over
// the whole frame, the bottom half (roadway) and the top half. Same pose, paused. Mac, ANGLE Metal.
// node halo-energy.js <port> <state.json> <out.jsonl>     env: CW CH (canvas size), VARS (JSON list of [name, {opts}])
const fs = require('fs');
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const [port, STATE, OUT] = [+process.argv[2], process.argv[3], process.argv[4]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VARIANTS = process.env.VARS ? JSON.parse(process.env.VARS) : [
  ['polar off', { haloPolar: 'off' }],
  ['auto 64x16', { haloPolar: 'auto', haloPolarBand: '64x16' }],
  ['auto 128x32', { haloPolar: 'auto', haloPolarBand: '128x32' }],
  ['auto 512x64', { haloPolar: 'auto', haloPolarBand: '512x64' }],
  ['per lamp', { haloPolar: 'perlamp' }],
  ['merged', { haloPolar: 'merged' }],
  ['polar off again', { haloPolar: 'off' }],
];
setTimeout(() => { console.log('watchdog: 10 min'); process.exit(1); }, 600000).unref();
(async () => {
  const browser = await pw.chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene && window.RF?.DriveAnim, null, { timeout: 90000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const dump = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log('load:', await page.evaluate((d) => { const V = RF.DriveAnim._.V; return RF.DriveAnim.loadState(RF.UI, d, (ui, k, v) => V.setOwn(k, v)); }, dump));
    await sleep(2000);
    if (process.env.CW) await page.evaluate(([w, h]) => { const p = RF.DriveAnim._.V.canvas.parentElement; for (const el of [p, p.closest('.canvas-wrap, .dp-stage')].filter(Boolean)) { el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.flex = 'none'; } dispatchEvent(new Event('resize')); }, [+process.env.CW, +process.env.CH]);
    await sleep(3000);
    const set = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); V.setOwn('playing', false); }, o);
    // render a few frames, then the HDR sim image; returns luminance sums of (on - off) per region
    const grab = () => page.evaluate(async () => { const A = RF.DriveAnim._; for (let i = 0; i < 4; i++) { A.frame(); await new Promise((r) => setTimeout(r, 30)); } const a = A.readHdr(); return Array.from(a); });
    for (const [name, ch] of VARIANTS) {
      await set(Object.assign({ trafficHalo: dump.options.trafficHalo || 16 }, ch)); await sleep(1500);
      const on = await grab();
      await set({ trafficHalo: 0 }); await sleep(1200);
      const off = await grab();
      const info = await page.evaluate(() => { const V = RF.DriveAnim._.V, s = V.three.haloState(); return { w: V.p.w, h: V.p.h, polars: s.polars, polarNote: s.polarNote || null, lamps: s.lamps && s.lamps.length }; });
      const W = info.w, H = info.h; let all = 0, top = 0, bot = 0, neg = 0, offTop = 0, offBot = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i0 = 4 * (y * W + x), l0 = 0.2126 * off[i0] + 0.7152 * off[i0 + 1] + 0.0722 * off[i0 + 2]; if (y < H / 2) offTop += l0; else offBot += l0; }
      info.orientation = { offTop, offBot };   // control for row order: the lit road (bottom of the picture) should be the brighter half of the halo-off frame
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 4 * (y * W + x), d = 0.2126 * (on[i] - off[i]) + 0.7152 * (on[i + 1] - off[i + 1]) + 0.0722 * (on[i + 2] - off[i + 2]); all += d; if (d < 0) neg += d; if (y < H / 2) top += d; else bot += d; }   // readHdr: row 0 = top
      const row = { name, ch, w: W, h: H, all, top, bottom: bot, negative: neg, orientation: info.orientation, polars: info.polars, lamps: info.lamps };
      console.log(JSON.stringify(row)); fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    }
    if (errs.length) console.log('page errors:', errs.slice(0, 3));
  } finally { await browser.close(); }
})();
