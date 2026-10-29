// REVIEW-C integ 2026-10-26: halo lookup now reads 4 knots from a prefix-summed table (shader text changed on purpose; halo-on frames differ from main by <= 2/255, agent-measured on 4 poses). Moved: PIN_PASS_ON 2f8d8419c8e42866 -> 23e7528f03291d77, PIN_FLAT_ON 852ef5c2cf48809d -> cfd4feefa3934c71 (both halo-on frames).
// TOUGE-SKY-VEIL: on the mountain pass, the sky gets the same traffic-halo veil as the far ground (it was black next to a lit cliff, so the
// cliff and trees read as silhouettes against it). The sky quad now adds haloScatter at the far distance (saturated at 120 m, no view ray needed).
// Checks: (1) pass, fog on, oncoming car near (d=750), halo off = main (pin); (2) ambient up, halo off = main (pin); (3) flat road halo off and
// on = main (pins; the sky term is pass-only); (4) pass halo on = the sky-veil frame (branch pin; main's frame is pinned in the report, so
// the pin differs from main's); (5) off after on = the first off; (6) the skyline (the luminance step between the sky and the cliff) is
// halved: median over columns of the largest adjacent-row step in the top 200 rows, pinned measurement main 25.0 vs branch 8.8 (threshold 12).
// The threshold is a cut between two measured values, not a physical constant. Positive control: run on a main archive; (4) and (6) must fail.
// Pins: sha1 of the 912x373 PNG clip at y=140 (the same clip as TOUGE-HALO-TILT), samples '1', real GPU (Apple M4, Metal), measured 2026-10-23 on
// main 0fed388 (git archive) and this branch. Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/TOUGE-SKY-VEIL.js <port>
// UI step C (2026-10-29): the frame is the drive canvas pinned at page 0,0 (was the page region y >= 140, which sat on the canvas only while the large view had
// its 30 px header; the layout shell dropped it and the region moved off the picture). Pins below re-baselined for that capture (old -> new: 2182d301 -> 15e3263e, 94a75eca -> 46680ba4, 3791c6a0 -> eacb3d61, 53f2a81f -> 21718f45, 23e7528f -> 2e0f21a9); the halo tables (bin, cum) still match.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
// REVIEW integ 2026-10-26: PIN_PASS_OFF 1df27fae2210614c -> 2182d30171a7951b and PIN_AMBIENT_OFF 65a7dd08bf6a8747 -> 94a75ecaba63c384, cause B6 shadow normal (proved by reverting only that line); PIN_PASS_ON 1a41ccf6b756c86d -> 2f8d8419c8e42866, cause ROLL (b0ae354da282f1bf with B6 reverted, so ROLL alone moves it) + B6.
// FLAT-PEDS re-pin 2026-10-26 (overnight integration): flat-road pin(s) moved by pedestrian scene content, not by the halo/sky (bisected with --only, alone): S 1a410c9 (seeded walker kinds) first moves them (G d51aedb alone clean), T then moves them again; identical on main d20fe9d and on Brief J's branch. Pass pins unchanged. Moved: e0bda83bb1da9572, cfd4feefa3934c71 -> 3791c6a03764a100, 53f2a81fed077f0e.
const PIN_PASS_OFF = '15e3263efed66317', PIN_AMBIENT_OFF = '46680ba4fe8e164d', PIN_FLAT_OFF = 'eacb3d61116d4dda', PIN_FLAT_ON = '21718f45d8984c61';
const PIN_PASS_ON = '2e0f21a9853b050a';   // branch sky-veil frame (main's halo-on frame is 6e4191c6af587594)
const SKY_STEP_MAX = 12;                  // pinned: main 25.0, branch 8.8 (median over columns of the largest adjacent-row luminance step)
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async (mountain) => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'TOUGE-SKY-VEIL'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    await page.evaluate((m) => { const V = RF.DriveAnim._.V; V.setOwn('mountainPass', m); }, mountain);
    return page;
  };
  const setBase = (page, extra) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); },
    Object.assign({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 60, samples: '1', haloPolar: 'off' }, extra));   // SP: haloPolar off pinned explicitly (the default is auto since SP); the pins hold with off
  const shot = async (page, dist, halo) => {
    await page.evaluate(async ([d, h]) => { RF.DriveAnim._.V.setOwn('trafficHalo', h); RF.UI.dvAnim.dist = d; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1200)); }, [dist, halo]);
    return (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 373 } }));
  };
  const skyline = (page, buf) => page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const W = c.width, px = g.getImageData(0, 0, W, c.height).data;
    const L = (x, y) => { const i = 4 * (y * W + x); return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
    const steps = []; for (let x = 100; x <= 700; x += 20) { let m = 0; for (let y = 0; y < 199; y++) m = Math.max(m, Math.abs(L(x, y + 1) - L(x, y))); steps.push(m); }
    steps.sort((a, b) => a - b); return steps[steps.length >> 1];
  }, buf.toString('base64'));
  try {
    // pass, fog on, oncoming car near (d=750): off, on, off
    const page = await open(true);
    console.log('renderer:', await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
    await setBase(page, { ambient: 0 });
    const info = await page.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, gpuFailure: RF.DriveAnim._.V.gpuFailure || null }));
    ok('pass is rendered on the GPU (touge, no gpuFailure)', info.touge && !info.gpuFailure, info);
    const off = await shot(page, 750, 0), on = await shot(page, 750, 16), offAfter = await shot(page, 750, 0);
    const hOff = sha(off), hOn = sha(on);
    ok('(1) pass halo off equals main (pin ' + PIN_PASS_OFF + ')', hOff === PIN_PASS_OFF, { hash: hOff });
    ok('(5) off after on equals the first off', sha(offAfter) === hOff, { hash: sha(offAfter) });
    ok('(4) pass halo on equals the sky-veil frame (pin ' + PIN_PASS_ON + ')', hOn === PIN_PASS_ON, { hash: hOn });
    const sky = await skyline(page, on);
    ok('(6) skyline step at the halo-on frame is halved (median step <= ' + SKY_STEP_MAX + ', main pins 25.0)', sky <= SKY_STEP_MAX, { medianStep: +sky.toFixed(2) });
    // (2) ambient up, halo off
    await setBase(page, { ambient: 5 });
    const amb = await shot(page, 750, 0);
    ok('(2) ambient up, halo off equals main (pin ' + PIN_AMBIENT_OFF + ')', sha(amb) === PIN_AMBIENT_OFF, { hash: sha(amb) });
    await page.close();
    // (3) flat road, halo off and on: the sky term is pass-only
    const flat = await open(false);
    await setBase(flat, { ambient: 0 });
    const flatTouge = await flat.evaluate(() => !!RF.DriveAnim._.V.p.touge);
    const fOff = await shot(flat, 750, 0), fOn = await shot(flat, 750, 16);
    ok('(3) flat road is not on the pass', !flatTouge, { touge: flatTouge });
    ok('(3) flat road halo off equals main (pin ' + PIN_FLAT_OFF + ')', sha(fOff) === PIN_FLAT_OFF, { hash: sha(fOff) });
    ok('(3) flat road halo on equals main (pin ' + PIN_FLAT_ON + ')', sha(fOn) === PIN_FLAT_ON, { hash: sha(fOn) });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await flat.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
