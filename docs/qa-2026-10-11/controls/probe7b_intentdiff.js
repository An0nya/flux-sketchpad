// Which intent fields differ between preset X after a chain vs preset X on a fresh page?
const { boot, pw } = require('./h.js');
const PAIRS = [['headlamp', 'spec-box'], ['stamps', 'parabola'], ['spec-box', 'headlamp'], ['tir', 'fresnel']];
async function applyPreset(page, name) {
  await page.selectOption('#preset-select', name); await page.click('#preset-confirm button.primary'); await page.waitForTimeout(300);
  return page.evaluate(() => { const it = RF.History.intent(RF.UI.store.scene); delete it.modeA.paint; return JSON.parse(JSON.stringify(it)); });
}
function diff(a, b, p = '') { const out = []; if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p + ': ' + JSON.stringify(a).slice(0, 80) + ' vs fresh ' + JSON.stringify(b).slice(0, 80)); return out; } for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diff(a[k], b[k], p + '.' + k)); return out; }
(async () => {
  const browser = await pw.chromium.launch();
  for (const [a, b] of PAIRS) {
    let s = await boot({ browser }); const fresh = await applyPreset(s.page, b); await s.ctx.close();
    s = await boot({ browser }); await applyPreset(s.page, a); const got = await applyPreset(s.page, b); await s.ctx.close();
    console.log(a, '→', b, diff(got, fresh).slice(0, 12));
  }
  await browser.close();
})();
