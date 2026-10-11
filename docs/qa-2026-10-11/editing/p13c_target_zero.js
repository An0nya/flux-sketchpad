const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  const sc = await L.rect(page, 'scene-canvas');
  await L.activate(page, 'scene-canvas');
  await page.click('#btn-setup'); await page.waitForTimeout(300);
  for (let k = 0; k < 16; k++) {
    const hs = await page.evaluate(() => { const g = (id) => RF.UI.handles.find((x) => x.id === id); return { t: [g('tgt').x, g('tgt').y], s: [g('src').x, g('src').y] }; });
    const dir = [hs.s[0] - hs.t[0], hs.s[1] - hs.t[1]], L2 = Math.hypot(...dir) || 1;
    const to = [hs.t[0] + dir[0] / L2 * 250, hs.t[1] + dir[1] / L2 * 250];
    await L.drag(page, [[sc.x + hs.t[0], sc.y + hs.t[1]], [sc.x + to[0], sc.y + to[1]]], 20); await page.waitForTimeout(300);
    const d = await page.evaluate(() => RF.UI.store.scene.target.distance);
    console.log('drag', k, 'tgt handle', hs.t.map(Math.round), 'distance', d);
    if (d < 1) break;
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: L.DIR + '/shots/p13c_target_zero.png' });
  const st = await page.evaluate(() => ({ d: RF.UI.store.scene.target.distance, src: RF.UI.store.scene.source.pos, env: RF.UI.store.scene.envelope, foot: document.getElementById('min-row').innerText.replace(/\n/g, ' | ').slice(0, 200), notices: RF.UI.store.notices.slice(0, 3).map((n) => n.msg.slice(0, 140)) }));
  console.log(JSON.stringify(st));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
