// AC: air-beam cache generations (js/drive-three.js runTable). A key change (lamp pose, LUT, ...) starts a new generation; only slots of the
// newest generation that has a finished slot are shown; a fill past half its rows finishes with the pose it started with.
// Run:  python3 tests/serve.py <port> & echo $! > <pidfile>
//       PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/AC-air-cache-generations.js <port>
// Real GPU flags (ANGLE / Metal). The pose is changed through st.lighting.yaw (AFS on), which frame() copies into V.p.yaw; the test asserts
// that SD_SCATTER.gen really advances. globalThis.SD_GEN_OFF restores main's drop and slot choice: each check that guards the bug is also
// run with it set (negative control) and must then FAIL, so the checks are known to see the bug.
// Band size is pinned, not timed: before each frame msPerRow is set to 1 and the budget to R, so the pacing draws exactly R rows per frame
// (a version of th rows then takes ceil(th / R) frames, independent of GPU speed). The clock is real except in (c).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    // frozen clock only on demand (c): the cycle phase advances by dt and distance only, so a frozen clock and distance give a fixed phase
    await page.evaluate(() => { const real = performance.now.bind(performance); window.__fakeNow = null; window.__real = real; performance.now = () => (window.__fakeNow == null ? real() : window.__fakeNow); });
    const base = { visibility: 200, scatterMode: 'table', scatter: 16, scatterTableSteps: 48, scatterRes: 'quarter', scatterBlur: 'off', afs: true, lampPitch: false, corneringLamps: false, scatterCache: 'on', scatterCycle: 8, scatterCycleFade: 'on', scatterNearFadeRange: 'medium', samples: '1' };
    const setOpts = async (o) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(1500); };
    // One frame at yaw (radians; AFS on) with the band pinned to R rows. dtMs / dMetres move the clock (when frozen) and the car.
    let R = 1e6;
    const frame = (yaw, dtMs = 0, dMetres = 0) => page.evaluate(([y, dt, dm, r]) => {
      globalThis.SD_SCATTER.msPerRow = 1; globalThis.SD_TABLE_BUDGET_MS = r;
      if (window.__fakeNow != null) window.__fakeNow += dt; const st = RF.DriveAnim._.S(RF.UI); st.dist += dm; st.lighting = { yaw: y, left: 0, right: 0 }; RF.DriveAnim._.frame();
      const s = globalThis.SD_SCATTER; return { gen: s.gen, shownGen: s.shownGen, slotGen: s.slotGen, shown: s.shown, blend: s.blend, valid: s.valid, fills: s.fills, dropped: s.dropped, kept: s.kept, syncs: s.syncs, frames: s.frames, rowsDone: s.rowsDone, rowsTotal: s.rowsTotal };
    }, [yaw, dtMs, dMetres, R]);
    const hash = async () => { await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-ac', '1')); return crypto.createHash('sha256').update(await page.locator('canvas[data-ac="1"]').screenshot()).digest('hex').slice(0, 16); };
    const genOff = (v) => page.evaluate((x) => { globalThis.SD_GEN_OFF = x; }, v);
    const DEG = Math.PI / 180;
    let yaw = 0, s;
    // complete all eight versions at the current yaw, with whole-table bands
    const complete = async () => { R = 1e6; await genOff(false); s = await frame(yaw); for (let i = 0; i < 40 && s.valid < 8; i++) s = await frame(yaw); return s; };
    await setOpts(base);

    s = await complete();
    ok('AC setup: eight versions valid at a steady pose', s.valid === 8 && s.slotGen.length === 8 && s.slotGen.every((g) => g === s.gen), JSON.stringify({ valid: s.valid, gen: s.gen, slotGen: s.slotGen }));
    const TH = s.rowsTotal; R = Math.ceil(TH / 4);   // a version takes four frames; half the rows is reached after the second band, not the first
    console.log('[info] rowsTotal ' + TH + ', band ' + R + ' rows (' + Math.ceil(TH / R) + ' frames per version), half = ' + TH / 2 + '; ' + R + ' < half, 2 x ' + R + ' >= half: ' + (R < TH / 2 && 2 * R >= TH / 2));

    // (a) one key change from a complete steady state: no shown (or blended) slot may be older than the newest finished slot
    const runA = async (flagOff) => {
      yaw += 1 * DEG; await complete();
      await genOff(flagOff); R = Math.ceil(TH / 4); yaw += 1 * DEG;
      let bad = 0, mixed = 0, framesWithNew = 0, last = null;
      for (let i = 0; i < 160; i++) {
        last = await frame(yaw, 33.3, 0.6);   // moving, so the phase visits every slot
        const newest = Math.max(...last.slotGen.filter((g) => g !== undefined));
        if (newest === last.gen) framesWithNew++;
        const gens = [last.shown, last.blend].filter((j) => j >= 0).map((j) => last.slotGen[j]);
        if (gens.some((g) => g !== newest)) bad++;
        if (new Set(gens).size > 1) mixed++;
        if (last.valid === 8) break;
      }
      return { bad, mixed, framesWithNew, last };
    };
    const A = await runA(false);
    ok('AC (a) after a key change no shown or blended slot is older than the newest finished slot, and generations never mix', A.bad === 0 && A.mixed === 0 && A.framesWithNew > 0 && A.last.valid === 8, JSON.stringify({ bad: A.bad, mixed: A.mixed, framesWithNew: A.framesWithNew, finalValid: A.last.valid }));
    const A0 = await runA(true);
    ok('AC (a) negative control: with the fix off (main behaviour) older slots ARE shown after a newer one finished', A0.bad > 0, 'frames with an older slot shown: ' + A0.bad + ', mixed ' + A0.mixed);

    // (b) a key change every frame for 60 frames: a newer version must still finish (bounded lag)
    const runB = async (flagOff) => {
      yaw += 1 * DEG; await complete();
      const first = await frame(yaw), g0 = first.gen, f0 = first.fills;
      await genOff(flagOff); R = Math.ceil(TH / 4);
      let last = first, firstFinish = -1;
      for (let i = 1; i <= 60; i++) {
        yaw += 0.1 * DEG;   // 0.1 deg > the 0.05 deg quantum: the key changes on every frame
        last = await frame(yaw, 33.3, 0.6);
        if (firstFinish < 0 && last.fills > f0) firstFinish = i;
      }
      return { advanced: last.gen - g0, finished: last.fills - f0, firstFinish, newGenSlots: last.slotGen.filter((g) => g > g0).length, dropped: last.dropped - first.dropped, kept: last.kept - first.kept, shownGen: last.shownGen, gen: last.gen, g0 };
    };
    const Bk = await runB(false);
    ok('AC (b) the key really changed on all 60 frames (gen advanced by 60)', Bk.advanced === 60, 'gen advanced ' + Bk.advanced);
    ok('AC (b) under a key change every frame, at least one newer version finishes (within 12 frames: two dropped fills, then one that is kept) and it is shown', Bk.finished >= 1 && Bk.firstFinish > 0 && Bk.firstFinish <= 12 && Bk.newGenSlots >= 1 && Bk.shownGen > Bk.g0, JSON.stringify(Bk));
    const Bk0 = await runB(true);
    ok('AC (b) negative control: with the fix off (main behaviour) no version finishes in 60 frames of continuous change', Bk0.finished === 0 && Bk0.newGenSlots === 0, JSON.stringify(Bk0));

    // B8: the GPU wait (texel readback) runs on a minority of drawn frames. Main does one per drawn frame.
    await genOff(false); yaw += 1 * DEG; await complete();
    yaw += 1 * DEG; R = 5; const b0 = await frame(yaw); let b1 = b0;   // 18 frames per version, no further key change: every frame draws a band
    for (let i = 0; i < 36; i++) b1 = await frame(yaw);
    const drawn = b1.frames - b0.frames, syncs = b1.syncs - b0.syncs;
    ok('AC B8 the GPU wait runs on at most half of the drawn frames (a probe does two: one before to drop the backlog, one after)', syncs > 0 && syncs <= 0.5 * drawn, 'syncs ' + syncs + ' over ' + drawn + ' drawn frames (main: ' + drawn + ')');

    // (d) a fill that outlives a key change finishes with the pose it STARTED with: its slot equals a whole render at that pose, texel for texel
    await setOpts({ scatterCycle: 0, scatterCycleFade: 'off' });
    const yA = 3 * DEG, yB = -2 * DEG;
    const read = () => page.evaluate(() => [0, 1, 2].map((b) => Array.from(globalThis.SD_SCATTER.readVersion(0, b))));
    R = 1e6; await setOpts({ scatterCache: 'off' }); await frame(yA); await frame(yA); const refA = await read();
    await frame(yB); await frame(yB); const refB = await read();
    await setOpts({ scatterCache: 'on' });
    R = Math.ceil(TH / 4); s = await frame(yA);   // key A: a new fill (one slot) starts and draws its first band
    s = await frame(yA);                          // second band: past half the rows
    const half = s.rowsDone, g1 = s.gen, f1 = s.fills;
    R = 1e6; s = await frame(yB);                 // key B arrives with the fill past half: kept, and finished with pose A
    const slotAfter = await read();
    const eq = (X, Y) => X.every((a, b) => a.length === Y[b].length && a.every((v, i) => v === Y[b][i]));
    ok('AC (d) a fill past half its rows survives a key change and finishes (kept)', half >= TH / 2 && s.fills === f1 + 1 && s.gen === g1 + 1, JSON.stringify({ rowsDoneBeforeChange: half, rowsTotal: TH, fillsDelta: s.fills - f1, genDelta: s.gen - g1 }));
    ok('AC (d) the kept fill equals a whole render at the OLD pose (not a mix of poses)', eq(slotAfter, refA) && !eq(slotAfter, refB), 'equals A ' + eq(slotAfter, refA) + ', equals B ' + eq(slotAfter, refB) + ' (A and B tables differ: ' + !eq(refA, refB) + ')');

    // (c) a steady pose reaches 8/8 and its frame equals the frame with the fix disabled (main's slot choice)
    await setOpts({ scatterCycle: 8, scatterCycleFade: 'on' });
    yaw = 5 * DEG; await complete();
    ok('AC (c) a steady pose reaches 8/8 and every slot carries the current generation', s.valid === 8 && s.slotGen.every((g) => g === s.gen) && s.shownGen === s.gen, JSON.stringify({ valid: s.valid, gen: s.gen, slotGen: s.slotGen }));
    await page.evaluate(() => { window.__fakeNow = window.__real(); }); await frame(yaw); await frame(yaw);   // freeze the clock; one frame to absorb the last real dt
    const hashes = [];
    for (const off of [false, true, false, true]) { await genOff(off); await frame(yaw); hashes.push(await hash()); }
    console.log('AC_STEADY_HASH ' + hashes[0]);   // compare across builds by hand: the same on main
    ok('AC (c) steady-pose frame hash with the fix equals the hash with the fix disabled', hashes[0] === hashes[1] && hashes[0] === hashes[2] && hashes[1] === hashes[3], hashes.join(' '));
    await genOff(false); await page.evaluate(() => { window.__fakeNow = null; });
    ok('AC nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.evaluate(() => { globalThis.SD_TABLE_BUDGET_MS = 8; Object.assign(RF.UI.dvOpts, { scatterMode: 'direct', scatter: 0, scatterCache: 'off', scatterCycle: 0, afs: false, visibility: null }); RF.UI.redrawSpec(); });
  } catch (e) { ok('AC run completes', false, String(e && e.stack || e).slice(0, 500)); }
  finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all AC air-cache-generation checks passed'); process.exitCode = fails ? 1 : 0;
})();
