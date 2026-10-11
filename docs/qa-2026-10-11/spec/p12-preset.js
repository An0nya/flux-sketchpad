// switching standard ECE R112 B → FMVSS LB2V through the real preset control: does every dependent view follow?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => { window.__txt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { if (this.canvas && this.canvas.id === 'heat-canvas') window.__txt.push(String(t)); return f.apply(this, arguments); }; });
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const snap = (tag) => page.evaluate((tag) => { const ui = RF.UI, m = ui.store.scene.modeD, s = ui.spec, ev = s.ev, rd = RF.SpecUI.roadModel(ui);
    const rowVal = (re) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r && r.querySelector('input,select'); return i ? i.value : null; };
    const aimLbl = window.__txt.filter((x) => /^aim:/.test(x)).slice(-1)[0]; window.__txt = [];
    return { tag, preset: m.preset, sel: document.querySelector('#spec-box select[aria-label="Spec preset"]').value, items: m.items.length, rows: ev.rows.length, aimMode: m.aimMode, aimLine: m.aimLine, itemReaim: m.itemReaim, dist: m.distance, kernel: m.kernel, n: ev.n, note: ev.aim.note,
      ui: { aim: rowVal('^Aim$'), aimLine: rowVal('^Aim line'), reaimPt: rowVal('^Re-aim per point'), kernel: rowVal('^Kernel'), mountH: rowVal('^Mounting height'), lane: rowVal('^Lane width') },
      road: { mountH: rd.mdl.road.mountH, lane: rd.lane, laneDrive: rd.laneDrive }, reachTip: ([...document.querySelectorAll('.tile')].find((t) => /reach/.test(t.innerText)) || {}).title, ffAim: aimLbl, measured: [...document.querySelectorAll('#spec-report .note')].map((n) => n.innerText).find((t) => /^Measured/.test(t)), src: document.getElementById('spec-source').textContent.slice(0, 80) }; }, tag);
  await page.evaluate(() => RF.UI.redrawSpec()); await page.waitForTimeout(300);
  console.log(JSON.stringify(await snap('ECE boot'), null, 0));
  await page.selectOption('#spec-box select[aria-label="Spec preset"]', 'fmvss-lb2v');
  const btn = page.locator('#spec-box button', { hasText: 'Load preset' }); await btn.click(); await page.locator('#spec-box button.confirming').click();
  const t0 = Date.now();
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => console.log('no solve started'));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 });
  await waitJudged(page, 240000); console.log('re-solve + judge', Date.now() - t0, 'ms');
  await page.evaluate(() => RF.UI.redrawSpec()); await page.waitForTimeout(500);
  console.log(JSON.stringify(await snap('after FMVSS LB2V'), null, 0));
  await page.screenshot({ path: __dirname + '/p12-fmvss.png' });
  console.log('errors', errors);
  await browser.close();
})();
