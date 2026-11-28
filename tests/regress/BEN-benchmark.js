// BEN: the drive Benchmark (js/drive-bench.js, buttons "Benchmark" / "save benchmark"). Runs a shortened benchmark on the bundled forest
// save and checks the results file, the screenshot, the save path, and that the user's own options and spot are put back.
// Checks:
//  1. The Benchmark button shows only with GPU stages + Debug timings + GPU renderer; "save benchmark" is hidden before a run.
//  2. Rows: baseline (real frames + stage means incl. scene/objects/final), one variant (real frames only), "baseline again", drift ratio.
//  3. The forest screenshot is a JPEG data URL of real size; the file records the profile, env (sim size), the device name typed in
//     the bench-device box plus screen/dpr, and no error.
//  4. Afterwards every option and the pose (dist, t) equal what they were before the run; "save benchmark" is visible.
//  5. save() downloads a flux-bench-*.json that parses to the same rows.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/BEN-benchmark.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs');
const port = +(process.argv[2] || 8806);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 600) : '')); };
const errors = [];
setTimeout(() => { console.log('[FAIL] watchdog: no result after 8 min (checks so far: ' + checks.length + ')'); process.exit(1); }, 8 * 60 * 1000).unref();
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, acceptDownloads: true }), page = await ctx.newPage();
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene && RF.DriveAnim && RF.DriveBench, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const set = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
    const hidden = (id) => page.evaluate((id) => { const b = RF.UI.driveBar.querySelector('[data-anim="' + id + '"]'); return b ? b.hidden : 'missing'; }, id);
    await set({ gpuRenderer: true, debugTimings: false, gpuStages: false, playing: false });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three', null, { timeout: 120000 }); await sleep(1000);
    const offHidden = await hidden('benchmark');
    await set({ debugTimings: true, gpuStages: true }); await sleep(500);
    ok('1. Benchmark button hidden without GPU stages, shown with them; save hidden before a run', offHidden === true && (await hidden('benchmark')) === false && (await hidden('bench-save')) === true, { offHidden });

    // the user's own state: a distinctive spot and settings the bench profile would overwrite
    await set({ samples: '2', haloBins: 12, density: 2, seed: 3 });
    await page.evaluate(() => { const st = RF.DriveAnim._.S(RF.UI); st.dist = 1332; st.t = 140; RF.UI.redrawSpec(); }); await sleep(1500);
    const before = await page.evaluate(() => { const d = RF.DriveAnim.stateDump(RF.UI); return { options: d.options, pose: { dist: d.pose.dist, t: d.pose.t } }; });

    await page.evaluate(() => { const i = RF.UI.driveBar.querySelector('[data-anim="bench-device"]'); i.value = 'Test Phone 1'; i.dispatchEvent(new Event('change')); });
    const out = await page.evaluate(() => RF.DriveBench.run({
      scenes: [{ name: 'forest', file: 'forest.json', variants: [['trees off', { veg: false }]] }],
      real: 16, realWarm: 4, stages: 8, stageWarm: 2, settleLoad: 1500, settleToggle: 800,
    }));
    const rows = out.rows || [], base = rows[0] || {}, vr = rows[1] || {}, again = rows[2] || {};
    ok('2. rows: baseline with real frames and stage means, variant real-only, baseline again, drift',
      rows.length === 3 && base.variant === 'baseline' && base.real && base.real.n === 16 && base.stages && ['scene', 'objects', 'final'].every((k) => base.stages[k] >= 0)
      && vr.variant === 'trees off' && vr.real && vr.real.n === 16 && vr.stages === null && again.variant === 'baseline again' && out.drift && out.drift.ratio > 0,
      { rows: rows.map((r) => ({ v: r.variant, real: r.real, stages: r.stages && Object.keys(r.stages) })), drift: out.drift, error: out.error });
    const shot = (out.shots || {}).forest || '';
    ok('3. screenshot is a JPEG of real size; profile, env and no error recorded', /^data:image\/jpeg;base64,/.test(shot) && shot.length > 3000 && out.profile && out.profile.samples === '1' && out.env && out.env.sim && !out.error && !out.restoreError
      && out.device && out.device.name === 'Test Phone 1' && Array.isArray(out.device.screen) && out.device.dpr > 0,
      { shotLen: shot.length, device: out.device, sim: out.env && out.env.sim, error: out.error, restoreError: out.restoreError, seconds: out.seconds });

    await sleep(1500);
    const after = await page.evaluate(() => { const d = RF.DriveAnim.stateDump(RF.UI); return { options: d.options, pose: { dist: d.pose.dist, t: d.pose.t } }; });
    const diff = Object.keys(before.options).filter((k) => JSON.stringify(before.options[k]) !== JSON.stringify(after.options[k]));
    ok('4. every option and the pose put back; save button shown', diff.length === 0 && before.pose.dist === after.pose.dist && before.pose.t === after.pose.t && (await hidden('bench-save')) === false,
      { diff: diff.map((k) => [k, before.options[k], after.options[k]]), before: before.pose, after: after.pose });

    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.evaluate(() => RF.DriveBench.save())]);
    const p = await dl.path(), saved = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok('5. save() downloads flux-bench-<device>-*.json with the same rows', /^flux-bench-Test_Phone_1-.*\.json$/.test(dl.suggestedFilename()) && saved.kind === 'flux-bench' && saved.rows.length === rows.length, { name: dl.suggestedFilename() });
  } catch (e) { ok('no exception', false, String(e && e.stack || e)); }
  finally {
    if (errors.length) ok('no page errors', false, errors.slice(0, 5));
    await browser.close();
    const pass = checks.every(Boolean); console.log((pass ? 'PASS' : 'FAIL') + ' BEN-benchmark ' + checks.filter(Boolean).length + '/' + checks.length); process.exit(pass ? 0 : 1);
  }
})();
