// ASK1-3-full-registry-click: the registry-generated click test (ENDLESS-ROAD-REVIEW ASK1-3 FULL, cyrus).
// Clicks/types EVERY controlled option in js/options-registry.js and asserts both directions: UI->store (the option
// value moved) and store->UI baseline (after a full-snapshot restore the control reflects the store again).
// Developed and validated through the gpuq page lane; final shape measured clean there (job cyrus-20261111-215228-8b20:
// swept 123, passed 247, 0 fails, 105 s, renderer three; earlier 793e/4f2a). Design notes — each born from a measured failure:
//  * TABS: inactive drive-layout panes are [hidden] and reveal() does not switch tabs — the sweep loops the four
//    [data-dl-tab] tabs (drive-layout.js:42). Without this only ~81 of 158 controlled options are reachable.
//  * cpuStill-chain EXCLUSION (expMode, gpuRenderer): actuating either makes skipStill false (spec-ui.js) -> redrawSpec
//    falls into SYNCHRONOUS cpuStill CPU renders; under this test's visibility-60 fog one render can run minutes
//    (measured: three consecutive 600 s gpuq timeouts). They are [SKIP]-classified with mechanism, never clicked.
//  * axes (endlessAxes_*): axisFromPair fail-softs a HALF-SET pair to 'auto' BY DESIGN (endless-axis-config.js:194) —
//    set BOTH selects, dispatch ONE change; assert the RAW committed JSON (rung strings), not EA.parse (ladder indices).
//  * preset writers (airLevel/haloQuality/trafficLighting) write MANY keys — restore is a full dvOpts JSON snapshot.
//  * cycleSD debounces (scatterCycle/scatterCycleFade/scatterCache): 700 ms waits, so the late setDV lands before restore.
//  * [SKIP] classes are reported loudly with mechanism: envLimited (library-fed: trafficOutIds — its checkbox list is
//    built from libLoad() low-beam entries, drive-anim.js:2497 — and ownLow/ownHigh single-option selects), specRow
//    (onKcd/RL/smooth: spec-ui.js:600-602 rows with no data-dv hook), transport (playing/high reflect V/S state, not
//    dvOpts), gatedStill (with unmet() reasons and the gate type).
// Setup: serve.py's pinned defaults (tests/pinned-defaults.js) + the gpuq tiles-lane recipe: trafficBeams true,
// oncoming true, preceding false, seed 1, visibility 60, trafficHalo 16, samples "1", tiles true, mountainPass false.
// Run: python3 tests/serve.py <port> (background), then PLAYWRIGHT=... node tests/regress/ASK1-3-full-registry-click.js <port>
// Exits 1 on any [FAIL], a fatal page error, or budget truncation. Internal page budget 240 s (the gate runner's WALL_MS
// is 600 s and SIGKILLs; a slow-but-alive run must return partial data first). Progress is logged as [run] lines — the
// page console is bridged to node stdout, so even a wall-kill leaves the stalling op in the gate log (tests/gate-logs/).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8994);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const T0 = Date.now();
  const run = (m) => console.log('[run] ' + m + ' t=' + Math.round((Date.now() - T0) / 1000) + 's');
  const browser = await pw.chromium.launch(process.env.P1_REAL_GPU ? { channel: 'chromium', args: ['--use-angle=metal'] } : { args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });   // P1-drive-three pattern: the gate sets P1_REAL_GPU for GPU drive tests; software GL stalls on the first full-scene frame
  let fails = 0;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('console', (m) => { try { const t = m.text(); if (t.startsWith('[run]')) console.log(t + '  (node +' + Math.round((Date.now() - T0) / 1000) + 's)'); } catch (e) {} });   // progress bridge: page [run] lines -> node stdout -> gate log
    await page.addInitScript(() => { try { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); } catch (e) {} });   // pre-dismiss first-run overlays (AGENTS.md recipe) so the play button is clickable
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene, null, { timeout: 60000 });
    run('app ready');
    await page.evaluate(async () => {   // drive view + the gpuq tiles-lane recipe on top of the pinned defaults
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      const u = RF.UI;
      let w = 0; for (; w < 600 && (RF.SolverHost.loading() || u.solving); w++) await sl(100);
      console.log('[run] setup: solver idle after ' + w + ' waits');
      // Pre-warm the three module while the main thread is still free: drive-anim's gpuRenderer() (first sync) does
      // import('./drive-three.js') = /js/drive-three.js; the module EVAL needs a main-thread task, and the gate's first
      // drive frame saturates it (9713: 480s before sync/bars ran — drawDrive's 'lazy && !gpuShowing' branch paints a
      // full cpuStill synchronously when three is not up yet, spec-ui.js:1232). A cached module resolves in a microtask
      // between frames instead, so gpuShowing goes true before the late cpuStill can run.
      try { const tImp = Date.now(); await import('/js/drive-three.js'); console.log('[run] setup: drive-three.js pre-imported in ' + (Date.now() - tImp) + 'ms'); } catch (e) { console.log('[run] setup: pre-import FAILED: ' + (e && e.message)); }
      RF.SpecUI.dvOpts(u);   // lazy-init (DV_DEF + localStorage merge, spec-ui.js:890): dvOpts does not exist until the drive builds it — f644 assigned onto undefined
      // Recipe BEFORE the first drive frame: the gate loads pinned defaults (tiles 1200) while the gpuq lane pre-applies
      // this recipe at load; on software GL the 1200-tile first frame is what stalled da16 inside this evaluate.
      Object.assign(u.dvOpts, { trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, trafficHalo: 16, samples: '1', tiles: true, mountainPass: false });
      u.setMode('D');
      console.log('[run] setup: setMode done');
      u.setDisplay('drive');
      console.log('[run] setup: setDisplay done, renderer=' + RF.DriveAnim.stats().renderer);
      // The play button is built ASYNC: bars() runs inside DriveAnim.sync (a drawDrive hook) and appends V.bar to
      // ui.driveExtras (drive-anim.js:3177) — a synchronous querySelector right after setDisplay never finds it
      // (8a75: 'NO play button found'). The validated gpuq harness polls u.driveBar (gpuq-ask13.js:59); do the same,
      // then press play (AGENTS.md: the renderer starts cpu and switches after Play; 662f proved the cpu loop
      // saturates the main thread — every sl(100) resolved ~30s late, so wall caps are checked between starved awaits).
      const qpb = () => document.querySelector('[data-anim="play"]') || (u.driveExtras && u.driveExtras.querySelector('[data-anim="play"]'));
      let pb = qpb(), hb = 0;
      for (const tb = Date.now(); !pb && !(u.driveBar && (pb = qpb())) && Date.now() - tb < 120000;) {
        await sl(100);
        if (Date.now() - hb > 5000) { hb = Date.now(); const s = RF.DriveAnim.stats(); console.log('[run] setup-wait: bar=' + !!u.driveBar + ' renderer=' + s.renderer + ' gpuFail=' + !!s.gpuFailure + ' playing=' + !!(u.dvAnim && u.dvAnim.playing) + ' three=' + !!(RF.DriveAnim._ && RF.DriveAnim._.V && RF.DriveAnim._.V.three)); }   // heartbeat: 5s slices make any remaining stall attributable (arrival gaps show main-thread saturation)
      }
      console.log('[run] setup: driveBar=' + !!u.driveBar + ' playBtn=' + !!pb);
      if (!pb) throw new Error('play button never appeared (driveBar=' + !!u.driveBar + ') — sync/drawDrive never completed; refusing to sweep');
      if (pb.getAttribute('aria-pressed') !== 'true') pb.click();   // aria-pressed mirrors run state (drive-anim.js:2850); don't click into a pause
      for (const tw = Date.now(); Date.now() - tw < 30000 && RF.DriveAnim.stats().renderer !== 'three' && !RF.DriveAnim.stats().gpuFailure;) await sl(100);
      console.log('[run] setup: renderer=' + RF.DriveAnim.stats().renderer + ' gpuFailure=' + !!RF.DriveAnim.stats().gpuFailure);
      if (RF.DriveAnim.stats().renderer !== 'three') throw new Error('renderer stayed ' + RF.DriveAnim.stats().renderer + ' after play — refusing to sweep on the CPU renderer (main-thread starvation; validated config is renderer three, gpuq 8b20)');
    });
    run('setup done, sweep starting');
    const r = await page.evaluate(async () => {
      // ASK1-3 FULL validation v1.8 (cyrus) — TABS. v1.7 (4f2a) returned 92.8s, nFails 2, axes commit arm PASSED (setBoth
      // single-dispatch works), but gatedStill=69 with driveToolsMs=0: the stale-hidden-flag theory was WRONG — the 69 sit
      // in INACTIVE TAB PANES ([hidden]; drive-layout.js:42 TABS lighting/scene/performance/details/timings; reveal() does
      // not switch tabs). v1.8: ARM1/ARM1b/ARM3 each loop the four control tabs (click data-dl-tab, open all details,
      // driveTools resync) with a done-set. Reversed-pair assertion now reads the RAW committed JSON — EA.parse returns
      // ladder INDICES {min:0,max:1}, so the v1.7 fail was my wrong representation; the app normalized correctly.
      // trafficOutIds -> envLimited: its checkbox list is built from libLoad() low-beam entries (drive-anim.js:2497) and the
      // page-lane library has none — nothing to click (frames(2) fallback confirmed). Budget 360s. v1.7 history below.
      // ASK1-3 FULL validation v1.7 (cyrus) — FINAL SHAPE. v1.6 (793e) RETURNED (87s, 3 fails) => bisects conclusive:
      // hang family = actuating stale-hidden controls; mechanism (read): expMode/gpuRenderer actuation makes skipStill
      // false (spec-ui.js) -> redrawSpec falls into cpuStill = SYNCHRONOUS CPU still render; with this lane's visibility=60
      // dense fog + live scatter/halo options one render can run minutes -> v1.3/v1.4 600s timeouts. v1.7 changes:
      //  1. canary doubles as the after-setup driveTools RE-SYNC: the bar was built before the lane applied visibility=60,
      //     so halo*/scatter*/lamp* controls carry STALE hidden flags (only the driveTools k-switch updates them) — that
      //     is why v1.6 parked 71. One resync legitimately reveals them for the sweep.
      //  2. expMode + gpuRenderer EXCLUDED from actuation: loud class 'cpuStill-chain' (mechanism above, statically classified).
      //  3. ARM2 axes: axisFromPair (endless-axis-config.js:194) fail-softs a HALF-SET pair to 'auto' BY DESIGN — sequential
      //     setSel(lo)+setSel(hi) committed (city,auto)->auto->''->labels() reset the selects (the v1.2-v1.6 all-auto mystery).
      //     Correct pattern: set BOTH selects, dispatch ONE change. UX note for harbert: a real user editing one end sees it revert.
      //  4. trafficOutIds: handler is on V.trafficList (drive-anim.js:2467); list items build during frame passes — rAF is
      //     idle in the page lane, so zero checkboxes existed (the v1.6 ARM3 fail). Fallback: two rAF frames then retry (the regress env has a live rAF).
      //  5. ARM3: driveTools resync after precondition writes (hidden flags follow the written options).
      // v1.6 BISECT #2 history: v1.5 (driveTools removed) STILL timed out => driveTools innocent.
      // v1.6 restores v1.2's hidden gating (disabled||hidden||closest) — the biggest remaining v1.3 delta: it had recovered
      // ~48 hidden controls (halo*/lamp*/scatter*/shadow*, preconditions UNSATISFIED — and this lane sets trafficBeams,
      // trafficHalo 16, visibility 60, so those options are live) for actuation with a working full D.sync — a combination
      // v1.1 (broken sync) and v1.2 (gated) never exercised. RETURNS => culprit family = hidden-control actuation;
      // TIMES OUT => culprit in the small deltas (ev/evm, trafficOutIds checkbox, haloJitterAmount precond, ARM2 probes).
      // Also fixed: scatterCache/scatterCycleFade are cycleSD-debounced (500ms) — their late setDV fired AFTER my 130ms
      // restore, polluting dvOpts; now in DEBOUNCED at 700ms. dvBase checked: minigame-only, null here — not a restore flaw.
      // v1.5 history: identical to v1.4 except lightSync drops RF.SpecUI.driveTools — the only new call vs v1.2 (88s clean).
      // If this RETURNS: driveTools is the culprit (canary/phases will show where). If it TIMES OUT: driveTools is innocent
      // and the culprit is among the other v1.3 deltas (disabled-only gating recovering ~48 hidden controls, debounces,
      // ARM2 probes). stillSuspects counts lightSyncs where skipStill would be false (cpuStill chain exposure, H2).
      // v1.3 history below.
      // ASK1-3 FULL validation v1.3 (cyrus). v1.2 (9de4) triage -> changes:
      //  1. lightSync += RF.SpecUI.driveTools(u, V.cv) — the data-dv bar k-switch (spec-ui.js:1120+) is the sync surface
      //     for wetness/expMode/scatterCycle-text etc; D.sync+redrawSpec never ran it (wetness baseline fail mechanism).
      //  2. gate check = el.disabled ONLY (v1.2's hidden/closest check parked ~60 programmatic-actuatable controls).
      //  3. debounced controls (cycleDebounced, DV_DEBOUNCE_MS=500): 700ms settle.
      //  4. ev: actuate via evm (reset-click at default is a legit no-op; probe proved evm 1->0.5).
      //  5. high -> TRANSPORT (V.high, high-beam button; not dvOpts).
      //  6. derived bundles (kind='derived', e.g. haloRangeRow): UI->store = any bundle key moves; restore bundle keys.
      //  7. trafficOutIds: actuate the first inner checkbox (control resolves to the DETAILS container).
      //  8. range nudge rail-aware (haloJitterAmount sat at max=1, +step clamped -> false fail).
      //  9. wetness restore includes derived dvOpts.wet.
      // 10. onKcd/RL/smooth: N/A-spec-row class — built at spec-ui.js:600-602 via row()/rnum()/rsel() (static evidence),
      //     no data-dv hook; not a runtime fail.
      // 11. ownLow/ownHigh: options.length<2 = env-limited (beam library not loaded in gpuq), not a fail.
      // 12. ARM2 axes: full probe (duplicate count, 0/150/500ms store reads, direct fromUi) — v1.2 all-auto unexplained.
      // 13. haloJitterAmount: preconditions (haloJitter='jittered', visibility=60) then normal sweep.
      // 14. budget + partial return kept; fails grouped by class.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const t0 = Date.now(), BUDGET_MS = 240000;   // v1.9: 240s — the gate runner's WALL_MS is 600s and SIGKILLs the process; a non-hang slow run must RETURN partial data (loud truncation FAIL) well before that. v1.4 history: 7134 timed out past a 480s budget
      const over = () => Date.now() - t0 > BUDGET_MS;
      const u = RF.UI, D = RF.DriveAnim, V = D._.V;
      for (let i = 0; i < 300 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      if (!u.driveBar) { u.setMode('D'); u.setDisplay('drive'); for (let i = 0; i < 200 && !u.driveBar; i++) await sleep(50); }
      await sleep(150);
      const F = { exists: [], ui2store: [], baseline: [], descriptor: [], transport: [], envLimited: [], specRow: [], cpuStillChain: [], probes: {} };
      const gatedStill = [], gatedOpened = [], preconds = [], timings = [];
      let swept = 0, passed = 0, truncated = false, stillSuspects = 0;
      const phases = []; const mark = (n) => { const s = Math.round((Date.now() - t0) / 1000); phases.push([n, s]); console.log('[run] phase ' + n + ' t=' + s + 's'); }; let lastOp = 'init'; const canary = {};
      const ok = (bucket, name, pass, detail) => { if (pass) passed++; else F[bucket].push({ name, detail: detail === undefined ? null : JSON.stringify(detail).slice(0, 220) }); };
      const all = (sel) => { try { return [...new Set([...u.driveBar.querySelectorAll(sel), ...u.driveExtras.querySelectorAll(sel), ...document.querySelectorAll(sel)])]; } catch (e) { return []; } };
      const lightSync = async () => {
        try { if (V.cv && V.info) D.sync(u, V.cv, V.info); } catch (e) {}
        // v1.5 BISECT: driveTools REMOVED — the only new call vs v1.2 (88s clean); v1.3+v1.4 both timed out past internal budgets.
        // H2 exposure counter: skipStill (spec-ui.js) is false when expMode!=='fixed' or gpuRenderer off -> redrawSpec would fall into synchronous cpuStill CPU renders.
        if (u.dvOpts.expMode !== 'fixed' || !u.dvOpts.gpuRenderer) stillSuspects++;
        try { u.redrawSpec(); } catch (e) {}
        await sleep(140);
      };
      const str = (v) => JSON.stringify(v === undefined ? null : v);
      const state = (el) => el.tagName === 'BUTTON' ? 'ap=' + el.getAttribute('aria-pressed') + '|tx=' + (el.textContent || '').slice(0, 24) :
        el.type === 'checkbox' ? 'ck=' + el.checked : 'v=' + el.value;
      const DEFER = { endlessAxes: 'container span; payload = 5 axis selects — ARM 2' };
      const ALLOW_MISSING = { haloRange: 'dead control ref; fed via haloRangeRow derived bundle (options-registry.js:1780) — verified cosmetic' };
      const TRANSPORT = { playing: 'session kind; play aria reflects S(ui).playing', high: 'high-beam button reflects V.high (transport state), not dvOpts.high' };
      const SPEC_ROW = { onKcd: 'spec-ui.js:601 rnum row, no data-dv hook', RL: 'spec-ui.js:600 rnum row, no data-dv hook', smooth: 'spec-ui.js:602 rsel row, no data-dv hook' };
      const CPUSTILL = { expMode: 'cycling expMode off fixed makes skipStill false (spec-ui.js) -> synchronous cpuStill CPU renders under this lane\'s dense fog = the v1.3/v1.4 600s hang mechanism', gpuRenderer: 'toggling gpuRenderer off makes skipStill false -> synchronous cpuStill CPU renders = the v1.3/v1.4 hang mechanism' };
      const DEBOUNCED = { scatterCycle: 700, scatterCycleFade: 700, scatterCache: 700 };
      const controlled = RF.Options.OPTIONS.filter((o) => o.control && o.control !== 'none' && !(o.id in DEFER));
      // ---- v1.7 canary + after-setup driveTools RESYNC (one call, both purposes): times each lightSync component and
      // refreshes the bar's stale hidden flags from the lane options (visibility=60 legitimately reveals halo*/scatter*) ----
      { let tc = Date.now(); try { if (V.cv && V.info) D.sync(u, V.cv, V.info); } catch (e) { canary.syncErr = String(e).slice(0, 80); } canary.syncMs = Date.now() - tc;
        tc = Date.now(); try { RF.SpecUI.driveTools(u, V.cv); } catch (e) { canary.dtErr = String(e).slice(0, 80); } canary.driveToolsMs = Date.now() - tc;
        tc = Date.now(); try { u.redrawSpec(); } catch (e) { canary.rsErr = String(e).slice(0, 80); } canary.redrawSpecMs = Date.now() - tc;
        await sleep(300); mark('canary'); }
      for (const k in CPUSTILL) F.cpuStillChain.push(k + ': ' + CPUSTILL[k]);
      try {
      // ---- ARM 0: existence ----
      const els0 = {};
      for (const opt of controlled) {
        if (opt.id in ALLOW_MISSING) continue;
        if (opt.id === 'mountainPass') { els0[opt.id] = all('[data-dv="scene"]')[0] || null; if (!els0[opt.id]) ok('exists', 'ARM0 mountainPass scene select', false); continue; }
        if (opt.id in SPEC_ROW) { F.specRow.push(opt.id + ': ' + SPEC_ROW[opt.id]); continue; }
        try { RF.DriveLayout.reveal(u, opt.control); } catch (e) {}
        const els = all(opt.control);
        els0[opt.id] = els[0] || null;
        if (!els.length) ok('exists', 'ARM0 control exists: ' + opt.id, false, opt.control);
      }
      await sleep(100);
      mark('ARM0');
      // ---- actuation core ----
      const actuate = async (opt, el, tag) => {
        lastOp = tag + ':' + opt.id;
        console.log('[run] ' + lastOp + ' t=' + Math.round((Date.now() - t0) / 1000) + 's');   // v1.9: per-op progress — a wall-kill must leave the stalling op in the gate log
        const snap = JSON.parse(JSON.stringify(u.dvOpts));   // v1.7: FULL snapshot restore — preset controls (airLevel/haloQuality/trafficLighting) write MANY keys
        const bundle = opt.kind === 'derived' && Array.isArray(opt.bundle) ? opt.bundle : null;
        const orig = u.dvOpts[opt.id];
        const origBundle = bundle ? bundle.map((k) => u.dvOpts[k]) : null;
        const origWet = u.dvOpts.wet;
        const base = state(el);
        const regen = opt.cost === 'scene-regenerate';
        const wait = DEBOUNCED[opt.id] || (regen ? 300 : 130);
        let acted = false;
        const tA = Date.now();
        const id = opt.id;
        if (id === 'trafficOutIds') {
          let cb = el.querySelector('input[type=checkbox]') || all('[data-anim="traffic-list"] input[type=checkbox]')[0];
          if (!cb) { try { for (let i = 0; i < 2; i++) await new Promise((rr) => requestAnimationFrame(rr)); } catch (e) {} cb = el.querySelector('input[type=checkbox]') || all('[data-anim="traffic-list"] input[type=checkbox]')[0]; }   // v1.7: the list builds during frame passes; rAF is idle in the page lane
          if (cb) { cb.click(); acted = true; }
          else { F.envLimited.push('trafficOutIds: checkbox list is built from libLoad() low-beam entries (drive-anim.js:2497); the page-lane library has none — nothing to click'); timings.push([id, Date.now() - tA]); return; }
        } else if (id === 'ev') {
          const evm = all('[data-dv="evm"]')[0];
          if (evm) { evm.click(); acted = true; }
        } else if (el.tagName === 'SELECT') {
          const cur = el.value;
          const nxt = [...el.options].map((o) => o.value).find((v) => v !== cur && v !== '');
          if (nxt !== undefined) { el.value = nxt; el.dispatchEvent(new Event('change', { bubbles: true })); acted = true; }
          else if (id === 'ownLow' || id === 'ownHigh') { F.envLimited.push(id + ': select has only ' + el.options.length + ' option(s) — beam library not loaded in this environment'); timings.push([id, Date.now() - tA]); return; }
        } else if (el.tagName === 'BUTTON') { el.click(); acted = true; }
        else if (el.tagName === 'INPUT') {
          if (el.type === 'checkbox') { el.checked = !el.checked; acted = true; }
          else if (el.type === 'range' || el.type === 'number') {
            const step = +el.step || 1, cur = +el.value;
            el.value = String(cur + step > +el.max ? cur - step : cur + step); acted = true;
          }
          else if (el.type === 'text') { el.value = (el.value || '') + 'x'; acted = true; }
          if (acted) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        await sleep(wait);
        const moved = bundle ? bundle.some((k, i) => str(u.dvOpts[k]) !== str(origBundle[i])) : str(u.dvOpts[id]) !== str(orig);
        if (!(id in TRANSPORT)) ok('ui2store', tag + ' UI->store: ' + id, acted && moved, { before: bundle ? str(origBundle) : str(orig), after: bundle ? str(bundle.map((k) => u.dvOpts[k])) : str(u.dvOpts[id]), tag: el.tagName, acted });
        // restore (v1.7: full snapshot — single-key restore left preset writers dirty)
        for (const k of Object.keys(u.dvOpts)) if (!(k in snap)) delete u.dvOpts[k];
        Object.assign(u.dvOpts, snap);
        await lightSync();
        if (id in TRANSPORT) F.transport.push(id + ': ' + TRANSPORT[id]);
        else ok('baseline', tag + ' store->UI baseline: ' + id, state(el) === base, { base, after: state(el) });
        timings.push([id, Date.now() - tA]);
        swept++;
      };
      const gated = (el) => el.disabled || el.hidden || !!el.closest('[hidden]');   // v1.6: v1.2's full gate restored (bisect #2)
      const TABS = ['lighting', 'scene', 'performance', 'details'];   // v1.8: drive-layout.js:42; inactive panes are [hidden] and reveal() does not switch tabs
      const done = new Set();
      const clickTab = async (t) => { const b = all('[data-dl-tab="' + t + '"]')[0]; if (!b) return; b.click(); await sleep(250); all('details').forEach((d) => { d.open = true; }); try { RF.SpecUI.driveTools(u, V.cv); } catch (e) {} };
      const ungate = (id) => { const i = gatedStill.indexOf(id); if (i >= 0) gatedStill.splice(i, 1); };
      // ---- ARM 1: cheap-cost options, per tab (v1.8) ----
      for (const t of TABS) {
        if (over()) { truncated = true; break; }
        await clickTab(t);
        for (const opt of controlled) {
          if (done.has(opt.id)) continue;
          if (opt.cost === 'scene-regenerate' || opt.id in ALLOW_MISSING || opt.id in SPEC_ROW || opt.id in CPUSTILL || opt.id === 'mountainPass') continue;
          const el = els0[opt.id];
          if (!el) continue;
          if (gated(el)) { if (!gatedStill.includes(opt.id)) gatedStill.push(opt.id); continue; }
          if (over()) { truncated = true; break; }
          if (opt.id === 'haloJitterAmount') { const s = { haloJitter: u.dvOpts.haloJitter, visibility: u.dvOpts.visibility }; u.dvOpts.haloJitter = 'jittered'; u.dvOpts.visibility = 60; preconds.push(['haloJitterAmount', '{"haloJitter":"jittered","visibility":60}']); await lightSync(); await actuate(opt, all(opt.control)[0] || el, 'ARM1'); u.dvOpts.haloJitter = s.haloJitter; u.dvOpts.visibility = s.visibility; await lightSync(); done.add(opt.id); ungate(opt.id); continue; }
          await actuate(opt, el, 'ARM1');
          done.add(opt.id); ungate(opt.id);
        }
        mark('ARM1:' + t);
      }
      // ---- ARM 1d: mountainPass descriptor ----
      if (!over()) {
        lastOp = 'ARM1d';
        const sc = els0['mountainPass'];
        if (sc) { const origScene = u.dvOpts.scene, origMP = u.dvOpts.mountainPass;
          sc.value = '__pass'; sc.dispatchEvent(new Event('change', { bubbles: true })); await sleep(500);
          ok('descriptor', 'ARM1d mountainPass via scene=__pass', u.dvOpts.mountainPass === true, { mp: str(u.dvOpts.mountainPass), scene: str(u.dvOpts.scene) });
          u.dvOpts.mountainPass = origMP; u.dvOpts.scene = origScene; await lightSync();
          sc.value = origScene; sc.dispatchEvent(new Event('change', { bubbles: true })); await sleep(500); await lightSync(); }
      } else truncated = true;
      mark('ARM1d');
      // ---- ARM 2: axes + full probe ----
      if (!over()) {
        lastOp = 'ARM2';
        const EA = RF.EndlessAxes, AX = EA.AXES;
        const selAll = (axis, end) => all('[data-anim="endlessAxes_' + axis + end + '"]');
        const setSel = (s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
        const setBoth = (lo, hi, vl, vh) => { lo.value = vl; hi.value = vh; hi.dispatchEvent(new Event('change', { bubbles: true })); };   // v1.7: ONE commit with both ends set — a half-set pair fail-softs to auto (endless-axis-config.js:194)
        const probe = { dupCounts: {}, directFromUi: null, storeReads: {}, firstAxis: {} };
        for (const axis of AX) probe.dupCounts[axis] = [selAll(axis, 'lo').length, selAll(axis, 'hi').length];
        { const axis = AX[0], L = EA.LADDERS[axis], los = selAll(axis, 'lo'), his = selAll(axis, 'hi');
          const lo = los[los.length - 1], hi = his[his.length - 1];   // LAST = newest build if duplicates
          if (lo && hi) {
            setBoth(lo, hi, L[0], L[0]);
            probe.storeReads.t0 = str(u.dvOpts.endlessAxes).slice(0, 100);
            await sleep(150); probe.storeReads.t150 = str(u.dvOpts.endlessAxes).slice(0, 100);
            await sleep(400); probe.storeReads.t550 = str(u.dvOpts.endlessAxes).slice(0, 100);
            probe.firstAxis = { loValue: lo.value, hiValue: hi.value, loOptions: [...lo.options].map((o) => o.value).slice(0, 6), parsed: str(EA.parse(u.dvOpts.endlessAxes || '')[axis]) };
            const pairs = {}; for (const a of AX) { const l2 = selAll(a, 'lo'), h2 = selAll(a, 'hi'); pairs[a] = { lo: l2[l2.length - 1] ? l2[l2.length - 1].value : 'auto', hi: h2[h2.length - 1] ? h2[h2.length - 1].value : 'auto' }; }
            probe.directFromUi = str(EA.fromUi(pairs, '1')).slice(0, 140);
            probe.tilesEndless = { tiles: str(u.dvOpts.tiles), endlessRoad: str(u.dvOpts.endlessRoad) };
          } }
        F.probes.axes = probe;
        // formal checks on the LAST (newest) selects
        const axDetail = {}; let axOK = true;
        for (const axis of AX) {
          const los = selAll(axis, 'lo'), his = selAll(axis, 'hi');
          const lo = los[los.length - 1], hi = his[his.length - 1];
          if (!lo || !hi) { ok('ui2store', 'ARM2 axes selects exist: ' + axis, false); axOK = false; continue; }
          const rung = EA.LADDERS[axis][0];
          setBoth(lo, hi, rung, rung); await sleep(150);
          const g = EA.parse(u.dvOpts.endlessAxes || '')[axis];
          axDetail[axis] = typeof g === 'string' ? g : JSON.stringify(g);
          if (g !== rung) axOK = false;
        }
        ok('ui2store', 'ARM2 axes: all five selects commit to real values (not auto)', axOK, axDetail);
        { const axis = AX[0], L = EA.LADDERS[axis];
          const los = selAll(axis, 'lo'), his = selAll(axis, 'hi');
          const lo = los[los.length - 1], hi = his[his.length - 1];
          if (lo && hi && L.length > 1) { setBoth(lo, hi, L[1], L[0]); await sleep(150);
            const g = (() => { try { return JSON.parse(u.dvOpts.endlessAxes || '{}')[axis]; } catch (e) { return null; } })();   // v1.8: RAW committed JSON (rung strings) — EA.parse returns indices
            ok('ui2store', 'ARM2 axes: reversed pair normalizes to {min,max}', !!g && typeof g === 'object' && g.min === L[0] && g.max === L[1], JSON.stringify(g)); } }
        { const cs = all('[data-anim="endlessCurviness"]'); const c = cs[cs.length - 1];
          if (c) { c.value = '2'; c.dispatchEvent(new Event('change', { bubbles: true })); await sleep(150);
            ok('ui2store', 'ARM2 axes: curviness commits', EA.parse(u.dvOpts.endlessAxes || '').userCurviness === 2, String(u.dvOpts.endlessAxes).slice(0, 120)); }
          else ok('ui2store', 'ARM2 axes: curviness input exists', false); }
        { const axis = AX[1], rung = EA.LADDERS[axis][1];
          const payload = {}; payload[axis] = rung;
          u.dvOpts.endlessAxes = JSON.stringify(payload); await lightSync();
          const los = selAll(axis, 'lo'), his = selAll(axis, 'hi');
          const lo = los[los.length - 1], hi = his[his.length - 1];
          const pr = EA.axisPair(EA.parse(u.dvOpts.endlessAxes), axis);
          ok('baseline', 'ARM2 axes: store->UI sync sets the selects', lo && hi && lo.value === pr.lo && hi.value === pr.hi, { want: pr, lo: lo && lo.value, hi: hi && hi.value }); }
        u.dvOpts.endlessAxes = ''; await lightSync();
      } else truncated = true;
      mark('ARM2');
      // ---- ARM 1b: scene-regenerate options ----
      const regenDeferred = [];
      for (const t of TABS) {
        if (over()) { truncated = true; break; }
        await clickTab(t);
        for (const opt of controlled) {
          if (done.has(opt.id)) continue;
          if (opt.cost !== 'scene-regenerate' || opt.id in ALLOW_MISSING || opt.id in SPEC_ROW || opt.id in CPUSTILL || opt.id === 'mountainPass') continue;
          const el = els0[opt.id];
          if (!el) continue;
          if (gated(el)) { const rid = opt.id + ' (regen)'; if (!gatedStill.includes(rid)) gatedStill.push(rid); continue; }
          if (over()) { truncated = true; regenDeferred.push(opt.id); continue; }
          await actuate(opt, el, 'ARM1b');
          done.add(opt.id); ungate(opt.id); ungate(opt.id + ' (regen)');
        }
        mark('ARM1b:' + t);
      }
      // ---- ARM 3: gated controls — satisfy preconditions via RF.Options.unmet() ----
      const satisfy = (cond) => {
        if (!cond) return null;
        if (cond.all) { const out = []; for (const c of cond.all) { const s = satisfy(c); if (s) out.push(s); } return out.length ? Object.assign({}, ...out) : null; }
        if (cond.any) { for (const c of cond.any) { const s = satisfy(c); if (s) return s; } return null; }
        if (cond.ctx || !cond.opt) return null;
        let v = true;
        if ('eq' in cond) v = cond.eq; else if ('in' in cond) v = cond.in[0]; else if ('gt' in cond) v = cond.gt + 1; else if ('ne' in cond) v = cond.ne === null ? 60 : (cond.ne === false ? true : cond.ne + 1);
        return { [cond.opt]: v };
      };
      for (const t of TABS) {
        if (over() || !gatedStill.length) { if (over()) truncated = true; break; }
        await clickTab(t);
        for (const id of [...gatedStill]) {
          if (over()) { truncated = true; break; }
        const opt = controlled.find((o) => o.id === id.replace(' (regen)', ''));
        if (!opt) continue;
        if (opt.id in CPUSTILL) continue;
        lastOp = 'ARM3:' + id;
        const unmet = RF.Options.unmet(opt.id, u.dvOpts, { renderer: V.three ? 'gpu' : 'cpu' });
        const writes = {};
        for (const r of unmet.filter((x) => x.kind === 'requires')) { const s = satisfy(r.cond || (RF.Options.RULES[r.rule] || {}).cond); if (s) Object.assign(writes, s); }
        if (opt.id === 'haloJitterAmount') Object.assign(writes, { haloJitter: 'jittered', visibility: 60 });
        if (!Object.keys(writes).length) continue;
        const saved = {}; for (const k in writes) { saved[k] = u.dvOpts[k]; u.dvOpts[k] = writes[k]; }
        preconds.push([opt.id, JSON.stringify(writes).slice(0, 120)]);
        await lightSync();
        try { RF.SpecUI.driveTools(u, V.cv); } catch (e) {}   // v1.7: hidden flags follow the written preconditions
        try { RF.DriveLayout.reveal(u, opt.control); } catch (e) {}
        const el = all(opt.control)[0] || els0[opt.id];
        if (el && !gated(el)) {
          gatedOpened.push(opt.id);
          gatedStill.splice(gatedStill.indexOf(id), 1);
          await actuate(opt, el, 'ARM3');
        }
        for (const k in saved) u.dvOpts[k] = saved[k];
        await lightSync();
        }
        mark('ARM3:' + t);
      }
      timings.sort((a, b) => b[1] - a[1]);
      const gatedReasons = {};   // loud parking: why each remaining gated control could not be actuated
      for (const gid of gatedStill) {
        const oid = gid.replace(' (regen)', '');
        const gopt = controlled.find((o) => o.id === oid);
        const gel = gopt && els0[oid];
        let why = gel ? (gel.disabled ? 'disabled' : gel.hidden ? 'hidden' : gel.closest('[hidden]') ? 'inside [hidden] container' : 'not gated at report time') : 'control element not found';
        try { const un = RF.Options.unmet(oid, u.dvOpts, { renderer: V.three ? 'gpu' : 'cpu' }); const req = un.filter((x) => x.kind === 'requires').map((x) => x.rule || JSON.stringify(x.cond || {}).slice(0, 60)); if (req.length) why += '; unmet: ' + req.join(', '); } catch (e) {}
        gatedReasons[gid] = why;
      }
      const nFails = ['exists', 'ui2store', 'baseline', 'descriptor'].reduce((n, k) => n + F[k].length, 0);
      return { swept, passed, nFails, truncated, regenDeferred, stillSuspects, F, gatedOpened, gatedStill, preconds: preconds.slice(0, 30), gatedReasons, slowest: timings.slice(0, 10), phases, lastOp, canary, elapsedS: Math.round((Date.now() - t0) / 1000), info: (() => { try { return RF.DriveAnim.stats(); } catch (e) { return null; } })() };
      } catch (e) {
      return { fatal: String(e && e.stack || e).slice(0, 400), lastOp, phases, canary, swept, passed, truncated: true, stillSuspects, F, gatedOpened, gatedStill, elapsedS: Math.round((Date.now() - t0) / 1000) };
      }

    });
    run('sweep returned');
    const J = (x) => typeof x === 'object' ? JSON.stringify(x) : String(x);
    if (!r || r.fatal) { fails++; console.log('[FAIL] fatal page error: ' + ((r && r.fatal) || 'no result') + ' (lastOp ' + ((r && r.lastOp) || '?') + ')'); }
    else {
      for (const k of ['exists', 'ui2store', 'baseline', 'descriptor']) for (const f of (r.F && r.F[k]) || []) { fails++; console.log('[FAIL] ' + f.name + ' — ' + J(f.detail)); }
      if (r.truncated) { fails++; console.log('[FAIL] truncated: internal budget exhausted — ' + J(r.phases)); }
      for (const s of (r.F && r.F.envLimited) || []) console.log('[SKIP] env-limited: ' + s);
      for (const s of (r.F && r.F.cpuStillChain) || []) console.log('[SKIP] cpuStill-chain (never click in a page test): ' + s);
      for (const s of (r.F && r.F.specRow) || []) console.log('[SKIP] no data-dv hook: ' + s);
      for (const s of (r.F && r.F.transport) || []) console.log('[SKIP] transport state: ' + s);
      for (const g of r.gatedStill || []) console.log('[SKIP] gated: ' + g + ((r.gatedReasons && r.gatedReasons[g]) ? ' — ' + r.gatedReasons[g] : ''));
      const clean = !fails && r.nFails === 0;
      console.log((clean ? '[PASS] ' : '[FAIL] ') + 'ASK1-3 full registry sweep: swept ' + r.swept + ', passed ' + r.passed + ', fails ' + r.nFails + ', gatedStill ' + (r.gatedStill || []).length + ', elapsed ' + r.elapsedS + 's, renderer ' + J(r.info && r.info.renderer));
      if (!clean) fails++;
    }
  } catch (e) {
    console.log('[FAIL] run error: ' + String(e && e.stack || e).slice(0, 400)); fails++;
  } finally {
    await browser.close();
  }
  process.exitCode = fails ? 1 : 0;
})();
