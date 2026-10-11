const L = require('./lib');
(async () => {
  const { browser, ctx, page, errors } = await L.open({});
  const lay = () => page.evaluate(() => { const l = RF.UI.layout; return { split: +l.split.toFixed(3), rowSplit: +l.rowSplit.toFixed(3), pairSplit: +l.pairSplit.toFixed(3), exp: l.expanded, cols: getComputedStyle(workspace).gridTemplateColumns, rows: getComputedStyle(right).gridTemplateRows, pair: getComputedStyle(pair).gridTemplateColumns + ' / ' + getComputedStyle(pair).gridTemplateRows }; });
  const drag = async (sel, dx, dy) => { const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400); };
  console.log('start', JSON.stringify(await lay()));
  await drag('.divider.v', -2000, 0); console.log('main far left', JSON.stringify(await lay())); await page.screenshot({ path: L.SH + 'div-main-left.png' });
  await drag('.divider.v', 3000, 0); console.log('main far right', JSON.stringify(await lay())); await page.screenshot({ path: L.SH + 'div-main-right.png' });
  console.log(' canv', JSON.stringify(await L.canvases(page)), JSON.stringify(await L.overflow(page)));
  await page.dblclick('.divider.v'); await page.waitForTimeout(400); console.log('main dblclick', JSON.stringify(await lay()));
  await drag('.divider.h', 0, -2000); console.log('row up', JSON.stringify(await lay())); await page.screenshot({ path: L.SH + 'div-row-up.png' });
  await drag('.divider.h', 0, 2000); console.log('row down', JSON.stringify(await lay())); await page.screenshot({ path: L.SH + 'div-row-down.png' });
  console.log(' canv', JSON.stringify(await L.canvases(page)));
  await page.dblclick('.divider.h'); await page.waitForTimeout(400);
  await drag('.divider.pd', -1000, 0); console.log('pair left', JSON.stringify(await lay())); await page.screenshot({ path: L.SH + 'div-pair-left.png' });
  console.log(' canv', JSON.stringify(await L.canvases(page)), JSON.stringify(await L.overflow(page)));
  await page.dblclick('.divider.pd'); await page.waitForTimeout(400);
  // keyboard
  await page.focus('.divider.v'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  console.log('kbd right x5', JSON.stringify(await lay()));
  const fv = await page.evaluate(() => { const d = document.querySelector('.divider.v'); return { focused: document.activeElement === d, focusVisible: d.matches(':focus-visible'), after: getComputedStyle(d, '::after').opacity }; });
  console.log('focus', JSON.stringify(fv));
  // expanded + drag
  await page.click('button.expand[data-expand="optics"]'); await page.waitForTimeout(500);
  console.log('expanded optics', JSON.stringify(await lay()));
  await drag('.divider.h', 0, -30); console.log('drag while expanded', JSON.stringify(await lay()));
  console.log('expand buttons', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-expand]')].map(b => b.dataset.expand + ':' + b.textContent))));
  // persistence
  const saved = await page.evaluate(() => localStorage.getItem('flux/layout'));
  await page.reload(); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.UI.layout); await page.waitForTimeout(1500);
  console.log('after reload', saved, JSON.stringify(await lay()));
  console.log(errors); await browser.close();
})();
