// SD page checks: the air-beam scatter table on the GPU drive renderer (look.scatterMode 'table'), next to the direct in-scatter.
// Run (worktree): python3 tests/serve.py 8991  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SD-scatter-table.js 8991
// Brief U: lampCone is set off here: the lamp cone (default 'auto' = on in mist) adds light the table comparison is not about. The direct-mode pin below moved for Brief U's glare change only (see DIRECT16).
// Direct mode must hash to the main baseline (DIRECT16, captured on main 0f47b41 with the same recipe). Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8991);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Re-baselined by LAZYCPU: the GPU canvas is 476.4 px wide at a fractional x, so its element screenshot's edge column (x=476)
// used to show the CPU still beneath it. With the CPU still skipped while the GPU view shows, that column shows the page background.
// The GL frame itself is unchanged. Before (main 0f47b41 / pre-LAZYCPU): f7eba2f98a72...5d9d. After: fb9a713b4bf3...98f.
// PED-CLOTHING-MODES: people off (walkers' clothes changed in every mode). Pin = main b38c628's direct frame with people off, equal to the new build with people off (full sha256). With people on the old pin fb9a713b... no longer matches.
// Brief U (A+B): every lamp is now a glare source and carries its colour, so the page's default glare ('rain', UX2 scene with an oncoming car, preceding car and street lamps in view) draws a coloured veil from them.
// PROOF the old pin is only moved by that: the same build with D.glareSources patched back to its old body (headlamps only, 4-tuples) and lampCone off reproduces the old hash (checked 2026-10-27 for this file: b1da9456..., with lampCone off). Old pin: b1da94564d4c891b419083e3c209ee4224d8ace9be0529e6462d5ebd6e3ac309.
// SPEED0 (2026-10-28): re-baselined for the speed slider's new range (min 0 step 1, was 5/5). The drive toolbar overlays the canvas, so its element screenshot holds the slider
// thumb, which moves at the same 50 km/h. PROOF: the same frame with the old vs new min/step differs in 68 px, all inside the slider's box (x 174-189, y 10-25 of the canvas;
// slider at x 148-233, y 6-30), and restoring the old range gives 0 px; with the slider line reverted, the old pins pass (WT, FG, SC, SD). The render is unchanged.
const DIRECT16 = process.env.SD_DIRECT16 || '883d591544bb3fcd2a49703b99ac910906475d46f2ecef377bfcbeb020d32101';   // before SPEED0: 35206d78...
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
    // SE2 pacing: with the cache on a table fills over frames; wait until no version is pending before measuring (the cap guards a stall).
    const settle = () => page.evaluate(() => { let n = 0; while (RF.UI.dvOpts.scatterMode === 'table' && globalThis.SD_SCATTER.cache && globalThis.SD_SCATTER.pending > 0 && n < 4000) { RF.DriveAnim._.frame(); n++; } return n; });
    const frame = async (label, opts) => {
      await page.evaluate((o) => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, people: false, visibility: 200, lampCone: 'off', scatter: 16, scatterMode: 'direct', scatterRes: undefined, scatterBlur: 'off', scatterTableSteps: undefined, scatterNearFadeRange: 'off', ...o }); RF.UI.redrawSpec(); }, opts);
      await sleep(2500); await settle();
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
    // SD2 cache: the table is redrawn only when its key changes; cycle 8 shows eight jitter versions in rotation.
    // The car moves 0.6 m per frame (the key does not depend on distance, so a straight drive must not redraw the table).
    const counters = () => page.evaluate(() => ({ ...globalThis.SD_SCATTER }));
    const setOpts = async (o) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(2000); await settle(); };
    const drive = (n) => page.evaluate((k) => { const st = RF.DriveAnim._.S(RF.UI); const out = []; for (let i = 0; i < k; i++) { st.dist += 0.6; RF.DriveAnim._.frame(); out.push(globalThis.SD_SCATTER.shown); } return out; }, n);
    const base = { scatterMode: 'table', scatter: 16, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', afs: false, lampPitch: false, corneringLamps: false, scatterCache: 'on', scatterCycle: 0, scatterNearFadeRange: 'off' };
    await setOpts(base);
    await drive(3);
    await page.evaluate(() => { globalThis.SD_SCATTER.recomputes = 0; globalThis.SD_SCATTER.skips = 0; });
    await drive(30);
    const straight = await counters();
    ok('SD cache: a straight drive over 30 frames redraws none (key unchanged, skips counted)', straight.recomputes === 0 && straight.skips === 30 && straight.cache === true, JSON.stringify(straight));
    await setOpts({ afs: true });
    await drive(2);
    const afsOn = await counters();
    await setOpts({ lampPitch: true });
    await drive(2);
    const pitchOn = await counters();
    ok('SD cache: switching AFS or lamp pitch changes the key and redraws', afsOn.recomputes > straight.recomputes && pitchOn.recomputes > afsOn.recomputes, 'recomputes ' + straight.recomputes + ' -> ' + afsOn.recomputes + ' -> ' + pitchOn.recomputes);
    await setOpts({ afs: false, lampPitch: false });
    // cache on (cycle 0) against cache off: the same single version (seed 0), so the frames match
    const tbl = { scatterMode: 'table', scatter: 16, scatterTableSteps: 48, scatterRes: 'half', scatterBlur: 'off', scatterNearFadeRange: 'off' };
    const onFrame = await frame('cache on, cycle 0', Object.assign({ scatterCache: 'on', scatterCycle: 0 }, tbl));
    const offFrame = await frame('cache off', Object.assign({ scatterCache: 'off', scatterCycle: 0 }, tbl));
    ok('SD cache off equals cache on (cycle 0) within 1e-3 mean luminance', Math.abs(onFrame.luma - offFrame.luma) / offFrame.luma < 1e-3, 'on ' + onFrame.luma.toFixed(4) + ' off ' + offFrame.luma.toFixed(4) + ' hashes ' + (onFrame.hash === offFrame.hash ? 'equal' : 'differ'));
    // cycle 8: eight versions fill one per frame after the change, then the shown index rotates through them
    await setOpts({ scatterMode: 'table', scatter: 16, scatterCache: 'on', scatterCycle: 8, scatterNearFadeRange: 'off' });
    await drive(10);
    const cyc = await counters();
    const seq = await drive(8);
    // SM: the cycle follows distance travelled, not the frame count, so eight frames no longer show eight versions. Check the phase moves instead.
    const cyc2 = await counters();
    ok('SD cycle 8: eight versions valid, and the cycle phase moves with distance (SM)', cyc.valid === 8 && cyc.cycle === 8 && Number.isFinite(cyc2.phase) && cyc2.phase !== cyc.phase, 'valid ' + cyc.valid + ' phase ' + cyc.phase + ' -> ' + cyc2.phase + ' shown ' + seq.join(','));
    await setOpts({ scatterCycle: 0, scatterCache: 'off', scatterMode: 'direct' });
    // SD3 UI: the buttons appear in air only; table mode switches the labels and the scatter steps (16, 32, 64); res, blur, cache and cycle need table mode.
    // Frames here are taken at one car position (no driving in this block), so direct frames can be compared with each other.
    // DD: air beam, beam blur and near fade are selects now; press steps a select to its next option (like a click on the old button).
    const ui = (k) => page.evaluate((key) => { const b = document.querySelector('[data-dv="' + key + '"]'); return b ? { text: b.tagName === 'SELECT' ? b.options[b.selectedIndex].textContent.trim() : b.textContent.trim(), hidden: b.hidden, disabled: b.disabled } : null; }, k);
    const press = async (k) => { await page.evaluate((key) => { const b = document.querySelector('[data-dv="' + key + '"]'); if (b.tagName === 'SELECT') { b.selectedIndex = (b.selectedIndex + 1) % b.options.length; b.dispatchEvent(new Event('change', { bubbles: true })); } else b.click(); }, k); await sleep(2200); };
    const pressTo = async (k, text) => { for (let i = 0; i < 6; i++) { if ((await ui(k)).text === text) return true; await press(k); } return (await ui(k)).text === text; };
    const snap = async (label) => { await settle(); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1')); const png = await page.locator('canvas[data-sc-drive="1"]').screenshot(); return { label, hash: crypto.createHash('sha256').update(png).digest('hex'), luma: await meanLuma(page, png) }; };
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { visibility: null, scatter: 0, scatterMode: 'direct', scatterRes: 'half', scatterBlur: 'off', scatterCache: 'off', scatterCycle: 0, scatterTableSteps: undefined }); RF.UI.redrawSpec(); });
    await sleep(1500);
    const clearStates = await Promise.all(['scatterMode', 'scatterRes', 'scatterBlur', 'scatterCache', 'scatterCycle'].map((k) => ui(k)));
    ok('SD UI: the five air beam buttons are hidden in clear air', clearStates.every((b) => b && b.hidden), JSON.stringify(clearStates.map((b) => b && b.hidden)));
    await page.evaluate(() => { RF.UI.dvOpts.visibility = 200; RF.UI.redrawSpec(); }); await sleep(2000);
    const dirUI = { mode: await ui('scatterMode'), res: await ui('scatterRes'), blur: await ui('scatterBlur'), cache: await ui('scatterCache'), cycle: await ui('scatterCycle') };
    ok('SD UI: in air, direct mode: the mode button reads direct, the table-only buttons are disabled', dirUI.mode.text === 'air beam mode: direct' && !dirUI.mode.hidden && ['res', 'blur', 'cache', 'cycle'].every((k) => dirUI[k].disabled && !dirUI[k].hidden), JSON.stringify(dirUI));
    const dirOff = await snap('direct, off');
    await pressTo('scatter', 'air beam: high');
    ok('SD UI: direct scatter labels read high at the top (4, 8, 16 steps, unchanged)', (await ui('scatter')).text === 'air beam: high', (await ui('scatter')).text);
    const dirHigh = await snap('direct, high');
    ok('SD UI: direct high frame differs from the beam-off frame (the button drives the frame)', dirHigh.hash !== dirOff.hash && dirHigh.luma > dirOff.luma, 'off ' + dirOff.luma.toFixed(3) + ' high ' + dirHigh.luma.toFixed(3));
    await press('scatterMode');
    ok('SD UI: switching to table keeps the level and shows the table step count (64)', (await ui('scatterMode')).text === 'air beam mode: table' && (await ui('scatter')).text === 'air beam: high (64)', (await ui('scatter')).text);
    ok('SD UI: table mode enables res, blur and cache; cycle waits for the cache', !(await ui('scatterRes')).disabled && !(await ui('scatterBlur')).disabled && !(await ui('scatterCache')).disabled && (await ui('scatterCycle')).disabled);
    const steps = [];
    await pressTo('scatter', 'air beam: low (16)'); steps.push((await ui('scatter')).text);
    await press('scatter'); steps.push((await ui('scatter')).text);
    await press('scatter'); steps.push((await ui('scatter')).text);
    ok('SD UI: table scatter steps read low (16), mid (32), high (64)', steps.join(' | ') === 'air beam: low (16) | air beam: mid (32) | air beam: high (64)', steps.join(' | '));
    await pressTo('scatterCache', 'beam cache: on');
    await pressTo('scatterCycle', 'beam cycle: 8');
    ok('SD UI: cache on enables the cycle button, which reads 8', (await ui('scatterCache')).text === 'beam cache: on' && !(await ui('scatterCycle')).disabled && (await ui('scatterCycle')).text === 'beam cycle: 8');
    await pressTo('scatterCycle', 'beam cycle: off'); await pressTo('scatterCache', 'beam cache: off');
    await pressTo('scatterRes', 'beam res: full'); const resFull = (await ui('scatterRes')).text;
    await pressTo('scatterRes', 'beam res: half');
    await pressTo('scatterBlur', 'beam blur: strong'); const blurStrong = (await ui('scatterBlur')).text;
    await pressTo('scatterBlur', 'beam blur: off');
    ok('SD UI: res cycles half and full, blur cycles off, mid and strong', resFull === 'beam res: full' && blurStrong === 'beam blur: strong', resFull + ' / ' + blurStrong);
    await pressTo('scatter', 'air beam: high (64)');
    const tabHigh = await snap('table, high 64');
    ok('SD UI: table frame at high (64) is within 15 percent of the direct high frame (mean luminance)', Math.abs(tabHigh.luma / dirHigh.luma - 1) < 0.15 && tabHigh.hash !== dirHigh.hash, 'direct ' + dirHigh.luma.toFixed(3) + ' table ' + tabHigh.luma.toFixed(3));
    await press('scatterMode');
    await pressTo('scatter', 'air beam: high');
    const dirAgain = await snap('direct, high again');
    ok('SD UI: back to direct at high: the frame equals the first direct high frame (same car position)', (await ui('scatterMode')).text === 'air beam mode: direct' && dirAgain.hash === dirHigh.hash, dirAgain.hash.slice(0, 12) + ' vs ' + dirHigh.hash.slice(0, 12));
    ok('SD nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SD page run completed', false, String(e && e.stack || e).slice(0, 400)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SD page checks passed'); process.exitCode = fails ? 1 : 0;
})();
