// SM: beam cycle by distance travelled, with the cycle blend (scatterCycleFade 'on' crossfades two adjacent versions).
// Run:  python3 tests/serve.py <port> & echo $! > <pidfile>
//       PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SM-cycle-distance.js <port>
// Headless Chromium on SOFTWARE GL: every number here is a headless number, not the owner's GPU or phone.
// Time is faked (performance.now) so each frame is exactly 1/30 s or 0.5 s apart; the frame difference is the mean absolute
// per-channel difference of the two screenshots (0-255 scale).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    // Fake clock: real time until __fakeNow is set. The drive reads dt from performance.now, so frames are exact.
    await page.evaluate(() => { const real = performance.now.bind(performance); window.__fakeNow = null; performance.now = () => (window.__fakeNow == null ? real() : window.__fakeNow); });
    // In-page: decode a PNG (base64) to pixels and keep it; mean absolute difference between two kept frames.
    await page.evaluate(() => {
      window.__frames = [];
      window.__push = async (b64) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); window.__frames.push(g.getImageData(0, 0, c.width, c.height).data); };
      window.__mads = () => { const F = window.__frames, out = []; for (let i = 1; i < F.length; i++) { const A = F[i - 1], B = F[i]; let s = 0; for (let k = 0; k < A.length; k += 4) s += Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]); out.push(s / (A.length / 4 * 3)); } return out; };
    });
    const setOpts = async (o) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(1500); };
    const base = { visibility: 200, scatterMode: 'table', scatter: 16, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', afs: false, lampPitch: false, corneringLamps: false, scatterCache: 'on', scatterCycle: 8, scatterCycleFade: 'on', scatterNearFadeRange: 'off' };
    // One frame: advance the fake clock dtMs and the car dMetres, draw, keep the screenshot's pixels.
    const frame = async (dtMs, dMetres) => {
      await page.evaluate(([dt, dm]) => { window.__fakeNow += dt; const s = RF.DriveAnim._.S(RF.UI); s.dist += dm; RF.DriveAnim._.frame(); }, [dtMs, dMetres]);
      await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sm-frame', '1'));
      const png = await page.locator('canvas[data-sm-frame="1"]').screenshot();
      await page.evaluate((b64) => window.__push(b64), png.toString('base64'));
    };
    const seq = async (kmh, dtMs, n) => { await page.evaluate(() => { window.__frames = []; }); for (let i = 0; i < n; i++) await frame(i === 0 ? 0 : dtMs, (kmh / 3.6) * (i === 0 ? 0 : dtMs) / 1000); return page.evaluate(() => window.__mads()); };
    const counters = () => page.evaluate(() => ({ ...globalThis.SD_SCATTER }));

    // 1. fill the eight versions at standstill (the fill is one band per frame, paced by the cost of the table)
    await page.evaluate(() => { window.__fakeNow = 0; });
    await setOpts(base);
    for (let i = 0; i < 300; i++) { await frame(33.333, 0); if ((await counters()).valid === 8) break; }
    const c8 = await counters();
    ok('SM fill: eight versions valid with the cycle on and the blend on', c8.valid === 8 && c8.cycle === 8, 'valid ' + c8.valid + ' cycle ' + c8.cycle);
    ok('SM badge: shows the phase with the cycle on', /phase \d/.test(c8.badge || ''), JSON.stringify(c8.badge));

    // 2. standstill, blend on: 1/30 s frames versus frames 0.5 s apart
    const still = await seq(0, 1000 / 30, 6);
    await frame(500, 0);
    const stillAll = await page.evaluate(() => window.__mads());
    const short = avg(stillAll.slice(0, 5)), long = stillAll[5];
    ok('SM standstill, blend on: 1/30 s frame difference is much smaller than 0.5 s apart', short < 0.5 * long, 'mean 1/30 s ' + short.toFixed(3) + ', 0.5 s ' + long.toFixed(3) + ' (0-255 mean abs)');

    // 3. 20 versus 80 km/h, blend on, 1/30 s apart
    const m20 = avg(await seq(20, 1000 / 30, 7));
    const m80 = avg(await seq(80, 1000 / 30, 7));
    ok('SM speed, blend on: frame difference at 20 km/h is smaller than at 80 km/h (1/30 s apart)', m20 < m80, '20 km/h ' + m20.toFixed(3) + ', 80 km/h ' + m80.toFixed(3));

    // 4. owner's question: 50 km/h, blend off versus on (numbers reported, not asserted)
    const m50on = avg(await seq(50, 1000 / 30, 7));
    await setOpts({ scatterCycleFade: 'off' });
    const m50off = avg(await seq(50, 1000 / 30, 7));
    console.log('[info] 50 km/h, 1/30 s apart (headless, software GL): blend off (hard switch) ' + m50off.toFixed(3) + ', blend on (crossfade) ' + m50on.toFixed(3));
    ok('SM blend off at 50 km/h: the frame difference is measured (hard switch steps)', Number.isFinite(m50off), 'off ' + m50off.toFixed(3));
    await setOpts({ scatterCycleFade: 'on' });

    // 5. cycle off with the cache on: one table, so two frames at one pose and one time are identical
    await setOpts({ scatterCycle: 0, scatterCycleFade: 'off' });
    await page.evaluate(() => { window.__fakeNow += 0; });
    await page.evaluate(() => { window.__frames = []; });
    await frame(0, 0); await frame(0, 0);
    const offMad = await page.evaluate(() => window.__mads()[0]);
    ok('SM cycle off (cache on): two frames at one pose and time are identical', offMad === 0, 'mean ' + offMad);

    // 6. nothing threw, no GPU failure
    const st = await page.evaluate(() => { const s = RF.DriveAnim.stats(); return { renderer: s.renderer, gpuFailure: s.gpuFailure || '' }; });
    ok('SM nothing throws and no GPU failure', errors.length === 0 && st.renderer === 'three' && !st.gpuFailure, JSON.stringify(st) + ' errors ' + errors.length + (errors.length ? ' ' + errors[0] : ''));
  } catch (e) { ok('SM run completes', false, String(e && e.stack || e).slice(0, 400)); }
  finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all SM cycle-distance checks passed'); process.exitCode = fails ? 1 : 0;
})();
