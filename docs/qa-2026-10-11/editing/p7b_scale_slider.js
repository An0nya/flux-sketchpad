const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.loadPreset(page, 'stamps'); await L.idle(page);
  const S = () => page.evaluate(() => { const sc = RF.UI.store.scene, st = sc.modeB.stamps.find((t) => t.id === sc.modeB.selected), r = (RF.UI.store.reports.B || []).find((x) => x.id === st.id); const sl = document.querySelector('input[type=range][data-control="B.scale"]'); return { scale: +st.scale.toFixed(2), slider: sl && [sl.min, sl.max, sl.value].map((x) => (+x).toFixed(2)), ok: r && r.ok, reasons: r && r.reasons, past: RF.UI.hist.past.length }; });
  console.log('start', JSON.stringify(await S()));
  for (const k of ['Home', 'End']) { await page.focus('input[type=range][data-control="B.scale"]'); await page.keyboard.press(k); await page.waitForTimeout(400); console.log(k, JSON.stringify(await S())); }
  // drag the slider thumb past both ends with the mouse
  const b = await page.evaluate(() => { const r = document.querySelector('input[type=range][data-control="B.scale"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  await L.drag(page, [[b[0] + b[2] - 3, b[1] + b[3] / 2], [b[0] - 200, b[1] + b[3] / 2]], 10); await page.waitForTimeout(400);
  console.log('mouse drag left past end', JSON.stringify(await S()));
  // undo the scale change
  await page.click('#btn-undo'); await page.waitForTimeout(400); console.log('undo', JSON.stringify(await S()));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
