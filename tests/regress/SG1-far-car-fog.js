// SG1 page check: a detailed (mesh) car body takes the same view-path fog as the procedural objects (drive-three-models.js car fragment).
// Setup: the PM-test fixture (mountain pass, oncoming car, detailed models on), viewport 1600x900, visibility 60, table scatter 64, scatter
// cycle 0 (a fixed table version), traffic beams off so car on vs off differs by the car body. Car at R = 60 m by the PM placement dist = 193.25 - (R - 5).
// Car pixels = on-vs-off changed pixels (linear HDR). Body = their median luminance. Fog reference = mean luminance of the frame beside the car
// (rows at the car's centre, 90 to 120 px left and right). A 4 px ring is NOT used: on this fixture the road below the car and the sky read 0.
// Checks:
//  (1) a mesh car is drawn; (2) >= 30 changed px; (3) body median / fog reference > 0.5 (the car is not black; before the fix it was ~0.01);
//  (4) table body vs direct-16 body within 20 percent (owner-set, fade off; SF1 convention: table 64 vs direct 16); (5) the air-clear linear HDR hash equals the pin
//  computed from main (SG1_PIN); (6) no NaN in any frame.
// Run: python3 tests/serve.py 8996 & echo $! > pidfile; PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SG1-far-car-fog.js 8996; kill $(cat pidfile)
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8996), R_CAR = 60, PIN = process.env.SG1_PIN || '75132428';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon\.ico|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'MG2-default-lamp.json'), 'utf8');
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'SG1 fixture'), fixture);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await page.evaluate(() => P1Page.ready()); await sleep(1500);
    const base = { scene: 'road', mountainPass: true, gpuRenderer: true, detailedModels: true, deerBehaviour: false, streetLamps: 'sodium', preceding: false,
      trafficLogic: false, animals: false, people: true, posts: true, signs: true, seed: 7, speed: 130, wet: true, wetSheen: false, fpsCounter: false,
      scatterRes: 'full', scatterBlur: 'strong', scatterCache: 'on', scatterCycle: 0, scatterNearFade: 'off', scatterNearFadeRange: 'off', scatterGain: 1,
      afs: false, lampPitch: false, corneringLamps: false, ambient: 0, playing: false, trafficDensity: 3, trafficRange: 800, trafficLightRange: 'cars', trafficBeams: false,
      visibility: 60, scatter: 64, scatterMode: 'table', oncoming: true };
    await page.evaluate((o) => { Object.assign(RF.UI.dvOpts, o); RF.UI.redrawSpec(); }, base); await sleep(900);
    await page.waitForFunction(() => { const V = RF.DriveAnim._.V; return !V.three || V.three.modelState().ready; }, null, { timeout: 90000 }).catch(() => {});
    await page.evaluate((R) => { RF.UI.dvAnim.dist = 193.25 - (R - 5); RF.UI.redrawSpec(); }, R_CAR); await sleep(400);
    // measure(name): car on vs off in the current scatter settings. All outputs are plain numbers.
    const measure = () => page.evaluate(() => {
      const grab = () => { let n = 0; while (globalThis.SD_SCATTER && globalThis.SD_SCATTER.fraction < 1 && n < 600) { RF.DriveAnim._.frame(); n++; } RF.DriveAnim._.frame(); const V = RF.DriveAnim._.V; return { a: RF.DriveAnim._.readHdr(), w: V.p.w, h: V.p.h, cars: V.three.modelState().cars }; };
      RF.UI.dvOpts.oncoming = true; RF.UI.redrawSpec(); const on = grab();
      RF.UI.dvOpts.oncoming = false; RF.UI.redrawSpec(); const off = grab();
      const W = on.w, H = on.h, N = W * H, dif = new Uint8Array(N); let cnt = 0, nan = 0;
      for (let i = 0; i < 4 * N; i++) if (!Number.isFinite(on.a[i]) || !Number.isFinite(off.a[i])) nan++;
      for (let i = 0; i < N; i++) { const k = 4 * i; if (Math.abs(on.a[k] - off.a[k]) + Math.abs(on.a[k + 1] - off.a[k + 1]) + Math.abs(on.a[k + 2] - off.a[k + 2]) > 1e-6) { dif[i] = 1; cnt++; } }
      const lumOn = (i) => { const k = 4 * i; return (on.a[k] + on.a[k + 1] + on.a[k + 2]) / 3; };
      const body = []; let cx = 0, cy = 0; for (let i = 0; i < N; i++) if (dif[i]) { body.push(lumOn(i)); cx += i % W; cy += (i / W) | 0; }
      body.sort((a, b) => a - b);
      const med = body.length ? body[body.length >> 1] : null;
      let side = 0, sn = 0;
      if (cnt) { cx = Math.round(cx / cnt); cy = Math.round(cy / cnt); for (const dx of [-120, -105, -90, 90, 105, 120]) { const x = cx + dx; if (x < 0 || x >= W) continue; for (let y = cy - 6; y <= cy + 6; y++) if (y >= 0 && y < H) { side += lumOn(y * W + x); sn++; } } }
      return { cars: on.cars, px: cnt, median: med, side: sn ? side / sn : null, nan, nanOff: 0, meshCars: on.cars };
    });
    const table = await measure();
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { scatterMode: 'direct', scatter: 16 }); RF.UI.redrawSpec(); }); await sleep(600);
    const direct16 = await measure();
    console.log('[info] table64 ' + JSON.stringify(table));
    console.log('[info] direct16 ' + JSON.stringify(direct16));
    const fogRatio = table.median !== null && table.side ? table.median / table.side : null;
    ok('SG1 a mesh car is drawn (modelState().cars >= 1)', table.meshCars >= 1, 'cars ' + table.meshCars);
    ok('SG1 car pixels changed by the car (>= 30 px)', table.px >= 30, table.px + ' px');
    ok('SG1 car body / fog beside the car > 0.5 (table 64, 60 m, fog 60 m; before the fix ~0.01)', fogRatio !== null && fogRatio > 0.5, 'body median ' + (table.median || 0).toExponential(3) + ' / fog ' + (table.side || 0).toExponential(3) + ' = ' + (fogRatio || 0).toFixed(3));
    const tabD = direct16.median !== null && table.median !== null ? table.median / direct16.median : null;
    // Owner-set band 20 percent (up to 25 allowed): the fade is off so the comparison is like for like; direct 16 is itself coarse (its loop caps at 16 steps, so direct 64 is unusable).
    ok('SG1 table 64 body vs direct 16 body within 20 percent (near fade off)', tabD !== null && Math.abs(tabD - 1) <= 0.20, 'table/direct ' + (tabD || 0).toFixed(3));
    ok('SG1 no NaN in any frame', table.nan === 0 && direct16.nan === 0, 'nan table ' + table.nan + ', direct ' + direct16.nan);
    // Air-clear: visibility null, scatter 0. FNV-1a over the float bytes; PIN is the value computed on main (see the report).
    const clear = await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { visibility: null, scatter: 0, oncoming: true }); RF.UI.redrawSpec(); RF.DriveAnim._.frame(); const a = RF.DriveAnim._.readHdr(); const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return { n: a.length, hash: h.toString(16) }; });
    console.log('[info] air-clear HDR hash ' + clear.hash + ' (' + clear.n + ' floats), pin ' + PIN);
    ok('SG1 air-clear HDR hash equals the main pin (byte-identical clear air)', clear.hash === PIN, clear.hash + ' vs ' + PIN);
    ok('SG1 nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SG1 page run completed', false, String(e && e.stack || e).slice(0, 500)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SG1 page checks passed'); process.exitCode = fails ? 1 : 0;
})();
