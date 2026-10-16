// CT pixel check: the Drive view's CPU frame with a 3000 K source vs an unset source, and unset vs main.
// Tester: python3 tests/serve.py 8851 & ; node tests/regress/CT-cct.js 8851 [mainPort]
//   mainPort (optional): a server on `git archive main` output; its unset frame must hash identically to ours.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8851), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Render one CPU frame of the Drive view on the fixture lamp. cct: undefined = unset, else kelvin set via the UI's own setter.
async function frameOf(browser, p, cct) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://127.0.0.1:' + p + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
  await page.evaluate((txt) => RF.UI.loadScene(RF.State.deserialize(txt), 'CT fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
  const out = await page.evaluate(async (cct) => {
    const u = RF.UI; u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await new Promise((r) => setTimeout(r, 100));
    if (!u.spec || !u.spec.full || u.needCompile) throw Error('No completed real lamp');
    await new Promise((r) => setTimeout(r, 500)); u.setDisplay('drive'); u.setPane('result', 'activate');
    Object.assign(u.dvAnim || (u.dvAnim = {}), { view: 'anim', playing: false, dist: 25, t: 12 });
    Object.assign(u.dvOpts, { mt: false, dynamicResolution: false, gpuRenderer: false }); u.redrawSpec();
    for (let i = 0; i < 200 && RF.DriveAnim.stats().renderer !== 'cpu'; i++) await new Promise((r) => setTimeout(r, 50));
    if (cct !== undefined) { u.setControl('src.cct', cct); }
    u.redrawSpec(); await new Promise((r) => setTimeout(r, 600));
    await new Promise(requestAnimationFrame); RF.DriveAnim._.frame();
    const V = RF.DriveAnim._.V, dig = async (arr) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', arr.buffer))).map((x) => x.toString(16).padStart(2, '0')).join('');
    // Mean R/B over the CPU object buffer (RGBA floats, alpha ignored) and the ground buffer when present (RGB floats).
    const rb = (arr, stride) => { let r = 0, b = 0; for (let i = 0; i + 2 < arr.length; i += stride) { r += arr[i]; b += arr[i + 2]; } return b > 0 ? r / b : NaN; };
    const objs = V.rgba, g = V.g && V.g.A;
    return { renderer: RF.DriveAnim.stats().renderer, lampRGB: RF.CCT ? RF.CCT.lampRGB([u.store.scene.source].concat(u.store.scene.emitters || [])) : null,
      cct: u.store.scene.source.cct === undefined ? 'unset' : u.store.scene.source.cct,
      hashObjects: null, hashGround: null, rbObjects: rb(objs, 4), rbGround: g ? rb(g, 3) : null, n: objs.length, hasGround: !!g,
      _o: Array.from(objs.slice(0, 0)) };
  }, cct);
  // hashes must be computed on the page side (binary buffers do not survive evaluate's return); do it here in one pass
  const hashes = await page.evaluate(async () => {
    const V = RF.DriveAnim._.V, dig = async (arr) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', arr.buffer))).map((x) => x.toString(16).padStart(2, '0')).join('');
    return { hashObjects: await dig(V.rgba), hashGround: V.g && V.g.A ? await dig(V.g.A) : null };
  });
  await page.close();
  return Object.assign(out, hashes, { errors });
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  const results = [];
  try {
    const unset = await frameOf(browser, port, undefined);
    const warm = await frameOf(browser, port, 3000);
    const checks = [];
    checks.push({ name: 'unset source: lampRGB exactly [1,1,1]', pass: JSON.stringify(unset.lampRGB) === '[1,1,1]', detail: unset.lampRGB });
    checks.push({ name: '3000 K source: lampRGB has R > B', pass: warm.lampRGB && warm.lampRGB[0] > warm.lampRGB[2], detail: warm.lampRGB });
    checks.push({ name: '3000 K frame: mean R/B rises vs unset (objects)', pass: warm.rbObjects > unset.rbObjects, detail: { unset: unset.rbObjects, cct3000: warm.rbObjects } });
    if (unset.hasGround) checks.push({ name: '3000 K frame: mean R/B rises vs unset (ground)', pass: warm.rbGround > unset.rbGround, detail: { unset: unset.rbGround, cct3000: warm.rbGround } });
    if (mainPort) {
      const main = await frameOf(browser, mainPort, undefined);
      checks.push({ name: 'unset frame bytes identical to main (CPU objects)', pass: unset.hashObjects === main.hashObjects, detail: { ours: unset.hashObjects, main: main.hashObjects } });
      if (unset.hashGround) checks.push({ name: 'unset frame bytes identical to main (CPU ground)', pass: unset.hashGround === main.hashGround, detail: { ours: unset.hashGround, main: main.hashGround } });
    } else checks.push({ name: 'unset vs main identity', pass: null, detail: 'skipped: no mainPort given' });
    for (const c of checks) console.log((c.pass === null ? '[SKIP] ' : c.pass ? '[PASS] ' : '[FAIL] ') + c.name + ' ' + JSON.stringify(c.detail));
    const errs = unset.errors.concat(warm.errors);
    console.log((errs.length ? '[FAIL]' : '[PASS]') + ' no page errors ' + JSON.stringify(errs));
    process.exitCode = checks.every((c) => c.pass !== false) && !errs.length ? 0 : 1;
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
