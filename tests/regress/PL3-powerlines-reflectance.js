// POWERLINES wire reflectance (option powerlineReflectance, js/drive.js materials()). Run: python3 tests/serve.py 8813 & node tests/regress/PL3-powerlines-reflectance.js 8813
// Pose: the owner's touge state (tests/regress/data/owner-touge-wires-2026-10-23.json: mountain pass, 1662.66 m, paused), GPU renderer, real GPU flags.
//  1 powerlines off: the frame is byte-identical at reflectance 0.04 and 0.40 (the option does nothing with the wires off)
//  2 powerlines on: the frame differs from off where the wires are (wire pixels exist)
//  3 wire pixels (those that change between 0.04 and 0.40) get brighter in order: L(0.04) < L(0.12) < L(0.40)
//  4 the CPU material table (materials(look), the table the CPU renderer uses) carries the option: wire rho equals the value
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8813);
const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'owner-touge-wires-2026-10-23.json'), 'utf8'));
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); if (!c) fails++; };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => UX2Page.ready());
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1920, height: 1400 });
    await page.waitForTimeout(1000);
    // one render of the owner pose with the given powerlines state and reflectance; returns the RGBA bytes of the canvas, kept in window.__cap[name]
    const cap = (name, pl, refl) => page.evaluate(({ dump, pl, refl, name }) => {
      const u = RF.UI, A = RF.DriveAnim;
      Object.assign(u.dvOpts, dump.dvOpts, { mountainPass: true, gpuRenderer: true, powerlines: pl, powerlineReflectance: refl });
      Object.assign(u.dvAnim, { view: 'anim', dist: dump.anim.dist, t: dump.anim.t, playing: false });
      u.redrawSpec(); A._.frame();
      window.__cap = window.__cap || {}; window.__cap[name] = Array.from(A._.V.gl.readCanvas());
      return A._.V.p.touge === true;
    }, { dump, pl, refl, name });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const touge = await cap('off04', 'off', 0.04);
    await cap('off40', 'off', 0.40);
    await cap('on04', 'on', 0.04);
    await cap('on12', 'on', 0.12);
    await cap('on40', 'on', 0.40);
    const r = await page.evaluate(() => {
      const C = window.__cap, n = C.off04.length;
      const same = (a, b) => { for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; };
      let wire = 0, lum = { a: 0, b: 0, c: 0 };
      const L = (a, i) => (a[i] + a[i + 1] + a[i + 2]) / 3;
      const wireIdx = [];
      for (let i = 0; i < n; i += 4) {
        if (Math.max(Math.abs(C.on04[i] - C.on40[i]), Math.abs(C.on04[i + 1] - C.on40[i + 1]), Math.abs(C.on04[i + 2] - C.on40[i + 2])) > 6) wireIdx.push(i);
      }
      for (const i of wireIdx) { lum.a += L(C.on04, i); lum.b += L(C.on12, i); lum.c += L(C.on40, i); }
      const m = wireIdx.length || 1;
      let diffOn = 0; for (const i of wireIdx) if (C.on04[i] !== C.off04[i] || C.on04[i + 1] !== C.off04[i + 1] || C.on04[i + 2] !== C.off04[i + 2]) diffOn++;
      return { off: same(C.off04, C.off40), wirePixels: wireIdx.length, diffOnVsOff: diffOn,
        mean: { r04: lum.a / m, r12: lum.b / m, r40: lum.c / m } };
    });
    ok('0 pass pose is the touge view (GPU, elevated route)', touge === true, { touge });
    ok('1 powerlines off: frame byte-identical at reflectance 0.04 and 0.40', r.off === true);
    ok('2 powerlines on: wire pixels exist and differ from off', r.wirePixels >= 20 && r.diffOnVsOff > 0, { wirePixels: r.wirePixels, diffOnVsOff: r.diffOnVsOff });
    ok('3 wire brightness ordered L(0.04) < L(0.12) < L(0.40)', r.mean.r04 < r.mean.r12 && r.mean.r12 < r.mean.r40, r.mean);
    const cpu = await page.evaluate(() => { const M = (v) => RF.Drive.materials({ RL: 0.2, ambient: 0, powerlineReflectance: v }); return [M(0.04).wire.rho[0], M(0.40).wire.rho[0], M(undefined).wire.rho[0]]; });
    ok('4 CPU material table carries the option (rho 0.04, 0.40, fallback)', cpu[0] === 0.04 && cpu[1] === 0.40 && cpu[2] === 0.12, cpu);
    console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  } catch (e) { console.log('[FAIL] exception ' + (e.stack || e)); fails++; }
  finally { await browser.close(); }
  process.exit(fails ? 1 : 0);
})();
