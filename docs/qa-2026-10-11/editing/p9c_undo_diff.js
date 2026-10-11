const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'parabola'); await L.idle(page);
  const r = await L.rect(page, 'left-canvas');
  for (let i = 0; i < 2; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.85); await page.waitForTimeout(600); }
  const D = () => page.evaluate(() => {
    const H = RF.History, a = RF.UI.hist.base, b = H.intent(RF.UI.store.scene), out = [];
    const walk = (x, y, p) => { if (out.length > 20) return; if (H.key(x) === H.key(y)) return; if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { out.push(p + ': ' + JSON.stringify(x).slice(0, 120) + ' -> ' + JSON.stringify(y).slice(0, 120)); return; } const ks = new Set([...Object.keys(x), ...Object.keys(y)]); for (const k of ks) walk(x[k], y[k], p + '.' + k); };
    walk(a, b, ''); return { same: H.key(a) === H.key(b), out, past: RF.UI.hist.past.map((e) => e.label) };
  });
  console.log('before undo', JSON.stringify(await D()));
  await page.click('#btn-undo'); 
  for (const t of [0, 50, 300, 1500]) { await page.waitForTimeout(t); console.log('after undo +' + t, JSON.stringify(await D())); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
