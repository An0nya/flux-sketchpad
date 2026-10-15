// W3a: the WebGL scene view (js/render-gl.js).  node tests/regress/W3a-webgl-scene.js [port]
// Needs a server (python3 tests/serve.py <port>).  Uses the real GPU browser (channel 'chromium'); W3A_SW=1 uses the software one (headless_shell, SwiftShader).
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8726);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.W3A_SW ? {} : { channel: 'chromium' }), errors = [];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('w3a-init')) { localStorage.clear(); sessionStorage.setItem('w3a-init', '1'); } } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 200000, polling: 300 });
  ok('page identifies as the Flux app on port ' + port + ' (RF.UI, RF.RenderGL)', await page.evaluate((p) => !!(RF.UI && RF.RenderGL) && location.port === String(p), port));
  ok('WebGL2 exists in this browser', await page.evaluate(() => RF.RenderGL.supported()));
  const freeze = (fit) => page.evaluate((fit) => { const u = RF.UI; u.orbitFirst = false; u.orbitIdle = Infinity; u.showRays = true; u.cam.setAngles(-150, 20); u.fit(fit); u.cam.setAngles(-150, 20); u.fit(fit); u.sel = null; }, fit || 'fixture');
  const redraw = async () => { await page.evaluate(() => { RF.UI.sceneDirty = true; RF.UI.redrawSpec(); }); await sleep(500); };
  // the view as the user sees it: a screenshot of the canvas box (GL underlay + 2D overlay composited by the browser), decoded into pixels in the page
  const snap = async (id) => {
    const buf = await (await page.$('#' + id)).screenshot(), b64 = buf.toString('base64');
    if (process.env.W3A_DUMP) require('fs').writeFileSync(process.env.W3A_DUMP + '/' + id + '-' + (++snap.n) + '.png', buf);
    return page.evaluate(async ([id, b64]) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const t = document.createElement('canvas'); t.width = im.width; t.height = im.height; const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
      window['__snap_' + id] = x.getImageData(0, 0, t.width, t.height).data;
      const g = RF.RenderGL.info(document.getElementById(id)); return { w: t.width, h: t.height, gl: !!(g && g.canvas.style.display !== 'none') };
    }, [id, b64]);
  };
  snap.n = 0;
  const diff = (id, id2) => page.evaluate(([a, b]) => { const A = window['__snap_' + a], B = window['__snap_' + b + '2']; let s = 0, big = 0, n = A.length / 4; for (let i = 0; i < A.length; i += 4) { const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3; s += d; if (d > 40) big++; } return { mean: s / n, bigPct: 100 * big / n }; }, [id, id2]);
  await freeze();

  // 1. default: off, nothing GL on screen
  ok('default: the setting is off (flux/glScene unset) and no GL canvas exists yet', await page.evaluate(() => !RF.RenderGL.pref() && !document.querySelector('.gl-under')));

  // 2. the setting is in Simulation → Advanced
  const row = await page.evaluate(() => { const l = [...document.querySelectorAll('label.tog')].find((x) => /WebGL scene view/.test(x.textContent)); return !!l && !!l.closest('[data-section="sim-adv"]'); });
  ok('Simulation → Advanced has the "WebGL scene view" checkbox', row);

  // 3. 2D reference for each scene, then GL, same camera: parity
  for (const [scene, focal, fit] of [['default', 0, 'fixture'], ['default', 35, 'fixture'], ['tir', 0, 'fixture'], ['tir', 0, 'all'], ['default', 35, 'all']]) {
    if (scene !== 'default') { await page.evaluate((n) => RF.UI.loadScene(RF.Panels.presetScene(n).scene, 'w3a'), scene); await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 }); }
    await page.evaluate((f) => { RF.UI.setDisplay('grid'); if (f) { RF.UI.cam.focal = f; RF.UI.camS.focal = f; } else { RF.UI.cam.focal = Infinity; RF.UI.camS.focal = Infinity; } }, focal);
    await freeze(fit);
    await page.evaluate(() => { RF.RenderGL.setPref(false); }); await redraw();
    const out = {};
    for (const id of ['scene-canvas', 'surface-canvas']) { out[id] = await snap(id); await page.evaluate((id) => { window['__snap_' + id + '2'] = window['__snap_' + id]; }, id); }
    ok(scene + ' f=' + focal + ' fit=' + fit + ': 2D reference drew without the GL underlay', !out['scene-canvas'].gl && !out['surface-canvas'].gl);
    await page.evaluate(() => { RF.RenderGL.setPref(true); }); await redraw();
    for (const id of ['scene-canvas', 'surface-canvas']) {
      const s = await snap(id), d = await diff(id, id);
      const info = await page.evaluate((id) => { const i = RF.RenderGL.info(document.getElementById(id)); return i && { nRay: i.nRay, vis: i.canvas.style.display }; }, id);
      ok(scene + ' f=' + focal + ' fit=' + fit + ' ' + id + ': GL on, drawn by WebGL (' + (info ? info.nRay + ' ray segments' : 'no renderer') + ')', s.gl && !(await page.evaluate(() => RF.RenderGL.failure())), JSON.stringify(info));
      ok(scene + ' f=' + focal + ' fit=' + fit + ' ' + id + ': matches the Canvas 2D picture (mean |diff| ' + d.mean.toFixed(2) + '/255, ' + d.bigPct.toFixed(2) + ' % of pixels off by > 40)', d.mean < 4 && d.bigPct < 4);
    }
  }

  // 4. picking is the CPU camera math: the same click picks the same facet with GL on and off
  await page.evaluate(() => { RF.UI.loadScene(RF.Panels.presetScene('parabola').scene, 'w3a'); });
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 });
  await page.evaluate(() => { RF.UI.cam.focal = Infinity; RF.UI.camS.focal = Infinity; }); await freeze();
  const pickAt = async (gl, k) => {
    await page.evaluate((gl) => { RF.RenderGL.setPref(gl); RF.UI.select && RF.UI.select(null); }, gl); await redraw();
    const pt = await page.evaluate((k) => { const ui = RF.UI, p = ui.model.polys[k], s = ui.camS.project(p.c), b = document.getElementById('surface-canvas').getBoundingClientRect(); return { x: b.left + s[0], y: b.top + s[1] }; }, k);
    await page.mouse.click(pt.x, pt.y); await sleep(250);          // the first press into a pane only activates it
    await page.evaluate(() => RF.UI.select(null)); await page.mouse.click(pt.x, pt.y); await sleep(250);
    return page.evaluate(() => { const s = RF.UI.sel; return s ? s.kind + ':' + s.items.join(',') : null; });
  };
  const k = await page.evaluate(() => Math.floor(RF.UI.model.polys.length / 2));
  const p2 = await pickAt(false, k), p3 = await pickAt(true, k);
  ok('click-to-select in Optics picks a facet, and the same one with WebGL on or off', !!p2 && p2 === p3, '2D: ' + p2 + ' | GL: ' + p3);
  // with the facet selected (amber, others fade, secondary dashed), GL and 2D agree on the picture too
  for (const id of ['surface-canvas', 'scene-canvas']) {
    await page.evaluate(() => RF.RenderGL.setPref(true)); await redraw(); const sg = await snap(id);
    await page.evaluate((id) => { window['__snap_' + id + '2'] = window['__snap_' + id]; }, id);
    await page.evaluate(() => RF.RenderGL.setPref(false)); await redraw(); await snap(id);
    const d = await diff(id, id);   // (A = the 2D picture just taken, B = the GL one)
    ok('with a facet selected, ' + id + ': GL matches Canvas 2D (mean |diff| ' + d.mean.toFixed(2) + '/255, ' + d.bigPct.toFixed(2) + ' % of pixels off by > 40)', sg.gl && d.mean < 4 && d.bigPct < 4);
  }
  await page.evaluate(() => RF.RenderGL.setPref(true)); await redraw();
  ok('selection redraws on the GL view without a GL failure', !(await page.evaluate(() => RF.RenderGL.failure())) && !!(await page.evaluate(() => RF.UI.sel)));

  // 5. hits as points
  await page.evaluate(() => { RF.UI.select && RF.UI.select(null); RF.UI.setDisplay('hits'); }); await redraw();
  const h = await page.evaluate(() => { const i = RF.RenderGL.info(document.getElementById('scene-canvas')); return { nHit: i.nHit, nHits: RF.UI.run.ctx.nHits }; });
  ok('Result display "hits": every recorded hit is a point sprite on the target plane', h.nHit > 0 && h.nHit === h.nHits, JSON.stringify(h));
  await page.evaluate(() => RF.UI.setDisplay('grid'));

  // 6. rays-drawn limit follows the setting
  const mx = await page.evaluate(() => { const r = document.getElementById('ray-paths'); RF.RenderGL.setPref(true); RF.UI.applyRayPaths(); const on = +r.max; RF.RenderGL.setPref(false); RF.UI.applyRayPaths(); const off = +r.max; RF.RenderGL.setPref(true); RF.UI.applyRayPaths(); return [on, off]; });
  ok('"Rays drawn" slider: 20,000 with GL on, 2,000 with it off', mx[0] === 20000 && mx[1] === 2000, JSON.stringify(mx));
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 240000, polling: 300 });

  // 7. switching it off hides the GL canvas
  await page.evaluate(() => RF.RenderGL.setPref(false)); await redraw();
  ok('setting off again: the GL canvases are hidden and Canvas 2D draws', await page.evaluate(() => [...document.querySelectorAll('.gl-under')].every((c) => c.style.display === 'none')));
  await page.evaluate(() => RF.RenderGL.setPref(true)); await redraw();

  // 8. fallback: a lost context drops back to Canvas 2D, picture intact
  await page.evaluate(() => { const c = RF.RenderGL.info(document.getElementById('scene-canvas')).canvas; c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext(); });
  await sleep(300); await redraw();
  const fb = await page.evaluate(() => ({ fail: RF.RenderGL.failure(), hidden: [...document.querySelectorAll('.gl-under')].every((c) => c.style.display === 'none'), on: RF.RenderGL.on() }));
  ok('WebGL context lost: falls back to Canvas 2D (GL canvases hidden, failure recorded)', !!fb.fail && fb.hidden && !fb.on, JSON.stringify(fb));
  const nz = await page.evaluate(() => { const cv = document.getElementById('scene-canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  ok('after the fallback the 2D canvas carries the whole picture (not blank)', nz > 2000, nz + ' painted px');
  ok('no page errors', errors.length === 0, [...new Set(errors.map((e) => e.split('\n')[0]))].slice(0, 3).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
