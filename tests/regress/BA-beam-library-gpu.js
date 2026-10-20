// BA2 GPU check: with the GPU renderer on (the default), swapping our own low beam changes the picture, and swapping back restores it.
// Serve the worktree first: python3 tests/serve.py <free 88xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BA-beam-library-gpu.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8994);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: true })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BA GPU fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  await page.waitForFunction(() => RF.DriveAnim._.V.three === true, null, { timeout: 30000 }).catch(() => {});
  const gpu = await page.evaluate(() => !!RF.DriveAnim._.V.three && !RF.DriveAnim._.V.gpuFailure);
  ok('GPU renderer is active in this run', gpu, await page.evaluate(() => ({ three: !!RF.DriveAnim._.V.three, failure: RF.DriveAnim._.V.gpuFailure || null })));
  const hashNow = () => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619); return x >>> 0; });
  for (let i = 0; i < 3; i++) await hashNow();
  const H0 = await hashNow();
  const pick = (sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
  await page.evaluate(() => { window.BA = RF.Beams.fromLut({ ...RF.DriveAnim._.V.p.lowLut, data: Float32Array.from(RF.DriveAnim._.V.p.lowLut.data, x => x * 0.5) }, { name: 'half', beamKind: 'low', conv: 'A' }); });
  const b64 = await page.evaluate(() => JSON.stringify(RF.Beams.serialise(window.BA)));
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'half.json', mimeType: 'application/json', buffer: Buffer.from(b64) });
  await page.waitForFunction(() => document.querySelectorAll('[data-anim="own-low"] option').length >= 2, null, { timeout: 20000 }).catch(() => {});
  const id = await page.evaluate(() => [...document.querySelectorAll('[data-anim="own-low"] option')].map(o => o.value).find(v => v !== 'design'));
  await pick('[data-anim="own-low"]', id); await hashNow(); const Hs = await hashNow();
  ok('GPU: swapping to the half-strength saved low beam changes the picture', Hs !== H0, { H0, Hs });
  await pick('[data-anim="own-low"]', 'design'); await hashNow(); const Hb = await hashNow();
  ok('GPU: built-in again restores the built-in frame in this session', Hb === H0, { H0, Hb });
  ok('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' GPU check(s) FAILED' : 'all GPU checks passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
