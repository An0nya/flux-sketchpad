// recompute counts per user action (judge, far-field build, road model, drive render)
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => {
    window.__c = {}; const wrap = (o, k, name) => { const f = o[k]; o[k] = function () { const t = performance.now(); const r = f.apply(this, arguments); const c = window.__c[name] || (window.__c[name] = { n: 0, ms: 0 }); c.n++; c.ms += performance.now() - t; return r; }; };
    wrap(RF.Spec, 'evaluate', 'evaluate'); wrap(RF.FarField, 'build', 'ffBuild'); wrap(RF.Road, 'model', 'roadModel'); wrap(RF.Drive, 'render', 'driveRender'); wrap(RF.Road, 'beamOf', 'beamOf');
    if (RF.BeamQuality) wrap(RF.BeamQuality, 'measure', 'bqMeasure'); if (RF.IdealBeam) wrap(RF.IdealBeam, 'check', 'idealCheck');
  });
  const step = async (label, fn, wait) => { await page.evaluate(() => { for (const k in window.__c) window.__c[k] = { n: 0, ms: 0 }; }); await fn(); await page.waitForTimeout(wait || 1500);
    const c = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.__c).filter(([k, v]) => v.n).map(([k, v]) => [k, v.n + '× ' + Math.round(v.ms) + 'ms'])))); console.log(label.padEnd(44), c); };
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); if (i.type === 'checkbox') i.checked = val; else i.value = val; i.dispatchEvent(new Event('change')); return true; }, [re, val]);
  await step('idle (nothing)', async () => {});
  await step('ff: zoom wheel x5', async () => { const b = await page.locator('#heat-canvas').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100); });
  await step('ff: toggle contours/overlay', async () => { await page.click('[data-ff="contours"]'); await page.click('[data-ff="overlay"]'); });
  await step('ff: hover over beam', async () => { const b = await page.locator('#heat-canvas').boundingBox(); for (let i = 0; i < 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2); });
  await step('switch display → road', async () => page.evaluate(() => RF.UI.setDisplay('road')));
  await step('road: toggle 3 lx outline', async () => page.click('[data-rv="lev3"]'));
  await step('road: Road view scale top = 20 (sidebar)', async () => setRow('^Road view: scale top', '20'));
  await step('road: stretch ×2 (sidebar)', async () => setRow('^Road view: sideways stretch', '2'));
  await step('switch display → drive', async () => page.evaluate(() => RF.UI.setDisplay('drive')), 3000);
  await step('drive: EV +', async () => page.click('[data-dv="evp"]'));
  await step('drive: RL = 150 (sidebar)', async () => setRow('^Drive view: marking', '150'), 3000);
  await step('drive: ambient = moon (sidebar)', async () => setRow('^Drive view: ambient', '0.2'), 3000);
  await step('drive: ideal-beam hotH = 0.5 (sidebar)', async () => setRow('^Hotspot centre H', '0.5'), 3000);
  await step('drive: hover picture', async () => { const b = await page.locator('#heat-canvas').boundingBox(); for (let i = 0; i < 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2); });
  await step('Measure at ∞ (display drive)', async () => page.click('#spec-box [data-dist="0"]'), 4000);
  await step('Kernel 0.2', async () => setRow('^Kernel', '0.2'), 4000);
  console.log('errors', errors);
  await browser.close();
})();
