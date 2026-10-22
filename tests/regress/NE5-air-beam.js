// NE5 page checks: the top 'air beam' dropdown (levels and bundles), the collapsed 'advanced air beam' group, the haze select,
// ?reset, and the derived value. Headless software GL: no visual claims. Exits 1 on any failure.
// Run: python3 tests/serve.py <port> (background), then PLAYWRIGHT=... node tests/regress/NE5-air-beam.js <port>
// Screenshots are written only when NE5_SHOTS=<dir> is set (the gate does not set it).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8995);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const WANT = { baseline: ['half', 'strong'], low: ['half', 'strong'], medium: ['half', 'mid'], high: ['full', 'mid'], max: ['full', 'off'] };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const url = 'http://127.0.0.1:' + port + '/index.html';
    const boot = async (u) => { await page.goto(u); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 }); await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500); };
    await boot(url);
    await page.evaluate(() => localStorage.clear()); await boot(url);   // a fresh page with default storage
    const fresh = await page.evaluate(() => ({ scatter: RF.UI.dvOpts.scatter, mode: RF.UI.dvOpts.scatterMode, visibility: RF.UI.dvOpts.visibility, level: document.querySelector('[data-dv="airLevel"]').value }));
    ok('NE5 default air beam is off on a fresh page (scatter 0, direct, clear, top value off)', fresh.scatter === 0 && fresh.mode === 'direct' && fresh.visibility === null && fresh.level === 'off', JSON.stringify(fresh));
    const pick = async (k, v) => { await page.evaluate(([key, val]) => { const s = document.querySelector('[data-dv="' + key + '"]'); s.value = val; s.dispatchEvent(new Event('change')); }, [k, v]); await sleep(2500); };
    const opt = () => page.evaluate(() => { const o = RF.UI.dvOpts; return { scatter: o.scatter, scatterMode: o.scatterMode, scatterRes: o.scatterRes, scatterBlur: o.scatterBlur, scatterCache: o.scatterCache, scatterCycle: o.scatterCycle, scatterQuality: o.scatterQuality, visibility: o.visibility, scatterBinCounts: o.scatterBinCounts, scatterNearBias: o.scatterNearBias }; });
    const selVal = (k) => page.evaluate((key) => { const s = document.querySelector('[data-dv="' + key + '"]'); return s ? s.value : null; }, k);
    const binN = () => page.evaluate(() => SD_SCATTER.binN);

    // 1. the top dropdown and the group
    const levels = await page.evaluate(() => [...document.querySelector('[data-dv="airLevel"]').options].map((o) => o.value));
    ok('NE5 top dropdown: values off, baseline, low, medium, high, max, custom', JSON.stringify(levels) === JSON.stringify(['off', 'baseline', 'low', 'medium', 'high', 'max', 'custom']), JSON.stringify(levels));
    const grp = await page.evaluate(() => { const d = document.querySelector('details.drive-air-adv'); return d ? { open: d.open, inside: !!d.closest('details.drive-more'), has: ['scatter', 'scatterMode', 'scatterRes', 'scatterBlur', 'scatterCache', 'scatterCycle', 'scatterNearFadeRange', 'scatterNearBias', 'scatterBinCounts'].filter((k) => d.querySelector('[data-dv="' + k + '"]')).length } : null; });
    ok('NE5 advanced group: present, collapsed by default, inside More, holds the 9 advanced controls', !!grp && grp.open === false && grp.inside && grp.has === 9, JSON.stringify(grp));
    const scQ = await page.evaluate(() => !!document.querySelector('[data-dv="scatterQuality"]'));
    ok('NE5 the quality select has no control of its own (the top dropdown writes it)', scQ === false);
    await page.evaluate(() => { document.querySelector('details.drive-air-adv').open = true; }); await sleep(300);
    const stored = await page.evaluate(() => localStorage.getItem('flux/driveAirAdv'));
    ok('NE5 advanced group remembers open (stored true)', stored === 'true', String(stored));
    await page.evaluate(() => { document.querySelector('details.drive-air-adv').open = false; }); await sleep(300);
    ok('NE5 advanced group remembers closed (stored false)', (await page.evaluate(() => localStorage.getItem('flux/driveAirAdv'))) === 'false');

    // 2. haze select
    await pick('visibility', 'fog');
    ok('NE5 haze select: fog sets visibility 200 and reads back as fog', (await opt()).visibility === 200 && (await selVal('visibility')) === 'fog', JSON.stringify(await opt()));
    await pick('visibility', 'mist');
    ok('NE5 haze select: mist sets visibility 1000', (await opt()).visibility === 1000);
    await pick('visibility', 'fog');

    // 3. each level sets exactly its bundle, the counts read back from the table pass, and leaves visibility alone
    for (const name of ['baseline', 'low', 'medium', 'high', 'max']) {
      await pick('airLevel', name);
      const o = await opt(), b = await binN(), want = await page.evaluate((n) => RF.Drive.qualityCounts(n), name), total = want.reduce((a, c) => a + c, 0);
      const exact = o.scatter === 16 && o.scatterMode === 'table' && o.scatterQuality === name && o.scatterRes === WANT[name][0] && o.scatterBlur === WANT[name][1] && o.scatterCache === 'on' && o.scatterCycle === 8 && o.scatterBinCounts === '' && o.scatterNearBias === 0;
      ok('NE5 level ' + name + ': options set exactly (scatter 16, table, res ' + WANT[name][0] + ', blur ' + WANT[name][1] + ', cache on, cycle 8)', exact, JSON.stringify(o));
      ok('NE5 level ' + name + ': the table pass gets exactly its counts (total ' + total + ')', JSON.stringify(b) === JSON.stringify(want), JSON.stringify(b));
      ok('NE5 level ' + name + ': visibility untouched and the top value reads ' + name, o.visibility === 200 && (await selVal('airLevel')) === name, JSON.stringify([o.visibility, await selVal('airLevel')]));
    }
    const label = await page.evaluate(() => [...document.querySelector('[data-dv="airLevel"]').options].map((x) => x.textContent).find((t) => t.includes('high')));
    ok('NE5 label carries the total from the counts: "' + label + '"', label === 'air beam: high (74)', label);

    // 4. off: scatter 0, visibility untouched
    await pick('airLevel', 'off');
    const offO = await opt();
    ok('NE5 level off: scatter 0 and visibility untouched (200)', offO.scatter === 0 && offO.visibility === 200 && (await selVal('airLevel')) === 'off', JSON.stringify(offO));

    // 5. one advanced edit makes the top value custom; choosing a level again restores it
    await pick('airLevel', 'baseline');
    await pick('scatter', '2');
    ok('NE5 advanced edit (air beam steps 32): the top value reads custom', (await selVal('airLevel')) === 'custom' && (await opt()).scatter === 32, (await selVal('airLevel')) + ' scatter ' + (await opt()).scatter);
    await pick('airLevel', 'baseline');
    await pick('scatterNearBias', '1');
    ok('NE5 advanced edit (near sampling on): the top value reads custom', (await selVal('airLevel')) === 'custom');
    await pick('airLevel', 'baseline');
    ok('NE5 picking a level again restores the level value', (await selVal('airLevel')) === 'baseline');

    // 6. off keeps the other settings (only scatter goes to 0)
    await pick('airLevel', 'off');
    const offKeeps = await opt();
    ok('NE5 level off keeps the rest (only scatter changes: mode table, res half, blur strong from baseline)', offKeeps.scatter === 0 && offKeeps.scatterMode === 'table' && offKeeps.scatterRes === 'half' && offKeeps.scatterBlur === 'strong', JSON.stringify(offKeeps));

    // 7. screenshots (before ?reset: the reset load does not show the drive More panel) (only when asked): More open, the group collapsed, then expanded
    if (process.env.NE5_SHOTS) {
      fs.mkdirSync(process.env.NE5_SHOTS, { recursive: true });
      await page.evaluate(() => { document.querySelector('details.drive-more').open = true; document.querySelector('details.drive-air-adv').open = false; }); await sleep(800);
      await page.screenshot({ path: path.join(process.env.NE5_SHOTS, 'NE5-air-beam-collapsed-headless.png'), fullPage: false });
      await page.evaluate(() => { document.querySelector('details.drive-air-adv').open = true; }); await sleep(800);
      await page.screenshot({ path: path.join(process.env.NE5_SHOTS, 'NE5-air-beam-expanded-headless.png'), fullPage: false });
      await page.evaluate(() => { document.querySelector('details.drive-air-adv').open = false; });
      console.log('NE5_SHOTS written to ' + process.env.NE5_SHOTS);
    }
    // 6. (merge with SM) every level turns the cycle blend on; a level picked from clear air starts from the light haze, 'off' never touches the haze
    await pick('visibility', 'clear'); await pick('airLevel', 'medium');
    const clearPick = await page.evaluate(() => ({ visibility: RF.UI.dvOpts.visibility, fade: RF.UI.dvOpts.scatterCycleFade, level: document.querySelector('[data-dv="airLevel"]').value }));
    ok('NE5+SM a level picked from clear air sets the light haze (3 km) and the cycle blend on', clearPick.visibility === 3000 && clearPick.fade === 'on' && clearPick.level === 'medium', JSON.stringify(clearPick));
    await pick('airLevel', 'off');
    ok('NE5+SM off leaves the haze where it is (3000)', (await page.evaluate(() => RF.UI.dvOpts.visibility)) === 3000);
    await pick('visibility', 'fog'); await pick('airLevel', 'max');
    ok('NE5+SM a level picked with haze already set keeps that haze (fog 200)', (await page.evaluate(() => RF.UI.dvOpts.visibility)) === 200);
    // 7. ?reset restores the defaults
    await pick('airLevel', 'high'); await pick('visibility', 'dense');
    await page.goto(url + '?reset'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 }); await sleep(1500);
    const after = await page.evaluate(() => ({ scatter: RF.UI.dvOpts.scatter, visibility: RF.UI.dvOpts.visibility, quality: RF.UI.dvOpts.scatterQuality, mode: RF.UI.dvOpts.scatterMode, level: ((document.querySelector('[data-dv="airLevel"]') || {}).value) || null }));
    ok('NE5 ?reset restores the defaults (air off, visibility clear, quality steps; the top value is off or not shown)', after.scatter === 0 && after.visibility === null && after.quality === 'steps' && after.mode === 'direct' && (after.level === 'off' || after.level === null), JSON.stringify(after));

    ok('NE5 no page errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200));
  } catch (e) {
    ok('NE5 run completed', false, String(e).slice(0, 300));
  } finally {
    await browser.close();
  }
  const fails = checks.filter((c) => !c).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' NE5 checks passed (headless software GL; no visual claim)');
  process.exitCode = fails ? 1 : 0;
})();
