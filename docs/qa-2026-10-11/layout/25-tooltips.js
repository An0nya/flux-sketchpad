const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  for (const m of ['A', 'D']) {
    await page.evaluate((m) => RF.UI.setMode(m), m); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const out = { noName: [], noTitleIconish: [], sameTitles: [] };
      for (const el of document.querySelectorAll('header button, .pane button, .pane select, .pane input, .pane label.tog, #footer button, .divider')) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const txt = (el.textContent || '').trim(), name = el.getAttribute('aria-label') || el.title || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || txt;
        if (!name) out.noName.push(el.outerHTML.slice(0, 90));
        if (txt.length <= 2 && !el.title && el.tagName === 'BUTTON') out.noTitleIconish.push((el.getAttribute('aria-label') || '') + ' "' + txt + '" ' + (el.closest('[id]') || {}).id);
      }
      return out;
    });
    console.log(m, JSON.stringify(r, null, 1));
  }
  console.log(errors.filter(e => !/clearZero/.test(e))); await browser.close();
})();
