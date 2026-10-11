// abort() while the worker is being rebuilt after a previous abort
const H = require('./h.js');
(async () => {
  const variant = process.argv[2] || 'race';
  const { browser, page, errors, workers, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1200);
  console.log('before stop', JSON.stringify(await st()));
  await page.evaluate(() => RF.UI.stopSolve());
  const t0 = Date.now();
  if (variant === 'control') {
    await start('patch-array');
  } else {
    await start('fill-fix'); await page.waitForTimeout(120);   // tick arms, next tick starts
    console.log('mid', JSON.stringify(await st()));
    await start('patch-array');
  }
  let done = false;
  for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); const s = await st(); if (!s.solving) { done = true; console.log('finished after', Date.now() - t0, 'ms', JSON.stringify(s)); break; } }
  if (!done) console.log('STILL SOLVING after 25 s', JSON.stringify(await st()));
  // can anything solve now?
  if (!done) { await page.evaluate(() => RF.UI.stopSolve()); await start('haiku55-spots'); await page.waitForTimeout(15000); console.log('after stop + new quick solve 15s:', JSON.stringify(await st())); }
  console.log('workers', workers.size, [...workers].map((w) => w.url().split('/').pop()), 'errors', errors);
  await browser.close();
})();
