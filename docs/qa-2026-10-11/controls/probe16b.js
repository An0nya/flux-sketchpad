// Which intent fields change when you only click mode tabs? Do they create undo entries?
const { boot } = require('./h.js');
(async () => {
  const { browser, page } = await boot(); await page.waitForTimeout(1500);
  const it = () => page.evaluate(() => JSON.parse(JSON.stringify(RF.History.intent(RF.UI.store.scene))));
  const n = () => page.evaluate(() => RF.UI.hist.past.map((e) => e.label));
  const a = await it(), h0 = await n();
  for (const m of ['B', 'C', 'D', 'A']) { await page.click('.modes button[data-mode="' + m + '"]'); await page.waitForTimeout(150); }
  await page.waitForTimeout(3000);
  const b = await it();
  const diff = (x, y, p = '') => (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) ? (JSON.stringify(x) === JSON.stringify(y) ? [] : [p + ': ' + String(JSON.stringify(x)).slice(0, 80) + ' → ' + String(JSON.stringify(y)).slice(0, 80)]) : [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => diff(x[k], y[k], p + '.' + k));
  console.log(diff(a, b).slice(0, 10)); console.log('undo labels before', h0, 'after', await n());
  await browser.close();
})();
