// G20 regression (Playwright): node tests/regress/G20-spec-small-ui.js [port]
// Small Spec UI defects: absurd headroom factors on the hover card, "One stop" titles on half-stop buttons, hotspot centre H input min.  Needs: python3 tests/serve.py 8825
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8825);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.Spec)));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  // 1. hover cards of every item: no headroom factor above 1000 and none on an unsure row
  const cards = await page.evaluate(() => { const ui = RF.UI, cv = document.getElementById('heat-canvas'), out = [];
    for (const it of RF.Spec.itemsOf(ui.store.scene.modeD)) { RF.SpecUI.showCard(ui, cv, it, 10, 10); for (const r of cv.parentElement.querySelectorAll('.spec-card .sc-l[class*="v-"]')) out.push({ name: it.name, unsure: r.classList.contains('v-unsure'), text: r.innerText }); }
    return out; });
  const big = cards.filter((c) => { const m = /×([\d.]+) headroom/.exec(c.text); return m && +m[1] > 1000; }), un = cards.filter((c) => c.unsure && /headroom/.test(c.text));
  ok('hover cards (' + cards.length + ' rows): no headroom factor above 1000', cards.length > 0 && big.length === 0, big.slice(0, 2).map((c) => c.name + ': ' + c.text.replace(/\s+/g, ' ')).join(' | '));
  ok('hover cards: no headroom claimed on an unsure row', un.length === 0, un.slice(0, 2).map((c) => c.name + ': ' + c.text.replace(/\s+/g, ' ')).join(' | '));
  // 2. exposure buttons
  await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(1500);
  const t = await page.evaluate(() => ({ evm: document.querySelector('[data-dv="evm"]').title, evp: document.querySelector('[data-dv="evp"]').title, ev0: RF.UI.dvOpts.ev }));
  await page.click('[data-dv="evp"]'); await page.waitForTimeout(500);
  const step = (await page.evaluate(() => RF.UI.dvOpts.ev)) - t.ev0;
  ok('exposure + button title matches its step (' + step + ' EV)', step === 1 ? /one stop/i.test(t.evp) : /half a stop/i.test(t.evp), t.evp);
  ok('exposure - button title matches its step', step === 1 ? /one stop/i.test(t.evm) : /half a stop/i.test(t.evm), t.evm);
  // 3. ideal beam hotspot centre H accepts a negative value
  await page.evaluate(() => RF.UI.setDisplay('ff'));
  const c = await page.evaluate(() => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => /^Hotspot centre H/.test(r.querySelector('label').textContent)); const i = r.querySelector('input'); const min = i.min; i.value = '-1'; return { min, validAtMinus1: i.checkValidity() }; });
  ok('Hotspot centre H input accepts -1', c.validAtMinus1 === true, JSON.stringify(c));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
