const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  const r = await page.evaluate(() => ({ title: document.title, mode: RF.UI.store.scene.mode, ls: Object.keys(localStorage),
    ctrls: [...document.querySelectorAll('#side [data-control]')].map((e) => e.tagName + ':' + (e.type||'') + ':' + e.dataset.control),
    presets: [...document.querySelectorAll('#preset-select option')].map((o) => o.value + '=' + o.text),
    uiKeys: Object.keys(RF.UI).filter((k) => typeof RF.UI[k] === 'function').join(' ') }));
  console.log(JSON.stringify(r, null, 1)); console.log('errors', errors);
  await browser.close();
})();
