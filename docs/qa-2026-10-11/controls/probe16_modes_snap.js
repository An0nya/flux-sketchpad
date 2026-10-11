// (1) every order of the 4 mode tabs: intent unchanged? errors? (2) snapshot Save → edit → Restore (2-step confirm). (3) paint undo + profile undo, one line each.
const { boot } = require('./h.js');
const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
(async () => {
  const { browser, page, errors } = await boot();
  const key = () => page.evaluate(() => RF.History.key(RF.History.intent(RF.UI.store.scene)));
  const k0 = await key(); let bad = 0;
  for (const p of perms(['A', 'B', 'C', 'D'])) { for (const m of p) { await page.click('.modes button[data-mode="' + m + '"]'); await page.waitForTimeout(60); }
    const k = await key(); const mode = await page.evaluate(() => RF.UI.store.scene.mode); if (k !== k0 || mode !== p[3]) { bad++; console.log('order', p.join(''), 'intent changed:', k !== k0, 'mode', mode); } }
  console.log('mode orders tested 24, intent changes:', bad, 'distinct errors:', [...new Set(errors)].map((e) => e.slice(0, 90)));
  await page.click('.modes button[data-mode="A"]');
  // snapshot
  await page.evaluate(() => RF.UI.setControl('A.budget', 444)); await page.click('#btn-snapshot'); await page.waitForTimeout(200);
  await page.evaluate(() => RF.UI.setControl('A.budget', 11));
  await page.click('#btn-restore'); await page.click('#btn-restore'); await page.waitForTimeout(800);
  console.log('snapshot restore → budget', await page.evaluate(() => RF.UI.store.scene.modeA.budget), '| undo label', await page.evaluate(() => RF.UI.hist.past.slice(-1)[0].label));
  // paint undo
  const sum = () => page.evaluate(() => RF.UI.store.scene.modeA.paint.reduce((a, b) => a + b, 0).toFixed(2));
  const s0 = await sum(); const box = await page.locator('#left-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.85, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
  const s1 = await sum(); await page.click('#btn-undo'); await page.waitForTimeout(800); const s2 = await sum();
  console.log('paint sum before/after stroke/after undo:', s0, s1, s2, '| undo top', await page.evaluate(() => RF.UI.hist.future.slice(-1)[0] && RF.UI.hist.future.slice(-1)[0].label));
  // profile undo: Mode C, apply preset change via control, then undo
  await page.click('.modes button[data-mode="C"]'); await page.waitForTimeout(300);
  const pr = () => page.evaluate(() => RF.UI.store.scene.modeC.profile.length + ' pts, kind ' + RF.UI.store.scene.modeC.preset.kind);
  const p0 = await pr(); await page.selectOption('#side select[data-control="C.preset"]', 'cone'); await page.waitForTimeout(400); const p1 = await pr();
  await page.click('#btn-undo'); await page.waitForTimeout(800); console.log('profile:', p0, '→', p1, '→ undo →', await pr());
  console.log('errors', [...new Set(errors)].map((e) => e.slice(0, 100)));
  await browser.close();
})();
