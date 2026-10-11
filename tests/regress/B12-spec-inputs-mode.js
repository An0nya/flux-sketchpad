// B12 regression (Playwright): node tests/regress/B12-spec-inputs-mode.js [port]   (needs a server: python3 tests/serve.py 8834)
//  T5 (S14) Spec-mode number inputs write back the value in use after change / Enter / blur (a clamped or emptied entry must not stay on screen)
//  T6 (B11 point 1) a mode switch alone is autosaved (and is not an undo entry)
//  T7 (B11 point 2) in Spec, collapsing Result and reopening it comes back expanded; elsewhere collapse still clears expand
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8834);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const KEY = 'faceted-reflector-demo/scene/v1';
const load = async (page) => {
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.UI.layout && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(700);
};
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  await page.addInitScript(() => { if (!sessionStorage.getItem('b12-cleared')) { try { localStorage.clear(); sessionStorage.setItem('b12-cleared', '1'); } catch (e) { /* ignore */ } } });
  await load(page);
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI)));
  // T6: a mode switch alone
  const mode0 = await page.evaluate(() => RF.UI.store.scene.mode), past0 = await page.evaluate(() => RF.UI.hist.past.length);
  await page.evaluate(() => RF.UI.setMode('D')); await page.waitForTimeout(1500);   // (the first entry to Spec also sets the display, which saves: the real test is the next switch)
  await page.evaluate(() => RF.UI.setMode('B')); await page.waitForTimeout(1500);
  const saved = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)).mode; } catch (e) { return 'unreadable'; } }, KEY);
  ok('T6 switching mode alone autosaves the new mode (was ' + mode0 + ', then Spec, then Stamp)', saved === 'B', 'saved mode ' + saved);
  ok('T6 ... and adds no undo entry', (await page.evaluate(() => RF.UI.hist.past.length)) === past0, 'past ' + past0 + ' -> ' + (await page.evaluate(() => RF.UI.hist.past.length)));
  await page.reload(); await load(page);
  ok('T6 a reload right after the switch comes up in the new mode (Stamp)', (await page.evaluate(() => RF.UI.store.scene.mode)) === 'B');
  await page.evaluate(() => RF.UI.setMode('D')); await page.waitForTimeout(800);
  // T5: a clamped entry in a Spec input
  const ker = '#spec-box input[type="number"][min="0.05"][max="5"]';
  ok('T5 found the Kernel input', (await page.locator(ker).count()) > 0);
  await page.evaluate((q) => { for (let e = document.querySelector(q); e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true; }, ker); await page.waitForTimeout(200);
  await page.click(ker); await page.fill(ker, '99'); await page.press(ker, 'Enter'); await page.waitForTimeout(300);
  let r = { store: await page.evaluate(() => RF.UI.store.scene.modeD.kernel), field: await page.inputValue(ker) };
  ok('T5 over the max + Enter: the field shows the clamped value in use', r.store === 5 && +r.field === 5, JSON.stringify(r));
  await page.click(ker); await page.fill(ker, '0.001'); await page.press(ker, 'Tab'); await page.waitForTimeout(300);
  r = { store: await page.evaluate(() => RF.UI.store.scene.modeD.kernel), field: await page.inputValue(ker) };
  ok('T5 under the min + Tab: the field shows the clamped value in use', r.store === 0.05 && +r.field === 0.05, JSON.stringify(r));
  await page.click(ker); await page.fill(ker, ''); await page.press(ker, 'Tab'); await page.waitForTimeout(300);
  r = { store: await page.evaluate(() => RF.UI.store.scene.modeD.kernel), field: await page.inputValue(ker) };
  ok('T5 emptied + Tab: the field shows the stored value again', r.store === 0.05 && +r.field === 0.05, JSON.stringify(r));
  // T7
  await page.evaluate(() => { RF.UI.setMode('A'); RF.UI.setMode('D'); }); await page.waitForTimeout(600);
  let L = await page.evaluate(() => JSON.parse(JSON.stringify(RF.UI.layout)));
  ok('T7 Spec opens with Result expanded', L.expanded === 'result' && L.collapsed.result === false, JSON.stringify(L));
  await page.evaluate(() => RF.UI.setPane('result', 'collapse')); await page.waitForTimeout(400);
  L = await page.evaluate(() => JSON.parse(JSON.stringify(RF.UI.layout)));
  ok('T7 collapsing Result in Spec collapses it (expand cleared while collapsed)', L.collapsed.result === true && L.expanded === null, JSON.stringify(L));
  await page.evaluate(() => RF.UI.setPane('result', 'collapse')); await page.waitForTimeout(400);
  L = await page.evaluate(() => JSON.parse(JSON.stringify(RF.UI.layout)));
  ok('T7 reopening Result in Spec comes back expanded', L.collapsed.result === false && L.expanded === 'result', JSON.stringify(L));
  await page.evaluate(() => RF.UI.setMode('A')); await page.waitForTimeout(600);
  await page.evaluate(() => { RF.UI.setPane('result', 'expand'); RF.UI.setPane('result', 'collapse'); RF.UI.setPane('result', 'collapse'); }); await page.waitForTimeout(400);
  L = await page.evaluate(() => JSON.parse(JSON.stringify(RF.UI.layout)));
  ok('T7 outside Spec, collapse then reopen is plain (unchanged behaviour)', L.collapsed.result === false && L.expanded === null, JSON.stringify(L));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
