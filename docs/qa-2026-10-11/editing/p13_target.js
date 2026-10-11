const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  const sc = await L.rect(page, 'scene-canvas');
  await L.activate(page, 'scene-canvas');
  await page.click('#btn-setup'); await page.waitForTimeout(300);
  const hs = await page.evaluate(() => RF.UI.handles.map((h) => ({ id: h.id, x: +h.x.toFixed(1), y: +h.y.toFixed(1), label: h.label })));
  console.log(JSON.stringify(hs));
  const t = hs.find((h) => h.id === 'tgt'), s = hs.find((h) => h.id === 'src');
  const D = () => page.evaluate(() => ({ d: RF.UI.store.scene.target.distance, src: RF.UI.store.scene.source.pos.map((x) => +x.toFixed(1)), notices: RF.UI.store.notices.slice(0, 2).map((n) => n.msg.slice(0, 120)) }));
  console.log('before', JSON.stringify(await D()));
  // drag the target handle toward and well past the source
  await L.drag(page, [[sc.x + t.x, sc.y + t.y], [sc.x + s.x + 3 * (s.x - t.x), sc.y + s.y + 3 * (s.y - t.y)]], 40); await page.waitForTimeout(600);
  console.log('after', JSON.stringify(await D()));
  await page.screenshot({ path: L.DIR + '/shots/p13_target.png' });
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({ foot: document.getElementById('min-row').innerText.replace(/\n/g, ' | ').slice(0, 200), status: document.getElementById('run-state').textContent }));
  console.log(JSON.stringify(st));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
