// G39 regression (Playwright): node tests/regress/G39-field-writeback.js [port]
// A rejected or clamped entry must not stay in the field: it shows the value actually in use.  Arrow keys step from the stored value.
// Covers sidebar number controls (panels.js numberControl) and the LED drive-current field.  Needs: python3 tests/serve.py 8830
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8830);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.Panels)));
  await page.evaluate(() => RF.UI.setMode('A')); await page.waitForTimeout(500);
  const fld = '#side input.scrub[data-control="A.budget"]', store = () => page.evaluate(() => RF.UI.store.scene.modeA.budget);
  const enter = async (txt, key) => { await page.click(fld); await page.fill(fld, txt); await page.press(fld, key || 'Enter'); await page.waitForTimeout(250); return { store: await store(), field: await page.inputValue(fld) }; };
  let r = await enter('abc'); const b0 = r.store;
  ok('text that is not a number: field shows the stored value again', r.field === String(b0), JSON.stringify(r));
  r = await enter('99999'); ok('over the max: field shows the clamped value', r.field === String(r.store) && r.store <= 2000 && r.store > b0, JSON.stringify(r));
  r = await enter('-5', 'Tab'); ok('under the min (Tab away): field shows the clamped value', r.field === String(r.store) && r.store >= 1, JSON.stringify(r));
  await enter('50'); const cur = await store(); await page.click(fld); await page.fill(fld, 'abc'); await page.press(fld, 'ArrowUp'); await page.waitForTimeout(250);
  r = { store: await store(), field: await page.inputValue(fld) };
  ok('ArrowUp after junk text steps from the stored value (' + cur + ')', r.store > cur && r.store < cur + 20 && r.store !== 1 && r.field === String(r.store), JSON.stringify(r));
  await page.press(fld, 'Escape'); await page.evaluate(() => document.activeElement.blur());
  // drive current
  const ids = await page.evaluate(() => [...document.querySelectorAll('#source-preset select[aria-label="Emitter preset"] option')].map((o) => o.value).filter(Boolean));
  await page.selectOption('#source-preset select[aria-label="Emitter preset"]', ids.find((i) => /519a/.test(i)) || ids[1]); await page.waitForTimeout(300);
  const dr = '#source-preset input[aria-label="Drive current (A)"]', amps = () => page.evaluate(() => RF.UI.store.scene.source.driveA);
  const a0 = await amps();
  for (const v of ['0', '-1']) {
    await page.fill(dr, v); await page.press(dr, 'Tab'); await page.waitForTimeout(250);
    ok('drive current ' + v + ' is rejected and the field shows ' + a0, (await amps()) === a0 && +(await page.inputValue(dr)) === a0, 'driveA ' + (await amps()) + ' field ' + (await page.inputValue(dr)));
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
