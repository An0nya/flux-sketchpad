// BA5 page checks: per-car traffic beams on the GPU renderer (beam atlas). Built-in frames unchanged, shuffle changes the GPU frame,
// two cars draw different atlas beams, unticking a beam removes it, shuffle off is the built-in frame again, nothing throws.
// Serve the worktree first: python3 tests/serve.py <free 89xx> (background, pidfile), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BA5-gpu-atlas.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8962);
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({});
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: true })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BA5 fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  // the GPU renderer, traffic beams on, oncoming and preceding cars
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  const gpuOn = await page.evaluate(() => RF.DriveAnim.stats().renderer === 'three');
  ok('GPU renderer is running', gpuOn, await page.evaluate(() => RF.DriveAnim.stats()));
  await page.evaluate(() => { const b = document.querySelector('[data-anim="traffic-beams"]'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  await page.evaluate(() => { const V = RF.DriveAnim._.V; V.setOwn('oncoming', true); V.setOwn('preceding', true); });
  await page.waitForFunction(() => RF.DriveAnim._.V.info.o.oncoming && RF.DriveAnim._.V.info.o.preceding, null, { timeout: 30000 }).catch(() => {});
  const hashNow = () => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619); return x >>> 0; });
  const settle = async () => { for (let i = 0; i < 3; i++) await hashNow(); return hashNow(); };
  const atlas = () => page.evaluate(() => (RF.DriveAnim._.V.three ? RF.DriveAnim._.V.three.atlasState() : { on: false, beams: 0, nTraffic: 0, idx: [], tints: [] }));
  const pool = () => page.evaluate(() => { const V = RF.DriveAnim._.V; return V.p.trafficPool ? V.p.trafficPool.entries.map(e => e.id) : null; });
  const title = () => page.evaluate(() => document.querySelector('[data-anim="traffic-shuffle"]').title);

  const H0 = await settle();
  const a0 = await atlas();
  ok('shuffle off: no atlas, GPU frame is the built-in frame', a0.on === false && (await pool()) === null, { on: a0.on, pool: await pool() });

  // two beams with very different shapes: our design at 0.6 with 3200 K, and a flat wash at 6500 K
  const bundle = await page.evaluate(() => { const L = RF.DriveAnim._.V.p.lowLut; const scaled = RF.Beams.fromLut({ ...L, data: Float32Array.from(L.data, (x) => x * 0.6) }, { name: 'x', beamKind: 'low', conv: 'A', colour: { cct: 3200 } });
    const wash = RF.Beams.fromLut(RF.Beams.uniformWash(4000, { hMin: -40, hMax: 40, vMin: -12, vMax: 6 }, 0.25), { name: 'x', beamKind: 'low', conv: 'A', colour: { cct: 6500 } });
    return JSON.stringify(RF.Beams.bundle([{ ...scaled, name: 'halogen 3200 design' }, { ...wash, name: 'LED 6500 wash' }], { name: 'BA5 test bundle' })); });
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'ba5-test.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.startsWith('Added 2'), null, { timeout: 20000 }).catch(() => {});
  await pick(page, '[data-anim="traffic-shuffle"]', 'library');
  const H1 = await settle(); const a1 = await atlas(); const p1 = await pool();
  ok('shuffle on: the GPU frame differs from built-in', H1 !== H0, { H0, H1 });
  ok('shuffle on: the atlas is on with both beams', a1.on === true && a1.beams === 2 && p1 && p1.length === 2, { on: a1.on, beams: a1.beams, pool: p1 });
  ok('shuffle on: the tooltip no longer says CPU only', !/CPU renderer only|GPU renderer keeps/.test(await title()), await title());
  // each lit source's atlas index is the CPU's pick for its car (the seed decides which beam each car draws; two cars may share one)
  const cpuIdx = await page.evaluate((cars) => { const V = RF.DriveAnim._.V; return cars.map(c => RF.Drive.trafficPickIndexOf(V.p, c)); }, a1.cars);
  ok('every lit car draws the beam the CPU picks for it', a1.nTraffic >= 2 && a1.idx.length === cpuIdx.length && a1.idx.every((v, i) => v === cpuIdx[i]), { nTraffic: a1.nTraffic, cars: a1.cars, gpu: a1.idx, cpu: cpuIdx });
  ok('the atlas tints are the beams\' own colours (halogen warmer than LED)', a1.tints.length === 2 && a1.tints[0][2] < a1.tints[1][2] - 0.01 || a1.tints[0][2] > a1.tints[1][2] + 0.01, a1.tints);

  // untick one beam: the pool and the atlas shrink to the other
  const gone = await page.evaluate(() => [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].find(c => /halogen/.test(c.closest('label').textContent)).dataset.id);
  await page.evaluate((id) => { const c = document.querySelector('[data-anim="traffic-beam-list"] input[data-id="' + id + '"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }, gone);
  await settle(); const a2 = await atlas();
  ok('unticked beam leaves the atlas (one beam, every car on it)', a2.beams === 1 && a2.idx.every(i => i === 0) && !(await pool()).includes(gone), { beams: a2.beams, idx: a2.idx });
  await page.evaluate((id) => { const c = document.querySelector('[data-anim="traffic-beam-list"] input[data-id="' + id + '"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }, gone);
  await settle(); const a3 = await atlas();
  ok('ticking it back restores the two-beam atlas', a3.beams === 2, { beams: a3.beams });

  // shuffle off: the same built-in frame as before shuffle was ever on
  await pick(page, '[data-anim="traffic-shuffle"]', 'off');
  const H2 = await settle(); const a4 = await atlas();
  ok('shuffle off: atlas off and GPU frame equals the built-in frame of this session', a4.on === false && H2 === H0, { on: a4.on, H0, H2 });

  // CPU renderer with shuffle on: mean road light of the CPU and GPU frames agree
  await pick(page, '[data-anim="traffic-shuffle"]', 'library');
  const meanOf = () => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return s / (a.length / 4 * 3); });
  const gpuMean = await meanOf();
  await page.evaluate(() => { RF.UI.dvOpts.gpuRenderer = false; RF.UI.redrawSpec(); });
  for (let i = 0; i < 100 && (await page.evaluate(() => RF.DriveAnim.stats().renderer)) !== 'cpu'; i++) await new Promise((r) => setTimeout(r, 50));
  await settle(); const cpuMean = await meanOf();
  const rel = Math.abs(cpuMean - gpuMean) / Math.max(cpuMean, 1e-9);
  console.log('[INFO] mean canvas value, shuffle on: CPU ' + cpuMean.toFixed(3) + ', GPU ' + gpuMean.toFixed(3) + ', relative ' + (100 * rel).toFixed(2) + '%');
  ok('CPU and GPU agree on mean road light with shuffle on (within 5 percent, 8-bit canvas)', rel < 0.05, { rel });

  ok('nothing threw and no GPU failure', errors.length === 0 && !(await page.evaluate(() => RF.DriveAnim.stats().gpuFailure)), errors);
  console.log(fails ? fails + ' FAILED' : 'all BA5 page checks passed');
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
