// External runner: python3 tests/serve.py 8798; node tests/regress/FO-foliage.js 8798
(function(root) {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), a = () => RF.DriveAnim._;
  const checks = [], ok = (name, pass, detail) => {
    const row = { name, pass: !!pass, detail }; checks.push(row);
    console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
  };
  const bytesEqual = (x, y) => {
    const b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength), c = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
    return b.length === c.length && b.every((v, i) => v === c[i]);
  };
  function draw(p, world, engine = a().V.three, dist = 0, capture = true) {
    const V = a().V;
    V.gl.draw({ hfov: p.hfov, pats: [], k: 5, glare: 0, veil: 0, flip: false, tex: 0,
      groundGPU: (A, O) => engine.render(p, world, dist, A, O, 1) });
    return capture ? { hdr: a().readHdr(), display: a().readCanvas() } : null;
  }
  function resize(w, h) {
    const V = a().V; V.canvas.width = w; V.canvas.height = h; V.gl.resize(w, h, w, h);
  }
  function source(scene, leafyFoliage, density = 1.5) {
    return RF.DriveAnim.source(scene, 3.5, false, { veg: true, posts: true, signs: true, people: false, animals: false },
      { leafyFoliage, wild: false, seed: 7, density, trafficDensity: 0 });
  }
  function params(src, on, w = 640, h = 360, wet = false) {
    return { ...a().V.p, src, w, h, A: null, touge: false, detailedModels: true, leafyFoliage: on,
      trafficBeams: false, surfaceSheen: false, pitch: 0, yaw: 0, cornerLeft: 0, cornerRight: 0,
      look: { wet, wetSheen: wet, grain: false, ambient: 0, RL: .2 } };
  }
  function freeze() { const V = a().V; if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0; }
  async function ready(port) {
    if (location.port !== String(port)) throw Error('FO wrong server port');
    const u = await M1Page.ready(port);
    Object.assign(u.dvOpts, { leafyFoliage: false, scene: 'forest', detailedModels: true, veg: true, mt: false,
      density: 1.5, seed: 7, wild: false, tiles: false, mountainPass: false, dynamicResolution: false, glare: 'off' });
    u.dvAnim.playing = false; u.redrawSpec();
    // Finish the initial M2 asset callback before controlled framebuffer sizes are installed.
    for (let i = 0; i < 200 && !a().V.three.modelState().ready && !a().V.three.modelState().error; i++) await sleep(50);
    freeze();
    return u;
  }
  async function baseProof(sources) {
    const V = a().V, urls = [], blob = s => { const u = URL.createObjectURL(new Blob([s], { type: 'text/javascript' })); urls.push(u); return u; };
    const absolute = s => s.replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, q, path) => 'from ' + JSON.stringify(new URL(path, location.origin + '/js/').href));
    const shaders = blob(sources.shaders), objects = blob(absolute(sources.objects).replace(JSON.stringify(location.origin + '/js/drive-three-shaders.js'), JSON.stringify(shaders)));
    const renderer = blob(absolute(sources.renderer).replace(JSON.stringify(location.origin + '/js/drive-three-objects.js'), JSON.stringify(objects)).replace(JSON.stringify(location.origin + '/js/drive-three-shaders.js'), JSON.stringify(shaders)));
    const old = (await import(renderer)).create(V.canvas, V.gl.gl);
    try {
      resize(640, 360);
      for (const scene of ['road', 'forest', 'city']) for (const wet of [false, true]) for (const detailedModels of [false, true]) {
        const src = source(scene, false), p = { ...params(src, false, 640, 360, wet), detailedModels };
        const world = { objects: RF.DriveAnim.placedObjects(p, 37.5, 2.7), A: null, markings: src.markings };
        const before = draw(p, world, old), after = draw(p, world);
        ok('FO off frame bytes equal main 322d119 ' + [scene, wet, detailedModels].join('/'), bytesEqual(before.hdr, after.hdr) && bytesEqual(before.display, after.display));
        draw({ ...p, leafyFoliage: true }, world);
        const restored = draw(p, world);
        ok('FO off/on/off restores HDR and display bytes ' + [scene, wet, detailedModels].join('/'), bytesEqual(after.hdr, restored.hdr) && bytesEqual(after.display, restored.display));
      }
    } finally {
      old.dispose(); V.three.dispose();
      V.three = (await import('/js/drive-three.js')).create(V.canvas, V.gl.gl);
      urls.forEach(URL.revokeObjectURL);
    }
  }
  async function run(port, sources) {
    checks.length = 0;
    // P1.ready materializes the defaults before M1.ready modifies any options.
    await P1Page.ready(); ok('FO Leafy foliage defaults off', RF.UI.dvOpts.leafyFoliage === false);
    const u = await ready(port), layoutOk = RF.DriveLayout.reveal(u, '[data-anim=leafy-foliage]');   // UI step C: Scene > Objects (was More)
    const buttons = document.querySelectorAll('[data-anim=leafy-foliage]'), button = buttons[0];
    ok('FO exactly one Leafy foliage control, in Scene > Objects', layoutOk && buttons.length === 1 && !!button.closest('[data-dl-pane=scene]') && button.textContent === 'Leafy foliage');
    button.click(); ok('FO actual control enables prototype and source bushes', u.dvOpts.leafyFoliage && a().V.p.leafyFoliage && a().V.src.objects.some(o => o.foliage) && button.getAttribute('aria-pressed') === 'true');
    const density = document.querySelector('[data-anim=density]'), count = a().V.src.objects.filter(o => o.foliage).length;
    density.value = '3'; density.dispatchEvent(new Event('change', { bubbles: true }));
    ok('FO forest scenery density control changes undergrowth', !density.disabled && a().V.src.objects.filter(o => o.foliage).length === count * 2);
    const veg = document.querySelector('[data-anim=c-veg]'); veg.click();
    ok('FO vegetation control removes prototype bushes', !a().V.src.objects.some(o => o.foliage)); veg.click(); button.click();
    ok('FO actual control returns off', !u.dvOpts.leafyFoliage && !a().V.src.objects.some(o => o.foliage));
    freeze(); await baseProof(sources);
    resize(640, 360);
    for (const scene of ['forest', 'road']) for (const wet of [false, true]) {
      const src = source(scene, true), p = params(src, true, 640, 360, wet);
      // Isolate actual seeded bush lobes: road/paint cannot masquerade as foliage in this check.
      const world = { objects: src.objects.filter(o => o.foliage && o.x > 0 && o.x < 15), A: null, markings: src.markings };
      const on = draw(p, world).hdr, labels = a().V.three.masks(p, 1, true);
      const off = draw({ ...p, lamps: [] }, world).hdr;
      let pixels = 0, rising = 0, luminanceOn = 0, luminanceOff = 0;
      const samples = [], tanV = Math.tan(p.hfov * Math.PI / 360) * p.h / p.w;
      for (let i = 0; i < labels.length; i += 4) {
        if (labels[i] !== RF.Drive.MAT_KEYS.indexOf('foliage')) continue;
        const y = Math.floor(i / 4 / p.w), x = i / 4 % p.w, rz = ((y + .5) / p.h * 2 - 1) * tanV;
        const ahead = -2 + (labels[i + 2] - 1.2) / rz;
        if (!(ahead >= 0 && ahead <= 15)) continue;
        const k = ((p.h - 1 - y) * p.w + x) * 4;
        const lum = data => .2126 * data[k] + .7152 * data[k + 1] + .0722 * data[k + 2];
        const bright = lum(on), dark = lum(off); pixels++; luminanceOn += bright; luminanceOff += dark;
        if (bright > dark + 1e-6) { rising++; if (samples.length < 5) samples.push({ x, y, ahead, on: bright, off: dark }); }
      }
      ok('FO real beam lights 0–15 m verge foliage ' + [scene, wet].join('/'), pixels > 0 && rising > 10 && luminanceOn > luminanceOff && luminanceOff === 0,
        { pixels, rising, luminanceOn, luminanceOff, samples });
    }
    const independentSrc = source('forest', true), independentP = { ...params(independentSrc, true), detailedModels: false };
    draw(independentP, { objects: RF.DriveAnim.placedObjects(independentP, 0, 0), A: null });
    ok('FO standalone toggle gives leafy tree clusters without detailed actors', a().V.three.modelState().leafPrimitives > 0 && a().V.three.modelState().nearTrees > 0 && a().V.three.modelState().actors === 0);
    // A separate bright ambient silhouette probe verifies cutouts affect tree edges even above the low-beam cutoff.
    const src = source('forest', false), p = params(src, false);
    p.look = { ...p.look, ambient: 2 }; const world = { objects: RF.Drive.Models.tree({ x: 15, y: 0, h: 5, id: 'FO-edge' }), A: null, markings: src.markings };
    draw(p, world); const solid = a().V.three.masks(p, 1, true);
    draw({ ...p, leafyFoliage: true }, world); const cut = a().V.three.masks(p, 1, true);
    let holes = 0, edgeHoles = 0; const leafId = RF.Drive.MAT_KEYS.indexOf('foliage');
    for (let i = 0; i < solid.length; i += 4) if (solid[i] === leafId && cut[i] !== leafId) {
      holes++; const pixel = i / 4, x = pixel % p.w, y = Math.floor(pixel / p.w);
      if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => x + dx >= 0 && x + dx < p.w && y + dy >= 0 && y + dy < p.h && solid[((y + dy) * p.w + x + dx) * 4] !== leafId)) edgeHoles++;
    }
    ok('FO leaf cutouts break the tree silhouette', holes > 0 && edgeHoles > 0, { holes, edgeHoles });
    ok('FO no WebGL error after leaf shaders', a().V.gl.gl.getError() === 0);
    return { pass: checks.every(c => c.pass), checks: checks.slice() };
  }
  const median = values => { const v = values.slice().sort((a, b) => a - b), i = Math.floor(v.length / 2); return v.length ? v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2 : null; };
  async function gpuTime(gl, ext, render) {
    if (!ext) { const start = performance.now(); render(); gl.finish(); return { gpuMs: null, syncWallMs: performance.now() - start, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' }; }
    if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw Error('another GPU timer is active');
    const q = gl.createQuery();
    try {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { render(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); } gl.flush();
      for (let n = 0; n < 400; n++) {
        await sleep(5);
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return { gpuMs: null, reason: 'disjoint GPU timer' };
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return { gpuMs: gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 };
      }
      return { gpuMs: null, reason: 'GPU timer timeout' };
    } finally { gl.deleteQuery(q); }
  }
  async function bench(port, w, h) {
    await ready(port); freeze(); resize(w, h);
    const V = a().V, gl = V.gl.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const hardware = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
    const rows = [];
    // Same 240 camera positions in all four arms: t=0..8 s, 50 km/h, 30 samples/s. ABBA order reduces warmup/drift bias.
    for (const on of [false, true, true, false]) {
      const src = source('forest', on), p = params(src, on, w, h);
      const frame = t => { const dist = t * 50 / 3.6; draw(p, { objects: RF.DriveAnim.placedObjects(p, dist, t), A: null }, V.three, dist, false); };
      for (let n = 0; n < 30; n++) frame(n / 30); gl.finish();
      const raw = [], primitives = [], leaves = [];
      for (let n = 0; n < 240; n++) {
        raw.push(await gpuTime(gl, ext, () => frame(n * 8 / 239)));
        const state = V.three.modelState(); primitives.push(state.proxyPrimitives); leaves.push(state.leafPrimitives);
      }
      const valid = raw.map(r => r.gpuMs).filter(x => x !== null && Number.isFinite(x) && x > 0);
      const row = { on, resolution: [w, h], samples: raw.length, valid: valid.length,
        gpuMedianMs: valid.length === raw.length ? median(valid) : null,
        syncWallMedianMs: ext ? null : median(raw.map(r => r.syncWallMs)),
        primitivesMedian: median(primitives), proxyTrianglesMedian: 2 * median(primitives), leafPrimitivesMedian: median(leaves), raw };
      rows.push(row); console.log('[PERF] FO ' + JSON.stringify(row));
    }
    const off = median(rows.filter(r => !r.on).map(r => r.gpuMedianMs).filter(v => v !== null));
    const on = median(rows.filter(r => r.on).map(r => r.gpuMedianMs).filter(v => v !== null));
    const complete = rows.every(r => r.gpuMedianMs !== null), validHardware = /Apple M4/.test(hardware) && /ANGLE.*Metal/i.test(hardware);
    const deltaPercent = complete ? (on / off - 1) * 100 : null;
    const result = { hardware, validHardware, viewport: [innerWidth, innerHeight], resolution: [w, h], seconds: 8, samplesPerArm: 240, speedKmh: 50,
      detailedModels: true, density: 1.5, seed: 7, wet: false, ss: 1, dynamicResolution: false, glare: 'off', gpuOffMs: off, gpuOnMs: on,
      deltaPercent, phoneBudgetMet: w === 428 && complete && validHardware ? deltaPercent <= 25 : null,
      cutsIfOverBudget: 'First reduce bush density 30 to 20 plants/side/300m at density=1; then close tree cutouts beyond 60m. Retain the 0–15m verge bushes.', rows };
    console.log('[PERF-SUMMARY] FO ' + JSON.stringify(result)); return result;
  }
  function shot(on, w, h, tree = false) {
    resize(w, h); const src = source('forest', on), p = params(src, on, w, h);
    const objects = tree ? RF.Drive.Models.tree({ x: 15, y: 0, h: 5, id: 'FO-edge' }) : RF.DriveAnim.placedObjects(p, 0, 0);
    if (tree) { p.look.ambient = 2; p.lamps = []; } // labelled silhouette diagnostic, separate from real-beam screenshots
    draw(p, { objects, A: null });
    return a().V.canvas.toDataURL('image/png');
  }
  root.FOPage = { run, bench, shot };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof require !== 'undefined' && require.main === module) (async () => {
  const fs = require('fs'), path = require('path'), cp = require('child_process');
  const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
  const port = +(process.argv[2] || 8798), browser = await pw.chromium.launch({ channel: 'chromium' });
  const sources = {}; for (const [key, file] of Object.entries({ renderer: 'drive-three', objects: 'drive-three-objects', shaders: 'drive-three-shaders' }))
    sources[key] = cp.execFileSync('git', ['show', '322d119:js/' + file + '.js'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
  let failed = false;
  try {
    for (const [width, height] of [[1600, 900], [428, 926]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width === 428 }), page = await context.newPage(), errors = [];
      await page.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
      page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (/^\[(PASS|FAIL|PERF)/.test(m.text())) console.log(m.text()); });
      await page.addInitScript(() => localStorage.clear()); await page.goto('http://127.0.0.1:' + port + '/index.html');
      await page.waitForFunction(() => window.RF?.UI?.loadScene);
      await page.evaluate(text => RF.UI.loadScene(RF.State.deserialize(text), 'FO fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
      for (const script of ['drive-three-page', 'models-proto-page', 'regress/FO-foliage']) await page.addScriptTag({ url: '/tests/' + script + '.js' });
      const regression = await page.evaluate(({ port, sources }) => FOPage.run(port, sources), { port, sources }); failed ||= !regression.pass;
      const perf = await page.evaluate(({ port, width, height }) => FOPage.bench(port, width, height), { port, width, height });
      // Missing timers/hardware leave the budget explicitly unmeasured; an actual measured miss fails.
      failed ||= perf.phoneBudgetMet === false;
      console.log('[FO-RESULT] ' + JSON.stringify({ viewport: [width, height], regression, perf }));
      console.log((errors.length ? '[FAIL] ' : '[PASS] ') + 'FO no shader/page/console errors ' + JSON.stringify(errors)); failed ||= errors.length > 0;
      if (process.argv.includes('--shots')) {
        fs.mkdirSync(path.join(__dirname, '../shots'), { recursive: true });
        for (const tree of [false, true]) for (const on of [false, true]) {
          // Draw and capture within one task: preserveDrawingBuffer is false.
          const data = await page.evaluate(({ on, width, height, tree }) => FOPage.shot(on, width, height, tree), { on, width, height, tree });
          fs.writeFileSync(path.join(__dirname, '../shots/FO-' + width + 'x' + height + '-' + (tree ? 'silhouette-ambient' : 'real-beam') + '-' + (on ? 'on' : 'off') + '.png'), Buffer.from(data.split(',')[1], 'base64'));
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? 'FO FAILED' : 'all FO page checks passed (inspect PERF-SUMMARY for measurement availability)'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
