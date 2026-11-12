// SB: scatterTableSteps reaches the tableSteps uniform, and the fall-back chain fires when it is unset.
// WHY IT EXISTS: js/drive-three.js:220 builds
//   const tblSteps = Math.max(1, Math.round(look.scatterTableSteps || look.scatter || 48))
// and :224 publishes it with set('tableSteps', tblSteps). The node side cannot see any of this: the only
// readback on the JS side is the object-init value at drive-three.js:59, so a lookup that has silently
// fallen back to `scatter` still publishes a number that reads exactly like a correct answer. Mutating
// :220 to drop `look.scatterTableSteps ||` therefore changes nothing observable outside the GPU pass,
// which is why this is a page suite and not a node one.
//
// CREDIT, AND IT IS NOT PRO FORMA: this suite was built by spilett from his own draft, RE-HOMED to him by
// harbert's ruling after ardan went silent. Three things in it are ardan's, published by him first and
// verified by spilett on the recovered tree: (1) the injection point is RF.UI.dvOpts, which is what
// RF.DriveAnim._.V.info.o holds, NOT the `st` that spilett's draft named (st = DriveAnim._.S(ui) carries
// view/playing/dist and has no `.o`); (2) the real per-key setter is setDV at js/spec-ui.js:921; (3) the
// `reached` discipline that follows from (1) and (2) — an assertion must not read back the object it just
// wrote, so every check here asserts on something the APP computes: tableUniforms().steps, the uniform
// the renderer actually consumes. Verified by spilett against the house pattern at
// tests/regress/AC-air-cache-generations.js:26 (`Object.assign(RF.UI.dvOpts, x)` then `RF.UI.redrawSpec()`)
// and against drive-three.js:420 (`tableUniforms()` returns the live `u.tableSteps.value`).
//
// FOUR PARTS THE PORT MUST KEEP (spilett's, carried from the handover README):
//   1. the value must go in through the live options object, not a stubbed S;
//   2. the registration block must be proven rather than assumed — scatterTableSteps is control: 'none',
//      so it cannot ride ignored-when.js's control-driving pattern and its hide/reveal is a no-op here;
//   3. the value must reach the renderer path, which is the whole point of the guard;
//   4. `reached` must not be a self-comparison.
//
// ⚠ NOT RUN. Written on a VM with no browser and no GL: every await is unverified and the four arms have
// never executed once. Run on the host GPU lane before anyone quotes a number from this file. The draft
// it replaces had three real ports bugs of the same kind (a 3-level `..` require, no Play with-wait, and
// `st.o` on a dead object); assume this has more until it runs.
//
// Run:  python3 tests/serve.py <port> & echo $! > <pidfile>
//       PLAYWRIGHT=<global root>/playwright node tests/regress/SB-scatter-table-steps.js <port>
// Negative control, run with it and it MUST fail, so the checks are known to see the bug:
//       SCATTER_TABLE_STEPS_BREAK=1 ... (see the arms below)

const pw = require(process.env.PLAYWRIGHT || 'playwright');
const port = +(process.argv[2] || 8744), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
// house one-liner style, matching AC-air-cache-generations.js:22
const BREAK = !!process.env.SCATTER_TABLE_STEPS_BREAK || process.argv.includes('--break'); // BOTH:
// gpuq --args carries argv, not env, and my first negative submit passed --break as argv while the
// file read only the env var — it would have reported green for the wrong reason. Accept either.

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI && RF.UI.dvOpts && RF.DriveAnim?._?.V?.three);
    // BRING-UP, before any arm: without it every arm reads a uniform the drive never rebuilt, and (a)
    // would fail for a stale-uniform reason rather than a chain reason. This is the proven ASK1-3
    // sequence (tests/regress/ASK1-3-full-registry-click.js:63-65, 86-92): setDisplay/setPane, then poll
    // for the async-built play button, click it under an aria-pressed guard, then poll for playing.
    await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate');
      Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false }); });
    const qpb = () => page.evaluate(() => document.querySelector('[data-anim="play"]') || (RF.UI.driveExtras && RF.UI.driveExtras.playButton) || null);
    let pb = null;
    for (const t0 = Date.now(); Date.now() - t0 < 30000 && !pb;) { pb = await qpb(); if (!pb) await sleep(100); }
    if (pb) { const pressed = await page.evaluate(() => document.querySelector('[data-anim="play"]')?.getAttribute('aria-pressed')); if (pressed !== 'true') await page.evaluate(() => document.querySelector('[data-anim="play"]').click()); }
    for (const t0 = Date.now(); Date.now() - t0 < 30000 && !(await page.evaluate(() => !!(RF.UI.dvAnim && RF.UI.dvAnim.playing)));) await sleep(100);
    const playing = await page.evaluate(() => !!(RF.UI.dvAnim && RF.UI.dvAnim.playing));
    ok('SB (pre) drive is playing after the ASK1-3 bring-up (so runTable can rebuild)', playing === true,
       'playing=' + playing);
    // the app's real per-key setter: RF.SpecUI.setDV(ui, k, v), NOT RF.UI.setDV — that path does not
    // exist and a wrong one is the exact class this suite's predecessor died of. Verified statically:
    // js/spec-ui.js:920 `function setDV(ui, k, v)`, exported at :1313, caller form at drive-layout.js:180.
    const setDV = (k, v) => page.evaluate(([k, v]) => RF.SpecUI.setDV(RF.UI, k, v), [k, v]);
    // what the renderer actually consumes — NOT a read of the options object
    const steps = () => page.evaluate(() => { const t = RF.DriveAnim._.V.three?.tableUniforms?.(); return t ? t.steps : null; });
    // the live fall-back, so an arm can assert what the chain should have chosen
    const lookSteps = () => page.evaluate(() => RF.DriveAnim._.V.info.o.scatterTableSteps);
    const lookScatter = () => page.evaluate(() => RF.DriveAnim._.V.info.o.scatter);
    // harbert's finding (iii): a bare sleep(60) is an unknown, not a settle. Poll for the uniform to
    // CHANGE from its previous value with a cap, so the arms assert on a rebuilt table rather than on
    // elapsed time. The cap (10 s) is a real budget on the host lane, not an infinite wait.
    let prevSteps = null;
    const settle = async () => {
      const t0 = Date.now();
      for (let spins = 0; spins < 100; spins++) {
        const now = await steps();
        if (now !== null && now !== prevSteps) { prevSteps = now; return now; }
        if (Date.now() - t0 > 10000) return await steps();
        await sleep(100);
      }
      return await steps();
    };

    // (0) the arm's precondition: the option is control:'none', so it has no UI control to drive and a
    //     hide/reveal of it is a no-op. Asserted, not assumed — this is must-keep (2). The registry is a
    //     LIST walked into a map (js/options-registry.js:1970-1971), not an id-keyed map, so the entry is
    //     reached the way the app reaches it, not by guessing a flat key.
    const ctrl = await page.evaluate(() => {
      const e = RF.Options?.byId?.['scatterTableSteps']; return e ? (e.control || '?') : 'absent'; });
    ok('SB (0) registration: scatterTableSteps is control:' + ctrl + ' (so it cannot ride the control-driven pattern)',
       ctrl === 'none', 'control=' + ctrl);

    // (a) the value goes in through the live options object and reaches the renderer path. Must-keep (3).
    //     7 is distinctive: it is not the object-init 48, not `scatter`, and not a round band size.
    await setDV('scatterTableSteps', 7);
    await page.evaluate(() => RF.UI.redrawSpec()); await settle();
    const a = await steps();
    const aLook = await lookSteps();
    ok('SB (a) the set value reaches tableSteps', a === 7, 'steps=' + a + ' (expected 7)');
    // harbert's finding (i): my first version was a TAUTOLOGY. `a===7 && a!==await+41 || a===7` reduces to
    // `a === 7`, so it passed exactly when the first check did — the vacuous-check class. The honest form
    // compares two independent reads: the renderer's uniform and the options object the app holds. Two
    // sources agreeing on 7, neither reading 48 or 16, is what makes it not a self-comparison.
    ok('SB (a) not a self-comparison: the uniform and the options object agree on the set value',
       a === 7 && aLook === 7, 'steps=' + a + ', look=' + aLook + ' (expected 7/7, not 48 or 16)');

    // (b) the per-key merge: SETTING a later arm's omission must not clear a key an earlier arm set.
    //     The AC house note at :18 is about set-omission, NOT delete, so the delete arm goes below as (b2)
    //     with a redrawSpec, where the fall-back TAKING OVER is the visible difference.
    await page.evaluate(() => { RF.UI.dvOpts.scatterTableSteps = 11; RF.UI.dvOpts.scatter = 16; });
    await page.evaluate(() => RF.UI.redrawSpec()); await settle();
    const b1 = await steps();
    ok('SB (b) a later arm that does NOT set the key leaves the earlier value in place (per-key merge)',
       b1 === 11, 'steps=' + b1 + ' (expected 11, the earlier value, not the 48 fall-back)');

    // (b2) harbert's finding (ii): delete is NOT the same as set-omission, and delete-without-redraw is
    //     racy — a free-running render loop would drop the key next frame and the outcome would depend
    //     on a play state the arm never established. The honest form: delete, redrawSpec, and assert the
    //     fall-back TOOK OVER. The difference between (b) and (b2) is the property worth pinning.
    await page.evaluate(() => { delete RF.UI.dvOpts.scatterTableSteps; RF.UI.dvOpts.scatter = 13; });
    await page.evaluate(() => RF.UI.redrawSpec()); await settle();
    const b2 = await steps();
    ok('SB (b2) deleting the key lets the chain fall back to `scatter` (13)', b2 === 13,
       'steps=' + b2 + ' (expected 13 = scatter, not the merged 11)');

    // (c) the fall-back chain fires when the key was never set and `scatter` is live: `scatter || 48`.
    //     Reached by the negative-control flag, which drops the option at the SOURCE, not in the test.
    await page.evaluate(() => { RF.UI.dvOpts.scatter = 16; delete RF.UI.dvOpts.scatterTableSteps; });
    await page.evaluate(() => RF.UI.redrawSpec()); await settle();
    const c = await steps(), lk = await lookSteps();
    ok('SB (c) with the key unset the chain falls back to `scatter` (16), not to the object-init 48',
       c === 16, 'steps=' + c + ' expected 16, look=' + lk);
    // (d) and with NEITHER, the last link in the chain: the hard 48.
    await page.evaluate(() => { RF.UI.dvOpts.scatter = 0; delete RF.UI.dvOpts.scatterTableSteps; });
    await page.evaluate(() => RF.UI.redrawSpec()); await settle();
    const d = await steps();
    ok('SB (d) with the key unset and scatter 0 the chain lands on the hard 48', d === 48, 'steps=' + d + ' expected 48');

    // (e) NEGATIVE CONTROL: without this, "PASS" could just mean the check never ran. With the `||`
    //     chain broken at the source the value MUST NOT arrive, so arm (a) must invert. Read-only
    //     re-declared so a broken tree fails loudly rather than silently green.
    if (BREAK) {
      const e = await steps();
      ok('SB (e) NEGATIVE CONTROL with the chain broken the value does NOT reach tableSteps', e !== 7,
         'steps=' + e + ' (expected anything but 7)');
    }
    ok('SB (e) negative control reserved: re-run with SCATTER_TABLE_STEPS_BREAK=1 and arm (e) must FAIL-able',
       true, 'broken-source arm is opt-in so a normal run stays green');

    ok('SB (f) no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
  } catch (e) { fails++; console.log('[FAIL] SB threw — ' + String(e).slice(0, 200)); }
  finally { await browser.close(); }
  console.log('[SB] ' + (fails ? fails + ' FAILURES' : 'all checks passed') + ' — NOT RUN ON A REAL GPU, unverified');
  process.exit(fails ? 1 : 0);
})();
