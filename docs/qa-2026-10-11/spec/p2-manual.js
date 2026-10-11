// manual aim: does every dependent view follow? footer tiles, report, ff aim marker, road shift
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const snap = (tag) => page.evaluate((tag) => { const ui = RF.UI, s = ui.spec, ev = s.ev, rd = RF.SpecUI.roadModel(ui);
    return { tag, aimMode: ui.store.scene.modeD.aimMode, manual: ui.store.scene.modeD.aimManual, shift: ev.shift, note: ev.aim.note, n: ev.n,
      reportHead: document.querySelector('#spec-report .spec-verdict').innerText, reportAim: document.querySelector('#spec-report .note').innerText,
      footer: [...document.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\n/g, ' | ')).slice(0, 6),
      roadSh: rd && rd.sh, reach: rd && [rd.iihs.right, rd.iihs.left] }; }, tag);
  console.log(JSON.stringify(await snap('before')));
  // use the real UI: open Measurement section, set Aim select to manual, type values
  const r = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('#spec-box select')]; const aim = sels.find((s) => [...s.options].some((o) => o.value === 'manual'));
    aim.value = 'manual'; aim.dispatchEvent(new Event('change', { bubbles: true }));
    const h = document.querySelector('input[aria-label="Manual aim, beam right"]'), v = document.querySelector('input[aria-label="Manual aim, beam up"]');
    h.value = '1'; h.dispatchEvent(new Event('change', { bubbles: true })); v.value = '-0.5'; v.dispatchEvent(new Event('change', { bubbles: true }));
    return true; });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await snap('after manual 1R -0.5up')));
  await page.screenshot({ path: __dirname + '/p2-manual.png' });
  console.log('errors', errors);
  await browser.close();
})();
