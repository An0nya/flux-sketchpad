// SF page checks: near-fade range button (cycle, table rebuild), scatter gain slider (lookup only, no rebuild, luminance effect),
// old saved scatterNearFade options load. GPU drive renderer, table mode. SF1 (object pixels) is not in this file yet.
// Run (worktree): python3 tests/serve.py 8994 & then PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SF-silhouette-fade.js 8994
// Exits 1 on any failure. Timings are SOFTWARE GL (headless SwiftShader), not the owner's phone.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8994);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
async function meanLuma(page, png) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (Number.isFinite(v)) { s += v; n++; } } return s / n;
  }, png.toString('base64'));
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const load = async () => { await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 }); await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500); };
    await load();
    const setOpts = async (o, wait = 1200) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(wait); };
    // step frames until the table is complete (fraction 1), so a snapshot shows a finished table
    const settle = () => page.evaluate(() => { let n = 0; while (globalThis.SD_SCATTER.fraction < 1 && n < 600) { RF.DriveAnim._.frame(); n++; } return n; });
    const snap = async (label) => { await settle(); await page.evaluate(() => RF.UI.redrawSpec()); await sleep(1200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sf-drive', '1')); const png = await page.locator('canvas[data-sf-drive="1"]').screenshot(); return { label, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) }; };
    const recomputes = () => page.evaluate(() => globalThis.SD_SCATTER.recomputes);
    // DD: near fade is a select now; stepFade moves it to the next option (what a click on the old button did).
    const stepFade = () => page.evaluate(() => { const s = document.querySelector('[data-dv="scatterNearFadeRange"]'); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); });
    const btnText = (k) => page.evaluate((key) => { const b = document.querySelector('[data-dv="' + key + '"]'); return b.tagName === 'SELECT' ? b.options[b.selectedIndex].textContent : b.textContent; }, k);
    const base = { visibility: 60, wet: false, wetness: 0, wetSheen: false, fpsCounter: false, scatterMode: 'table', scatter: 64, scatterTableSteps: 64, scatterRes: 'half', scatterBlur: 'off', scatterCache: 'on', scatterCycle: 0, scatterNearFade: 'on', scatterNearFadeRange: 'medium', scatterGain: 1, afs: false, lampPitch: false, corneringLamps: false };
    await setOpts(base, 1500);

    // 1. the range button cycles off, short, medium, long and each range changes the frame
    await setOpts({ scatterNearFadeRange: 'off' }, 800);
    const seq = [];
    seq.push(await snap('off'));
    const rebuild0 = await recomputes();
    for (const want of ['short', 'medium', 'long']) {
      await stepFade(); await sleep(600);
      const r =await page.evaluate(() => RF.UI.dvOpts.scatterNearFadeRange);
      ok('SF button: cycle reaches ' + want, r === want, 'dvOpts ' + r);
      seq.push(await snap(want));
    }
    await stepFade(); await sleep(600);
    ok('SF button: cycle wraps back to off', (await page.evaluate(() => RF.UI.dvOpts.scatterNearFadeRange)) === 'off');
    ok('SF button: label names the range', /beam near fade: off/.test(await btnText('scatterNearFadeRange')), await btnText('scatterNearFadeRange'));
    const rebuild1 = await recomputes();
    ok('SF cache: changing the fade range rebuilds the table (recomputes rise)', rebuild1 > rebuild0, rebuild0 + ' -> ' + rebuild1);
    const distinct = seq.every((s, i) => i === 0 || s.hash !== seq[i - 1].hash);
    ok('SF fade: each range step changes the frame (consecutive hashes differ)', distinct, seq.map((s) => s.label + ' ' + s.luma.toFixed(2)).join(', '));

    // 2. the gain slider scales the lookup (luma), never rebuilds the table
    await setOpts({ scatterNearFadeRange: 'medium', scatterGain: 1 }, 800);
    const slider = () => page.evaluate(() => { const s = document.querySelector('[data-anim="scatter-gain"]'); return s ? { value: s.value, exists: true } : { exists: false }; });
    const sl = await slider();
    ok('SF gain: the gain slider exists on the drive bar', sl.exists, JSON.stringify(sl));
    const setGain = async (g) => { await page.evaluate((v) => { const s = document.querySelector('[data-anim="scatter-gain"]'); s.value = String(v); s.dispatchEvent(new Event('change')); }, Math.log2(g)); await sleep(800); };
    const g1 = await snap('gain 1');
    const r1 = await recomputes();
    await setGain(0.5); const gHalf = await snap('gain 0.5');
    await setGain(2); const gTwo = await snap('gain 2');
    const r2 = await recomputes();
    ok('SF gain: changing the gain does not rebuild the table (recomputes unchanged)', r2 === r1, r1 + ' -> ' + r2);
    ok('SF gain: the gain is stored in dvOpts', (await page.evaluate(() => RF.UI.dvOpts.scatterGain)) === 2);
    ok('SF gain: luminance rises with gain (0.5 < 1 < 2)', gHalf.luma < g1.luma && g1.luma < gTwo.luma, gHalf.luma.toFixed(2) + ' < ' + g1.luma.toFixed(2) + ' < ' + gTwo.luma.toFixed(2));
    // linear light: the HDR readback (the P1 readback, before tone map). Scatter part = frame minus the air-off frame, same pose.
    const hdrMean = () => page.evaluate(() => { RF.DriveAnim._.frame(); const a = RF.DriveAnim._.readHdr(); let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; });
    await setGain(1); const h1 = await hdrMean();
    await setGain(0.5); const h05 = await hdrMean();
    await setGain(2); const h2 = await hdrMean();
    await setOpts({ scatter: 0 }, 800); const hOff = await hdrMean();
    await setOpts({ scatter: 64, scatterGain: 1 }, 800);
    const sHalf = (h05 - hOff) / (h1 - hOff), sTwo = (h2 - hOff) / (h1 - hOff);
    ok("SF gain: scatter part scales by the gain in linear light (0.5 and 2, within 10 percent)", Math.abs(sHalf - 0.5) <= 0.05 && Math.abs(sTwo - 2) <= 0.2, "HDR mean air-off " + hOff.toFixed(4) + ", gain 1 " + h1.toFixed(4) + ", gain 0.5 ratio " + sHalf.toFixed(3) + ", gain 2 ratio " + sTwo.toFixed(3));

    // 3. old saved options load: a saved scatterNearFade 'off' becomes range off
    await page.evaluate(() => localStorage.setItem('flux/driveView', JSON.stringify({ scatterNearFade: 'off', scatterMode: 'table', visibility: 60, scatter: 64 })));
    await load();
    const old = await page.evaluate(() => ({ range: RF.UI.dvOpts.scatterNearFadeRange, gain: RF.UI.dvOpts.scatterGain }));
    ok('SF saved options: scatterNearFade off loads as range off, gain defaults to 1', old.range === 'off' && old.gain === 1, JSON.stringify(old));
    await page.evaluate(() => localStorage.removeItem('flux/driveView'));

    ok('SF nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SF page run completed', false, String(e && e.stack || e).slice(0, 500)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SF page checks passed'); process.exitCode = fails ? 1 : 0;
})();
