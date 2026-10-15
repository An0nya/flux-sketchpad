// W3a: same scene + camera drawn by Canvas 2D and by the WebGL scene view; saves PNG pairs. node tests/bench/gl-shots.js outDir [port]
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const out = process.argv[2], port = +(process.argv[3] || 8726); require('fs').mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 }), errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 200000, polling: 300 });
  if (!(await page.evaluate((p) => !!RF.UI && location.port === String(p), port))) throw new Error('wrong page');
  for (const scene of (process.env.SCENES || 'default,tir').split(',')) {
    if (scene !== 'default') { await page.evaluate((n) => RF.UI.loadScene(RF.Panels.presetScene(n).scene, 'x'), scene); await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 }); }
    await page.evaluate((fit) => { const u = RF.UI; u.orbitFirst = false; u.orbitIdle = Infinity; u.showRays = true; u.cam.setAngles(-130, 25); u.fit(fit); u.cam.setAngles(-130, 25); u.fit(fit); }, process.env.FIT || 'fixture');
    for (const mode of ['2d', 'gl']) {
      await page.evaluate((m) => { RF.RenderGL.setPref(m === 'gl'); RF.UI.sceneDirty = true; RF.UI.redrawSpec(); }, mode);
      await sleep(800);
      for (const id of ['scene-canvas', 'surface-canvas']) await (await page.$('#' + id)).screenshot({ path: out + '/' + scene + '-' + id.split('-')[0] + '-' + (process.env.FIT || 'fixture') + '-' + mode + '.png' });
      console.log(scene, mode, JSON.stringify(await page.evaluate(() => { const i = RF.RenderGL.info(document.getElementById('scene-canvas')); return i && { nRay: i.nRay, uploads: i.uploads }; })), 'failure:', await page.evaluate(() => RF.RenderGL.failure()));
    }
  }
  console.log('errors:', errs.slice(0, 5).join(' | ') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
