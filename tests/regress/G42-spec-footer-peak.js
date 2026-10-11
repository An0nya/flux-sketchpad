// G42 regression (Playwright): node tests/regress/G42-spec-footer-peak.js [port]
// In Spec mode the footer "peak" is the far-field maximum, not the target-plane grid's 99.5th percentile.  Needs: python3 tests/serve.py 8830
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.FarField)));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 250 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const ui = RF.UI, sp = ui.spec, cd = RF.FarField.map(sp.G, sp.ev.kernel > 0 ? sp.ev.kernel : 0.15).cd; let m = 0; for (const x of cd) if (x > m) m = x;
    const tile = [...document.querySelectorAll('#min-row .tile')].find((t) => /peak$/.test(t.innerText.trim()));
    return { far: RF.Panels.fmtCd(m), grid: RF.Panels.fmtCd(ui.photo.peakCd), tile: tile && tile.innerText.split('\n')[0].trim() };
  });
  ok('footer peak equals the far-field maximum (' + r.far + ')', r.tile === r.far, JSON.stringify(r));
  ok('and is not the grid percentile (' + r.grid + ')', r.far === r.grid || r.tile !== r.grid, JSON.stringify(r));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
