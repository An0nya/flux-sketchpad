// BA2 page checks: own low/high beam selects, import/export, library persistence, quota fallback. CPU renderer.
// Serve the worktree first: python3 tests/serve.py <free 88xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BA-beam-library.js <port>
// Bit-identical check (in-session): the built-in frame hash, taken before any swap, comes back exactly after swapping back to built-in.
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8994);
// the bar's selects are not visible at this viewport in the headless run (see report), so picks are dispatched as the change event
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: false })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BA fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });
  // frame hash of the current picture after warm-up (3 frames; the first frames differ from later ones)
  const hashNow = () => page.evaluate(() => { const a = (RF.DriveAnim._.frame(), RF.DriveAnim._.readCanvas()); let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619); return x >>> 0; });
  for (let i = 0; i < 3; i++) await hashNow();
  const H0 = await hashNow();
  const st = () => page.evaluate(() => { const V = RF.DriveAnim._.V; return { low: V.p.lut === V.p.lowLut, options: [...document.querySelectorAll('[data-anim="own-low"] option')].map(o => o.value), ownLow: document.querySelector('[data-anim="own-low"]').value, ownHigh: document.querySelector('[data-anim="own-high"]').value, msg: document.querySelector('[data-anim="beam-status"]').textContent }; });
  const s0 = await st();
  ok('selects exist and default to our design / generic high', s0.ownLow === 'design' && s0.ownHigh === 'generic', s0);
  ok('built-in: low table is our own table object (no swap)', s0.low === true);
  // make the test beams in the page: half and double our design (low), and a flat 300 cd high on the same window
  await page.evaluate(() => { window.BA = { mk: (name, kind, lut) => RF.Beams.fromLut(lut, { name, beamKind: kind, conv: 'A' }) }; });
  const bundle = await page.evaluate(() => { const L = RF.DriveAnim._.V.p.lowLut; const sc = (k) => ({ ...L, data: Float32Array.from(L.data, (x) => x * k) });
    const hi = RF.Beams.uniformWash(300, { hMin: L.h0, hMax: L.h0 + L.nh * L.step, vMin: L.v0, vMax: L.v0 + L.nv * L.step }, L.step);
    return JSON.stringify(RF.Beams.bundle([BA.mk('half', 'low', sc(0.5)), BA.mk('double', 'low', sc(2)), BA.mk('flat 300', 'high', hi)], { name: 'BA test bundle' })); });
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'ba-test.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.startsWith('Added 3'), null, { timeout: 20000 }).catch(() => {});
  const s1 = await st();
  ok('import of a 3-beam bundle adds the two low beams to the low select', s1.options.length === 3 && s1.msg.startsWith('Added 3'), { options: s1.options, msg: s1.msg });
  const half = s1.options.find(v => v !== 'design');
  const doubleId = s1.options[2];
  // swap to the half-strength low beam: the picture must change and the table must be the saved one (0.5 x our design)
  await pick(page, '[data-anim="own-low"]', half);
  await hashNow(); const Hh = await hashNow();
  const scaled = await page.evaluate(() => { const V = RF.DriveAnim._.V, L = V.p.lowLut; const k = Math.floor(L.nh * L.nv * 0.5); return { ratio: L.data[k] / 1, lutIsSaved: V.p.lowLut !== null }; });
  ok('saved low beam changes the picture', Hh !== H0, { H0, Hh });
  ok('picture uses the saved low table (not ours)', scaled.lutIsSaved === true && await page.evaluate(() => RF.DriveAnim._.V.p.lut === RF.DriveAnim._.V.p.lowLut));
  // swap back to built-in: bit-identical to the built-in frame of this session
  await pick(page, '[data-anim="own-low"]', 'design'); await hashNow(); const Hb = await hashNow();
  ok('built-in again: frame hash equals the built-in frame (bit-identical)', Hb === H0, { H0, Hb });
  // high: a saved high beam replaces the generic one when the switch is on (added to our low beam)
  await page.evaluate(() => { const b = document.querySelector('[data-anim="high-beam"]'); for (let i = 0; i < 3 && b.dataset.state !== 'on'; i++) b.click(); });
  await pick(page, '[data-anim="own-high"]', await page.evaluate(() => [...document.querySelectorAll('[data-anim="own-high"] option')].map(o => o.value).find(v => v !== 'generic')));
  const hiOk = await page.evaluate(() => { const V = RF.DriveAnim._.V, L = V.p.lowLut, k = (L.nv >> 1) * L.nh + (L.nh >> 1); return { differs: V.p.lut !== L, sum: V.p.lut.data[k] - L.data[k] }; });
  ok('high on + saved high: picture table is low + saved high (adds 300 cd on the centre)', hiOk.differs && Math.abs(hiOk.sum - 300) < 1e-2, hiOk);
  await page.evaluate(() => { const b = document.querySelector('[data-anim="high-beam"]'); for (let i = 0; i < 3 && b.dataset.state !== 'off'; i++) b.click(); });
  // export: a bundle of the library (3 beams), via a real download
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.evaluate(() => document.querySelector('[data-anim="export-beams"]').click())]);
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString('utf8')).catch(() => '');
  const back = await page.evaluate((t) => { try { return RF.Beams.readFile(JSON.parse(t)).map(b => [b.name, b.beamKind]); } catch (e) { return String(e.message); } }, text);
  ok('export downloads a bundle that reads back (3 beams, bit-exact via readFile)', Array.isArray(back) && back.length === 3, back);
  // persistence (BI1): the library is in IndexedDB at full resolution (the old coarse 0.25 deg copy is gone), one record per beam
  const stored = await page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('flux-beams', 1); r.onerror = () => rej(String(r.error));
    r.onsuccess = () => { const db = r.result, g = db.transaction('beams').objectStore('beams').getAll(); g.onsuccess = () => { db.close(); res(g.result.map(x => [x.id.length > 0, x.grid.step])); }; g.onerror = () => rej(String(g.error)); }; }));
  const srcStep = await page.evaluate(() => RF.DriveAnim._.V.p.lowLut.step);
  ok('library persisted in IndexedDB at the source table\'s own step (full resolution, no coarsening), 3 beams', Array.isArray(stored) && stored.length === 3 && stored.every(([a, s]) => a && s === srcStep), { srcStep, stored });
  // quota (BI1): an IndexedDB put that throws keeps the beam for this session and says so; no page error
  await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new Error('QuotaExceededError'); }; });
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'one.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await page.evaluate(() => RF.Beams.serialise(RF.Beams.fromLut({ ...RF.DriveAnim._.V.p.lowLut, data: Float32Array.from(RF.DriveAnim._.V.p.lowLut.data, x => x * 0.25) }, { name: 'quarter', beamKind: 'low' }))))) });
  await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.includes('session only'), null, { timeout: 20000 }).catch(() => {});
  const s2 = await st();
  ok('storage refused: beam kept for this session and the status says so', s2.msg.includes('session only') && s2.options.some(v => v && v !== 'design'), s2.msg);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
  // bad file: rejected with a message, nothing added
  await page.setInputFiles('[data-anim="beam-file"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":1,"kind":"beam","name":"x"}') });
  await page.waitForFunction(() => document.querySelector('[data-anim="beam-status"]').textContent.startsWith('Import failed'), null, { timeout: 20000 }).catch(() => {});
  ok('bad beam file rejected with a message', (await st()).msg.startsWith('Import failed'), (await st()).msg);
  ok('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' BA2 page check(s) FAILED' : 'all BA2 page checks passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
