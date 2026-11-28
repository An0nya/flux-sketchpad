// GM page checks: the glare model (hdr-spike port, 11-27, Anya; registry glareModel + the gm* knobs). Urban tile at night, sodium street lamps
// , glare dry, fixed exposure, samples 1, GPU drive renderer.
//  1. no model (unset) and glareModel 'current' give the same bytes; with a mainPort, they also equal the lander build's frame.
//  2. a model set up to copy the drive (veil physical, Stiles-Holladay, 1° floor, strength 1, no tail, no starburst, bloom on) reproduces the
//     no-model frame to within 1 code value per channel (a different program: same sums, float rounding may differ).
//  3. perceptual changes the frame; turning the model off afterwards gives the first bytes back (off after on).
//  4. glare off is still off with a model on (the level is the master switch): bytes equal glare off without a model.
//  5. reduced motion: perceptual draws the same frame as perceptual with the tail and the starburst switched off.
//  6. gpuRenderer off (CPU ground, still the WebGL compositor): the model still applies and no notice shows. The true CPU fallback (no WebGL2:
//     drive.js tonemap, and the spec-ui CPU still) ignores the model and the Glare tab says so; that path is NOT exercised here (no seam to drop WebGL2).
// Run: python3 tests/serve.py <port> ; node tests/regress/GM-glare-model.js <port> [mainPort]   (env SHOTS=<dir> saves the frames)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8985), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' - ' + detail : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SHOTS = process.env.SHOTS || '';
const BASE = { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', glare: 'dry', onMode: 'generic', tiles: true, streetLamps: 'sodium' };
const GM_KEYS = (page) => page.evaluate(() => ['glareModel', ...RF.Options.GLARE_PARAMS.map((p) => p.id)]);
async function open(p, ctxOpts) {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext(Object.assign({ viewport: { width: 1920, height: 1400 } }, ctxOpts || {}))).newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + p + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.setViewportSize({ width: 1920, height: 1400 }); await sleep(1500);
  await page.evaluate((base) => {
    const u = RF.UI, D = RF.DriveAnim;
    Object.assign(u.dvOpts, base);
    const tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban');
    Object.assign(u.dvAnim, { view: 'anim', dist: tile.s0 + 55, t: 2, playing: false });
    u.redrawSpec();
  }, BASE);
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  return { browser, page };
}
// set options (undefined deletes the key), redraw, return the canvas PNG
const frame = async (page, opts) => {
  if (opts) await page.evaluate((o) => { const d = RF.UI.dvOpts; for (const [k, v] of Object.entries(o)) { if (v === null) delete d[k]; else d[k] = v; } RF.UI.redrawSpec(); }, opts);
  await sleep(1200);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  return page.locator('canvas[data-sl-drive="1"]').screenshot();
};
// largest per-channel difference and the count of pixels that differ, decoded in the page
const diff = (page, a, b) => page.evaluate(async ([a64, b64]) => {
  const img = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
  const A = await img(a64), B = await img(b64); let max = 0, n = 0;
  for (let i = 0; i < A.length; i += 4) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A[i + c] - B[i + c])); if (d) n++; if (d > max) max = d; }
  return { max, n, px: A.length / 4 };
}, [a.toString('base64'), b.toString('base64')]);
const clear = (keys) => Object.fromEntries(keys.map((k) => [k, null]));
const AS_CURRENT = { glareModel: 'custom', gmVeil: 'physical', gmVeilLaw: 'stiles-holladay', gmVeilFloor: 1, gmVeilStr: 1, gmSdrBoost: 1, gmTail: false, gmSpike: false, gmBloom: true };

(async () => {
  let A = null, M = null, R = null;
  try {
    A = await open(port);
    const { page } = A, keys = await GM_KEYS(page);
    console.log('GPU: ' + await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
    ok('GM GPU renderer is on', (await page.evaluate(() => RF.DriveAnim.stats().renderer)) === 'three');
    const nSrc = await page.evaluate(() => (RF.DriveAnim._.V.frameGlare || []).length);
    ok('GM the scene has glare sources', nSrc > 0, nSrc + ' sources');
    const f0 = await frame(page), fCur = await frame(page, { glareModel: 'current' });
    ok('GM 1 glareModel current = no model (bytes)', sha(f0) === sha(fCur), sha(f0).slice(0, 12) + ' vs ' + sha(fCur).slice(0, 12));
    if (mainPort) { M = await open(mainPort); const fm = await frame(M.page); ok('GM 1 no model = the lander build (bytes)', sha(fm) === sha(f0), sha(fm).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12)); }
    const fAs = await frame(page, Object.assign(clear(keys), AS_CURRENT)), dAs = await diff(page, f0, fAs);
    ok('GM 2 a model set up as the drive reproduces it (max 1 code value)', dAs.max <= 1, JSON.stringify(dAs));
    const perc = await page.evaluate(() => Object.assign({ glareModel: 'perceptual' }, RF.Options.GLARE_MODELS.perceptual));
    const fP = await frame(page, Object.assign(clear(keys), perc)), dP = await diff(page, f0, fP);
    ok('GM 3 perceptual changes the frame', dP.n > 0, JSON.stringify(dP));
    const fOff = await frame(page, clear(keys));
    ok('GM 3 off after on = the first off (bytes)', sha(fOff) === sha(f0), sha(fOff).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12));
    const g0 = await frame(page, Object.assign(clear(keys), { glare: 'off' })), gP = await frame(page, Object.assign({ glare: 'off' }, perc));
    ok('GM 4 glare off stays off with a model on (bytes)', sha(g0) === sha(gP), sha(g0).slice(0, 12) + ' vs ' + sha(gP).slice(0, 12));
    const fNoTS = await frame(page, Object.assign({ glare: 'dry' }, perc, { gmTail: false, gmSpike: false }));
    const note = await frame(page, Object.assign(clear(keys), perc)).then(() => page.evaluate(() => document.querySelector('[data-anim="glareModel-note"]').textContent));
    ok('GM the note is empty on the GPU renderer with glare on', note === '', JSON.stringify(note));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); for (const [n, b] of [['off', f0], ['as-current', fAs], ['perceptual', fP], ['perceptual-no-tail-spike', fNoTS]]) fs.writeFileSync(path.join(SHOTS, n + '.png'), b); }
    // 5. reduced motion
    R = await open(port, { reducedMotion: 'reduce' });
    const rP = await frame(R.page, Object.assign(clear(keys), perc)), rNo = await frame(R.page, Object.assign({}, perc, { gmTail: false, gmSpike: false }));
    ok('GM 5 reduced motion: perceptual = perceptual without tail and starburst (bytes)', sha(rP) === sha(rNo), sha(rP).slice(0, 12) + ' vs ' + sha(rNo).slice(0, 12));
    // 6. gpuRenderer off: CPU ground, WebGL compositor
    const c0 = await frame(page, Object.assign(clear(keys), { gpuRenderer: false })); await sleep(2500);
    const c0b = await frame(page), cP = await frame(page, Object.assign({}, perc));
    const cNote = await page.evaluate(() => document.querySelector('[data-anim="glareModel-note"]').textContent);
    ok('GM 6 gpuRenderer off: the model still applies (the compositor is WebGL)', sha(c0b) !== sha(cP), sha(c0b).slice(0, 12) + ' vs ' + sha(cP).slice(0, 12));
    ok('GM 6 gpuRenderer off: no CPU notice (only a missing WebGL2 compositor shows one)', cNote === '', JSON.stringify(cNote));
    ok('GM no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('GM ran without throwing', false, String(e && e.stack || e)); }
  finally { for (const X of [A, M, R]) if (X) await X.browser.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(checks.length + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
