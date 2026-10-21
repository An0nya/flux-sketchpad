// SC page checks: the air beam button (off, low, mid, high = 0, 4, 8, 16 in-scatter steps) on the GPU drive renderer, and CPU/GPU parity with the beam on.
// Run (worktree): python3 tests/serve.py 8984  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SC-beam-scatter.js 8984
// The clear frame with the button absent must hash to the main baseline (OLD_CLEAR, the FG value). Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8984);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// sha256 of the drive canvas PNG on main 465e41c (no visibility, no scatter): the same value FG-fog pins.
const OLD_CLEAR = process.env.FG_OLD_CLEAR || 'f195e8c7532d178e7aa0db9464b5e5fff642c97e1f5fa42f142983bdc67333e1';
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
async function meanLuma(page, png) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4);
  }, png.toString('base64'));
}
(async () => {
  const browser = await pw.chromium.launch();
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0 }); RF.UI.redrawSpec(); });
    const state = async () => page.evaluate(() => {
      const s = RF.DriveAnim.stats(), b = document.querySelector('[data-dv="scatter"]');
      return { renderer: s.renderer, gpuFailure: s.gpuFailure || '', btn: b ? (b.options ? b.options[b.selectedIndex].textContent.trim() : b.textContent.trim()) : '', hidden: b ? b.hidden : null };   // DD: air beam steps is a select
    });
    const capture = async (label) => {
      await sleep(2500);
      const st = await state();
      await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1'));
      const png = await page.locator('canvas[data-sc-drive="1"]').screenshot();
      return { label, st, png, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) };
    };
    // 1. clear air: the button is hidden and the frame is the main baseline
    const clear = await capture('clear');
    ok('SC GPU renderer is on (no GPU failure)', clear.st.renderer === 'three' && !clear.st.gpuFailure, JSON.stringify(clear.st));
    ok('SC clear air: the frame equals the main baseline (button off, visibility off)', clear.hash === OLD_CLEAR, clear.hash.slice(0, 12));
    ok('SC clear air: the air beam button is hidden', clear.st.hidden === true, JSON.stringify(clear.st));
    // 2. fog 200: three clicks on the air button (clear, haze, mist, fog), then the beam button shows
    for (let i = 0; i < 3; i++) await page.evaluate(() => document.querySelector('[data-dv="visibility"]').click());
    const fogOff = await capture('fog, beam off');
    ok('SC fog 200: the air beam button shows, off', fogOff.st.hidden === false && fogOff.st.btn === 'air beam: off', JSON.stringify(fogOff.st));
    // 3. the beam steps: low, mid, high
    const levels = [fogOff];
    for (const name of ['low', 'mid', 'high']) { await page.evaluate(() => { const s = document.querySelector('[data-dv="scatter"]'); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); }); levels.push(await capture('fog, beam ' + name)); }
    const labels = levels.map((f) => f.st.btn);
    ok('SC air beam button cycles off, low, mid, high', labels.join('|') === 'air beam: off|air beam: low|air beam: mid|air beam: high', labels.join(' | '));
    ok('SC the beam frames differ from the beam-off frame', new Set(levels.map((f) => f.hash)).size === levels.length, levels.map((f) => f.hash.slice(0, 8)).join(' '));
    // mean luminance: low, mid and high are close to each other; the beam adds light, and high adds more than low
    const [off, low, mid, high] = levels.map((f) => f.luma);
    const spread = Math.max(low, mid, high) / Math.min(low, mid, high) - 1;
    ok('SC low, mid and high are within 20 percent of each other (mean luminance)', spread < 0.2, 'off ' + off.toFixed(3) + ' low ' + low.toFixed(3) + ' mid ' + mid.toFixed(3) + ' high ' + high.toFixed(3) + ' spread ' + spread.toFixed(3));
    ok('SC the beam adds light: high adds more than low (over the beam-off frame)', (high - off) > (low - off) && (low - off) > 0, 'low +' + (low - off).toFixed(3) + ' high +' + (high - off).toFixed(3));
    ok('SC no page errors (session)', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
    await context.close();
    // 4. CPU/GPU parity with the beam on: the P1 checks, visibility 200 and 8 steps (same thresholds as P1)
    const fs2 = fs, ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } }), p2 = await ctx2.newPage(), errs2 = [];
    p2.on('pageerror', (e) => errs2.push(String(e)));
    await p2.addInitScript(() => localStorage.clear());
    await p2.goto('http://localhost:' + port + '/index.html'); await p2.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await p2.evaluate((text) => RF.UI.loadScene(RF.State.deserialize(text), 'P1 fixture'), fs2.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await p2.addScriptTag({ url: '/tests/drive-three-page.js' });
    const result = await p2.evaluate((p) => P1Page.run(p, { visibility: 200, scatter: 8 }), port);
    ok('SC CPU/GPU parity with the beam on (P1 checks, visibility 200, 8 steps)', result.pass, 'checks ' + result.checks.length + ', failed ' + result.checks.filter((c) => !c.pass).map((c) => c.name).join('; '));
    ok('SC no page errors (parity session)', errs2.length === 0, JSON.stringify(errs2.slice(0, 3)));
    await ctx2.close();
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SC page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
