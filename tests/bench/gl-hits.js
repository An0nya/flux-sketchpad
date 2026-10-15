// W3a: how many ray hits the WebGL scene view draws per frame (synthetic hits on the target plane, real GPU). node tests/bench/gl-hits.js [port]
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8726);
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('flux/glScene', '1'); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 200000, polling: 300 });
  if (!(await page.evaluate((p) => !!RF.UI && location.port === String(p), port))) throw new Error('wrong page');
  const res = await page.evaluate(async () => {
    const ui = RF.UI, T = RF.Engine.targetFrame(ui.store.scene.target), cv = document.getElementById('scene-canvas'), out = [];
    ui.cam.setAngles(-150, 15); ui.cam.fit([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => RF.Engine.targetUVtoWorld(T, a * T.half, c * T.half)), 0.1);
    for (const n of [1e5, 1e6, 2e6, 5e6, 1e7, 2e7]) {
      const uv = new Float32Array(3 * n), b = new Uint8Array(n);
      for (let i = 0; i < n; i++) { uv[3 * i] = (Math.random() - 0.5) * T.half; uv[3 * i + 1] = (Math.random() - 0.5) * T.half; uv[3 * i + 2] = 1; b[i] = i & 3; }
      const H = { n, uv, b, key: {} }, t = [];
      const opts = { scene: ui.store.scene, model: ui.model, paths: ui.run.ctx.paths, heatCanvas: null, showRays: true, setup: false, sel: null, hits: H };
      let up = 0; const sc = ui.cam.project(T.C); if (!(sc[0] > 0 && sc[0] < cv.getBoundingClientRect().width && sc[1] > 0)) throw new Error('target centre off screen: ' + sc);
      for (let i = 0; i < 18; i++) {
        ui.cam.turntable(0.5, 0);
        const t0 = performance.now(); RF.Render.drawScene(cv, ui.cam, opts); RF.RenderGL.sync(cv); const dt = performance.now() - t0;
        if (i === 0) up = dt; else if (i >= 3) t.push(dt);
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (n === 5e6) window.__keep = { opts, H };
      t.sort((a, c) => a - c); out.push({ hits: n, firstFrameMs: +up.toFixed(1), medianMs: +t[t.length >> 1].toFixed(2), drawn: RF.RenderGL.info(cv).nHit });
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
  if (process.env.SHOT) { await page.evaluate(() => { const ui = RF.UI; }).catch(() => {}); await page.evaluate(() => { const k = window.__keep; RF.Render.drawScene(document.getElementById('scene-canvas'), RF.UI.cam, k.opts); }); await (await page.$('#scene-canvas')).screenshot({ path: process.env.SHOT }); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
