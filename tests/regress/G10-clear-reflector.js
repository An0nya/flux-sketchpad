// G10 regression (Playwright): node tests/regress/G10-clear-reflector.js [port]
// Clear on the Mode A reflector: empties it, footer shows 0 facets, a source nudge does not bring it back, ONE undo entry,
// undo restores it, redo clears it again, Rebuild brings it back.  Needs: python3 tests/serve.py 8830
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
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.UI.clearGroup)));
  const st = () => page.evaluate(() => { const s = RF.UI.store; return { n: s.scene.groups.A.surfaces.length, dirty: s.dirty.has('A'), auto: s.autoA, past: RF.UI.hist.past.length, foot: (document.querySelector('#min-row .tile.facets b') || {}).textContent || null }; });
  const settle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 }); await page.waitForTimeout(1500); };
  await page.evaluate(() => RF.UI.setMode('A')); await settle();
  const s0 = await st(); ok('setup: a solved reflector, footer shows its facets', s0.n > 0 && /^\d+ \/ /.test(s0.foot || '') && !/^0 \//.test(s0.foot), JSON.stringify(s0));
  await page.evaluate(() => { const b = [...document.querySelectorAll('#group-list .item')].find((i) => /Mode A|reflector|Paint/i.test(i.textContent) && i.querySelector('button.danger')).querySelector('button.danger'); b.click(); b.click(); });
  await settle();
  const s1 = await st(); ok('clear empties the reflector, footer shows 0 facets, one history entry', s1.n === 0 && /^0 \//.test(s1.foot || '') && s1.past === s0.past + 1, JSON.stringify(s1));
  await page.evaluate(() => { const c = RF.UI.store.scene.source.pos; RF.UI.store.scene.source.pos = [c[0] + 0.5, c[1], c[2]]; RF.UI.store.invalidate(['A']); RF.UI.afterChange(); }); await settle();
  const s2 = await st(); ok('a source nudge does not bring the reflector back', s2.n === 0 && !s2.dirty && /^0 \//.test(s2.foot || ''), JSON.stringify(s2));
  for (let i = 0; i < 2; i++) { await page.evaluate(() => document.getElementById('btn-undo').click()); await settle(); }   // the nudge, then the clear
  const s3 = await st(); ok('undo restores the reflector', s3.n > 0, JSON.stringify(s3));
  for (let i = 0; i < 2; i++) { await page.evaluate(() => document.getElementById('btn-redo').click()); await settle(); }
  const s4 = await st(); ok('redo clears it again', s4.n === 0 && /^0 \//.test(s4.foot || ''), JSON.stringify(s4));
  await page.evaluate(() => document.getElementById('btn-generate-top').click()); await settle();
  const s5 = await st(); ok('Rebuild brings the reflector back and auto-solve returns', s5.n > 0 && s5.auto === true, JSON.stringify(s5));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
