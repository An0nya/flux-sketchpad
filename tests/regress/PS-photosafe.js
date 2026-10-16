// Photosensitivity safety for the animated Drive view (PS).
// python3 tests/serve.py 8799 ; PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/PS-photosafe.js 8799
const fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8799);
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); if (!c) fails++; };
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const url = 'http://localhost:' + port + '/index.html';

async function ready(page) {
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
  await page.evaluate((txt) => { RF.UI.loadScene(RF.State.deserialize(txt), 'PS fixture'); RF.UI.setMode('D'); }, scene);
  await page.waitForFunction(() => { const u = RF.UI; return !u.solving && u.run && u.run.ctx.done && u.spec && u.spec.ctx === u.run.ctx && u.spec.full && u.spec.ev; }, null, { timeout: 180000 });
  await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); Object.assign(u.dvOpts, { mt: false, fitControls: true, scene: 'road', speed: 50, tiles: false, oncoming: false, preceding: false, trafficDensity: 0, trafficLogic: false }); u.redrawSpec(); });
}
// Starts playback from the paused animation and waits for the first rendered frame.
async function startAnimation(page) {
  await page.locator('.drive-more').evaluate((e) => { e.open = true; });
  if (!await page.evaluate(() => RF.UI.dvAnim.playing)) await page.locator('[data-anim=play]').click();
  await page.locator('.drive-more').evaluate((e) => { e.open = false; });
  await page.waitForFunction(() => RF.UI.dvAnim.playing && RF.DriveAnim.renderedGlare() !== null, null, { timeout: 60000 });
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await pw.chromium.launch({});
  const errors = [];
  try {
    // Scenario A: fresh browser, no saved options, system Reduce Motion OFF.
    {
      const context = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await context.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await ready(page);
      ok('PS (a) fresh localStorage -> dvOpts glare is off', await page.evaluate(() => RF.UI.dvOpts.glare === 'off'), await page.evaluate(() => RF.UI.dvOpts.glare));
      await startAnimation(page);
      const notice = page.locator('[data-anim=photosafe-notice]');
      ok('PS (d) notice appears on first animation start', await notice.count() === 1, await notice.count());
      ok('PS (d) notice text is the required wording', (await notice.textContent()).startsWith('Flashing lights: the drive view can flash (glare, passing headlamps). Glare is off by default; your system\'s Reduce Motion setting caps it.'));
      await page.waitForTimeout(400);
      ok('PS (d) notice is not duplicated by later frames', await notice.count() === 1, await notice.count());
      await notice.locator('[data-anim=photosafe-dismiss]').click();
      ok('PS (d) dismissal stored under flux/photosafeNotice', await page.evaluate(() => localStorage.getItem('flux/photosafeNotice') === 'dismissed'));
      await page.reload(); await ready(page); await startAnimation(page);
      ok('PS (d) notice does not return after dismissal + reload', await page.locator('[data-anim=photosafe-notice]').count() === 0);
      await context.close();
    }
    // Scenario B: saved glare 'rain', system Reduce Motion ON.
    {
      const context = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await context.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url); await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ glare: 'rain' })); }); await page.reload(); await ready(page);
      ok('PS (b) saved glare rain is kept in dvOpts', await page.evaluate(() => RF.UI.dvOpts.glare === 'rain'), await page.evaluate(() => RF.UI.dvOpts.glare));
      await startAnimation(page);
      const rendered = await page.evaluate(() => RF.DriveAnim.renderedGlare());
      ok('PS (c) reduced motion renders glare at dry-low', rendered === 'dry-low', rendered);
      ok('PS (c) saved setting still rain after rendering', await page.evaluate(() => RF.UI.dvOpts.glare === 'rain'));
      const label = await page.locator('[data-dv=glare]').textContent();
      ok('PS (c) glare button shows capped suffix', /\(capped: reduced motion\)/.test(label), label);
      await context.close();
    }
    ok('PS no page errors', errors.length === 0, errors);
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all PS checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
