// D-spec-layout: entering Spec collapses Editor and expands Result; leaving restores the pre-Spec layout exactly (even after layout
// changes made in Spec); a reload in Spec comes up in its Spec layout, other modes in their own.
// node tests/regress/D-spec-layout.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const load = async (page) => {
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.UI.layout && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(700);
};
const lay = (page) => page.evaluate(() => ({ mode: RF.UI.store.scene.mode, l: JSON.stringify(RF.UI.layout), ed: document.querySelector('.editor-pane').className, rs: document.querySelector('.result-pane').className }));
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  await load(page);
  ok('page identifies as Flux, Paint mode', (await lay(page)).mode === 'A');
  await page.evaluate(() => { const l = RF.UI.layout; l.split = 0.55; l.rowSplit = 0.4; l.collapsed.optics = true; RF.UI.layoutGrid(); localStorage.setItem('flux/layout', JSON.stringify(l)); }); await page.waitForTimeout(500);
  const own = await lay(page);
  await page.click('#sidebar [data-mode="D"]'); await page.waitForTimeout(900);
  let s = await lay(page), L = JSON.parse(s.l);
  ok('entering Spec: Editor collapsed, Result expanded', s.mode === 'D' && L.collapsed.editor === true && L.expanded === 'result' && /collapsed/.test(s.ed) && /expanded/.test(s.rs), s.l);
  ok('... Scene / Optics states and splits untouched', L.collapsed.optics === true && L.split === 0.55 && L.rowSplit === 0.4);
  await page.evaluate(() => RF.UI.setPane('result', 'expand')); await page.evaluate(() => RF.UI.setPane('scene', 'collapse')); await page.waitForTimeout(500);   // the user rearranges in Spec
  await page.evaluate(() => RF.State.saveLocal(RF.UI.store.scene));   // a mode switch alone does not autosave the scene (not part of this group); any later edit does
  await page.reload(); await load(page);
  s = await lay(page); L = JSON.parse(s.l);
  ok('reload in Spec: it comes up in the layout it had (user changes kept, not re-applied)', s.mode === 'D' && L.collapsed.editor === true && L.collapsed.scene === true && L.expanded === null, s.l);
  await page.click('#sidebar [data-mode="A"]'); await page.waitForTimeout(900);
  s = await lay(page);
  ok('leaving Spec (after a reload and changes in Spec) restores exactly the pre-Spec layout', s.mode === 'A' && s.l === own.l, s.l + ' vs ' + own.l);
  await page.evaluate(() => RF.State.saveLocal(RF.UI.store.scene)); await page.reload(); await load(page);
  s = await lay(page);
  ok('reload in Paint: its own layout', s.mode === 'A' && s.l === own.l, s.l);
  await page.evaluate(() => RF.UI.setMode('D')); await page.waitForTimeout(700);
  await page.evaluate(() => RF.UI.setMode('A')); await page.waitForTimeout(700);
  ok('Spec then Paint through the API restores it as well', (await lay(page)).l === own.l);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
