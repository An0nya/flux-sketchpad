// same number everywhere: report row value vs spot readout at the drawn marker vs hover card
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const out = await page.evaluate(() => {
    const ui = RF.UI, s = ui.spec, ev = s.ev, m = ui.store.scene.modeD, view = ui.vHeat, sh = ev.shift, res = [];
    for (const it of RF.Spec.itemsOf(m)) {
      if (it.kind !== 'point') continue;
      const row = ev.rows.find((r) => r.id === it.id), p = view.toScreen(it.h + sh[0], it.v + sh[1]);
      const ro = RF.SpecUI.readout(ui, view, p[0], p[1]);
      const hit = RF.SpecUI.itemAt(ui, view, p[0], p[1]);
      const cv = document.getElementById('heat-canvas'); RF.SpecUI.showCard(ui, cv, it, p[0], p[1]);
      const card = cv.parentElement.querySelector('.spec-card').innerText.replace(/\n/g, ' | ');
      const t = RF.SpecUI.rowText(row);
      res.push({ name: it.name, rowVal: Math.round(row.value), rowAt: row.at, readoutCd: Math.round(ro.cd), readHV: [+ro.h.toFixed(3), +ro.v.toFixed(3)], expectHV: [it.h + sh[0], it.v + sh[1]], itemAt: hit && hit.name, got: t.got, card });
    }
    return res;
  });
  for (const r of out) console.log(JSON.stringify(r));
  console.log('errors', errors);
  await browser.close();
})();
