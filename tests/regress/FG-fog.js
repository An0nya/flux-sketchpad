// FG page checks: the air button (clear, haze, mist, fog, dense) on the GPU drive renderer, the FPS badge, and CPU/GPU parity under fog.
// Run (worktree): python3 tests/serve.py 8984  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/FG-fog.js 8984
// Baseline (main, cbcb340): git archive cbcb340 into a temp dir, python3 <dir>/tests/serve.py 8983, then  node tests/regress/FG-fog.js 8983 --baseline
// The clear frame must hash to the main baseline (OLD_CLEAR below, set from the --baseline run). Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const IMG = require('../image/compare.js');
const port = +(process.argv[2] || 8984), baseline = process.argv.includes('--baseline');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Brief U (D): lampCone is set 'off' in this file's pages (here and in the P1 parity run). Its default is now 'auto' = on in mist, and the cone adds light in fog (so fog is no
// longer darker than clear: measured clear 33.65 vs dense 37.58 mean luminance) and the CPU renderer cannot draw it (P1 parity fails). Both checks are about the fog's own extinction.
// sha256 of the drive canvas PNG on main cbcb340 with the UX2 start and wet, wetSheen off, visibility absent (set by --baseline).
// PED-CLOTHING-MODES: people off in this session (walkers' clothes changed in every mode). The pin is main b38c628's clear frame with people off, equal to the new build with people off (full sha256). With people on, the old pin f195e8c7... no longer matches.
// Brief U (A+B): every lamp is now a glare source and carries its colour, so the page's default glare ('rain', UX2 scene with an oncoming car, preceding car and street lamps in view) draws a coloured veil from them.
// PROOF the old pin is only moved by that: the same build with D.glareSources patched back to its old body (headlamps only, 4-tuples) and lampCone off reproduces the old hash (checked 2026-10-27 for this file: the clear pin aac78891..., FG and SC). Old pin: aac7889105ba1d4cb0f6991f275a68bdb7cad1165c4f60d6a507cb3b07061e4a.
// SPEED0 (2026-10-28): re-baselined for the speed slider's new range (min 0 step 1, was 5/5). The drive toolbar overlays the canvas, so its element screenshot holds the slider
// thumb, which moves at the same 50 km/h. PROOF: the same frame with the old vs new min/step differs in 68 px, all inside the slider's box (x 174-189, y 10-25 of the canvas;
// slider at x 148-233, y 6-30), and restoring the old range gives 0 px; with the slider line reverted, the old pins pass (WT, FG, SC, SD). The render is unchanged.
// UI step C (2026-10-29): re-baselined for the drive layout shell. The element screenshot holds the bars that overlay the canvas top (overlay mode in this
// small pane), which changed look; the render itself is unchanged: in overlay mode the canvas is the old size, and a headless BT probe gave readCanvas
// hashes identical to HEAD 0e77d52 before and after a traffic shuffle (brief REVIEW-2026-10-28-presets.md, step C).
// OVL-RIGHT (2026-10-29): re-baselined: wide overlay moved the collapsed right panel (Details | Timings) to the right edge and lets both
// panels shrink in a small host; the element screenshot holds those panels. Proof: with only those 3 CSS lines reverted the OLD pin passes.
// RE-PIN 11-03 (murchison, maston cluster handoff per cyrus 16:55, rule 23): was 9c6980768743c538... (set at the OVL-RIGHT re-baseline). Cause: the accumulated renderer landings 10-30 -> 11-03 (first failing in the 11-03 approval run), through qq v2 + shader-slots. Values byte-identical across Claude's 11-03b list and my run on the current tree (stable; NOT moved by m0-guard or cone-dedupe - measured pre/post). NOTE: the separate CPU/GPU-parity FAIL (8 buildings sub-checks) is nemo's C4 / le-chonk's P1-drive-three item - untouched here.
// RE-PIN 11-04 (harbert, C4 batch, my half per cyrus 04:04, rule 23): was ab13dbfc24c6a070... (murchison's maston-cluster re-pin 11-03). Cause: the C4 fix (mergeq le-chonk-20261103-192204-2763: objects.js:86 facade-edge restored to wall-light:wall; buildings were over-bright since the 10-30 marker insertion; root cause harbert, Claims 11-03 ~21:00) changed the clear frame. The known road/forest buildings mapped==1 residue (le-chonk's P1 probe; those parity checks still fail on this tree) is also in frame - a further move is expected when that fix lands. New value measured on the landed tree (objects 9415d650, tree 30fc51dbe4fc): harbert-20261103-111241-3da1 (FG) and -111341-ebaf (SC) byte-identical at 88df9d3e65dcdc13.
const OLD_CLEAR = process.env.FG_OLD_CLEAR || '2f20e9034dafd2e1ba792a368a0642c01b569e0f00bcce6d28a687cfd0f2e3bb';   // RE-PIN 11-05: back to main's hash. The earlier re-pins record the history. RE-PIN 11-10 (harbert, endless-road-v2 part 2, rule 23): was 9c6980768743c538... — the part-2 UI moves the captured pixels (canvas element screenshot includes the overlaid toolbar): drive-scenes.js legacy label renames ("(legacy)" suffixes) plus the new endlessAxes scene-pane group (named layout row, visible per the option-control rule); value measured by the 847a host gate (got 2f20e903...)ed the GPU material-id bug. before the C4 fix: ab13dbfc...; before OVL-RIGHT: 0517faf0...; before UI step C: b72a6a1e...; before SPEED0: 23802573...
const LEVELS = ['clear', 'haze', 'mist', 'fog', 'dense'];
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
async function meanLuma(page, png) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4);
  }, png.toString('base64'));
}
async function session(browser, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, people: false, lampCone: 'off' }); if (RF.UI.dvOpts.visibility !== undefined) RF.UI.dvOpts.visibility = null; RF.UI.redrawSpec(); });
  const capture = async (label) => {
    await sleep(2500);
    const state = await page.evaluate(() => { const s = RF.DriveAnim.stats(); return { renderer: s.renderer, gpuFailure: s.gpuFailure || '', btn: (document.querySelector('[data-dv="visibility"]') || {}).value || '' }; });
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-fg-drive', '1'));
    const png = await page.locator('canvas[data-fg-drive="1"]').screenshot();
    return { label, state, png, hash: crypto.createHash('sha256').update(png).digest('hex') };
  };
  return { context, page, capture };
}
(async () => {
  const browser = await pw.chromium.launch();
  const errors = [];
  try {
    const s = await session(browser, errors), { page, capture } = s;
    const clear = await capture('clear');
    if (baseline) { console.log('BASELINE clear=' + clear.hash + ' renderer=' + clear.state.renderer); await s.context.close(); return; }
    ok('FG GPU renderer is on (no GPU failure)', clear.state.renderer === 'three' && !clear.state.gpuFailure, JSON.stringify(clear.state));
    ok('FG clear frame equals the main baseline (GPU, visibility off)', OLD_CLEAR ? clear.hash === OLD_CLEAR : false, OLD_CLEAR ? clear.hash : 'OLD_CLEAR not set');   // full hash printed: a re-pin copies it
    // Tolerance comparison (B1): replaces exact hash with FLIP-based reference check.
    // When no reference exists for the current GPU class the check passes (missing); record one with REF_UPDATE=FG-fog node ...
    const cls = process.env.IMG_GPU_CLASS || await IMG.gpuClass(page);
    const refCheck = IMG.checkRef({ test: 'FG-fog', name: 'clear', png: clear.png, cls, pin: OLD_CLEAR, tol: { flipMean: 0.005 } });
    ok('B1 FG clear frame within tolerance of its reference', refCheck.pass || refCheck.missing, refCheck.detail);
    const frames = [clear];
    for (let i = 1; i < LEVELS.length; i++) { await page.evaluate((v) => { const s = document.querySelector('[data-dv="visibility"]'); s.value = v; s.dispatchEvent(new Event('change')); }, LEVELS[i]); frames.push(await capture(LEVELS[i])); }
    const labels = frames.map((f) => f.state.btn);
    ok('FG haze select steps clear, haze, mist, fog, dense (NE5: a select, values are the level names)', labels.join('|') === LEVELS.join('|'), labels.join(' | '));
    ok('FG frames differ at each air level', new Set(frames.map((f) => f.hash)).size === LEVELS.length, frames.map((f) => f.hash.slice(0, 8)).join(' '));
    const lum = [];
    for (const f of frames) lum.push(await meanLuma(page, f.png));
    ok('FG fog frame is darker than clear (mean luminance dense < clear)', lum[4] < lum[0], 'clear ' + lum[0].toFixed(2) + ' dense ' + lum[4].toFixed(2));
    ok('FG mean luminance falls monotonically with the air level', lum.every((v, i) => i === 0 || v <= lum[i - 1] + 1e-9), lum.map((v) => v.toFixed(2)).join(' '));
    // FPS badge: the badge reads mean and p95 frame ms once frames are drawn
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { fpsCounter: true }); RF.UI.redrawSpec(); });
    await sleep(3500);
    const badge = await page.evaluate(() => (RF.DriveAnim._.V.fpsLab || {}).textContent || '');
    ok('FG FPS badge shows mean and p95 frame ms', / ms mean · [\d.]+ ms p95/.test(badge), JSON.stringify(badge));
    ok('FG no page errors (session 1)', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
    await s.context.close();
    // CPU/GPU parity with fog on: the P1 checks with visibility 200 (same thresholds as P1)
    const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } }), p2 = await ctx2.newPage(), errs2 = [];
    p2.on('pageerror', (e) => errs2.push(String(e)));
    await p2.addInitScript(() => localStorage.clear());
    await p2.goto('http://localhost:' + port + '/index.html'); await p2.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    const fs = require('fs'), path = require('path');
    await p2.evaluate((text) => RF.UI.loadScene(RF.State.deserialize(text), 'P1 fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await p2.addScriptTag({ url: '/tests/drive-three-page.js' });
    const result = await p2.evaluate((p) => P1Page.run(p, { visibility: 200, lampCone: 'off' }), port);
    ok('FG CPU/GPU parity under fog (P1 checks, visibility 200)', result.pass, 'checks ' + result.checks.length + ', failed ' + result.checks.filter((c) => !c.pass).map((c) => c.name).join('; '));
    ok('FG no page errors (parity session)', errs2.length === 0, JSON.stringify(errs2.slice(0, 3)));
    await ctx2.close();
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' FG page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
