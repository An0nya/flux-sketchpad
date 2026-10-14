// F2: the animated Drive view and its large view (js/drive-anim.js).
// node tests/regress/F2-drive-anim.js [port]   (needs a server: python3 tests/serve.py <port>; F2_REAL_GPU=1 uses the real GPU browser instead of the software one)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8722);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch(process.env.F2_REAL_GPU ? { channel: 'chromium' } : {}), errors = [];
  const open = async (viewport, dpr) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: dpr || 1 });
    page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
    await page.evaluate(() => RF.UI.setMode('D'));
    await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
    await page.evaluate(() => RF.UI.setDisplay('drive')); await sleep(1500);
    return page;
  };
  const page = await open({ width: 1500, height: 950 });
  ok('page identifies as the Flux app on port ' + port + ' (RF.UI, RF.DriveAnim)', await page.evaluate((p) => !!(RF.UI && RF.DriveAnim && RF.Drive.render) && location.port === String(p), port));
  const frames = () => page.evaluate(() => RF.DriveAnim.stats().frames), dist = () => page.evaluate(() => RF.UI.dvAnim.dist), running = () => page.evaluate(() => RF.DriveAnim.stats().running);
  const gpu = await page.evaluate(() => { const c = document.createElement('canvas'), g = c.getContext('webgl2'); return !!g && !!g.getExtension('EXT_color_buffer_float'); });
  ok('WebGL2 with float render targets exists in this browser', gpu);
  if (!gpu) { await browser.close(); process.exit(1); }

  // 1. the default is the still picture
  let st = await page.evaluate(() => ({ view: RF.UI.dvAnim ? RF.UI.dvAnim.view : 'still', gl: !!document.querySelector('.drive-gl') && !document.querySelector('.drive-gl').hidden, btn: document.querySelector('[data-anim="animate"]').getAttribute('aria-pressed') }));
  ok('default: still view, no animated canvas shown, animate button off', st.view === 'still' && !st.gl && st.btn === 'false', JSON.stringify(st));

  // 2. animate: frames advance, distance advances, canvas sits over the still picture
  await page.click('[data-anim="animate"]'); await sleep(2500);
  let f0 = await frames(), d0 = await dist(); await sleep(1000); let f1 = await frames(), d1 = await dist();
  ok('animate: frames keep coming (' + (f1 - f0) + ' in 1 s) and the car moves (' + (d1 - d0).toFixed(1) + ' m at 50 km/h)', f1 - f0 >= 5 && d1 > d0 + 5, 'speed ' + await page.evaluate(() => RF.UI.dvOpts.speed));
  const geo = await page.evaluate(() => { const g = document.querySelector('.drive-gl').getBoundingClientRect(), w = document.getElementById('heat-canvas').getBoundingClientRect(); return { gl: [g.left, g.top, g.right, g.bottom], wrap: [w.left, w.top, w.right, w.bottom], ratio: g.width / g.height }; });
  ok('animated canvas is 16:9 and inside the drive canvas box', Math.abs(geo.ratio - 16 / 9) < 0.02 && geo.gl[0] >= geo.wrap[0] - 1 && geo.gl[2] <= geo.wrap[2] + 1 && geo.gl[1] >= geo.wrap[1] - 1 && geo.gl[3] <= geo.wrap[3] + 1, JSON.stringify(geo));

  // 3. pause / play, speed
  await page.click('[data-anim="play"]'); await sleep(400); f0 = await frames(); d0 = await dist(); await sleep(800); f1 = await frames(); d1 = await dist();
  ok('pause: no frames and no movement for 0.8 s, loop stopped', f1 === f0 && d1 === d0 && !(await running()));
  await page.click('[data-anim="play"]'); await sleep(300);
  const rate = async (kmh) => { await page.evaluate((v) => { const s = document.querySelector('[data-anim="speed"]'); s.value = v; s.dispatchEvent(new Event('input')); }, kmh); await sleep(200); const a = await dist(), t0 = Date.now(); await sleep(1000); const b = await dist(), t1 = Date.now(); return ((b - a + (b < a ? RF_PERIOD : 0)) / ((t1 - t0) / 1000)) * 3.6; };
  const RF_PERIOD = await page.evaluate(() => RF.DriveAnim.PERIOD);
  const r30 = await rate(30), r90 = await rate(90);
  ok('speed slider: 30 and 90 km/h are driven at about that speed', Math.abs(r30 - 30) < 6 && Math.abs(r90 - 90) < 14, r30.toFixed(1) + ' and ' + r90.toFixed(1) + ' km/h measured');
  ok('the speed is remembered in the drive-view settings', await page.evaluate(() => JSON.parse(localStorage.getItem('flux/driveView')).speed === 90));

  // 4. the loop stops when it cannot be seen: hidden tab, another display, and starts again
  const setVis = (v) => page.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await setVis('hidden'); await sleep(500); f0 = await frames(); await sleep(700); f1 = await frames();
  ok('hidden tab: the frame counter stops', f1 === f0 && !(await running()), f0 + ' → ' + f1);
  await setVis('visible'); await sleep(900); f0 = await frames(); await sleep(600); f1 = await frames();
  ok('tab visible again: frames resume', f1 > f0 && (await running()));
  await page.evaluate(() => RF.UI.setDisplay('grid')); await sleep(600); f0 = await frames(); await sleep(700); f1 = await frames();
  ok('Result switched to another view: frames stop and the canvas is not shown', f1 === f0 && !(await running()) && await page.evaluate(() => getComputedStyle(document.querySelector('.drive-gl')).display === 'none'), f0 + ' → ' + f1);
  await page.evaluate(() => RF.UI.setDisplay('drive')); await sleep(1000); f0 = await frames(); await sleep(600); f1 = await frames();
  ok('Result back on Drive: frames resume', f1 > f0 && (await running()));

  // 5. scenery toggles: each class has its own switch and takes only its own objects out
  const cnt = (cls) => page.evaluate((cls) => RF.DriveAnim._.V.src.objects.filter((o) => (o.cls || '') === cls).length, cls);
  const all = await page.evaluate(() => RF.DriveAnim._.V.src.objects.length), posts = await cnt('post'), crates0 = await cnt('obstacle');
  await page.click('[data-anim="c-posts"]'); await sleep(500); const noPosts = await page.evaluate(() => RF.DriveAnim._.V.src.objects.length);
  ok('posts toggle: only the delineator posts go (' + all + ' → ' + noPosts + ' objects)', posts > 0 && noPosts === all - posts && (await cnt('post')) === 0);
  await page.click('[data-anim="c-posts"]'); await page.click('[data-anim="c-obstacle"]'); await sleep(500);
  ok('crates toggle: off by default, on adds crates', crates0 === 0 && (await cnt('obstacle')) >= 2, 'crates ' + (await cnt('obstacle')));
  await page.click('[data-anim="c-obstacle"]'); await sleep(300);
  for (const k of ['signs', 'people', 'animals', 'veg']) { const before = await page.evaluate(() => RF.DriveAnim._.V.src.objects.length); await page.click('[data-anim="c-' + k + '"]'); await sleep(300); const after = await page.evaluate(() => RF.DriveAnim._.V.src.objects.length); ok('toggle ' + k + ' changes the scenery (' + before + ' → ' + after + ' objects)', after < before); await page.click('[data-anim="c-' + k + '"]'); await sleep(200); }

  // 6. the large view
  await page.click('[data-anim="popout"]'); await sleep(2500);
  const pop = await page.evaluate(() => { const R = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, p = document.querySelector('.drive-popout'), wc = document.querySelector('.work-col'), sb = document.getElementById('sidebar'), g = document.querySelector('.drive-gl'); return { pop: R(p), work: R(wc), side: R(sb), gl: R(g), glParent: g.parentElement.className, st: RF.UI.dvAnim, focus: document.activeElement.className, bar: document.querySelector('.drive-tools').parentElement.className, vw: innerWidth }; });
  ok('popout fills the work column and stops at the sidebar', Math.abs(pop.pop[0] - pop.work[0]) < 1 && Math.abs(pop.pop[2] - pop.work[2]) < 1 && pop.pop[2] <= pop.side[0] + 1 && Math.abs(pop.pop[3] - pop.work[3]) < 1, JSON.stringify({ pop: pop.pop, side: pop.side }));
  ok('popout holds the animated canvas and the toolbar, bigger than the pane\'s', pop.glParent === 'dp-stage' && pop.bar === 'dp-stage' && (pop.gl[2] - pop.gl[0]) > 800, 'canvas ' + Math.round(pop.gl[2] - pop.gl[0]) + ' px wide');
  ok('popout moves focus to its close button', /dp-close/.test(pop.focus), pop.focus);
  f0 = await frames(); await sleep(700); f1 = await frames(); ok('popout animates', f1 > f0);
  const fit = await page.evaluate(() => { const g = document.querySelector('.drive-gl'), st = document.querySelector('.dp-stage').getBoundingClientRect(), r = g.getBoundingClientRect(); return { px: [g.width, g.height], css: [r.width, r.height], stage: [st.width, st.height], dpr: devicePixelRatio }; });
  ok('popout canvas is the largest 16:9 that fits, one backing pixel per css pixel at dpr 1', Math.abs(fit.css[0] - Math.min(fit.stage[0], fit.stage[1] * 16 / 9)) < 2 && Math.abs(fit.px[0] - fit.css[0] * fit.dpr) <= 1, JSON.stringify(fit));
  await page.setViewportSize({ width: 1100, height: 800 }); await sleep(1500);
  const fit2 = await page.evaluate(() => { const g = document.querySelector('.drive-gl'), st = document.querySelector('.dp-stage').getBoundingClientRect(), r = g.getBoundingClientRect(); return { px: [g.width, g.height], css: [r.width, r.height], stage: [st.width, st.height] }; });
  ok('popout follows a window resize (1500×950 → 1100×800)', Math.abs(fit2.css[0] - Math.min(fit2.stage[0], fit2.stage[1] * 16 / 9)) < 2 && fit2.css[0] < fit.css[0] - 100 && Math.abs(fit2.px[0] - fit2.css[0]) <= 1, JSON.stringify(fit2));
  await page.setViewportSize({ width: 1500, height: 950 }); await sleep(800);
  await page.keyboard.press('Escape'); await sleep(800);
  const back = await page.evaluate(() => ({ pop: !!document.querySelector('.drive-popout'), parent: document.querySelector('.drive-gl').parentElement.className, bar: document.querySelector('.drive-tools').parentElement.className, st: RF.UI.dvAnim.popout, focus: document.activeElement.dataset.anim }));
  ok('Esc closes it, canvas and toolbar go back to the pane, focus returns to the large button', !back.pop && /canvas-wrap/.test(back.parent) && /canvas-wrap/.test(back.bar) && !back.st && back.focus === 'popout', JSON.stringify(back));
  f0 = await frames(); await sleep(700); f1 = await frames(); ok('after closing, the pane animates again', f1 > f0);
  await page.click('[data-anim="popout"]'); await sleep(1200); await page.click('.dp-close'); await sleep(600);
  ok('the close button closes it too', !(await page.evaluate(() => !!document.querySelector('.drive-popout'))));
  await page.click('[data-anim="popout"]'); await sleep(1200); await setVis('hidden'); await sleep(400); f0 = await frames(); await sleep(600); f1 = await frames();
  ok('popout open in a hidden tab: frames stop', f1 === f0, f0 + ' → ' + f1); await setVis('visible'); await sleep(800);
  await page.evaluate(() => RF.UI.setMode('A')); await sleep(800);
  ok('leaving Spec mode closes the popout', !(await page.evaluate(() => !!document.querySelector('.drive-popout'))));
  await page.evaluate(() => { RF.UI.setMode('D'); RF.UI.setDisplay('drive'); }); await sleep(2500);

  // 7. the animation is a layer on top: the still picture is not rendered again by it, and turning it off gives the still view back
  await page.evaluate(() => { const st = RF.UI.dvAnim; st.view = 'anim'; st.playing = true; RF.UI.redrawSpec(); }); await sleep(800);
  await page.evaluate(() => { window.__n = 0; const f = RF.Drive.render; RF.Drive.render = function (o) { if (!o.layer && !(o.scene && o.scene.objects && o.scene.objects.length === 0)) window.__n++; return f.apply(this, arguments); }; }); await sleep(2000);
  ok('while animating, the whole-picture renderer is not called per frame', (await page.evaluate(() => window.__n)) === 0, 'calls ' + await page.evaluate(() => window.__n));
  await page.click('[data-anim="animate"]'); await sleep(800); f0 = await frames(); await sleep(600); f1 = await frames();
  ok('animate off: loop stopped, canvas hidden, still picture shown', f1 === f0 && await page.evaluate(() => document.querySelector('.drive-gl').hidden && RF.UI.dvAnim.view === 'still'));

  // 8. parity: an animated frame against the whole picture of the same displaced world (the still renderer)
  const parity = (cfg) => page.evaluate(async (cfg) => {
    const ui = RF.UI; ui.dvOpts.glare = 0; ui.dvOpts.expMode = 'fixed'; ui.rvOpts.shape = cfg.shape; const st = ui.dvAnim; st.view = 'anim'; st.playing = false; ui.redrawSpec(); await new Promise((r) => setTimeout(r, 1500));
    const DA = RF.DriveAnim, X = DA._, V = X.V; V.pinSS = 2; X.setDist(cfg.dist); /* 2×2 samples, as the reference has */ const p = V.p, W = p.w, H = p.h, hdr = X.readHdr(), src = V.src;
    const shift = (m) => m.pat ? Object.assign({}, m, { pat: Object.assign({}, m.pat, { s0: m.pat.s0 - cfg.dist, s1: m.pat.s1 - cfg.dist }) }) : m;
    const cam = { w: W, h: H, hfov: p.hfov, eye: DA.EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, arc: p.A, lane: p.lane, look: p.look, scene: { objects: DA.place(src, cfg.dist, p.A), markings: src.markings.map(shift), verge: src.verge } };
    const ref = RF.Drive.render(cam), ref1 = RF.Drive.render(Object.assign({}, cam, { ss: 1 })), rgba = new Float32Array(4 * W * H); DA.objects(p, cfg.dist, rgba, 2);
    const L = (a, q, s) => 0.2126 * a[s * q] + 0.7152 * a[s * q + 1] + 0.0722 * a[s * q + 2], full = [], edge = [], ground = []; let worstG = 0, nonzero = 0;
    for (let q = 0; q < W * H; q++) {
      const a = L(hdr, q, 4), b = L(ref.rgb, q, 3), rel = Math.abs(a - b) / Math.max(b, 0.02); if (a > 0.05) nonzero++; const c = rgba[4 * q + 3];
      if (c >= 0.999) full.push(rel); else if (c > 0) edge.push(rel); else if (ref.rgb[3 * q] === ref1.rgb[3 * q] && ref.rgb[3 * q + 1] === ref1.rgb[3 * q + 1] && ref.rgb[3 * q + 2] === ref1.rgb[3 * q + 2]) { ground.push(rel); worstG = Math.max(worstG, rel); }
    }
    const comp = DA.composeCPU(p, V.g, rgba, cfg.dist); let gc = 0; for (let q = 0; q < W * H; q++) gc = Math.max(gc, Math.abs(L(hdr, q, 4) - L(comp, q, 3)) / Math.max(L(comp, q, 3), 0.02));
    const srt = (a) => a.sort((x, y) => x - y); srt(full); srt(edge);
    V.pinSS = 0;
    return { W, H, nonzero, nFull: full.length, fullMax: full[full.length - 1] || 0, nEdge: edge.length, edgeMed: edge[edge.length >> 1] || 0, nGround: ground.length, groundMax: worstG, glVsCpu: gc };
  }, cfg);
  for (const cfg of [{ shape: 'straight', dist: 37.3 }, { shape: '250R', dist: 111.7 }, { shape: '150L', dist: 5 }]) {
    const r = await parity(cfg);
    ok('GL frame = whole picture, ' + cfg.shape + ' at ' + cfg.dist + ' m: ground outside object tiles within half-float rounding', r.nonzero > 1000 && r.nGround > 100000 && r.groundMax < 5e-3, r.nGround + ' px, worst relative ' + r.groundMax.toExponential(1) + ' (' + r.W + '×' + r.H + ')');
    ok('GL frame = whole picture, ' + cfg.shape + ' at ' + cfg.dist + ' m: pixels an object covers fully', r.nFull > 100 && r.fullMax < 5e-3, r.nFull + ' px, worst relative ' + r.fullMax.toExponential(1));
    ok('GL frame = whole picture, ' + cfg.shape + ' at ' + cfg.dist + ' m: edge pixels, median', r.nEdge > 50 && r.edgeMed < 0.02, r.nEdge + ' px, median ' + (100 * r.edgeMed).toFixed(2) + ' %');
    ok('GL frame = the shader\'s sum in plain JS (composeCPU), ' + cfg.shape, r.glVsCpu < 5e-3, 'worst relative ' + r.glVsCpu.toExponential(1));
  }
  // 8b. the tone map on the GPU against RF.Drive.tonemap on the same HDR picture (the large view, where the canvas and the trace are the same size)
  await page.evaluate(() => { RF.UI.dvAnim.view = 'anim'; RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); }); await sleep(500); await page.click('[data-anim="popout"]'); await sleep(2500);
  for (const gl of [0, 0.3, 1]) {
    const r = await page.evaluate(async (gl) => {
      const ui = RF.UI; ui.dvOpts.glare = gl; ui.dvOpts.ev = 1; ui.dvOpts.expMode = 'fixed'; ui.dvAnim.playing = false; ui.redrawSpec(); await new Promise((r) => setTimeout(r, 1200));
      const X = RF.DriveAnim._; X.V.pinSS = 2; X.setDist(80); const p = X.V.p, hdr = X.readHdr(), cv = X.readCanvas(); X.V.pinSS = 0; const W = p.w, H = p.h, rgb = new Float32Array(3 * W * H);
      for (let q = 0; q < W * H; q++) { rgb[3 * q] = hdr[4 * q]; rgb[3 * q + 1] = hdr[4 * q + 1]; rgb[3 * q + 2] = hdr[4 * q + 2]; }
      const tm = RF.Drive.tonemap({ w: W, h: H, rgb }, { mode: 'fixed', ev: 1, glare: gl }); if (X.V.gl.cw !== W || X.V.gl.ch !== H) return { skip: [X.V.gl.cw, X.V.gl.ch, W, H] };
      let mx = 0, sum = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { const d = Math.abs(cv[4 * ((H - 1 - y) * W + x) + c] - tm.px[4 * (y * W + x) + c]); mx = Math.max(mx, d); sum += d; n++; }
      return { max: mx, mean: sum / n };
    }, gl);
    ok('GPU tone map vs Drive.tonemap, glare ' + gl + (gl ? ' (blurred at half size on the GPU: close, not identical)' : ' (no blur: the same 8-bit values, ±1 for the GPU\'s pow rounding; exactly 0 on the Apple GPU)'), !r.skip && (gl === 0 ? r.max <= 1 && r.mean < 0.01 : r.mean < 0.2 && r.max <= 24), JSON.stringify(r));
  }
  await page.keyboard.press('Escape'); await sleep(500);
  await page.close();

  // 9. a 2× display: the canvas has twice the pixels of its css box, the picture is traced at up to 1600 px
  const p2 = await open({ width: 1500, height: 950 }, 2);
  await p2.evaluate(() => { const st = RF.UI.dvAnim || (RF.UI.dvAnim = { view: 'still', playing: true, popout: false, dist: 0, total: 0 }); }); await p2.click('[data-anim="animate"]'); await sleep(2000);
  const d2 = await p2.evaluate(() => { const g = document.querySelector('.drive-gl'), r = g.getBoundingClientRect(); return { px: [g.width, g.height], css: [r.width, r.height], dpr: devicePixelRatio, sim: RF.DriveAnim.stats().sim }; });
  ok('devicePixelRatio 2: canvas backing store = css size × 2', Math.abs(d2.px[0] - d2.css[0] * 2) <= 1 && Math.abs(d2.px[1] - d2.css[1] * 2) <= 1, JSON.stringify(d2));
  await p2.click('[data-anim="popout"]'); await sleep(2500);
  const d3 = await p2.evaluate(() => { const g = document.querySelector('.drive-gl'), r = g.getBoundingClientRect(); return { px: [g.width, g.height], css: [r.width, r.height], sim: RF.DriveAnim.stats().sim }; });
  ok('devicePixelRatio 2 popout: backing store = css × 2, trace capped at 1600 px wide', Math.abs(d3.px[0] - d3.css[0] * 2) <= 1 && d3.sim[0] <= 1600 && d3.sim[0] >= 1200, JSON.stringify(d3));
  await p2.close();

  // 10. 1280×720 with the sidebar open: the drive canvas stays inside its pane (the old suspicion: it sticks out on the right)
  const p3 = await open({ width: 1280, height: 720 });
  const ov = await p3.evaluate(() => { const pane = document.querySelector('.result-pane').getBoundingClientRect(), cv = document.getElementById('heat-canvas').getBoundingClientRect(), gl = document.querySelector('.drive-gl'); return { paneRight: pane.right, canvasRight: cv.right, sideHidden: document.body.classList.contains('side-hidden'), glRight: gl && !gl.hidden ? gl.getBoundingClientRect().right : null }; });
  ok('1280×720, sidebar open: drive canvas right edge inside the Result pane', !ov.sideHidden && ov.canvasRight <= ov.paneRight + 0.5, JSON.stringify(ov));
  await p3.click('[data-anim="animate"]'); await sleep(2000);
  const ov2 = await p3.evaluate(() => { const pane = document.querySelector('.result-pane').getBoundingClientRect(), gl = document.querySelector('.drive-gl').getBoundingClientRect(), bar = document.querySelector('.drive-anim-tools').getBoundingClientRect(), els = [...document.querySelectorAll('.drive-anim-tools button')].map((b) => b.getBoundingClientRect().right); return { paneRight: pane.right, paneBottom: pane.bottom, glRight: gl.right, barBottom: bar.bottom, maxBtn: Math.max(...els) }; });
  ok('1280×720: the animated canvas and its controls stay inside the pane', ov2.glRight <= ov2.paneRight + 0.5 && ov2.maxBtn <= ov2.paneRight + 0.5 && ov2.barBottom <= ov2.paneBottom + 0.5, JSON.stringify(ov2));
  await p3.close();

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
