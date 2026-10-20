// SD page checks: the air-beam scatter table on the GPU drive renderer (look.scatterMode 'table'), next to the direct in-scatter.
// Run (worktree): python3 tests/serve.py 8991  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SD-scatter-table.js 8991
// Direct mode must hash to the main baseline (DIRECT16, captured on main 0f47b41 with the same recipe). Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8991);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIRECT16 = process.env.SD_DIRECT16 || 'f7eba2f98a72dbcc4cf058c7b164699108772cf3fad4034411c4d59f915b5d9d';
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
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    // one frame with the given options: fog 200, the beam at 16 scatter steps (direct) or the table's 48 steps
    const frame = async (label, opts) => {
      await page.evaluate((o) => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: 200, scatter: 16, scatterMode: 'direct', scatterRes: undefined, scatterBlur: 'off', scatterTableSteps: undefined, ...o }); RF.UI.redrawSpec(); }, opts);
      await sleep(2500);
      const st = await page.evaluate(() => { const s = RF.DriveAnim.stats(); return { renderer: s.renderer, gpuFailure: s.gpuFailure || '' }; });
      await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1'));
      const png = await page.locator('canvas[data-sc-drive="1"]').screenshot();
      return { label, st, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) };
    };
    const direct = await frame('direct 16', { scatterMode: 'direct' });
    ok('SD GPU renderer is on (no GPU failure)', direct.st.renderer === 'three' && !direct.st.gpuFailure, JSON.stringify(direct.st));
    ok('SD direct mode: the frame equals the main baseline (DIRECT16)', direct.hash === DIRECT16, direct.hash.slice(0, 12));
    const table = await frame('table 48 half', { scatterMode: 'table', scatter: 48, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off' });
    ok('SD table mode renders on the GPU without failure', table.st.renderer === 'three' && !table.st.gpuFailure, JSON.stringify(table.st));
    ok('SD table frame differs from the direct frame', table.hash !== direct.hash, table.hash.slice(0, 12) + ' vs ' + direct.hash.slice(0, 12));
    ok('SD table vs direct near: mean luminance within 15 percent', Math.abs(table.luma / direct.luma - 1) < 0.15, 'direct ' + direct.luma.toFixed(3) + ' table ' + table.luma.toFixed(3));
    const blur = await frame('table 48 half blur mid', { scatterMode: 'table', scatter: 48, scatterTableSteps: 48, scatterBlur: 'mid' });
    ok('SD blur mid vs off: mean luminance within 5 percent', Math.abs(blur.luma / table.luma - 1) < 0.05, 'off ' + table.luma.toFixed(3) + ' mid ' + blur.luma.toFixed(3));
    const full = await frame('table 48 full', { scatterMode: 'table', scatter: 48, scatterTableSteps: 48, scatterRes: 'full', scatterBlur: 'off' });
    ok('SD full-res vs half-res: mean luminance within 10 percent', Math.abs(full.luma / table.luma - 1) < 0.1, 'half ' + table.luma.toFixed(3) + ' full ' + full.luma.toFixed(3));
    ok('SD no NaN or empty frames (mean luminance finite and above zero in every table frame)', [table, blur, full].every((f) => Number.isFinite(f.luma) && f.luma > 0));
    const back = await frame('direct 16 again', { scatterMode: 'direct' });
    ok('SD back to direct: the frame equals the baseline again', back.hash === DIRECT16, back.hash.slice(0, 12));
    ok('SD nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SD page run completed', false, String(e && e.stack || e).slice(0, 400)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SD page checks passed'); process.exitCode = fails ? 1 : 0;
})();
