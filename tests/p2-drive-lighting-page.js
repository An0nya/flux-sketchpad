/* P2 page helpers: external runner and tester use the same checks and measurements. */
(function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ready() {
    const u = RF.UI; u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    if (!u.spec || !u.spec.full || u.needCompile) throw Error('No completed real lamp');
    await sleep(500); u.setDisplay('drive'); u.setPane('result', 'activate');
    Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false, dist: 25, t: 12 });
    Object.assign(u.dvOpts, { mt: false, dynamicResolution: false, gpuRenderer: true }); u.redrawSpec();
    for (let i = 0; i < 200 && RF.DriveAnim.stats().renderer !== 'three'; i++) await sleep(50);
    if (RF.DriveAnim.stats().renderer !== 'three') throw Error('GPU unavailable: ' + RF.DriveAnim.stats().gpuFailure);
    u.redrawSpec(); await sleep(200); RF.DriveAnim.openPop(u);
    Object.assign(RF.DriveAnim._.V.popStage.style, { position: 'fixed', left: '0', top: '0', width: '1600px', height: '900px' });
    await sleep(100); return u;
  }
  async function select(options) { Object.assign(RF.UI.dvOpts, options); RF.UI.redrawSpec(); await sleep(600); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); RF.DriveAnim._.frame(); }
  async function digest(v) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', v))).map(x => x.toString(16).padStart(2, '0')).join(''); }
  function worldOf(p, dist, t) { const D = RF.DriveAnim; return p.src.tiles ? D.tileWorld(p, dist, t) : { A: p.A, objects: D.placedObjects(p, dist, t) }; }
  function drawWorld(p, world, renderer) {
    const a = RF.DriveAnim._;
    a.V.gl.draw({ hfov: p.hfov, pats: [], k: 0.2, glare: 0, flip: false, groundGPU: (A, O) => (renderer || a.V.three).render(p, world, 25, A, O, 1) });
    return a.readHdr();
  }
  async function baseProof(base) {
    const u = await ready(), a = RF.DriveAnim._, D = RF.Drive, results = []; a.V.pinSS = 1;
    const url = code => URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), vendor = new URL('/vendor/three/three.module.min.js', location.href).href;
    const shaders = url(base.shaders), objs = url(base.objects.replace("'../vendor/three/three.module.min.js'", JSON.stringify(vendor)).replace("'./drive-three-shaders.js'", JSON.stringify(shaders)));
    const moduleURL = url(base.renderer.replace("'../vendor/three/three.module.min.js'", JSON.stringify(vendor)).replace("'./drive-three-shaders.js'", JSON.stringify(shaders)).replace("'./drive-three-objects.js'", JSON.stringify(objs)));
    const original = await import(moduleURL), renderer = original.create(a.V.canvas, a.V.gl.gl);
    (0, eval)(base.cpu); const baseD = RF.Drive; RF.Drive = D;
    Object.assign(u.dvOpts, { trafficBeams: false, surfaceSheen: false, lampPitch: false, tex: false, wild: false, ambient: 0, oncoming: true, preceding: true, trafficLogic: false });
    try {
      for (const scene of ['road', 'city']) for (const wet of [false, true]) for (const tiles of [false, true]) {
        await select({ gpuRenderer: true, scene, tiles, wet, wetSheen: wet });
        const p = { ...a.V.p, w: 320, h: 180, pitch: 0 }, world = worldOf(p, 25, 12);
        const options = { w: p.w, h: p.h, hfov: p.hfov, eye: RF.DriveAnim.EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, arc: world.A, lane: p.lane, look: p.look, ss: 1, pointLights: world.lights, crossings: world.crossings, scene: { objects: world.objects, markings: world.markings || p.src.markings, verge: p.src.verge } };
        const before = baseD.render(options), after = D.render(options), cpuEqual = before.rgb.every((v, i) => v === after.rgb[i]);
        // Same destinations, same completed beam, same geometry: only renderer source differs.
        a.V.gl.resize(p.w, p.h, 1600, 900);
        const beforeHDR = drawWorld(p, world, renderer), beforeDisplay = a.readCanvas(), afterHDR = drawWorld(p, world), afterDisplay = a.readCanvas();
        results.push({ scene, wet, tiles, cpuEqual, gpuHDREqual: beforeHDR.every((v, i) => v === afterHDR[i]), gpuDisplayEqual: beforeDisplay.every((v, i) => v === afterDisplay[i]) });
      }
    } finally { renderer.dispose(); URL.revokeObjectURL(shaders); URL.revokeObjectURL(objs); URL.revokeObjectURL(moduleURL); u.redrawSpec(); }
    return { base: 'a95029b', results, pass: results.every(r => r.cpuEqual && r.gpuHDREqual && r.gpuDisplayEqual) };
  }
  function difference(a, b) { let sum = 0, max = 0, count = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { const d = Math.abs(a[i] - b[i]); sum += d; max = Math.max(max, d); if (d > 1e-6) count++; } return { sum, max, count }; }
  async function run(port) {
    const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + JSON.stringify(detail) : '')); };
    ok('P2 RF.UI and expected port', !!RF.UI && location.port === String(port)); if (location.port !== String(port)) throw Error('wrong page port');
    const u = await ready(), A = RF.DriveAnim, D = RF.Drive, a = A._; a.V.pinSS = 1;
    ok('P2 all options default off', ['trafficBeams', 'surfaceSheen', 'lampPitch'].every(k => u.dvOpts[k] === false));
    await select({ gpuRenderer: true, scene: 'road', tiles: false, wet: true, wetSheen: true, tex: false, ambient: 0, wild: false, glare: 'off', trafficLogic: false });
    const p = { ...a.V.p, w: 320, h: 180, trafficBeams: false, surfaceSheen: false, pitch: 0 }, kit = D.kit({ Lw: p.lane, A: null, us: false, rand: () => 0.5 });
    kit.car(40, 3.5, { face: -1, lamps: 'head' }); kit.car(32, -1, { lamps: 'tail' }); kit.sign(40, -4, 'white', { z0: 1, h: 1 });
    kit.O.forEach(ob => { if (ob.headlamp || (ob.x < 35 && !/sign/.test(ob.mat))) ob.traffic = ob.x < 35 ? 'preceding' : 'oncoming'; });
    // Brighten an ordinary nearby object via traffic: no emitter/retro material needed.
    kit.O.push({ k: 'box', x: 25, y: 4.8, hx: 0.5, hy: 0.5, z0: 0, z1: 1, mat: 'concrete' });
    const world = { objects: kit.O, markings: p.src.markings }, trace = u.run.ctx, table = p.lut;
    a.V.gl.resize(p.w, p.h, 1600, 900);
    const off = drawWorld(p, world), onP = { ...p, trafficBeams: true }, on = drawWorld(onP, world), diff = difference(off, on);
    ok('P2 bounded oncoming AND preceding low-beam sources', D.trafficSources(world.objects).length === 4);
    ok('P2 traffic light changes road/object HDR, not only emitter sprites', diff.count > 100 && diff.sum > 0, diff);
    const options = { w: p.w, h: p.h, hfov: p.hfov, eye: A.EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, lane: p.lane, look: p.look, src: p.src, ss: 1, trafficBeams: true, scene: { ...world, verge: p.src.verge } };
    const cpu = D.render(options); let err = 0, ref = 0; const classes = {}, gains = {};
    for (let i = 0; i < p.w * p.h; i++) { const key = cpu.keys[cpu.mat[i]]; gains[key] = (gains[key] || 0) + on[4 * i] - off[4 * i]; const group = /paint|asphalt|grass|gravel/.test(key) ? 'ground/markings' : key, g = classes[group] || (classes[group] = { error: 0, reference: 0, count: 0 }); for (let c = 0; c < 3; c++) { const d = Math.abs(cpu.rgb[3 * i + c] - on[4 * i + c]); err += d; ref += cpu.rgb[3 * i + c]; g.error += d; g.reference += cpu.rgb[3 * i + c]; g.count++; } }
    ok('P2 road, paint AND ordinary nearby object receive traffic light', gains.asphalt > 0 && gains['white-paint'] > 0 && gains.concrete > 0, gains);
    for (const g of Object.values(classes)) g.relative = g.error / Math.max(g.reference, g.count * 0.01);
    ok('P2 traffic GPU/CPU HDR agrees within existing P1 3% ground / 5% object tolerances', Object.entries(classes).every(([k, g]) => g.relative < (k === 'ground/markings' ? 0.03 : 0.05)), classes);
    const surface = D.surfaceSources(world.objects, p), sheen = drawWorld({ ...p, surfaceSheen: true }, world), sheenDiff = difference(off, sheen);
    ok('P2 real beam-lit sign has computed area and returned luminance', surface.some(q => q.area > 0 && q.returnedLuminance > 0) && surface.length <= 8, surface);
    ok('P2 lit surface adds wet HDR streak', sheenDiff.count > 0 && sheenDiff.sum > 0, sheenDiff);
    const dry = { ...p, look: { ...p.look, wet: false, wetSheen: false } }, dryOff = drawWorld(dry, world), dryOn = drawWorld({ ...dry, surfaceSheen: true }, world);
    ok('P2 surface sheen has no dry-road effect', dryOff.every((v, i) => v === dryOn[i]));
    const pitch = A.pitchStep(null, -4, 1), pitched = drawWorld({ ...p, lampPitch: true, pitch: pitch.angle }, world);
    ok('P2 braking pitch shifts drive beam and leaves optical LUT unchanged', pitch.angle < 0 && difference(off, pitched).count > 100 && u.run.ctx === trace && p.lut === table && !u.needCompile, { pitchDegrees: pitch.angle * 180 / Math.PI, difference: difference(off, pitched) });
    for (const conv of ['A', 'B', 'S']) {
      const pp = { ...p, conv, trafficBeams: true, lampPitch: true, pitch: pitch.angle, src: { ...p.src, traffic: { ...p.src.traffic, onMode: 'symmetric' } } }, gpu = drawWorld(pp, world);
      const ref = D.render({ ...options, conv, pitch: pitch.angle, src: pp.src }); let error = 0, sum = 0;
      for (let i = 0; i < p.w * p.h; i++) for (let c = 0; c < 3; c++) { error += Math.abs(ref.rgb[3 * i + c] - gpu[4 * i + c]); sum += ref.rgb[3 * i + c]; }
      ok('P2 symmetric design traffic and pitch GPU/CPU agreement in ' + conv, error / Math.max(sum, 1) < 0.05, { relative: error / Math.max(sum, 1) });
    }
    const restored = drawWorld(p, world); ok('P2 all-off restores identical GPU frame after every feature', restored.every((v, i) => v === off[i]));
    for (const [name, key] of [['traffic-beams', 'trafficBeams'], ['surface-sheen', 'surfaceSheen'], ['lamp-pitch', 'lampPitch']]) {
      document.querySelector('[data-anim=' + name + ']').click(); await sleep(600);
      ok('P2 ' + key + ' toggle persists', JSON.parse(localStorage.getItem('flux/driveView'))[key] === true); u.dvOpts[key] = false; u.redrawSpec(); await sleep(600);
    }
    a.V.gl.resize(p.w, p.h, 1600, 900); const glareFrames = [], glareSources = D.glareSources(world.objects, A.EYE);
    for (const pp of [p, { ...p, trafficBeams: true }, p, { ...p, surfaceSheen: true }, p, { ...p, lampPitch: true, pitch: pitch.angle }, p]) {
      a.V.gl.draw({ hfov: p.hfov, pats: [], k: 0.2, glare: 0.3, veil: 1, sources: glareSources, flip: false, groundGPU: (G, O) => a.V.three.render(pp, world, 25, G, O, 1) }); glareFrames.push(a.readCanvas());
    }
    ok('P2 all-off display restores byte-for-byte through rain glare after each feature', [2, 4, 6].every(k => glareFrames[k].every((v, i) => v === glareFrames[0][i])));
    // Exercise the actual minigame speed path, rather than injecting a rendering-only pitch.
    Object.assign(u.dvOpts, { lampPitch: true }); u.redrawSpec(); await sleep(600); a.toggleGame(u); document.querySelector('[data-game=start]').click(); await sleep(150); u.dvAnim.playing = false; u.redrawSpec(); await sleep(300);
    const game = u.dvAnim.game; game.braking = true; game.brake = true; const oldSpeed = game.v; a.advanceCamera(u.dvAnim, 0.1); a.frame();
    ok('P2 game braking speed produces negative acceleration and pitch', game.v < oldSpeed && u.dvAnim.acceleration < 0 && u.dvAnim.pitch.angle < 0, { oldSpeed, speed: game.v, acceleration: u.dvAnim.acceleration, pitch: u.dvAnim.pitch });
    a.toggleGame(u); await sleep(600); await select({ trafficLogic: true, lampPitch: true, speed: 50 });
    u.dvAnim.camera = { x: u.dvAnim.dist, v: 25 }; u.dvAnim.pitch = null; a.advanceCamera(u.dvAnim, 0.1); a.frame();
    ok('P2 traffic-logic actual speed reduction drives suspension', u.dvAnim.acceleration < 0 && u.dvAnim.pitch.angle < 0, { acceleration: u.dvAnim.acceleration, pitch: u.dvAnim.pitch.angle });
    return { checks, pass: checks.every(c => c.pass) };
  }
  async function pictures() {
    const u = await ready(), a = RF.DriveAnim._; a.V.pinSS = 1;
    Object.assign(u.dvAnim, { dist: 45, t: 8, playing: false, pitch: null });
    await select({ scene: 'city', wild: false, tiles: false, wet: true, wetSheen: true, glare: 'rain', onMode: 'generic', oncoming: true, preceding: true, trafficDensity: 3, trafficLogic: true, ambient: 0, trafficBeams: false, surfaceSheen: false, lampPitch: false });
    await sleep(1000);
    const p = { ...a.V.p, w: 640, h: 360, pitch: 0 }, world = worldOf(p, 45, 8), sources = RF.Drive.glareSources(world.objects, RF.DriveAnim.EYE), lut = p.lut, trace = u.run.ctx, results = [];
    a.V.gl.resize(p.w, p.h, 1600, 900);
    function png(pixels) { const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900; const ctx = canvas.getContext('2d'), data = ctx.createImageData(1600, 900); for (let y = 0; y < 900; y++) data.data.set(pixels.subarray((899 - y) * 6400, (900 - y) * 6400), y * 6400); ctx.putImageData(data, 0, 0); return canvas.toDataURL('image/png'); }
    for (const feature of ['trafficBeams', 'surfaceSheen', 'lampPitch']) {
      let before;
      for (const enabled of [false, true]) {
        const pp = { ...p, [feature]: enabled, pitch: feature === 'lampPitch' && enabled ? RF.DriveAnim.pitchStep(null, -4, 1).angle : 0 };
        a.V.gl.draw({ hfov: p.hfov, pats: [], k: 0.2, glare: 0.3, veil: 1, sources, flip: false, groundGPU: (G, O) => a.V.three.render(pp, world, 45, G, O, 1) });
        const pixels = a.readCanvas(), hdr = a.readHdr(); if (!enabled) before = hdr;
        results.push({ feature, enabled, pixels, hdr, difference: enabled ? difference(before, hdr) : null, pitch: pp.pitch, sim: [p.w, p.h], canvas: [1600, 900] });
      }
    }
    const off = results.filter(r => !r.enabled), offFramesEqual = off.every(r => r.pixels.every((v, i) => v === off[0].pixels[i])), lutHash = await digest(lut.data.buffer);
    for (const r of results) { r.png = png(r.pixels); r.hdrHash = await digest(r.hdr.buffer); r.lutHash = lutHash; delete r.pixels; delete r.hdr; }
    return { results, offFramesEqual, sameTrace: u.run.ctx === trace && !u.needCompile && p.lut === lut, source: 'actual MG2 traced lamp, one frozen world and LUT for all six captures; raw displayed canvas readback including rain glare, no debug lighting' };
  }
  async function bench({ native = true, costOnly = false } = {}) {
    const u = await ready(), A = RF.DriveAnim, a = A._, results = []; a.V.pinSS = native ? 1 : 2;
    await select({ scene: 'city', tiles: true, wild: true, seed: 7, density: 3, wet: true, wetSheen: true, glare: 'rain', trafficDensity: 3, trafficLogic: true, onMode: 'generic', oncoming: true, preceding: true, streetLamps: 'sodium', tex: true, ambient: 0, debugTimings: true, fpsCounter: true, dynamicResolution: false });
    const gl = a.V.gl.gl, timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
    for (const feature of ['off', 'trafficBeams', 'surfaceSheen', 'lampPitch', 'all', 'off-repeat']) {
      Object.assign(u.dvAnim, { dist: 100, t: 8, total: 100, camera: null, pitch: null, playing: false }); a.V.src.traffic.state = null;
      await select({ trafficBeams: feature === 'trafficBeams' || feature === 'all', surfaceSheen: feature === 'surfaceSheen' || feature === 'all', lampPitch: feature === 'lampPitch' || feature === 'all' });
      u.dvAnim.playing = !costOnly; u.redrawSpec(); await sleep(600); if (native) a.prepare({ ...a.size(), W: 1600, H: 900 }); await sleep(costOnly ? 300 : 3000); A.resetStats(); const start = performance.now(), frames = a.V.frames, trace = u.run.ctx; if (costOnly) a.frame(); else await sleep(8000);
      const elapsed = performance.now() - start, stats = A.stats(), completed = a.V.frames - frames; u.dvAnim.playing = false; u.redrawSpec(); await sleep(200); if (native) a.prepare({ ...a.size(), W: 1600, H: 900 });
      const world = worldOf(a.V.p, u.dvAnim.dist, u.dvAnim.t), counts = { lamps: RF.Drive.trafficSources(world.objects).length, surfaces: RF.Drive.surfaceSources(world.objects, a.V.p).length, streetLights: (world.lights || []).length };
      // Synchronized fixed-frame wall cost includes GPU completion, unlike CPU submission telemetry.
      const samples = [], queries = [];
      for (let i = 0; i < 25; i++) {
        const q = timer && gl.createQuery(); if (q) gl.beginQuery(timer.TIME_ELAPSED_EXT, q); const begin = performance.now(); a.frame(); if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(q); } a.V.gl.sync(); samples.push(performance.now() - begin); await sleep(0);
      }
      const gpuSamples = []; let disjoint = false;
      for (const q of queries) { for (let i = 0; i < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) await sleep(5); disjoint = disjoint || gl.getParameter(timer.GPU_DISJOINT_EXT); if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpuSamples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
      results.push({ feature, elapsed, completed, averageFPS: costOnly ? null : completed * 1000 / elapsed, p95Ms: stats.p95Ms, meanWorkMs: stats.breakdownMean.workMs, sim: stats.sim, ss: stats.ss, canvas: stats.canvasPx, sameTrace: u.run.ctx === trace && !u.needCompile, counts, readbackFrameMs: samples.reduce((x, y) => x + y, 0) / samples.length, gpuMs: !disjoint && gpuSamples.length ? gpuSamples.reduce((x, y) => x + y, 0) / gpuSamples.length : null, gpuDisjoint: disjoint, samples, gpuSamples });
    }
    return { native, costOnly, viewport: [innerWidth, innerHeight], devicePixelRatio, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', fixture: 'MG2-default-lamp actual traced optics; city tiles, dense=3, wet/sheen, rain glare, traffic logic and both directions, sodium street lamps', timing: '3 s warm-up + 8 s completed frames per condition; 25 paused frames including synchronous 1-pixel readback (CPU+GPU completion); GPU query elapsed is diagnostic if extension and non-disjoint', results };
  }
  window.P2Page = { ready, select, sleep, digest, worldOf, drawWorld, baseProof, run, pictures, bench };
})();
