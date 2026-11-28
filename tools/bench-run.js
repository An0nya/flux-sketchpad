// Run the drive Benchmark headless on this Mac (same code and file format as the button) and save the results file.
// python3 tests/serve.py <port>, then: node tools/bench-run.js <port> [out.json]    env: CW/CH canvas css px (default 856x482)
// Real frames are uncapped (--disable-frame-rate-limit), so they measure the GPU, not the 60 Hz headless display.
const fs = require('fs'), pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8979), OUT = process.argv[3], CW = +(process.env.CW || 856), CH = +(process.env.CH || 482);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await pw.chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  try {
    const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene && window.RF?.DriveAnim && window.RF?.DriveBench, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries({ gpuRenderer: true, debugTimings: true, gpuStages: true })) V.setOwn(k, v); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three', null, { timeout: 120000 });
    await page.evaluate(([w, h]) => { const p = RF.DriveAnim._.V.canvas.parentElement; for (const el of [p, p.closest('.canvas-wrap, .dp-stage')].filter(Boolean)) { el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.flex = 'none'; } dispatchEvent(new Event('resize')); }, [CW, CH]);
    await sleep(2000);
    const size = await page.evaluate(() => [RF.DriveAnim._.V.canvas.width, RF.DriveAnim._.V.canvas.height]);
    if (size[0] < 0.9 * CW) throw Error('canvas is ' + size + ', asked for ' + CW + 'x' + CH);
    const cfg = process.env.QUICK ? { real: 16, realWarm: 4, stages: 8, stageWarm: 2, settleLoad: 1500, settleToggle: 800 } : {};
    const t = setInterval(() => page.evaluate(() => RF.DriveBench.text()).then((x) => console.log(x)).catch(() => {}), 10000);
    const out = await page.evaluate((c) => RF.DriveBench.run(c), cfg); clearInterval(t);
    const name = OUT || ('flux-bench-mac-' + out.started.replace(/[:.]/g, '-').slice(0, 19) + '.json');
    fs.writeFileSync(name, JSON.stringify(out, null, 1)); console.log('wrote ' + name + (out.error ? ' · ERROR ' + out.error : '') + (errs.length ? ' · page errors: ' + errs.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); }
})();
