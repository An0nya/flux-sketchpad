// BB3 page checks: a saved beam carries its colour (the lamp tint) and that tint is what the picture lights with.
// Runs twice: the CPU renderer (picture hashes and V.p.lampRGB) and the GPU renderer (the lampRGB uniform).
// Serve the worktree first: python3 tests/serve.py <free port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BB3-beam-colour.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8997);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
const clickAnim = (page, k) => page.evaluate((k) => document.querySelector('[data-anim="' + k + '"]').click(), k);
const idByLabel = (page, sel, startsWith) => page.evaluate(([sel, p]) => [...document.querySelectorAll(sel + ' option')].find(o => o.textContent.startsWith(p))?.value || null, [sel, startsWith]);
const tintOf = (page) => page.evaluate(() => RF.DriveAnim._.V.p.lampRGB);
const maxDiff = (a, b) => (a && b && a.length === b.length) ? Math.max(...a.map((x, i) => Math.abs(x - b[i]))) : Infinity;
const hashNow = (page) => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619); return x >>> 0; });
const settle = async (page, n = 3) => { for (let i = 0; i < n; i++) await hashNow(page); };
// the coloured picker entries and the manager rows, read back from the page
const rowTexts = (page) => page.evaluate(() => [...document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')].map(r => ({ name: r.querySelector('[data-anim="beam-row-name"]').value, colour: r.querySelector('[data-anim="beam-colour"]').textContent })));
const fileIn = (page, name, obj) => page.setInputFiles('[data-anim="beam-file"]', { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });

async function run(browser, gpu) {
  const tag = gpu ? 'GPU' : 'CPU';
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript((gpu) => { if (!sessionStorage.getItem('bb3-booted')) { sessionStorage.setItem('bb3-booted', '1'); localStorage.clear(); } localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: gpu })); }, gpu);
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  // the source is a 6000 K LED: the fixture with its source's cct set
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    const sc = RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()); sc.source.cct = 6000;
    u.loadScene(sc, 'BB3 fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  if (gpu) await page.waitForFunction(() => RF.DriveAnim._.V.three && RF.DriveAnim._.V.three.lampUniform, null, { timeout: 60000 }).catch(() => {});
  const cctRGB = (k) => page.evaluate((k) => RF.CCT.cctToRGB(k), k);
  const tint6 = await cctRGB(6000), tint4 = await cctRGB(4300), tint27 = await cctRGB(2700);
  await settle(page);
  const H6 = await hashNow(page);
  const pre = await tintOf(page);
  ok(tag + ': the 6000 K source lights the picture with its tint', maxDiff(pre, tint6) < 1e-9, { pre, tint6 });
  if (gpu) { const u0 = await page.evaluate(() => RF.DriveAnim._.V.three && RF.DriveAnim._.V.three.lampUniform()); ok(tag + ': GPU uniform carries the 6000 K tint', maxDiff(u0, tint6) < 1e-6, { u0, tint6 }); }

  // 1. save the design: the default name carries the source kelvin, and the beam keeps the tint and kelvin
  await clickAnim(page, 'save-design');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('flux/beamLibrary') || '[]').map(r => r.beam));
  ok(tag + ': saved design carries its colour (6000 K and the tint in use)', saved.length === 1 && saved[0].colour && saved[0].colour.cct === 6000 && maxDiff(saved[0].colour.rgb, tint6) < 1e-9, saved.map(b => b.colour));
  ok(tag + ': default name shows the kelvin', saved[0] && saved[0].name === 'Headlamp sketch 6000K', saved[0] && saved[0].name);

  // 2. a 4300 K HID beam (same table as ours): selected, the picture takes the HID colour and the frame changes
  const lut = await page.evaluate(() => { const L = RF.DriveAnim._.V.p.lowLut; return { h0: L.h0, v0: L.v0, step: L.step, nh: L.nh, nv: L.nv, data: Array.from(L.data) }; });
  const hid = await page.evaluate((lut) => RF.Beams.serialise(RF.Beams.fromLut({ ...lut, data: Float32Array.from(lut.data) }, { name: 'HID 4300', beamKind: 'low', conv: 'A', colour: { cct: 4300, rgb: RF.CCT.cctToRGB(4300) } })), lut);
  await fileIn(page, 'hid.json', hid);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-anim="own-low"] option')].some(o => o.textContent.startsWith('HID 4300')), null, { timeout: 20000 }).catch(() => {});
  const hidId = await idByLabel(page, '[data-anim="own-low"]', 'HID 4300');
  await pick(page, '[data-anim="own-low"]', hidId); await settle(page);
  const H4 = await hashNow(page), t4 = await tintOf(page);
  ok(tag + ': HID beam selected: the picture takes the beam colour (4300 K), not the source (6000 K)', maxDiff(t4, tint4) < 1e-9 && maxDiff(t4, tint6) > 1e-3, { t4, tint4, tint6 });
  ok(tag + ': HID picture differs from the 6000 K picture (same table: the tint is what changed)', H4 !== H6, { H4, H6 });
  if (gpu) { const u4 = await page.evaluate(() => RF.DriveAnim._.V.three.lampUniform()); ok(tag + ': GPU uniform carries the HID tint', maxDiff(u4, tint4) < 1e-6, { u4, tint4 }); }

  // 3. an old file (no colour): lights with the source tint, and the row says so
  const plain = await page.evaluate((lut) => RF.Beams.serialise(RF.Beams.fromLut({ ...lut, data: Float32Array.from(lut.data) }, { name: 'Old beam', beamKind: 'low', conv: 'A' })), lut);
  await fileIn(page, 'old.json', plain);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-anim="own-low"] option')].some(o => o.textContent.startsWith('Old beam')), null, { timeout: 20000 }).catch(() => {});
  await pick(page, '[data-anim="own-low"]', await idByLabel(page, '[data-anim="own-low"]', 'Old beam')); await settle(page);
  const tOld = await tintOf(page);
  ok(tag + ': beam with no colour lights with the current source tint', maxDiff(tOld, tint6) < 1e-9, { tOld, tint6 });
  const rowsA = await rowTexts(page);
  ok(tag + ': the row says the colour comes from the current source', rowsA.some(r => r.name === 'Old beam' && r.colour === 'colour: from current source'), rowsA);

  // 4. set a kelvin on that row while it is selected: the tint follows at once (the picture is rebuilt)
  await page.evaluate(() => { const r = [...document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')].find(r => r.querySelector('[data-anim="beam-row-name"]').value === 'Old beam'); r.querySelector('[data-anim="beam-row-cct"]').value = '2700'; r.querySelector('[data-anim="beam-set-cct"]').click(); });
  await settle(page);
  const t27 = await tintOf(page);
  ok(tag + ': setting 2700 K on the selected row changes the tint at once', maxDiff(t27, tint27) < 1e-9, { t27, tint27 });
  if (gpu) { const u27 = await page.evaluate(() => RF.DriveAnim._.V.three.lampUniform()); ok(tag + ': GPU uniform follows the 2700 K row', maxDiff(u27, tint27) < 1e-6, { u27 }); }
  ok(tag + ': the row now shows its kelvin', (await rowTexts(page)).some(r => r.name === 'Old beam' && r.colour === '2700 K'), await rowTexts(page));

  // 5. high beam: a saved high with its own colour (3000 K) wins while the high switch is on; off, the low beam's tint (2700 K) returns
  const tint30 = await cctRGB(3000);
  await fileIn(page, 'high.json', await page.evaluate((k) => { const L = RF.DriveAnim._.V.p.lowLut; const b = RF.Beams.uniformWash(300, { hMin: L.h0, hMax: L.h0 + L.nh * L.step, vMin: L.v0, vMax: L.v0 + L.nv * L.step }, L.step); return RF.Beams.serialise(RF.Beams.fromLut(b, { name: 'High 3000', beamKind: 'high', conv: 'A', colour: { cct: k, rgb: RF.CCT.cctToRGB(k) } })); }, 3000));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-anim="own-high"] option')].some(o => o.textContent.startsWith('High 3000')), null, { timeout: 20000 }).catch(() => {});
  await pick(page, '[data-anim="own-high"]', await idByLabel(page, '[data-anim="own-high"]', 'High 3000'));
  await clickAnim(page, 'high-beam'); await settle(page);
  const onState = await page.evaluate(() => ({ high: RF.DriveAnim._.V.high, state: document.querySelector('[data-anim="high-beam"]').dataset.state }));
  const tOn = await tintOf(page);
  ok(tag + ': high switch on: the saved high colour (3000 K) is used', onState.high === true && maxDiff(tOn, tint30) < 1e-9, { onState, tOn, tint30 });
  for (let i = 0; i < 3; i++) { const st = await page.evaluate(() => document.querySelector('[data-anim="high-beam"]').dataset.state); if (st === 'off') break; await clickAnim(page, 'high-beam'); }
  await settle(page);
  const tOff = await tintOf(page);
  ok(tag + ': high switch off: the low beam tint (2700 K) returns', (await page.evaluate(() => RF.DriveAnim._.V.high)) === false && maxDiff(tOff, tint27) < 1e-9, { tOff, tint27 });
  if (gpu) { const uOff = await page.evaluate(() => RF.DriveAnim._.V.three.lampUniform()); ok(tag + ': GPU uniform follows the switch (2700 K when off)', maxDiff(uOff, tint27) < 1e-6, { uOff }); }

  ok(tag + ': no page errors', errors.length === 0, errors);
  await page.close();
}

(async () => {
  const browser = await pw.chromium.launch({});
  await run(browser, false);
  await run(browser, true);
  console.log(fails ? fails + ' BB3 check(s) FAILED' : 'all BB3 colour checks passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
