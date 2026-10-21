// DD: heavy Drive options with 3+ values are dropdowns (air beam steps, beam blur, traffic halo, beam near fade). Choosing a value applies once.
// Beam res and beam cycle (two values each) stay buttons; their apply waits 500 ms after the last click. Saved values round-trip through reload, ?reset clears them.
// Run:  python3 tests/serve.py <port> &  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/DD-dropdowns.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const boot = async (path) => {
      await page.goto('http://127.0.0.1:' + port + path); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
      await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    };
    const setOpts = async (o) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(1500); };
    const pick = (k, v) => page.evaluate(([k, v]) => { const s = document.querySelector('select[data-dv="' + k + '"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
    const opt = (k) => page.evaluate((key) => ({ values: [...document.querySelector('select[data-dv="' + key + '"]').options].map((o) => o.value), value: document.querySelector('select[data-dv="' + key + '"]').value }), k);
    const opts = (k) => page.evaluate((key) => (RF.UI.dvOpts[key]), k);
    const redraws = () => page.evaluate(() => RF.UI.__rd);
    const btnLabel = (k) => page.evaluate((key) => document.querySelector('button[data-dv="' + key + '"]').textContent.trim(), k);

    await boot('/index.html');
    // 1. Each converted option is a select with the right values; res and cycle stay buttons.
    const want = { scatter: ['0', '1', '2', '3'], trafficHalo: ['0', '4', '8', '16'], scatterBlur: ['off', 'mid', 'strong'], scatterNearFadeRange: ['off', 'short', 'medium', 'long'] };
    for (const k of Object.keys(want)) {
      const s = await page.evaluate((key) => { const e = document.querySelector('[data-dv="' + key + '"]'); return e ? e.tagName : 'missing'; }, k);
      const got = await opt(k);
      ok('DD ' + k + ' is a select with values ' + want[k].join(', '), s === 'SELECT' && JSON.stringify(got.values) === JSON.stringify(want[k]), s + ' ' + JSON.stringify(got.values));
    }
    const tags = await page.evaluate(() => ['scatterRes', 'scatterCycle'].map((k) => { const e = document.querySelector('[data-dv="' + k + '"]'); return e ? e.tagName : 'missing'; }));
    ok('DD beam res and beam cycle stay buttons', tags.every((t) => t === 'BUTTON'), tags.join(','));

    // 2. Air on, table mode, cache on: the controls are live. Count redraws (setDV calls redrawSpec once per apply).
    await setOpts({ visibility: 200, scatterMode: 'table', scatterCache: 'on', scatter: 0, trafficHalo: 0, scatterBlur: 'off', scatterNearFadeRange: 'medium', scatterRes: 'half', scatterCycle: 0 });
    await page.evaluate(() => { const u = RF.UI; const f = u.redrawSpec; u.__rd = 0; u.redrawSpec = function () { u.__rd++; return f.apply(this, arguments); }; });
    await sleep(800);

    // 3. Choosing a value applies exactly once. Table mode: index 2 is 32 table steps.
    let r0 = await redraws();
    await pick('scatter', '2'); await sleep(700);
    ok('DD air beam: one choice applies once (table 32)', (await redraws()) - r0 === 1 && (await opts('scatter')) === 32, (await redraws()) - r0 + ' redraw(s), scatter ' + (await opts('scatter')));
    r0 = await redraws(); await pick('trafficHalo', '8'); await sleep(700);
    ok('DD traffic halo: one choice applies once (8)', (await redraws()) - r0 === 1 && (await opts('trafficHalo')) === 8, (await redraws()) - r0 + ' redraw(s), halo ' + (await opts('trafficHalo')));
    r0 = await redraws(); await pick('scatterBlur', 'strong'); await sleep(700);
    ok('DD beam blur: one choice applies once (strong)', (await redraws()) - r0 === 1 && (await opts('scatterBlur')) === 'strong', (await redraws()) - r0 + ' redraw(s)');
    r0 = await redraws(); await pick('scatterNearFadeRange', 'long'); await sleep(700);
    ok('DD near fade: one choice applies once (long)', (await redraws()) - r0 === 1 && (await opts('scatterNearFadeRange')) === 'long', (await redraws()) - r0 + ' redraw(s)');

    // 4. Beam res: three quick clicks (half to full to half to full). The label moves at once; the apply waits 500 ms after the last click.
    r0 = await redraws();
    await page.evaluate(() => { const b = document.querySelector('button[data-dv="scatterRes"]'); for (let i = 0; i < 3; i++) b.click(); });
    const resLabel = await btnLabel('scatterRes'), resEarly = (await redraws()) - r0, resValEarly = await opts('scatterRes');
    ok('DD beam res: label moves at once', resLabel === 'beam res: full', resLabel);
    ok('DD beam res: nothing applied inside the 500 ms window', resEarly === 0 && resValEarly === 'half', 'redraws ' + resEarly + ', stored ' + resValEarly);
    await sleep(800);
    ok('DD beam res: one apply after the last click', (await redraws()) - r0 === 1 && (await opts('scatterRes')) === 'full', (await redraws()) - r0 + ' redraw(s), stored ' + (await opts('scatterRes')));

    // 5. Beam cycle: one click is 0 to 8; the apply waits 500 ms.
    r0 = await redraws();
    await page.evaluate(() => document.querySelector('button[data-dv="scatterCycle"]').click());
    const cycLabel = await btnLabel('scatterCycle'), cycEarly = (await redraws()) - r0;
    ok('DD beam cycle: label moves at once and nothing applies yet', cycLabel === 'beam cycle: 8' && cycEarly === 0, cycLabel + ', redraws ' + cycEarly);
    await sleep(800);
    ok('DD beam cycle: one apply after the click (stored 8)', (await redraws()) - r0 === 1 && (await opts('scatterCycle')) === 8, (await redraws()) - r0 + ' redraw(s)');

    // 6. Saved values round-trip through reload.
    await boot('/index.html'); await sleep(800);
    const back = { scatter: await opt('scatter'), trafficHalo: await opt('trafficHalo'), scatterBlur: await opt('scatterBlur'), scatterNearFadeRange: await opt('scatterNearFadeRange') };
    ok('DD saved values reload into the selects', back.scatter.value === '2' && back.trafficHalo.value === '8' && back.scatterBlur.value === 'strong' && back.scatterNearFadeRange.value === 'long', JSON.stringify(back));
    ok('DD saved beam res and cycle reload too', (await btnLabel('scatterRes')) === 'beam res: full' && (await btnLabel('scatterCycle')) === 'beam cycle: 8');

    // 7. ?reset clears them.
    // ?reset loads without the UX2 lamp-trace helper (it turns on safe mode; UX3 checks the same way): read the saved key and the live options.
    await page.goto('http://127.0.0.1:' + port + '/index.html?reset'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 }); await sleep(1500);
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('flux/driveView') || '{}'); } catch (e) { return {}; } });
    const dv = await page.evaluate(() => { const o = RF.UI.dvOpts || {}; return { scatter: o.scatter, trafficHalo: o.trafficHalo, scatterBlur: o.scatterBlur, scatterNearFadeRange: o.scatterNearFadeRange }; });
    const cleared = ['scatter', 'trafficHalo', 'scatterBlur', 'scatterNearFadeRange'].every((k) => !(k in saved));
    ok('DD ?reset clears the saved dropdown values', cleared, JSON.stringify(saved).slice(0, 160));
    ok('DD ?reset leaves the dropdowns at their defaults', dv.scatter === 0 && dv.trafficHalo === 0 && dv.scatterBlur === 'off' && dv.scatterNearFadeRange === 'medium', JSON.stringify(dv));
    ok('DD nothing throws', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' DD checks FAILED' : 'all DD checks passed'); process.exit(fails ? 1 : 0);
})();
