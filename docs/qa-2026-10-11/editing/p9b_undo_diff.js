const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'parabola'); await L.idle(page);
  const r = await L.rect(page, 'left-canvas');
  for (let i = 0; i < 2; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.85); await page.waitForTimeout(600); }
  await page.click('#btn-undo'); await page.waitForTimeout(400);
  const diff = await page.evaluate(() => {
    const a = RF.UI.hist.base, b = RF.History.intent(RF.UI.store.scene), out = [];
    const walk = (x, y, p) => { if (out.length > 20) return; if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p + ': ' + JSON.stringify(x).slice(0, 80) + ' -> ' + JSON.stringify(y).slice(0, 80)); return; } const ks = new Set([...Object.keys(x), ...Object.keys(y)]); for (const k of ks) walk(x[k], y[k], p + '.' + k); };
    walk(a, b, ''); return out;
  });
  console.log('intent diff base vs live after one undo:', JSON.stringify(diff, null, 1));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
