// CC page checks: does every halo table variant COMPILE? (driver-authoritative, not text.)
// Serve the worktree first: python3 tests/serve.py <port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/CC-halo-variant-compile.js <port>
// Exits 1 on any failure. Needs a real GL context (the driver is the oracle); on software GL it still runs but its
// verdict is about that driver, which is fine for a does-it-compile check (rule 24 allows software GL for that).
//
// Origin: qwen3.8max/app-edits/halo-variant-compile/compile-coverage.js (gpuq page lane, async(gpuq) shape), rewritten
// as a standalone tests/regress/ page test (P1/SE/SH shape) by pencroff. The in-page logic is preserved verbatim in
// spirit: the same three phases (positive control, pairwise, deterministic sample), the same driver-authoritative
// detection (COMPILE_STATUS/LINK_STATUS on renderer.info.programs, with throw/console.error/diagnostics as secondary
// channels), the same non-vacuity guard (programsSeen/programsMax), and the same loud INVALID verdicts (rule 15).
// qwen3.8max's two documented traps are kept: TVERT is reproduced verbatim (a vec4(position,1.0) fallback would fail
// every check for the wrong reason), and sm-uniform placeholders are correctly typed (a {value:0} for a Vector/Matrix
// uniform throws toArray() and leaves the sm half uncovered — a harness bug, not an app defect).
//
// PIN: tests/serve.py injects tests/pinned-defaults.js before the registry. This check is OPTION-INDEPENDENT — it
// imports haloTableSource directly and constructs its own ShaderMaterial, so neither pinned nor live defaults move the
// generated source. (haloTableSource takes explicit args, not the option store.) Stated for the reviewer per cyrus's note.
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
    // The page need not solve or open the drive view: the halo module is an ES module importable on its own.
    await page.waitForFunction(() => window.RF && RF.UI, null, { timeout: 60000 });

    // Run the whole compile-coverage harness in-page. It returns the same JSON the gpuq lane did, plus we add
    // the check list here so the gate sees [PASS]/[FAIL] lines and a nonzero exit on failure.
    const result = await page.evaluate(async () => {
      const out = { note: 'halo table variant COMPILE coverage', ok: false };
      const t0 = Date.now();

      const H = await import('/js/drive-three-halo.js');
      const T = await import('/vendor/three/three.module.min.js');
      out.threeRevision = T.REVISION;
      out.haloTableSourceIsFn = typeof H.haloTableSource === 'function';
      if (!out.haloTableSourceIsFn) { out.err = 'haloTableSource not exported'; return out; }

      // ---- a throwaway renderer on its own 4x4 context: compiles shaders, never touches the app's canvas ----
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
      const renderer = new T.WebGLRenderer({ canvas: cv, antialias: false });
      const gl = renderer.getContext();
      out.glVersion = String(gl.getParameter(gl.VERSION));
      out.glRenderer = String(gl.getParameter(gl.RENDERER));
      const scene = new T.Scene(), camera = new T.Camera();
      const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), null); scene.add(mesh);

      // three.js reports a bad shader on any of these depending on version; watch all three.
      const errs = [];
      const origError = console.error;
      console.error = function (...a) { errs.push(a.map((x) => String(x && x.message ? x.message : x)).join(' ').slice(0, 400)); return origError.apply(console, a); };

      // mk() signature order, from js/drive-three-halo.js:473
      const P = ['atlas', 'polar', 'occ', 'variant', 'jit', 'sm', 'lw', 'refine', 'nb', 'moment', 'widthStep', 'wb'];
      // the registry's own value sets (same lists sweep.js uses) — reduced where a value is only a cost knob
      const VALS = {
        atlas: [false, true], polar: [false, true], occ: [false, true], variant: ['', 'band', 'split'],
        jit: [false, 'lamp', 'row', 'bin', 'both'], sm: [false, true], lw: [0, 4, 8, 16, 32, 64],
        refine: [0, 4, 16, 64, 512, 2048], nb: [false, true], moment: [0, 1, 2],
        widthStep: [0, 1, 2, 3], wb: [false, true],
      };
      const DEF = { atlas: false, polar: false, occ: false, variant: '', jit: false, sm: false, lw: 0, refine: 0, nb: false, moment: 0, widthStep: 0, wb: false };
      const args = (o) => P.map((k) => o[k]);
      const label = (o) => P.filter((k) => o[k] !== DEF[k]).map((k) => k + '=' + JSON.stringify(o[k])).join(',') || 'default';

      // Uniform placeholders, CORRECTLY TYPED. A {value:0} for a Vector/Matrix uniform throws toArray() during upload
      // (three calls .toArray()), which would leave the whole sm half of the variant space uncovered — a harness bug,
      // not an app defect. Types from SM_DECL in js/drive-three-shadowmaps.js:12 (SM_MAX = 8).
      const SM_MAX = 8;
      const v3arr = () => Array.from({ length: SM_MAX }, () => new T.Vector3());
      const v4arr = () => Array.from({ length: SM_MAX }, () => new T.Vector4());
      const smTexPlaceholder = () => { const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; };
      const uni = (o) => Object.assign(
        o.sm ? { smTex: { value: smTexPlaceholder() }, smE: { value: v3arr() }, smF: { value: v3arr() }, smL: { value: v3arr() }, smU: { value: v3arr() }, smP: { value: v4arr() }, smRes: { value: new T.Vector2(512, 256) }, smM: { value: -1 } } : {},
        o.widthStep > 0 ? { haloWidthStep: { value: o.widthStep } } : {},
        o.wb ? { wetU: { value: 0 } } : {});

      let compiled = 0, programsSeen = 0, programsMax = 0, smTried = 0, smJsThrow = 0;
      const failures = [];
      // Driver-authoritative compile check. Actually RENDER (frustumCulled off so the mesh is submitted), then ask the
      // DRIVER: walk renderer.info.programs and read COMPILE_STATUS on every attached shader and LINK_STATUS on the
      // program. three's own channels (throw/console.error/diagnostics) are secondary, kept for the log TEXT.
      // programsSeen (growth) and programsMax (high-water mark — three releases programs on dispose()) are the
      // non-vacuity guard: if both are 0 nothing was ever compiled and the run is INVALID, never a quiet pass.
      function driverErrors() {
        const bad = [];
        const progs = renderer.info.programs || [];
        for (const p of progs) {
          const prog = p && p.program; if (!prog) continue;
          let sh = [];
          try { sh = gl.getAttachedShaders(prog) || []; } catch (e) { sh = []; }
          for (const s of sh) {
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
              bad.push('COMPILE ' + (gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex') + ': ' + String(gl.getShaderInfoLog(s) || '').slice(0, 300));
            }
          }
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) bad.push('LINK: ' + String(gl.getProgramInfoLog(prog) || '').slice(0, 300));
        }
        return bad;
      }

      // srcOverride lets the positive control feed a deliberately broken source through the same path.
      function check(o, srcOverride) {
        const src = srcOverride !== undefined ? srcOverride : H.haloTableSource(...args(o));
        const mat = new T.ShaderMaterial({
          uniforms: uni(o),
          // TVERT is module-local in drive-three-halo.js:105 (not exported), so reproduce it verbatim: vec4(position,1.0)
          // would not compile (position is a vec3) and would fail EVERY check, making the control pass for the wrong
          // reason. If this line drifts from TVERT the control goes INVALID, not silently green.
          vertexShader: H.TVERT || 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: src,
          blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor,
          blendSrcAlpha: o.moment ? T.OneFactor : T.ZeroFactor, blendDstAlpha: T.OneFactor, depthTest: false, depthWrite: false,
        });
        mesh.material = mat; mesh.frustumCulled = false;
        errs.length = 0;
        const before = (renderer.info.programs || []).length;
        let threw = '';
        try { renderer.render(scene, camera); } catch (e) { threw = String(e && e.message || e).slice(0, 300); }
        const after = (renderer.info.programs || []).length;
        if (after > before) programsSeen += after - before;
        if (after > programsMax) programsMax = after;
        const drv = driverErrors();
        let diag = '';
        const progs = renderer.info.programs || [];
        for (let i = before; i < progs.length; i++) { const d = progs[i] && progs[i].diagnostics; if (d) { diag = String((d.programLog || '') + ' ' + (d.fragmentShader && d.fragmentShader.log || '')).slice(0, 300); break; } }
        if (o.sm) { smTried++; if (threw) smJsThrow++; }
        const via = [drv.length && 'driver COMPILE_STATUS/LINK_STATUS', threw && 'throw', errs.length && 'console.error', diag && 'diagnostics'].filter(Boolean);
        compiled++;
        mat.dispose();
        if (via.length) { failures.push({ combo: label(o), via, driver: drv[0] || '', threw, consoleError: errs[0] || '', diag }); return false; }
        return true;
      }

      // ================= 1. POSITIVE CONTROL — must fail, or nothing below means anything =================
      // Rebuild the 11-02 defect: in a refine>0 && sm variant the refined copy's hook must read `rs`; the bug was
      // smText running AFTER crossText, so the rename never reached the refined copy and it used the undeclared `s`.
      const bugCombo = Object.assign({}, DEF, { refine: 512, sm: true });
      const goodSrc = H.haloTableSource(...args(bugCombo));
      const ANCHOR = 'if (!smLit(smM, haloEye + rs * ray)) continue;';
      const BROKEN = 'if (!smLit(smM, haloEye + s * ray)) continue;';
      out.control = { anchorPresent: goodSrc.split(ANCHOR).length - 1 };
      if (out.control.anchorPresent > 0) {
        const badSrc = goodSrc.replace(ANCHOR, BROKEN);
        check(bugCombo, goodSrc);                       // the shipped source must compile
        out.control.goodCompiles = failures.length === 0;
        const caughtIt = !check(bugCombo, badSrc);       // the 11-02 source must NOT
        out.control.caught = caughtIt;
        out.control.detectorVia = failures.length ? failures[failures.length - 1].via : [];
        out.control.logExcerpt = failures.length ? (failures[failures.length - 1].threw || failures[failures.length - 1].consoleError || failures[failures.length - 1].diag).slice(0, 200) : '';
        failures.length = 0;                             // the control's failure is expected; don't count it
      } else {
        out.control.caught = null;
        out.control.why = 'anchor not found in the generated source — the refined hook text changed; re-derive it before trusting this run';
      }

      // ================= 2. pairwise coverage =================
      const t2 = Date.now();
      const each = [];
      for (const k of P) for (const v of VALS[k]) if (v !== DEF[k]) { const o = Object.assign({}, DEF); o[k] = v; each.push(o); }
      for (const o of each) check(o);
      out.pairwiseSingle = { tried: each.length, ms: Date.now() - t2 };

      const t3 = Date.now();
      const pairs = [];
      for (const [a, b] of [['sm', 'refine'], ['sm', 'nb'], ['moment', 'refine'], ['wb', 'lw'], ['occ', 'refine'], ['polar', 'refine'], ['jit', 'sm'], ['variant', 'sm'], ['atlas', 'widthStep'], ['sm', 'widthStep'], ['nb', 'refine'], ['moment', 'wb']]) {
        for (const va of VALS[a]) for (const vb of VALS[b]) { if (va === DEF[a] && vb === DEF[b]) continue; const o = Object.assign({}, DEF); o[a] = va; o[b] = vb; pairs.push(o); }
      }
      for (const o of pairs) check(o);
      out.pairwiseInteract = { tried: pairs.length, ms: Date.now() - t3 };

      // ================= 3. deterministic sample of the full cross-product =================
      const t4 = Date.now();
      let seed = 20261103; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const N = 240, sample = [];
      for (let i = 0; i < N; i++) { const o = {}; for (const k of P) { const vs = VALS[k]; o[k] = vs[Math.floor(rnd() * vs.length) % vs.length]; } sample.push(o); }
      for (const o of sample) check(o);
      out.sampled = { tried: sample.length, ms: Date.now() - t4 };

      console.error = origError;
      out.compiled = compiled;
      out.smVariantsTried = smTried; out.smVariantsThrewJs = smJsThrow;
      out.programsSeen = programsSeen; out.programsMax = programsMax;
      out.failures = failures.slice(0, 12);
      out.failureCount = failures.length;
      out.uniqueFailingCombos = Array.from(new Set(failures.map((f) => f.combo))).slice(0, 20);
      out.ms = Date.now() - t0;
      out.programsAfter = renderer.info.programs ? renderer.info.programs.length : -1;
      out.ok = out.control.caught === true && out.control.goodCompiles === true && (programsSeen > 0 || programsMax > 0) && failures.length === 0;
      out.CHECK = (programsSeen === 0 && programsMax === 0)
        ? 'INVALID: NOTHING WAS COMPILED (renderer.info.programs never grew), so every check was a no-op'
        : out.control.goodCompiles !== true
        ? 'INVALID: the SHIPPED source did not compile either, so the harness itself is broken (vertex shader / uniforms / three version)'
        : out.control.caught !== true
        ? 'INVALID: the positive control did not catch the rebuilt 11-02 defect (programsSeen=' + programsSeen + ')'
        : (failures.length ? 'FAIL: ' + failures.length + ' variant(s) did not compile — ' + out.uniqueFailingCombos.slice(0, 4).join(' | ')
          : 'PASS: control caught the 11-02 defect, and all ' + compiled + ' generated variants compiled');
      renderer.dispose();
      return out;
    });

    // Translate the in-page JSON into gate checks (ok name/pass/detail), so the gate sees [PASS]/[FAIL] lines and a
    // nonzero exit on failure. The verdict is loud on purpose (rule 15): an INVALID run is a FAIL, not a quiet pass.
    ok('haloTableSource is exported', !!result.haloTableSourceIsFn, result.err);
    ok('three.js loaded (r' + result.threeRevision + ')', !!result.threeRevision);
    ok('GL context acquired: ' + (result.glRenderer || '').slice(0, 50), !!result.glVersion, { glVersion: result.glVersion });
    ok('positive control: the 11-02 anchor is present in the generated source', result.control && result.control.anchorPresent > 0, result.control && result.control.why);
    ok('positive control: the SHIPPED source compiles', result.control && result.control.goodCompiles === true);
    ok('positive control: the detector CATCHES the rebuilt 11-02 defect', result.control && result.control.caught === true, result.control && result.control.detectorVia);
    ok('non-vacuity: at least one program was compiled (programsSeen/programsMax)', (result.programsSeen > 0 || result.programsMax > 0), { programsSeen: result.programsSeen, programsMax: result.programsMax });
    ok('no sm-variant JS throws (uniform placeholders correctly typed)', result.smVariantsThrewJs === 0, { smTried: result.smVariantsTried, smThrew: result.smVariantsThrewJs });
    ok('all ' + result.compiled + ' generated variants compiled (0 failures)', result.failureCount === 0, result.failures.slice(0, 6));
    ok('VERDICT: ' + (result.CHECK || ''), result.ok === true, { failureCount: result.failureCount, uniqueFailingCombos: result.uniqueFailingCombos.slice(0, 8) });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
  }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' CC page check(s) FAILED' : 'all ' + checks.length + ' CC page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('[FAIL] CC harness: ' + (e && e.stack || e)); process.exitCode = 1; });
