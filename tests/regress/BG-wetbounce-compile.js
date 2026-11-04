// BG page checks: does the APP's real wetBounce composition compile? (driver-authoritative)
// Serve the worktree first: python3 tests/serve.py <port> (background), then:
//   PLAYWRIGHT=.../playwright node tests/regress/BG-wetbounce-compile.js <port>
// Exits 1 on any failure. Needs a real GL context (the driver is the oracle).
//
// ORIGIN (spilett, 11-04): Anya's B6 — "GPU drive unavailable (GPU drive shader: Fragment shader is not
// compiled. ERROR: 0:132: '' : syntax error)" at js/drive-three.js:53. That is the REAL drop-to-CPU path,
// and the two guards that looked like they covered it do not:
//   · tests/regress/CC-halo-variant-compile.js sweeps haloTableSource(...) -> withWetBounceHalo
//     (drive-three-halo.js:326), a function the app never calls. The app uses WITHWETBOUNCE
//     (drive-three-shaders.js:427) via drive-three.js:82 / :100 / :314. CC passing says nothing here.
//   · tests/frenchie-wet-bounce.js:65-66 asserts TEXT PRESENCE (includes('lampM[2]') && includes('shimmerAmp')),
//     which passes on the non-compiling source.
// So the app's own composition set had no driver-level check at all. This is it, in CC's shape.
//
// INSTRUMENT TRAPS (each cost me a run; keep them, they are why the guard is written this way):
//   1. a bare WebGL2 context fails EVERY case (three.js supplies the precision/#version prefix);
//   2. a stub vertex shader fails EVERY case — the app's fragments expect the app's `vertex` varyings
//      (CC's header warns about this as TVERT). Use the app's own vertex export.
//   3. Therefore: check the CONTROLS first. A run whose controls fail has measured nothing.
const path = require('path'), fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8844);
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); };

(async () => {
  const browser = await pw.chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 300)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store, null, { timeout: 30000 });

    const res = await page.evaluate(async () => {
      const sh = await import('/js/drive-three-shaders.js');
      const T = await import('/vendor/three/three.module.min.js');
      const ground = sh.ground, wb = sh.withWetBounce, lit = sh.withLighting, tps = sh.tablePassSource, shimmer = sh.withShimmer, tab = sh.tableSource;
      const ps = (await import('/js/drive-touge-three.js')).passShader;   // nicholl 10:25: :84, the mountain-pass/sky materials
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false });
      const camera = new T.Camera(), scene = new T.Scene();
      const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null); scene.add(quad);
      const programs = [];
      const compile = (name, fs2) => {
        const errs = [];
        const orig = console.error;
        console.error = function (...a) { errs.push(a.map((x) => String(x && x.message ? x.message : x)).join(' ').slice(0, 500)); return orig.apply(console, a); };
        let threw = null;
        try {
          quad.material = new T.ShaderMaterial({ uniforms: {}, vertexShader: sh.vertex, fragmentShader: fs2 });   // the APP's vertex: its varyings must match, or every case fails for the wrong reason
          renderer.render(scene, camera);
        } catch (e) { threw = String(e && e.message || e).slice(0, 300); }
        console.error = orig;
        programs.push({ name, compiled: !threw && errs.length === 0, log: threw || errs.join(' | ').slice(0, 500) });
      };
      // the app's real composition set, drive-three.js:82 / :100 / :312-314
      const cases = {
        'ground (control)': () => ground,
        'lit(ground,true) (control)': () => lit(ground, true),
        'wb(ground)': () => wb(ground),
        'wb(lit(ground,true))': () => wb(lit(ground, true)),
        'wb(lit(ground,FALSE)) DEFAULT': () => wb(lit(ground, false)),               // nicholl 10:25: withLighting(src, atlas = false) at shaders:457 and atlasOn starts false at drive-three.js:50, so THIS is the shipped default at :82/:100, not the atlas arm. It is the arm the shimmer defect hid behind: my set only called lit(ground,true).
        'APP tps(wb(lit(ground,true)))': () => tps(wb(lit(ground, true))),          // drive-three.js:100
        'APP tps(wb(ground))': () => tps(wb(ground)),                                // nicholl 10:25: :100 with extras = false
        'tps(ground) (control)': () => tps(ground),
        'tps(lit(ground,true)) (control)': () => tps(lit(ground, true)),
        'tps(lit(ground,FALSE)) (control)': () => tps(lit(ground, false)),           // nicholl 10:25: the default-extras table arm
        'APP tableSource(wb(lit(ground,true)))': () => tab(wb(lit(ground, true))),   // nicholl 10:25: drive-three.js:83, table on the ground material
        'APP passShader(wb(lit(ground,true)))': () => ps(wb(lit(ground, true))),      // nicholl 10:25: drive-three.js:84, mountain pass/sky materials (touge)
        'tps(shim(ground))': () => tps(shimmer(ground)),
        'shim(ground) ALONE': () => shimmer(ground),                               // Anya's B6 root class
        'lit(shim(ground))': () => lit(shimmer(ground)),
        'wb(shim(ground))': () => wb(shimmer(ground)),                            // drive-three.js:312-314 when shimAmp>0
      };
      for (const [name, fn] of Object.entries(cases)) { try { compile(name, fn()); } catch (e) { programs.push({ name, compiled: false, log: 'JS threw: ' + String(e.message || e).slice(0, 300) }); } }
      const controls = programs.filter((p) => p.name.includes('(control)'));
      const arms = programs.filter((p) => !p.name.includes('(control)'));
      return {
        programs, gpu: renderer.getContext().getParameter(renderer.getContext().VERSION),
        controlFailures: controls.filter((c) => !c.compiled).map((c) => c.name),
        armFailures: arms.filter((a) => !a.compiled).map((a) => ({ name: a.name, log: a.log.slice(0, 240) })),
      };
    });
    if (errors.length) ok('BG no page errors', false, errors); else ok('BG no page errors', true);

    ok('BG controls all compile (a run whose controls fail has measured nothing)', res.controlFailures.length === 0, { gpu: res.gpu, failing: res.controlFailures });
    ok('BG the app wetBounce composition set compiles', res.armFailures.length === 0, { failing: res.armFailures.map((f) => f.name) });
    if (res.armFailures.length) res.armFailures.forEach((f) => ok('BG ' + f.name + ' compiles', false, f.log));

    let fails = 0; for (const c of checks) if (!c.pass) fails++;
    console.log('\n' + (checks.length - fails) + ' checks, ' + fails + ' failed');
    await browser.close();
    process.exit(fails ? 1 : 0);
  } catch (e) { console.log('BG ERROR ' + String(e && e.stack || e).slice(0, 600)); await browser.close(); process.exit(1); }
})();
