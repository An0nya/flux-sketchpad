const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  const t0 = Date.now();
  console.log(await page.evaluate(() => ({ title: document.title, mode: RF.UI.store.scene.mode, preset: RF.UI.store.scene.modeD && RF.UI.store.scene.modeD.preset })));
  await page.evaluate(() => RF.UI.setMode('D'));
  await waitJudged(page);
  console.log('judged after', Date.now() - t0, 'ms');
  const st = await page.evaluate(() => { const ui = RF.UI, s = ui.spec, ev = s.ev, m = ui.store.scene.modeD;
    return { display: ui.display, preset: m.preset, aimMode: m.aimMode, aimLine: m.aimLine, aimBox: m.aimBox, dist: m.distance, Gdist: s.G.distance, N: ui.run.ctx.N, verdict: ev.verdict, n: ev.n, shift: ev.shift, reaim: ev.reaim, aimnote: ev.aim.note, caption: document.getElementById('right-caption').textContent, report: document.getElementById('spec-report').innerText.slice(0, 1500), footer: [...document.querySelectorAll('#stats .tile, .tile')].map((t) => t.innerText.replace(/\n/g, ' | ')).slice(0, 20), solve: ui.store.scene.solve, power: ui.store.scene.source.power, target: ui.store.scene.target.distance };
  });
  console.log(JSON.stringify(st, null, 1));
  await page.screenshot({ path: __dirname + '/p1-ff.png' });
  console.log('errors', errors);
  await browser.close();
})();
