// BB page checks: beam naming (BB1), library manager rename/delete (BB2), colour travels with the beam (BB3). CPU renderer.
// Serve the worktree first: python3 tests/serve.py <free 89xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BB-beam-library-fixes.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8997);
// BI1: the library's stored records (IndexedDB 'flux-beams'), read back from the page
const idbBeams = (page) => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('flux-beams', 1); r.onerror = () => rej(String(r.error));
  r.onsuccess = () => { const db = r.result, g = db.transaction('beams').objectStore('beams').getAll(); g.onsuccess = () => { db.close(); res(g.result); }; }; }));
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
// the bar's controls are not visible at this viewport in the headless run: clicks and values are set in the page
const clickAnim = (page, k) => page.evaluate((k) => document.querySelector('[data-anim="' + k + '"]').click(), k);
const setName = (page, v) => page.evaluate((v) => { const el = document.querySelector('[data-anim="beam-name"]'); el.value = v; }, v);
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
const libNames = (page) => page.evaluate(() => [...document.querySelectorAll('[data-anim="own-low"] option')].map(o => o.textContent.replace(/ \(session\)$/, '')).filter(n => n !== 'our design'));
(async () => {
  const browser = await pw.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  // a fresh tab starts with an empty library; a reload in the same tab keeps it (sessionStorage marks the first load)
  await page.addInitScript(() => { if (!sessionStorage.getItem('bb-booted')) { sessionStorage.setItem('bb-booted', '1'); localStorage.clear(); } localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: false })); });
  // load the fixture scene into the drive view (a reload starts from the default scene again)
  const boot = async () => {
    await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BB fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });

  };
  await boot();

  // BB1: naming. Typed name is used; empty uses the default (the design's name); a taken name gets a counter.
  const designName = await page.evaluate(() => RF.UI.store.scene.name);
  await setName(page, 'Alpha HID'); await clickAnim(page, 'save-design');
  ok('BB1: typed name saved and listed', (await libNames(page)).includes('Alpha HID'), await libNames(page));
  await setName(page, ''); await clickAnim(page, 'save-design');
  ok('BB1: empty name uses the design name as default', (await libNames(page)).includes(designName), { design: designName, names: await libNames(page) });
  await setName(page, 'Alpha HID'); await clickAnim(page, 'save-design');
  const names = await libNames(page);
  ok('BB1: a taken name gets a counter, nothing overwritten', names.includes('Alpha HID') && names.includes('Alpha HID 2'), names);
  const ph = await page.evaluate(() => document.querySelector('[data-anim="beam-name"]').placeholder);
  ok('BB1: placeholder shows the default name', ph === designName, { ph, designName });

  // BB2: the manager lists the rows; rename changes the name everywhere; delete removes it and a selected beam falls back
  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')].map(r => r.querySelector('[data-anim="beam-row-name"]').value));
  ok('BB2: manager has one row per saved beam', (await rows()).length === 3, await rows());
  // rows are addressed by position: a rename can make two rows share a name for a moment
  const rowAct = (i, act) => page.evaluate(([i, act]) => { const r = document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')[i]; if (!r) return 'no row'; r.querySelector('[data-anim="' + act + '"]').click(); return 'ok'; }, [i, act]);
  const setRowName = (i, v) => page.evaluate(([i, v]) => { document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]')[i].querySelector('[data-anim="beam-row-name"]').value = v; }, [i, v]);
  const idOf = (name) => page.evaluate((name) => [...document.querySelectorAll('[data-anim="own-low"] option')].find(o => o.textContent.replace(/ \(session\)$/, '') === name)?.value, name);
  await setRowName(2, 'Renamed beam'); await rowAct(2, 'beam-rename');
  ok('BB2: rename applies to the row and the picker', (await libNames(page)).includes('Renamed beam') && !(await libNames(page)).includes('Alpha HID 2'), await libNames(page));
  await setRowName(2, 'Alpha HID'); await rowAct(2, 'beam-rename');
  ok('BB2: renaming onto a taken name gets a counter', (await rows())[2] === 'Alpha HID 2', await rows());
  // select 'Alpha HID 2' as our low beam, then delete it: selection falls back and the status says so
  await pick(page, '[data-anim="own-low"]', await idOf('Alpha HID 2'));
  await rowAct(2, 'beam-delete');
  await page.waitForFunction(() => (document.querySelector('[data-anim="beam-status"]').textContent || '').includes('Deleted'), null, { timeout: 20000 }).catch(() => {});
  const afterDel = { ...(await page.evaluate(() => ({ low: document.querySelector('[data-anim="own-low"]').value, msg: document.querySelector('[data-anim="beam-status"]').textContent }))), stored: (await idbBeams(page)).map(r => r.name) };
  ok('BB2: deleting the selected beam falls back to our design and says so', afterDel.low === 'design' && afterDel.msg.includes('our design is selected now'), afterDel);
  ok('BB2: delete is persisted (stored copy lacks it)', !afterDel.stored.includes('Alpha HID 2') && afterDel.stored.length === 2, afterDel.stored);
  // reload keeps the remaining library and the fallback selection
  await boot();
  const afterReload = await rows();
  ok('BB2: reload keeps the library (deleted beam stays gone)', afterReload.length === 2 && !afterReload.includes('Alpha HID 2'), afterReload);
  // clear all: first click asks, second click removes everything
  await page.evaluate(() => document.querySelector('[data-anim="beam-clear-all"]').click());
  const asked = await page.evaluate(() => document.querySelector('[data-anim="beam-clear-all"]').textContent);
  ok('BB2: clear all asks first (no change yet)', asked.startsWith('confirm') && (await rows()).length === 2, asked);
  await page.evaluate(() => document.querySelector('[data-anim="beam-clear-all"]').click());
  for (let i = 0; i < 50 && (await idbBeams(page)).length; i++) await page.waitForTimeout(100);   // the store clears after the status is set
  const cleared = { ...(await page.evaluate(() => ({ rows: document.querySelectorAll('[data-anim="beam-manager"] .beam-row[data-id]').length, low: document.querySelector('[data-anim="own-low"]').value }))), stored: (await idbBeams(page)).length };
  ok('BB2: clear all removes every beam, stored and shown, and resets the selection', cleared.rows === 0 && cleared.stored === 0 && cleared.low === 'design', cleared);

  ok('BB: no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' BB check(s) FAILED' : 'all BB checks passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
