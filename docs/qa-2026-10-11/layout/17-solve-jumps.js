const L = require('./lib');
(async () => {
  const vp = process.argv[2] === '375' ? { width: 375, height: 812 } : process.argv[2] === '1280' ? { width: 1280, height: 720 } : { width: 1500, height: 950 };
  const mob = vp.width < 500;
  const { browser, page, errors } = await L.open({ viewport: vp, mobile: mob, touch: mob });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const sels = { genTop: '#btn-generate-top', status: '#run-state', undo: '#btn-undo', sideBtn: '#btn-side', leftCv: '#left-canvas', heatCv: '#heat-canvas', sceneCv: '#scene-canvas', surfCv: '#surface-canvas', footer: '#footer', minRow: '#min-row', details: '#btn-details', tabs: '#pane-tabs', heatDisp: '#heat-display', sideRebuild: '#btn-generate', sideSolver: '#sidebar select', sideTop: '.side-top', paneEd: '.editor-pane .pane-head', caption: '#right-caption', colorbar: '#colorbar' };
    window.__rects = {}; window.__solvingSeen = false;
    const snap = () => { if (RF.UI.solving) window.__solvingSeen = true; for (const [k, s] of Object.entries(sels)) { const e = document.querySelector(s); if (!e) continue; const r = e.getBoundingClientRect(); const v = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','); (window.__rects[k] = window.__rects[k] || new Map()); const m = window.__rects[k]; m.set(v, (m.get(v) || 0) + 1); } window.__raf = requestAnimationFrame(snap); };
    snap();
  });
  await page.click('#btn-generate-top');
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }).catch(() => console.log('never saw solving'));
  await page.waitForFunction(() => document.getElementById("footer").getBoundingClientRect().height > 60, null, { timeout: 60000 }).catch(() => console.log("footer never grew")); await page.waitForTimeout(100); await page.screenshot({ path: L.SH + `solve-${vp.width}-during.png` });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: L.SH + `solve-${vp.width}-after.png` });
  const out = await page.evaluate(() => { cancelAnimationFrame(window.__raf); const o = {}; for (const [k, m] of Object.entries(window.__rects)) if (m.size > 1) o[k] = [...m.entries()].map(([v, n]) => v + ' x' + n); return { seen: window.__solvingSeen, ms: RF.UI.lastGenMs, moved: o }; });
  console.log(JSON.stringify(out, null, 1));
  console.log(errors); await browser.close();
})();
