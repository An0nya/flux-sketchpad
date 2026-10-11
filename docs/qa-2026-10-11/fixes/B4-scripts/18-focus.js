const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  // collapse editor so we can see whether its contents are skipped
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(500);
  const stops = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const pane = a.closest('.pane'); return (a.id || a.dataset.collapse && 'collapse:' + a.dataset.collapse || a.dataset.expand && 'expand:' + a.dataset.expand || a.dataset.mode && 'mode:' + a.dataset.mode || a.dataset.disp && 'disp:' + a.dataset.disp || a.dataset.split && 'div:' + a.dataset.split || a.tagName + ':' + (a.textContent || '').trim().slice(0, 12)) + (pane ? '@' + pane.dataset.pane + (pane.classList.contains('collapsed') ? '(COLLAPSED)' : '') : '') + (r.width === 0 || r.height === 0 ? '[ZERO-SIZE]' : '') + (a.matches(':focus-visible') ? '' : '[no-focus-visible]'); }));
  }
  console.log(stops.join('\n'));
  // Escape behaviour: open details, Esc closes
  await page.click('#btn-details'); await page.waitForTimeout(200);
  const open1 = await page.evaluate(() => !document.getElementById('stats-full').hidden);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('details open', open1, 'after Esc open?', await page.evaluate(() => !document.getElementById('stats-full').hidden), 'focus now', await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
  // aria state of chrome toggles
  console.log(JSON.stringify(await page.evaluate(() => ({ collapseAria: [...document.querySelectorAll('button.collapse')].map(b => b.dataset.collapse + ' aria-expanded=' + b.getAttribute('aria-expanded')), tabsAria: [...document.querySelectorAll('[data-tab]')].map(b => b.dataset.tab + ' sel=' + b.getAttribute('aria-selected') + ' pressed=' + b.getAttribute('aria-pressed') + ' current=' + b.getAttribute('aria-current')), dividersAria: [...document.querySelectorAll('.divider')].map(d => d.dataset.split + ' valuenow=' + d.getAttribute('aria-valuenow')), heatDisp: [...document.querySelectorAll('#heat-display button')].map(b => b.dataset.disp + ' role=' + b.getAttribute('role') + ' checked=' + b.getAttribute('aria-checked')) }))));
  console.log(errors); await browser.close();
})();
