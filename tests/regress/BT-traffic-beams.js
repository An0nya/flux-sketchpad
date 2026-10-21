// BT3 page checks: traffic beams library shuffle on the CPU renderer. Built-in frames unchanged, shuffle changes them,
// the 'use in traffic' checklist restricts the pool, an empty pool falls back to built-in, the GPU renderer keeps built-in with a tooltip.
// Serve the worktree first: python3 tests/serve.py <free 89xx> (background, pidfile), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BT-traffic-beams.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8957);
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({});
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });   // one context: both pages share storage
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: false })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BT fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  // the CPU renderer with traffic beams on
  await page.evaluate(() => { const b = document.querySelector('[data-anim="traffic-beams"]'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  const hashNow = () => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619); return x >>> 0; });
  const settle = async () => { for (let i = 0; i < 3; i++) await hashNow(); return hashNow(); };
  const state = () => page.evaluate(() => { const V = RF.DriveAnim._.V; return { trafficBeams: !!V.p.trafficBeams, three: !!V.three, pool: V.p.trafficPool ? V.p.trafficPool.entries.map(e => e.id) : null, tints: V.p.trafficPool ? V.p.trafficPool.entries.map(e => e.tint.map(v => +v.toFixed(3))) : null, shuffle: document.querySelector('[data-anim="traffic-shuffle"]').value, title: document.querySelector('[data-anim="traffic-shuffle"]').title, checks: [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].map(c => [c.dataset.id, c.checked]), out: RF.DriveAnim._.V.info.o.trafficOutIds || null }; });
  // the fixture has no traffic: switch oncoming and preceding cars on (the beams only light cars that exist)
  await page.evaluate(() => { const V = RF.DriveAnim._.V; V.setOwn('oncoming', true); V.setOwn('preceding', true); });
  await page.waitForFunction(() => RF.DriveAnim._.V.info.o.oncoming && RF.DriveAnim._.V.info.o.preceding, null, { timeout: 30000 }).catch(() => {});
  const H0 = await settle();
  const s0 = await state();
  ok('traffic beams on, CPU renderer, shuffle off by default (no pool)', s0.trafficBeams && !s0.three && s0.pool === null && s0.shuffle === 'off', s0);
  ok('traffic is on in the scene (oncoming and preceding cars)', await page.evaluate(() => RF.DriveAnim._.V.info.o.oncoming === true && RF.DriveAnim._.V.info.o.preceding === true));

  // a bundle of three low beams: our design at half strength (no colour), a 6500 K LED and a 3200 K halogen, both at 0.6 of our design
  const bundle = await page.evaluate(() => { const L = RF.DriveAnim._.V.p.lowLut; const sc = (k, cct) => { const b = RF.Beams.fromLut({ ...L, data: Float32Array.from(L.data, (x) => x * k) }, { name: 'x', beamKind: 'low', conv: 'A', colour: cct ? { cct } : undefined }); return b; };
    return JSON.stringify(RF.Beams.bundle([{ ...sc(0.5), name: 'half' }, { ...sc(0.6, 6500), name: 'LED 6500' }, { ...sc(0.6, 3200), name: 'halogen 3200' }], { name: 'BT test bundle' })); });
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'bt-test.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.startsWith('Added 3'), null, { timeout: 20000 }).catch(() => {});
  const s1 = await state();
  ok('library has 3 saved low beams in the checklist', s1.checks.length === 3, s1.checks);

  // shuffle on: the frame changes, and each car draws a beam from the pool
  await pick(page, '[data-anim="traffic-shuffle"]', 'library');
  const H1 = await settle(); const s2 = await state();
  ok('shuffle on: CPU frame differs from built-in', H1 !== H0, { H0, H1 });
  ok('shuffle on: pool holds all 3 library beams, with distinct colour tints (halogen warmer than LED)', s2.pool && s2.pool.length === 3 && s2.tints.some((t, i) => s2.tints.some((u, j) => j !== i && t.join() !== u.join())), s2);
  ok('shuffle on: the tooltip no longer says CPU only (BA5: the GPU has the atlas)', !/CPU renderer only/.test(s2.title), s2.title);
  ok('shuffle on: the beam without a saved colour is neutral (1,1,1), not our lamp tint', s2.tints.some(t => t.join() === '1,1,1') && s2.tints.some(t => t.join() !== '1,1,1'), s2.tints);
  const saved1 = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('flux/driveView') || '{}'); return { shuffle: o.trafficShuffle, out: o.trafficOutIds }; });
  ok('shuffle choice is saved in the drive view options', saved1.shuffle === 'library', saved1);

  // checklist: untick the halogen beam, so the pool is the other two (subset respected)
  const halogenId = await page.evaluate(() => [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].find(c => /halogen/.test(c.closest('label').textContent)).dataset.id);
  await page.evaluate((id) => { const c = document.querySelector('[data-anim="traffic-beam-list"] input[data-id="' + id + '"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }, halogenId);
  await settle(); const s3 = await state();
  ok('checklist: unticked beam leaves the pool (2 beams remain)', s3.pool && s3.pool.length === 2 && !s3.pool.includes(halogenId) && s3.out && s3.out.includes(halogenId), { pool: s3.pool, out: s3.out });
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('flux/driveView') || '{}').trafficOutIds || null);
  ok('checklist: the unticked ids are saved in the drive view options', Array.isArray(saved2) && saved2.includes(halogenId), saved2);

  // empty pool: untick all three; traffic falls back to the built-in beam, so the frame is the built-in frame
  await page.evaluate(() => [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].forEach(c => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }));
  const Hempty = await settle(); const s4 = await state();
  ok('empty pool: no pool and the built-in frame (hash equals built-in)', s4.pool === null && Hempty === H0, { pool: s4.pool, Hempty, H0 });
  await page.evaluate(() => [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));

  // shuffle off again: bit-identical to the built-in frame of this session
  await pick(page, '[data-anim="traffic-shuffle"]', 'off');
  const Hb = await settle();
  ok('shuffle off again: built-in frame hash equals the session built-in frame (bit-identical)', Hb === H0, { H0, Hb });

  // GPU renderer: the shuffle keeps the built-in beam for every car and its tooltip says so
  await pick(page, '[data-anim="traffic-shuffle"]', 'library');
  await page.evaluate(() => { const b = document.querySelector('[data-anim="gpu-renderer"]'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  await page.waitForFunction(() => RF.DriveAnim._.V.three, null, { timeout: 60000 }).catch(() => {});
  await settle(); const s5 = await state();
  ok('GPU renderer: the library pool reaches the GPU (BA5 atlas), no GPU-only tooltip', s5.three && s5.pool !== null && s5.pool.length === s1.checks.length && !/GPU renderer keeps the built-in beam/.test(s5.title), { three: s5.three, pool: s5.pool, title: s5.title });
  await page.evaluate(() => { const b = document.querySelector('[data-anim="gpu-renderer"]'); if (b.getAttribute('aria-pressed') === 'true') b.click(); });

  // reload: untick the halogen beam, then open a second page in the same context (page.addInitScript is per page, so storage survives).
  // The shuffle, the unticked box and the pool must all come back from the saved options (the checklist must not show stale state).
  await page.evaluate((id) => { const c = document.querySelector('[data-anim="traffic-beam-list"] input[data-id="' + id + '"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }, halogenId);
  const page2 = await ctx.newPage(), errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page2.goto('http://127.0.0.1:' + port + '/index.html');
  await page2.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BT fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page2.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  await page2.waitForFunction(() => document.querySelectorAll('[data-anim="traffic-beam-list"] input').length === 3, null, { timeout: 30000 }).catch(() => {});
  await page2.evaluate(() => { for (let i = 0; i < 3; i++) RF.DriveAnim._.frame(); });
  const r2 = await page2.evaluate(() => { const V = RF.DriveAnim._.V; return { shuffle: document.querySelector('[data-anim="traffic-shuffle"]').value, checks: [...document.querySelectorAll('[data-anim="traffic-beam-list"] input')].map(c => [c.dataset.id, c.checked]), pool: V.p.trafficPool ? V.p.trafficPool.entries.map(e => e.id) : null, out: V.info.o.trafficOutIds || null }; });
  const halogenOn = (r2.checks.find(c => c[0] === halogenId) || [])[1];
  ok('reload: shuffle reads library from the saved options', r2.shuffle === 'library', r2.shuffle);
  ok('reload: the halogen box is still unticked (not stale ticked)', halogenOn === false && r2.checks.length === 3 && r2.checks.filter(c => c[1]).length === 2, r2.checks);
  ok('reload: the pool excludes the halogen beam (2 beams)', r2.pool && r2.pool.length === 2 && !r2.pool.includes(halogenId), { pool: r2.pool, out: r2.out });
  ok('reload: no page errors on the second page', errors2.length === 0, errors2.slice(0, 3));
  await page2.close();

  ok('no page errors during the BT checks', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all BT-traffic-beams page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch(async (e) => { console.log('[FAIL] harness error: ' + (e && e.stack || e)); process.exitCode = 1; process.exit(1); });
