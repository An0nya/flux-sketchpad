const H = require('./h.js');
(async () => {
  const { browser, page, errors, workers, st } = await H.boot();
  console.log(JSON.stringify(await st(), null, 1));
  console.log(await page.evaluate(() => JSON.stringify(RF.Solvers.list().map((d) => [d.id, d.worker ? 'W' : 'B', d.modes, d.bundled && d.bundled.group]))));
  console.log('workers', workers.size, [...workers].map((w) => w.url()));
  console.log(await page.evaluate(() => [...document.querySelectorAll('select')].map((s) => s.id + ':' + s.options.length).join(' ')));
  console.log(await page.evaluate(() => [...document.querySelectorAll('button')].filter((b)=>b.id).map((b) => b.id).join(' ')));
  console.log('errors', errors);
  await browser.close();
})();
