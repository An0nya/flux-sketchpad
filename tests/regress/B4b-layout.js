// B4b: Editor / Result titles on one line; Fidelity on the Hits / Grid / Smooth row when it fits; Spec with the Result pane NOT expanded is compact
// (Road / Drive / Far-field buttons and the toolbars over the map hidden, shown when expanded); the Result map is not 0 px tall at 1280x720 + sidebar.
// node tests/regress/B4b-layout.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8832);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const open = async (browser, vp) => {
  const page = await browser.newPage({ viewport: vp });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  await page.waitForTimeout(800); return page;
};
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s), r = e && e.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, shown: getComputedStyle(e).display !== 'none' && r.height > 0 }; }, sel);
const spec = async (page) => { await page.evaluate(() => { RF.UI.setMode('D'); RF.UI.layout.collapsed.editor = false; RF.UI.layout.expanded = null; RF.UI.layoutGrid(); }); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(800); };
const expand = async (page) => { await page.evaluate(() => RF.UI.setPane('result', 'expand')); await page.waitForTimeout(700); };
(async () => {
  const browser = await pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }]) {
    const tag = vp.width + 'x' + vp.height, page = await open(browser, vp);
    ok(tag + ': page identifies as Flux', await page.evaluate(() => !!(window.RF && RF.UI)));
    const titles = async (when) => { const e = await rect(page, '.editor-pane h2'), r = await rect(page, '.result-pane h2'); ok(tag + ' ' + when + ': Editor and Result titles on the same line', Math.abs(e.y - r.y) <= 1, 'editor y ' + e.y + ', result y ' + r.y); };
    await titles('Paint');
    const hits = await rect(page, '[data-disp=hits]'), fid = await rect(page, '[data-disp=fid]'), smooth = await rect(page, '[data-disp=smooth]');
    if (vp.width === 1500) ok(tag + ' Paint: Fidelity on the Hits / Grid / Smooth row', Math.abs(fid.y - hits.y) <= 1, 'hits y ' + hits.y + ', fidelity y ' + fid.y);
    else ok(tag + ' Paint: Fidelity never overlaps Smooth', fid.y > smooth.y + 10 || fid.x >= smooth.x + smooth.w - 1, 'smooth ' + Math.round(smooth.x) + '+' + Math.round(smooth.w) + '@' + Math.round(smooth.y) + ', fidelity ' + Math.round(fid.x) + '@' + Math.round(fid.y));
    await spec(page);
    await titles('Spec');
    for (const d of ['ff', 'road', 'drive']) {
      await page.evaluate((d) => RF.UI.setDisplay(d), d); await page.waitForTimeout(500);
      const hid = async () => { const o = {}; for (const s of ['[data-disp=road]', '[data-disp=drive]', '[data-disp=ff]', '.ff-tools', '.road-tools', '.drive-tools']) { const r = await rect(page, s); o[s] = !!(r && r.shown); } return o; };
      const h = await hid(); ok(tag + ' Spec ' + d + ', Result not expanded: extra Spec controls hidden', Object.values(h).every((v) => !v), JSON.stringify(h));
      const heat = await rect(page, '#heat-canvas'); ok(tag + ' Spec ' + d + ', Result not expanded: map is not collapsed', heat.h >= 40, 'heat canvas height ' + Math.round(heat.h));
      await expand(page);
      const want = { ff: ['[data-disp=road]', '.ff-tools'], road: ['[data-disp=road]', '.road-tools'], drive: ['[data-disp=drive]', '.drive-tools'] }[d];
      const sh = []; for (const s of want) sh.push((await rect(page, s)).shown);
      ok(tag + ' Spec ' + d + ', Result expanded: view buttons and toolbar shown', sh.every(Boolean), want.join(' + ') + ' ' + JSON.stringify(sh));
      await expand(page);
    }
    await page.close();
  }
  { // phone: panes are tabs with no expand button, so nothing is hidden
    const page = await open(browser, { width: 375, height: 812 }); await spec(page);
    await page.evaluate(() => RF.UI.setPane('result', 'activate')); await page.waitForTimeout(400);
    ok('375x812 Spec: Far field button still available (no expand on phones)', (await rect(page, '[data-disp=ff]')).shown);
    await page.close();
  }
  await browser.close();
  console.log(fails ? '[FAIL] ' + fails + ' check(s) failed' : '[PASS] all checks passed'); process.exitCode = fails ? 1 : 0;
})();
