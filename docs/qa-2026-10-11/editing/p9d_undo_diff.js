const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'parabola'); await L.idle(page);
  const r = await L.rect(page, 'left-canvas');
  for (let i = 0; i < 2; i++) { await page.mouse.click(r.x + r.w * (0.2 + 0.1 * i), r.y + r.h * 0.85); await page.waitForTimeout(600); }
  await page.evaluate(() => { window.__popped = RF.UI.hist.past[RF.UI.hist.past.length - 1].it; const orig = RF.UI.hist.checkpoint.bind(RF.UI.hist); RF.UI.hist.checkpoint = function (it, now, hint, mode) { const r = orig(it, now, hint, mode); if (r) window.__pushes = (window.__pushes || []).concat([{ label: r.label, stack: new Error().stack.split('\n').slice(1, 7).join(' | ') }]); return r; }; });
  await page.click('#btn-undo'); await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const H = RF.History, a = window.__popped, b = H.intent(RF.UI.store.scene), out = [];
    const walk = (x, y, p) => { if (out.length > 20) return; if (H.key(x) === H.key(y)) return; if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { out.push(p + ': ' + String(JSON.stringify(x)).slice(0, 160) + ' -> ' + String(JSON.stringify(y)).slice(0, 160)); return; } const ks = new Set([...Object.keys(x), ...Object.keys(y)]); for (const k of ks) walk(x[k], y[k], p + '.' + k); };
    walk(a, b, ''); return { out, pushes: window.__pushes };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
