// SR: scatter range (look.scatterRange, m) on the GPU drive view, the page side of tests/scatter-range.js. Run: python3 tests/serve.py <port>, then
// PLAYWRIGHT=... node tests/regress/SR-scatter-range.js <port>   (SR_SHOTS=<dir> also writes PNGs at 120 / 250 / 400 for the car 250 m out).
// Checks, with an oncoming car 250 m ahead on the pass (the lamp's air past 120 m is lit, so a range that does not reach it shows):
//  (1) PARITY at 300: the table's bin edges read back from the GPU (haloState().edges) equal the CPU haloEdgesOf(24, 300) from js/drive-three-halo.js, exactly;
//  (2) the far bin carries light at 300 (the table has a tile whose upper edge is 300 m and it is not all zero);
//  (3) at 120 the GPU edges equal haloEdgesOf(24, 120) and end at 120 (the old table);
//  (4) CONTROL: with the GPU forced to 120 (globalThis.SL_SR_GPU_CONTROL, the CPU still at 300) the parity in (1) must FAIL. The check passes only when it fails.
// Shots (SR_SHOTS): the frame at 120, 250 and 400 m. Table pass ms: tests/tools/sc/measure.js with --poseset and --opts (see reports/SR.md).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'SR-scatter-range'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
    await setOpts({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', haloPolar: 'off', crestOcclusion: 'off', scatterCull: 'off', haloBins: 24, trafficLightRange: '400' });   // lamps out to 400 m (the default light range is 150 m, which drops a car 250 m out)
    await page.evaluate(() => { const D = RF.DriveAnim; D.trafficCars = () => [{ id: 'oncoming:SR', kind: 'oncoming', rel: 250, off: D._.V.src.lane }]; });
    const H = await page.evaluate(() => import('/js/drive-three-halo.js').then((m) => ({ e300: Array.from(m.haloEdgesOf(24, 300)), e120: Array.from(m.haloEdgesOf(24, 120)) })));
    // one frame at a range: the GPU's edges and the far bin's content
    const at = async (range, tag) => {
      await setOpts({ scatterRange: range });
      await page.evaluate(async () => { RF.UI.dvAnim.dist = 1350; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); });
      const st = await page.evaluate(() => { const T = RF.DriveAnim._.V.three, s = T.haloState(), b = T.haloTableBytes('bin'); let farNz = 0; if (b) { const u16 = new Uint16Array(Uint8Array.from(atob(b.b64), (c) => c.charCodeAt(0)).buffer), N = s.bins, tw = s.tab[0]; for (let k = 0; k < N; k++) for (let y = 0; y < s.tab[1]; y++) for (let x = 0; x < tw; x++) { const i = 4 * (y * b.w + k * tw + x); if (k === N - 1 && ((u16[i] & 0x7fff) || (u16[i + 1] & 0x7fff) || (u16[i + 2] & 0x7fff))) farNz++; } } return { edges: s.edges, bins: s.bins, farNz, drawn: s.drawn }; });
      if (process.env.SR_SHOTS) { fs.mkdirSync(process.env.SR_SHOTS, { recursive: true }); const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; }); await sleep(400); fs.writeFileSync(path.join(process.env.SR_SHOTS, tag + '.png'), await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } })); }
      return st;
    };
    const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
    const s300 = await at(300, 'range300_car250');
    ok('SR parity 300: GPU bin edges equal the CPU haloEdgesOf(24, 300) exactly', same(s300.edges, H.e300.slice(1)), { gpuLast: s300.edges[23], cpuLast: H.e300[24], bins: s300.bins });
    ok('SR far bin at 300: the table tile ending at 300 m carries light (the car 250 m out is lit)', s300.farNz > 0 && s300.drawn > 0, { farNz: s300.farNz, drawn: s300.drawn });
    const s120 = await at(120, 'range120_car250');
    ok('SR default 120: GPU bin edges equal the old ladder (haloEdgesOf(24, 120)) and end at 120', same(s120.edges, H.e120.slice(1)) && s120.edges[23] === 120, { gpuLast: s120.edges[23] });
    const s250 = await at(250, 'range250_car250');
    ok('SR 250: GPU bin edges end at 250 m', s250.edges[23] === 250, { gpuLast: s250.edges[23] });
    // CONTROL: the GPU kept at 120 while the CPU asks for 300 must disagree (the check must be able to fail)
    await page.evaluate(() => { globalThis.SL_SR_GPU_CONTROL = 120; });
    const ctl = await at(300, 'control_gpu120_cpu300');
    await page.evaluate(() => { globalThis.SL_SR_GPU_CONTROL = 0; });
    const ctlMismatch = !same(ctl.edges, H.e300.slice(1));
    ok('SR CONTROL: GPU forced to 120 while the CPU is at 300 fails the parity check', ctlMismatch, { gpuLast: ctl.edges[23], cpuLast: H.e300[24] });
    await at(120, 'range120_restored');
    ok('SR nothing throws', errors.length === 0, errors.slice(0, 3));
  } catch (e) { ok('SR page run completed', false, String(e && e.stack || e).slice(0, 400)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length;
  console.log(fails ? fails + ' FAILED' : 'all SR page checks passed');
  process.exitCode = fails ? 1 : 0;
})();
