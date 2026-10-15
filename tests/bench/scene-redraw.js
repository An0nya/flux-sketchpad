// W3a: redraw time of the Scene and Optics views (Canvas 2D now; WebGL when RF.RenderGL exists and ?gl=1 / flux/glScene=1).
// node tests/bench/scene-redraw.js [port] [--gl] [--shot=dir]   needs: python3 tests/serve.py <port>; PLAYWRIGHT=.../agent-qa/node_modules/playwright
// Real GPU: chromium channel 'chromium' (set BENCH_SW=1 for headless_shell/SwiftShader). Each redraw = orbit step + draw + 1-px readback (forces the GPU to finish).
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8726), gl = process.argv.includes('--gl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENES = (process.env.SCENES || 'default,parabola,fresnel,stamps,spec-sealed7,tir').split(','), RAYS = +(process.env.RAYS || 240), FOCAL = +(process.env.FOCAL || 0);
(async () => {
  const browser = await pw.chromium.launch(process.env.BENCH_SW ? {} : { channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript((gl) => { try { localStorage.clear(); if (gl) localStorage.setItem('flux/glScene', '1'); } catch (e) { /* ignore */ } }, gl);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  const ident = await page.evaluate((p) => !!RF.UI && location.port === String(p), port);
  if (!ident) throw new Error('wrong page');
  console.log('renderer under test:', gl ? 'WebGL' : 'Canvas2D', '| GPU:', await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }));
  const out = {};
  for (const name of SCENES) {
    if (name !== 'default') {
      const ok = await page.evaluate((n) => { const p = RF.Panels.presetScene(n); if (!p) return false; RF.UI.loadScene(p.scene, 'bench'); return true; }, name);
      if (!ok) { console.log(name, 'no such preset'); continue; }
    }
    await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 }).catch(() => console.log(name, 'run not done, measuring anyway'));
    if (RAYS !== 240) { await page.evaluate((n) => { RF.UI.rayPaths = n; RF.UI.requestRun(false); }, RAYS); await sleep(500); await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 }); }
    await sleep(1500);
    await page.evaluate(() => { RF.UI.showRays = true; RF.UI.fit('all'); });
    if (FOCAL) { await page.evaluate((f) => { RF.UI.cam.focal = f; RF.UI.camS.focal = f; RF.UI.fit('all'); }, FOCAL); }
    await sleep(500);
    const r = await page.evaluate(async () => {
      const ui = RF.UI, N = 30, res = { polys: ui.model.polys.length, paths: ui.run ? ui.run.ctx.paths.length : 0, hits: ui.run ? ui.run.ctx.nHits : 0 };
      const flush = (cv) => { try { const c2 = cv.getContext('2d'); if (c2) c2.getImageData(0, 0, 1, 1); if (RF.RenderGL && RF.RenderGL.sync) RF.RenderGL.sync(cv); } catch (e) { /* ignore */ } };
      for (const view of ['scene', 'optics-solid', 'optics-pairs']) {
        const t = []; const tj = [];
        for (let i = 0; i < N + 3; i++) {
          const cam = view === 'scene' ? ui.cam : ui.camS;
          cam.orbit(6, 2); cam.zoomAt(i % 2 ? 1.01 : 0.99, 400, 300);
          const t0 = performance.now();
          const cv = document.getElementById(view === 'scene' ? 'scene-canvas' : 'surface-canvas');
          const opts = view === 'scene' ? { scene: ui.store.scene, model: ui.model, paths: ui.run.ctx.paths, heatCanvas: ui.heatImg, showRays: true, setup: false, sel: null }
            : { scene: ui.store.scene, model: ui.model, style: view === 'optics-pairs' ? 'pairs' : 'solid', envelope: true, handles: true, sel: null };
          const fn = view === 'scene' ? RF.Render.drawScene : RF.Render.drawSurfaceView;
          fn(cv, cam, opts);
          const t1 = performance.now();
          flush(cv);
          const t2 = performance.now();
          if (i >= 3) { tj.push(t1 - t0); t.push(t2 - t0); }
          await new Promise((r) => requestAnimationFrame(r));
        }
        const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
        res[view] = { jsMs: +med(tj).toFixed(2), withFlushMs: +med(t).toFixed(2) };
      }
      { const cv = document.getElementById('scene-canvas'), t = []; for (let i = 0; i < 20; i++) { const t0 = performance.now(); try { cv.getContext('2d').getImageData(0, 0, 1, 1); } catch (e) { /* ignore */ } t.push(performance.now() - t0); await new Promise((r) => requestAnimationFrame(r)); } res.flushFloorMs = +t.sort((a, b) => a - b)[10].toFixed(2); }
      if (ui.run && ui.run.ctx.hits) {   // the CPU re-bin that 'hits' display repeats while a trace grows (ui.js hitsCanvas), 2048 grid
        const c = ui.run.ctx, T = ui.run.P.T, M = 2048, t = [];
        for (let r = 0; r < 5; r++) { const t0 = performance.now(); const buf = new Float64Array(M * M), k = M / (2 * T.half), h = c.hits; for (let q = 0; q < 3 * c.nHits; q += 3) { let i = Math.floor((h[q] + T.half) * k), j = Math.floor((h[q + 1] + T.half) * k); if (i >= M) i = M - 1; if (j >= M) j = M - 1; if (i < 0 || j < 0) continue; buf[j * M + i] += h[q + 2]; } let n = 0; for (let i = 0; i < buf.length; i++) if (buf[i] > 0) n++; RF.Render2D.gridCanvas(buf, M, null, 1); t.push(performance.now() - t0); }
        res.hitsRebin2048Ms = +t.sort((a, b) => a - b)[2].toFixed(1);
      }
      return res;
    });
    out[name] = r; console.log(name, JSON.stringify(r));
  }
  console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
