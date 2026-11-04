// DL page checks: the drive layout places every named control, unplaced() is empty AND not vacuous, and every
// placed control is visible with a labelled group. Serve the worktree first: python3 tests/serve.py <port>, then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/DL-drive-layout.js <port>
// Exits 1 on any failure.
//
// Origin: qwen3.8max/app-edits/merge-8b553f4-review/layout-page.js (gpuq page lane, async(gpuq) shape), rewritten as a
// standalone tests/regress/ page test by pencroff. The in-page logic is preserved: the same 21 KEYS, the same
// where()/probe()/vis() walks, the same per-pane visibility measurement (only the selected pane is displayed, so a
// control is measured with its own tab active), and the same not-vacuous unplaced() check (place() skips a selector
// that matches nothing, so a never-created control is neither placed nor in Other — the walk catches that loudly).
// Translations from the gpuq lane: gpuq.pageShot('scene-tab') -> page.screenshot (a PNG saved beside the test, for a
// human to eyeball; not asserted pixel-wise); gpuq.info() -> RF.DriveAnim.stats() (renderer/gpuFailure) + pageerror
// list. The lane's `RF.DriveLayout.select/setOpen` calls are unchanged (they are app API, not gpuq helpers).
//
// PIN: tests/serve.py injects tests/pinned-defaults.js before the registry. This check is OPTION-INDEPENDENT — it
// reads DOM placement and visibility of layout controls, which the pinned defaults do not move (the layout is built
// from the LAYOUT table in drive-layout.js, not from option values). Stated for the reviewer per cyrus's note.
const path = require('path'), fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8845);
const SHOT = path.join(__dirname, 'DL-scene-tab.png');
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await pw.chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
    // Pre-dismiss the first-run overlays (AGENTS.md "Driving the app") so they don't cover the layout.
    await page.addInitScript(() => { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store, null, { timeout: 60000 });
    // Open the drive view the way DC-drive-controls does: load the default scene, Spec mode, then Drive display.
    // The default scene is already solved, so Drive appears without a Rebuild.
    await page.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.driveLayout, null, { timeout: 120000 });

    const result = await page.evaluate(async () => {
      const RF = window.RF;
      const out = { step: [] };
      out.hasDriveLayout = !!(RF && RF.DriveLayout);
      out.hasUiLayout = !!(RF && RF.UI && RF.UI.driveLayout);
      if (!out.hasUiLayout) { out.step.push('RF.UI.driveLayout is not built — the drive view never opened'); return out; }

      const KEYS = [
        ['anim', 'endlessRoad'], ['anim', 'elevatedView'], ['anim', 'endlessPreset'], ['anim', 'endlessPresetCustom'],
        ['anim', 'tileTerrain'], ['anim', 'multilaneRoad'], ['anim', 'endlessTunnel'], ['anim', 'endlessCrossing'],
        ['anim', 'junctionGantries'], ['anim', 'yawSmooth'],
        ['anim', 'cabinView'], ['anim', 'cabinStyle'], ['anim', 'cabinLight'], ['anim', 'cabinFovFrame'],
        ['anim', 'driftMode'], ['anim', 'driftDynamics'], ['anim', 'driftAfs'], ['anim', 'driftCabin'],
        ['dv', 'wetVeil'], ['dv', 'trafficMarkers'], ['dv', 'trafficLighting'],
        ['anim', 'imperial-units'],
      ];
      const where = (el) => {
        if (!el) return 'MISSING-FROM-DOM';
        const g = el.closest('[data-dl-group]');
        if (g) return g.getAttribute('data-dl-group');
        const other = RF.UI.driveLayout.other;
        if (other && other.row.contains(el)) return 'PERFORMANCE>OTHER (unplaced)';
        return 'outside-any-group:' + (el.parentElement ? el.parentElement.className || el.parentElement.tagName : '?');
      };
      const probe = () => {
        const found = {};
        for (const [kind, k] of KEYS) {
          const sel = kind === 'dv' ? '[data-dv="' + k + '"]' : '[data-anim="' + k + '"]';
          const el = document.querySelector(sel);
          found[k] = where(el);
        }
        return found;
      };

      // walk every tab so each pane's creators have run and place() has been called for them
      for (const tab of ['lighting', 'scene', 'performance']) {
        RF.DriveLayout.select(RF.UI, { tab });
        if (tab === 'lighting') for (const sub of ['oncoming', 'ours', 'lamps', 'glare']) RF.DriveLayout.select(RF.UI, { sub });
        await new Promise((r) => setTimeout(r, 120));
      }
      out.layoutRows = RF.DriveLayout.LAYOUT.length;
      out.unplaced = RF.DriveLayout.unplaced(RF.UI);
      out.unplacedCount = out.unplaced.length;
      out.placement = probe();
      out.missingFromDom = Object.keys(out.placement).filter((k) => out.placement[k] === 'MISSING-FROM-DOM');
      out.inOther = Object.keys(out.placement).filter((k) => /OTHER/.test(out.placement[k]));
      out.groupsSeen = [...new Set(Object.values(out.placement))].sort();

      // VISIBILITY: DOM placement alone does not prove a control is on screen. Measured PER TAB, because only the
      // selected pane is displayed. data-dl-group is 'tab/sub/title', so the tab to select is derived from where
      // place() actually put the control, not hardcoded.
      const vis = (el) => { if (!el) return null; const u = el.closest('.drive-slider') || el; const r = u.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), shown: !!u.offsetParent && r.width > 0 && r.height > 0 }; };
      const selOf = (k) => (KEYS.find((x) => x[1] === k)[0] === 'dv' ? '[data-dv="' + k + '"]' : '[data-anim="' + k + '"]');
      const byPane = new Map();
      for (const [, k] of KEYS) { const g = out.placement[k] || '?'; const p1 = g.indexOf('/'); const rest = g.slice(p1 + 1);
        const key = g.slice(0, p1) + '|' + rest.slice(0, rest.indexOf('/')); if (!byPane.has(key)) byPane.set(key, []); byPane.get(key).push(k); }
      out.visible = {}; out.groupLabels = [];
      for (const [key, ks] of byPane) {
        const [tab, sub] = key.split('|');
        RF.DriveLayout.select(RF.UI, sub ? { tab, sub } : { tab });
        RF.DriveLayout.setOpen(RF.UI, 'left', true);
        await new Promise((r) => setTimeout(r, 450));
        for (const k of ks) out.visible[k] = vis(document.querySelector(selOf(k)));
        for (const h of document.querySelectorAll('[data-dl-group] > h4')) {
          const g = h.parentElement.getAttribute('data-dl-group');
          if (!ks.some((k) => out.placement[k] === g)) continue;
          if (out.groupLabels.some((x) => x.g === g)) continue;
          const r = h.getBoundingClientRect();
          out.groupLabels.push({ g, text: h.textContent, w: Math.round(r.width), h: Math.round(r.height), tab });
        }
      }
      out.hiddenControls = Object.keys(out.visible).filter((k) => !out.visible[k] || !out.visible[k].shown);
      out.unlabelledGroups = out.groupLabels.filter((x) => !x.text || x.w === 0 || x.h === 0).map((x) => x.g);
      // stats() replaces gpuq.info(): renderer + gpuFailure are the fields the lane read.
      const st = RF.DriveAnim && RF.DriveAnim.stats ? RF.DriveAnim.stats() : {};
      out.renderer = st.renderer; out.gpuFailure = st.gpuFailure || '';
      out.verdict = (out.unplacedCount === 0 && out.inOther.length === 0 && out.missingFromDom.length === 0
          && out.hiddenControls.length === 0 && out.unlabelledGroups.length === 0)
        ? 'PASS: all 21 placed, unplaced() empty and NOT vacuous, all visible, all groups labelled'
        : 'CHECK: unplaced=' + JSON.stringify(out.unplaced) + ' inOther=' + JSON.stringify(out.inOther)
          + ' missing=' + JSON.stringify(out.missingFromDom) + ' hidden=' + JSON.stringify(out.hiddenControls)
          + ' unlabelled=' + JSON.stringify(out.unlabelledGroups);
      return out;
    });

    // The shot the original lane took (gpuq.pageShot('scene-tab')) — saved for a human eyeball, not pixel-asserted.
    await page.evaluate(() => { RF.DriveLayout.select(RF.UI, { tab: 'scene' }); RF.DriveLayout.setOpen(RF.UI, 'left', true); });
    await sleep(400);
    await page.screenshot({ path: SHOT });

    // Translate the in-page JSON into gate checks.
    ok('RF.DriveLayout is present', !!result.hasDriveLayout);
    ok('RF.UI.driveLayout is built (the drive view opened)', !!result.hasUiLayout, result.step);
    ok('unplaced() is empty', result.unplacedCount === 0, result.unplaced);
    ok('no control landed in Performance > Other (unplaced, not vacuous)', (result.inOther || []).length === 0, result.inOther);
    ok('no named control is missing from the DOM', (result.missingFromDom || []).length === 0, result.missingFromDom);
    ok('all 21 named controls are visible in their own pane', (result.hiddenControls || []).length === 0, result.hiddenControls);
    ok('every group has a non-empty, non-zero-size label', (result.unlabelledGroups || []).length === 0, result.unlabelledGroups);
    ok('the GPU renderer is on (three)', result.renderer === 'three', { renderer: result.renderer, gpuFailure: result.gpuFailure });
    ok('no GPU failure', !result.gpuFailure, result.gpuFailure);
    ok('no page or console errors', errors.length === 0, errors.slice(0, 5));
    ok('VERDICT: ' + (result.verdict || ''), result.verdict && /^PASS/.test(result.verdict), { groupsSeen: result.groupsSeen, layoutRows: result.layoutRows });
  } finally {
    await browser.close();
  }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' DL page check(s) FAILED' : 'all ' + checks.length + ' DL page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('[FAIL] DL harness: ' + (e && e.stack || e)); process.exitCode = 1; });
