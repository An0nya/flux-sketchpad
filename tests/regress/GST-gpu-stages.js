// GST: option gpuStages (GPU stage timings in the Debug timings readout). Every 8th frame waits for the GPU after each render stage
// (a 1-pixel read of a private 1x1 target) and books the wall time per stage. Probing only inserts reads, so the picture must not change.
// Checks:
//  1. OFF: frame and halo tables pinned at a pass pose (the reference for 2 and 5).
//  2. ON: frame and halo tables equal the OFF ones (probe frames included), and probes were recorded.
//  3. ON: the readout line exists and names the halo sub-stages, scene, compose and final.
//  4. Control, the readout measures what it says: with the halo off, no "halo ..." stage is booked.
//  5. Control: a 2.86x finer halo table (haloDiv 1.4 vs 4, with 32 bins and refine 256 so the pass is well above the timer grid)
//     makes "halo screen" at least 1.3x slower; "final" moves by less than that.
//  6. OFF after ON: frame and tables equal 1, and no probe is recorded any more.
//  7. "Time this frame" (GST2): 64 timed renders kept of 80, readout line with [min-max] spreads, pose/clock/traffic put back, same picture.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/GST-gpu-stages.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const errors = [];
// Watchdog: a stuck page (load or helper wait) fails loudly instead of hanging the gate.
setTimeout(() => { console.log('[FAIL] watchdog: no result after 10 min (checks so far: ' + checks.length + ')'); process.exit(1); }, 10 * 60 * 1000).unref();
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'GST-gpu-stages'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    const set = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
    await set({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, samples: '1', lampCone: 'off', haloPolar: 'off', debugTimings: true, gpuStages: false, playing: false });
    const capture = async (d) => {
      await page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200)); }, d);
      const shot = await (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 373 } }));
      const t = await page.evaluate(() => { const T = RF.DriveAnim._.V.three; const b = T.haloTableBytes('bin'), c = T.haloTableBytes('cum'); return { bin: b && b.b64, cum: c && c.b64, on: T.haloState().on }; });
      return { png: sha(shot), bin: t.bin ? sha(Buffer.from(t.bin, 'base64')) : null, cum: t.cum ? sha(Buffer.from(t.cum, 'base64')) : null, on: t.on };
    };
    // n frames back to back at a fixed pose (the scene is paused), then the probe ring
    const frames = (n) => page.evaluate(async (n) => { const A = RF.DriveAnim._; for (let i = 0; i < n; i++) { A.frame(); await new Promise((r) => setTimeout(r, 0)); } return (A.V.stageRing || []).map((r) => ({ ms: r.ms, order: r.order, total: r.total })); }, n);
    const med = (ring, k) => { const a = ring.map((r) => r.ms[k] || 0); return a.reduce((x, y) => x + y, 0) / a.length; };   // mean, as the readout
    const D = 1332;

    const off1 = await capture(D);
    ok('1. OFF: halo on at the pose, tables present', off1.on === 1 && !!off1.bin && !!off1.cum, off1);
    const ring0 = await frames(16);
    ok('1. OFF: no probe recorded', ring0.length === 0, { probes: ring0.length });

    await set({ gpuStages: true });
    const ringOn = await frames(24);
    const on = await capture(D);
    ok('2. ON: frame and halo tables equal OFF', on.png === off1.png && on.bin === off1.bin && on.cum === off1.cum, { off: off1, on });
    ok('2. ON: probes recorded (every 8th frame)', ringOn.length >= 2, { probes: ringOn.length });
    const names = ringOn.length ? ringOn[ringOn.length - 1].order : [];
    const text = await page.evaluate(() => { RF.DriveAnim._.perfLabel && RF.DriveAnim._.perfLabel(); const el = RF.DriveAnim._.V.perfLab; return el ? el.textContent : ''; });
    ok('3. ON: stages booked in frame order include halo screen, scene, compose, final', ['halo screen', 'scene', 'compose', 'final'].every((n) => names.includes(n)) && names.indexOf('scene') < names.indexOf('final'), names);
    ok('3. ON: the readout line is shown', /GPU stages \(1\/8 frames, synced, mean of/.test(text), text.split('\n').filter((l) => l.startsWith('GPU stages')));

    await set({ trafficHalo: 0 }); await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; });
    const ringNoHalo = await frames(24);
    ok('4. control: halo off books no halo stage', ringNoHalo.length >= 2 && ringNoHalo.every((r) => !r.order.some((n) => n.startsWith('halo ') && n !== 'halo uniforms')), ringNoHalo.map((r) => r.order));
    await set({ trafficHalo: 16 });

    const keep = await page.evaluate(() => ({ haloBins: RF.UI.dvOpts.haloBins, haloCrossingRefine: RF.UI.dvOpts.haloCrossingRefine, haloDiv: RF.UI.dvOpts.haloDiv }));
    await set({ haloBins: 32, haloCrossingRefine: 256 });   // a halo heavy enough that its screen pass is many timer ticks (the fixture's is ~0.3 ms, at the 0.1 ms timer grid)
    await set({ haloDiv: 4 }); await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; }); await frames(8);
    await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; }); const coarse = await frames(48);
    await set({ haloDiv: 1.4 }); await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; }); await frames(8);
    await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; }); const fine = await frames(48);
    const sc = med(coarse, 'halo screen'), sf = med(fine, 'halo screen'), fc = med(coarse, 'final'), ff = med(fine, 'final');
    ok('5. control: halo screen grows with the table (div 1.4 vs 4: >= 1.3x); final does not grow as much', sf >= 1.3 * sc && ff / Math.max(fc, 0.05) < sf / Math.max(sc, 0.05), { screen: [sc, sf], final: [fc, ff] });
    await set(keep);

    // 7. GST2 "Time this frame": 80 renders of the paused pose, 16 dropped; pose, clock, traffic and picture unchanged afterwards
    const before = await capture(D);
    const snap = () => page.evaluate(() => { const A = RF.DriveAnim._, st = A.S(RF.UI); return JSON.stringify({ dist: st.dist, t: st.t, playing: !!st.playing, traffic: A.V.src.traffic.state }); });
    const s0 = await snap();
    const tf = await page.evaluate(async () => { const r = await RF.DriveAnim._.timeFrame(); RF.DriveAnim._.perfLabel(); return { n: r ? r.length : -1, text: (RF.DriveAnim._.V.perfLab || {}).textContent || '' }; });
    const s1 = await snap();
    const after = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return 1; }).then(() => page.evaluate(() => 1)).then(async () => { const shot = await (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 373 } })); return sha(shot); });
    ok('7. time this frame: 64 timed renders kept (80 - 16 warm-up)', tf.n === 64, { n: tf.n });
    ok('7. time this frame: the readout line is shown with spreads', /Frame timing \(64 renders of one pose/.test(tf.text) && /\[[0-9.]+-[0-9.]+\]/.test(tf.text), tf.text.split('\n').filter((l) => l.startsWith('Frame timing')));
    const real = /Real speed \((\d+) renders back to back, no stage syncs\): ([0-9.]+) \[[0-9.]+-[0-9.]+\] ms per frame → stage timings run ([0-9.]+)x slow/.exec(tf.text);
    ok('7. time this frame: real-speed line shown (64 renders, ms > 0, stage sums not faster than real speed by more than 20%)', !!real && +real[1] === 64 && +real[2] > 0 && +real[3] >= 0.8, real ? real.slice(1) : tf.text.split('\n').filter((l) => /Real speed/.test(l)));
    ok('7. time this frame: pose, clock and traffic put back exactly; still paused', s0 === s1 && !JSON.parse(s1).playing, s0 === s1 ? undefined : { s0: s0.slice(0, 200), s1: s1.slice(0, 200) });
    ok('7. time this frame: the picture afterwards equals the picture before', after === before.png, { before: before.png, after });

    await set({ gpuStages: false }); await page.evaluate(() => { RF.DriveAnim._.V.stageRing = []; });
    const ringOff = await frames(24);
    const off2 = await capture(D);
    ok('6. OFF after ON: frame and tables equal the first OFF', off2.png === off1.png && off2.bin === off1.bin && off2.cum === off1.cum, { off1, off2 });
    ok('6. OFF after ON: no probe recorded', ringOff.length === 0, { probes: ringOff.length });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  console.log(checks.every(Boolean) ? 'GST: all ' + checks.length + ' checks passed' : 'GST: ' + checks.filter((c) => !c).length + ' of ' + checks.length + ' checks FAILED');
  process.exit(checks.every(Boolean) ? 0 : 1);
})();
