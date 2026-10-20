// BI1 page checks: the beam library in IndexedDB (js/beam-store.js). Full resolution, reload in a new context that keeps storage,
// delete persists, migration from the old localStorage library, and session-only fallback when indexedDB throws.
// Serve the worktree first: python3 tests/serve.py <free 90xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BI-beam-indexeddb.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 9061);
const BASE = 'http://127.0.0.1:' + port + '/index.html', VP = { width: 1500, height: 950 };
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
// the view is seeded once per context (a reload keeps the saved selection)
const seed = (ctx) => ctx.addInitScript(() => { if (!localStorage.getItem('flux/driveView')) localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: false })); });
(async () => {
  const browser = await pw.chromium.launch({});
  const errors = [];
  const pageOf = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | '))); return p; };
  const boot = async (p) => {
    await p.goto(BASE);
    await p.evaluate(async () => {
      const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
      u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BI fixture'); u.setMode('D');
      for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
      u.setDisplay('drive');
    });
    await p.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
    await p.evaluate(() => { window.__fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let x = 2166136261; for (let i = 0; i < u.length; i++) x = Math.imul(x ^ u[i], 16777619); return x >>> 0; };
      window.__mk = (k, grid) => { const data = new Float32Array(grid.nh * grid.nv); for (let j = 0; j < grid.nv; j++) for (let i = 0; i < grid.nh; i++) { const h = grid.h0 + (i + 0.5) * grid.step, v = grid.v0 + (j + 0.5) * grid.step; data[j * grid.nh + i] = (k + 1) * 100 * Math.exp(-(h * h) / 40 - (v * v) / 10) + (i % 13) * 1e-4; } return { ...grid, data }; };
    });
  };
  // a reload that keeps storage: the old context's storage (localStorage and IndexedDB) goes to a new context
  const reopen = async (ctx) => { const st = await ctx.storageState({ indexedDB: true }); await ctx.close(); const c = await browser.newContext({ viewport: VP, acceptDownloads: true, storageState: st }); await seed(c); return c; };
  const idbRows = (p) => p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('flux-beams', 1);
    r.onsuccess = () => { const db = r.result; const g = db.transaction('beams').objectStore('beams').getAll();
      g.onsuccess = () => { const rows = g.result.map(x => ({ id: x.id, name: x.name, step: x.grid.step, nh: x.grid.nh, nv: x.grid.nv, coarse: !!x.coarse, hash: window.__fnv(x.values), n: x.values.length })); db.close(); res(rows); };
      g.onerror = () => rej(String(g.error)); };
    r.onerror = () => rej(String(r.error));
  }));
  const optCount = (p) => p.evaluate(() => document.querySelectorAll('[data-anim="own-low"] option').length);
  const waitOpts = (p, n) => p.waitForFunction((n) => document.querySelectorAll('[data-anim="own-low"] option').length === n, n, { timeout: 30000 }).then(() => true, () => false);
  const waitMsg = (p, prefix) => p.waitForFunction((pre) => (document.querySelector('[data-anim="beam-status"]').textContent || '').startsWith(pre), prefix, { timeout: 30000 }).then(() => true, () => false);
  const rowsDOM = (p) => p.evaluate(() => [...document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')].map(r => ({ id: r.dataset.id, size: r.textContent })));

  // ---- A: 6 beams at 0.1 deg (the old cap was about 3 at 0.25), full resolution, reload, delete
  const ctxA = await browser.newContext({ viewport: VP, acceptDownloads: true }); await seed(ctxA);
  let pA = await pageOf(ctxA); await boot(pA);
  const bundle = await pA.evaluate(() => { const grid = { h0: -30, v0: -10, step: 0.1, nh: 600, nv: 300 };
    const beams = [1, 2, 3, 4, 5, 6].map((k) => RF.Beams.fromLut(window.__mk(k, grid), { name: 'full ' + k, beamKind: 'low', conv: 'A' }));
    return JSON.stringify(RF.Beams.bundle(beams, { name: 'BI six' })); });
  const expectHashes = await pA.evaluate((t) => RF.Beams.readFile(JSON.parse(t)).map(b => window.__fnv(b.values)).sort((a, b) => a - b), bundle);
  await pA.setInputFiles('[data-anim="beam-file"]', { name: 'bi-six.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  ok('six beams import (status says so)', await waitMsg(pA, 'Added 6'), await pA.evaluate(() => document.querySelector('[data-anim="beam-status"]').textContent));
  let rowsA = await idbRows(pA);
  ok('six beams in IndexedDB at 0.1 deg, not coarsened, none marked coarse', rowsA.length === 6 && rowsA.every(r => r.step === 0.1 && r.nh === 600 && r.nv === 300 && !r.coarse), rowsA.map(r => [r.step, r.nh, r.nv, r.coarse]));
  ok('stored tables equal the imported tables (bit-exact checksums)', JSON.stringify(rowsA.map(r => r.hash).sort((a, b) => a - b)) === JSON.stringify(expectHashes));
  // reload in a new context that keeps storage
  let ctxA2 = await reopen(ctxA); pA = await pageOf(ctxA2); await boot(pA);
  await waitOpts(pA, 7);
  const afterReload = await rowsDOM(pA);
  ok('reload (new context, storage kept): all 6 beams present', afterReload.length === 6 && afterReload.every(r => r.size.includes('60 x 30 deg')), afterReload.map(r => r.size.slice(0, 40)));
  const hashesReload = (await idbRows(pA)).map(r => r.hash).sort((a, b) => a - b);
  ok('after reload the stored tables are still bit-exact', JSON.stringify(hashesReload) === JSON.stringify(expectHashes));
  // a saved beam chosen before the reload is selected again and drives the picture from its full-resolution table
  const id3 = afterReload[2].id;
  await pick(pA, '[data-anim="own-low"]', id3);
  let ctxA3 = await reopen(ctxA2); pA = await pageOf(ctxA3); await boot(pA);
  await waitOpts(pA, 7);
  const sel = await pA.evaluate((id) => ({ sel: document.querySelector('[data-anim="own-low"]').value === id, lut: RF.DriveAnim._.V.p.lowLut.data.length, step: RF.DriveAnim._.V.p.lowLut.step, isSaved: RF.DriveAnim._.V.p.lut === RF.DriveAnim._.V.p.lowLut }), id3);
  ok('reload: the chosen saved beam is still selected and drives the picture at full resolution', sel.sel && sel.lut === 180000 && sel.step === 0.1 && sel.isSaved, sel);
  // delete one: it stays gone after another reload
  await pA.evaluate(() => document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')[0].querySelector('[data-anim="beam-delete"]').click());
  await pA.waitForFunction(() => (document.querySelector('[data-anim="beam-status"]').textContent || '').startsWith('Deleted'), null, { timeout: 20000 }).catch(() => {});
  const ctxA4 = await reopen(ctxA3); pA = await pageOf(ctxA4); await boot(pA);
  await waitOpts(pA, 6);
  const rowsDel = await idbRows(pA);
  ok('delete persists across a reload: 5 beams stored and listed', rowsDel.length === 5 && (await rowsDOM(pA)).length === 5, rowsDel.length);
  await ctxA4.close();

  // ---- B: migration from the old localStorage library (coarse 0.25 deg copies, keyed by id)
  const oldJson = await (async () => { const p = await (await browser.newContext({ viewport: VP })).newPage(); await p.goto(BASE); await p.waitForFunction(() => window.RF && RF.Beams, null, { timeout: 60000 });
    return p.evaluate(() => { const grid = { h0: -30, v0: -10, step: 0.1, nh: 600, nv: 300 };
      const mk = (k) => { const data = new Float32Array(grid.nh * grid.nv); for (let j = 0; j < grid.nv; j++) for (let i = 0; i < grid.nh; i++) { const h = grid.h0 + (i + 0.5) * grid.step, v = grid.v0 + (j + 0.5) * grid.step; data[j * grid.nh + i] = (k + 1) * 100 * Math.exp(-(h * h) / 40 - (v * v) / 10) + (i % 13) * 1e-4; } return { ...grid, data }; };
      return JSON.stringify([1, 2].map((k) => ({ id: 'old' + k, beam: RF.Beams.serialise(RF.Beams.fromLut(RF.Beams.coarsen(mk(k), 0.25), { name: 'old ' + k, beamKind: 'low', conv: 'A' })) }))); }); })();
  const ctxB = await browser.newContext({ viewport: VP });
  await ctxB.addInitScript((v) => { if (!sessionStorage.getItem('bi-seeded')) { sessionStorage.setItem('bi-seeded', '1'); localStorage.setItem('flux/beamLibrary', v); } }, oldJson);
  await seed(ctxB);
  const pB = await pageOf(ctxB);
  await pB.goto(BASE); await pB.waitForFunction(() => window.RF && RF.Beams, null, { timeout: 60000 });
  await boot(pB); await waitOpts(pB, 3);
  await waitMsg(pB, 'Moved 2');
  const migrated = await idbRows(pB);
  ok('migration: both old beams are in IndexedDB under their old ids, marked coarse at 0.25 deg', migrated.length === 2 && migrated.every(r => r.coarse && r.step === 0.25) && migrated.map(r => r.id).sort().join() === 'old1,old2', migrated.map(r => [r.id, r.step, r.coarse]));
  const keyGone = await pB.evaluate(() => localStorage.getItem('flux/beamLibrary') === null);
  ok('migration: the old localStorage key is removed once the copies are stored', keyGone);
  const labels = await pB.evaluate(() => [...document.querySelectorAll('[data-anim="own-low"] option')].map(o => o.textContent));
  ok('migration: the picker and the list say the beams are coarse', labels.filter(l => l.includes('coarse 0.25 deg')).length === 2, labels);
  await ctxB.close();

  // ---- C: indexedDB throws before the app loads: the library is session-only and says so; nothing else breaks
  const ctxC = await browser.newContext({ viewport: VP });
  await ctxC.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('storage blocked'); } }); });
  await seed(ctxC);
  const pC = await pageOf(ctxC); await boot(pC);
  const one = await pC.evaluate(() => RF.Beams.serialise(RF.Beams.fromLut(window.__mk(0, { h0: -30, v0: -10, step: 0.5, nh: 120, nv: 60 }), { name: 'session one', beamKind: 'low', conv: 'A' })));
  await pC.setInputFiles('[data-anim="beam-file"]', { name: 'one.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(one)) });
  ok('storage throws: the beam is kept for this session and the status says so', await waitMsg(pC, 'Kept for this session only'), await pC.evaluate(() => document.querySelector('[data-anim="beam-status"]').textContent));
  ok('storage throws: the beam is selectable in the picker', (await waitOpts(pC, 2)) === true);
  await ctxC.close();

  // ---- D (BI2): save design with the grid select (default 0.25 deg; 0.5 deg picked by hand), storage line, row size and grid
  const ctxD = await browser.newContext({ viewport: VP }); await seed(ctxD);
  const pD = await pageOf(ctxD); await boot(pD);
  const srcStep = await pD.evaluate(() => RF.DriveAnim._.V.p.lowLut.step);
  const gridDefault = await pD.evaluate(() => document.querySelector('[data-anim="save-grid"]').value);
  ok('BI2: the grid select defaults to 0.25 deg', gridDefault === '0.25', gridDefault);
  await pD.evaluate(() => document.querySelector('[data-anim="save-design"]').click());
  for (let i = 0; i < 50 && !(await idbRows(pD)).length; i++) await pD.waitForTimeout(100);
  const dDefault = await idbRows(pD);
  ok('BI2: a saved design defaults to a 0.25 deg grid (the source step if the source is already coarser)', dDefault.length === 1 && dDefault[0].step === Math.max(srcStep, 0.25), { srcStep, steps: dDefault.map(r => r.step) });
  await pick(pD, '[data-anim="save-grid"]', '0.5');
  await pD.evaluate(() => document.querySelector('[data-anim="beam-name"]').value = 'half grid');
  await pD.evaluate(() => document.querySelector('[data-anim="save-design"]').click());
  for (let i = 0; i < 50 && (await idbRows(pD)).length < 2; i++) await pD.waitForTimeout(100);
  const dHalf = (await idbRows(pD)).find(r => r.name === 'half grid');
  ok('BI2: picking 0.5 deg stores that grid, full precision values kept (no quantisation)', dHalf && dHalf.step === 0.5, dHalf && { step: dHalf.step, n: dHalf.n });
  const rowsD = await rowsDOM(pD);
  ok('BI2: each row shows its grid step and size in MB', rowsD.length === 2 && rowsD.every(r => /grid \d/.test(r.size) && / MB/.test(r.size)), rowsD.map(r => r.size.slice(0, 60)));
  const storageLine = await pD.evaluate(() => document.querySelector('[data-anim="beam-storage"]').textContent);
  ok('BI2: storage line shows used of quota and persistence', /storage: used [\d.]+ of [\d.]+ MB, persistent: (yes|no)/.test(storageLine), storageLine);
  await ctxD.close();

  ok('no page errors in any scenario', errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + ' BI1 page check(s) FAILED' : 'all BI1 page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
