const L = require('./lib');
(async () => {
  const vp = process.argv[2] === '1280' ? { width: 1280, height: 720 } : { width: 1500, height: 950 };
  const { browser, page, errors } = await L.open({ viewport: vp });
  const summ = async () => { const c = await L.canvases(page); return Object.entries(c).map(([k, v]) => k.split('-')[0] + ':' + v.css.join('x') + '/' + v.store.join('x') + ' nb' + v.nonbg).join(' | '); };
  console.log('base', await summ());
  for (const p of ['scene', 'editor', 'result', 'optics']) {
    await page.click(`button.collapse[data-collapse="${p}"]`); await page.waitForTimeout(600);
    console.log('collapsed ' + p, await summ());
    await page.screenshot({ path: L.SH + `col-${vp.width}-${p}-collapsed.png` });
    await page.click(`.pane[data-pane="${p}"] h2`); await page.waitForTimeout(600);
    console.log('reopened ' + p, await summ(), JSON.stringify((await page.evaluate(() => RF.UI.layout.collapsed))));
    await page.screenshot({ path: L.SH + `col-${vp.width}-${p}-reopened.png` });
  }
  // combos: collapse editor+result (pair bar), then optics too
  for (const seq of [['editor', 'result'], ['editor', 'result', 'optics'], ['scene', 'optics'], ['scene', 'editor', 'result', 'optics']]) {
    for (const p of seq) { await page.click(`button.collapse[data-collapse="${p}"]`); await page.waitForTimeout(400); }
    const n = seq.join('+');
    console.log('combo ' + n, await summ(), JSON.stringify(await L.overflow(page)));
    await page.screenshot({ path: L.SH + `col-${vp.width}-combo-${n}.png` });
    for (const p of seq.slice().reverse()) { await page.click(`.pane[data-pane="${p}"]`, { position: { x: 15, y: 15 } }); await page.waitForTimeout(400); }
    console.log(' restored ' + n, await summ(), JSON.stringify(await page.evaluate(() => RF.UI.layout.collapsed)));
    await page.screenshot({ path: L.SH + `col-${vp.width}-combo-${n}-restored.png` });
  }
  console.log('errors', errors);
  await browser.close();
})();
