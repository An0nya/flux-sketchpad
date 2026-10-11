// mid-solve actions: node p5_battery.js <scenario>
const H = require('./h.js');
const pick = (id) => `(() => { const s = document.querySelector('#solver-box select[aria-label=Solver]'); s.value = '${id}'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`;
const S = {
  builtin: async (p) => p.evaluate(pick('spoke')),
  worker: async (p) => p.evaluate(pick('patch-array')),
  modeB: async (p) => p.evaluate(() => document.querySelector('.modes button[data-mode=B]').click()),
  modeD: async (p) => p.evaluate(() => document.querySelector('.modes button[data-mode=D]').click()),
  presetStamps: async (p) => p.evaluate(() => { const s = document.getElementById('preset-select'); s.value = 'stamps'; s.dispatchEvent(new Event('change')); document.querySelector('#preset-confirm button.primary').click(); }),
  presetHead: async (p) => p.evaluate(() => { const s = document.getElementById('preset-select'); s.value = 'headlamp'; s.dispatchEvent(new Event('change')); document.querySelector('#preset-confirm button.primary').click(); }),
  undo: async (p) => p.evaluate(() => RF.UI.undo()),
  watchOff: async (p) => p.evaluate(() => { const c = document.getElementById('watch-solve'); c.checked = false; c.dispatchEvent(new Event('change')); }),
  refine: async (p) => p.evaluate(() => RF.UI.refine()),
  stopTwice: async (p) => p.evaluate(() => { RF.UI.stopSolve(); RF.UI.stopSolve(); }),
};
(async () => {
  const sc = process.argv[2], solver = process.argv[3] || 'fill-fix';
  const { browser, page, errors, workers, st, start } = await H.boot();
  await start(solver); await page.waitForTimeout(1500);
  const a = await st(); console.log('[' + sc + '] before', a.solving && a.solving.name, a.status);
  const r = await S[sc](page);
  await page.waitForTimeout(400);
  const b = await st(); console.log('[' + sc + '] +0.4s', JSON.stringify(b), r === undefined ? '' : 'ret=' + JSON.stringify(r));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 }).catch(() => console.log('still solving at 60 s'));
  await page.waitForTimeout(2500);
  const c = await st(); console.log('[' + sc + '] end', JSON.stringify(c));
  console.log('[' + sc + '] workers', workers.size, [...workers].map((w) => w.url().split('/').pop()).join(','), 'errors', JSON.stringify(errors));
  await browser.close();
})();
