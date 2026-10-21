// NE page checks: near-eye sample placement (look.scatterNearBias) on the GPU drive renderer, table mode, fog 200.
// Run (worktree): python3 tests/serve.py 8993  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/NE-near-eye.js 8993
// Off must be byte-identical to main: the direct frame equals the SD DIRECT16 baseline, and the table-off frame equals NE_TABLE48_MAIN
// when that env var is set (capture it by running this file against a main checkout; it prints NE_TABLE48_OFF=<hash>).
// Headless Chrome uses software GL: frames and timings here are not the owner's GPU. Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8993);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIRECT16 = process.env.SD_DIRECT16 || 'f7eba2f98a72dbcc4cf058c7b164699108772cf3fad4034411c4d59f915b5d9d';
const TABLE48_MAIN = process.env.NE_TABLE48_MAIN || '';
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
    // one frame: fog 200 with the given options (same recipe as SD-scatter-table, so the direct frame is comparable to DIRECT16)
    const settle = () => page.evaluate(() => { let n = 0; while (RF.UI.dvOpts.scatterMode === 'table' && globalThis.SD_SCATTER.cache && globalThis.SD_SCATTER.pending > 0 && n < 4000) { RF.DriveAnim._.frame(); n++; } return n; });
    const frame = async (label, opts) => {
      await page.evaluate((o) => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: 200, scatter: 16, scatterMode: 'direct', scatterRes: undefined, scatterBlur: 'off', scatterTableSteps: undefined, scatterNearFadeRange: 'medium', scatterNearBias: 0, ...o }); RF.UI.redrawSpec(); }, opts);
      await sleep(2500); await settle();
      const st = await page.evaluate(() => { const s = RF.DriveAnim.stats(); return { renderer: s.renderer, gpuFailure: s.gpuFailure || '' }; });
      await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1'));
      const png = await page.locator('canvas[data-sc-drive="1"]').screenshot();
      return { label, st, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) };
    };
    const direct = await frame('direct 16', { scatterMode: 'direct' });
    ok('NE GPU renderer is on (no GPU failure)', direct.st.renderer === 'three' && !direct.st.gpuFailure, JSON.stringify(direct.st));
    ok('NE direct mode: the frame equals the SD DIRECT16 baseline', direct.hash === DIRECT16, direct.hash.slice(0, 12));
    const sel = () => page.evaluate(() => { const s = document.querySelector('[data-dv="scatterNearBias"]'); return s ? { tag: s.tagName, hidden: s.hidden, values: [...s.options].map((o) => o.value) } : null; });
    const selDirect = await sel();
    ok('NE select: scatterNearBias is a SELECT with values 0 and 1', !!selDirect && selDirect.tag === 'SELECT' && JSON.stringify(selDirect.values) === '["0","1"]', JSON.stringify(selDirect));
    ok('NE select: hidden in direct mode', !!selDirect && selDirect.hidden === true, JSON.stringify(selDirect));
    const off = await frame('table 48 bias off', { scatterMode: 'table', scatter: 48, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', scatterNearBias: 0 });
    console.log('NE_TABLE48_OFF=' + off.hash);
    ok('NE table off renders on the GPU without failure', off.st.renderer === 'three' && !off.st.gpuFailure, JSON.stringify(off.st));
    const binsOff = await page.evaluate(() => ({ binN: SD_SCATTER.binN, bias: SD_SCATTER.bias }));
    ok('NE table off: the table pass gets bias 0 and 4 samples in each bin', binsOff.bias === 0 && JSON.stringify(binsOff.binN) === JSON.stringify(new Array(12).fill(4)), JSON.stringify(binsOff));
    const selTable = await sel();
    ok('NE select: shown in table mode', !!selTable && selTable.hidden === false, JSON.stringify(selTable));
    if (TABLE48_MAIN) ok('NE table off is byte-identical to the main frame', off.hash === TABLE48_MAIN, off.hash.slice(0, 12) + ' vs ' + TABLE48_MAIN.slice(0, 12));
    const on = await frame('table 48 bias on', { scatterMode: 'table', scatter: 48, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', scatterNearBias: 1 });
    ok('NE table bias on renders on the GPU without failure', on.st.renderer === 'three' && !on.st.gpuFailure, JSON.stringify(on.st));
    ok('NE bias on frame differs from bias off', on.hash !== off.hash, on.hash.slice(0, 12) + ' vs ' + off.hash.slice(0, 12));
    const binsOn = await page.evaluate(() => ({ binN: SD_SCATTER.binN, bias: SD_SCATTER.bias, expect: RF.Drive.tableBinSteps(48, 1) }));
    ok('NE table on: the table pass gets bias 1 and the CPU counts (tableBinSteps(48, 1))', binsOn.bias === 1 && JSON.stringify(binsOn.binN) === JSON.stringify(binsOn.expect) && binsOn.expect.reduce((a, b) => a + b, 0) === 48, JSON.stringify(binsOn));
    const changed = await page.evaluate(() => { const s = document.querySelector('[data-dv="scatterNearBias"]'); s.value = '0'; s.dispatchEvent(new Event('change')); return new Promise((r) => setTimeout(() => { let saved = null; try { saved = JSON.parse(localStorage.getItem('flux/driveView') || '{}').scatterNearBias; } catch (e) { saved = 'err'; } r({ opt: RF.UI.dvOpts.scatterNearBias, type: typeof RF.UI.dvOpts.scatterNearBias, saved }); }, 1500)); });
    ok('NE select: choosing "0" stores the number 0 and saves it', changed.opt === 0 && changed.type === 'number' && changed.saved === 0, JSON.stringify(changed));
    await page.evaluate(() => { const s = document.querySelector('[data-dv="scatterNearBias"]'); s.value = '1'; s.dispatchEvent(new Event('change')); });
    await sleep(1500);
    const picked = await page.evaluate(() => ({ opt: RF.UI.dvOpts.scatterNearBias, type: typeof RF.UI.dvOpts.scatterNearBias }));
    ok('NE select: choosing "1" stores the number 1', picked.opt === 1 && picked.type === 'number', JSON.stringify(picked));
    const ratio = on.luma / off.luma;
    ok('NE bias on vs off: mean road light within 10 percent (a resampling, not new light)', Math.abs(ratio - 1) < 0.10, 'off ' + off.luma.toFixed(3) + ' on ' + on.luma.toFixed(3) + ' ratio ' + ratio.toFixed(4));
    ok('NE no NaN or empty frames (mean luminance finite and above zero)', [off, on].every((f) => Number.isFinite(f.luma) && f.luma > 0));
    ok('NE no page errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
  } catch (e) {
    ok('NE page run completed', false, String(e).slice(0, 300));
  } finally {
    await browser.close();
  }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' NE checks passed (headless software GL; no visual claim)');
  process.exitCode = fails ? 1 : 0;
})();
