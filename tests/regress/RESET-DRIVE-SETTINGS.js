// RESET-DRIVE-SETTINGS: the "Reset drive settings" button (next to the Solve cache bar, spec mode only) clears the saved drive
// options (localStorage flux/driveView) and reloads with a plain URL. Other saved keys stay. Safe mode must NOT turn on.
// Real GPU flags. Screenshots go to SHOTS dir (env) if set.
// node tests/regress/RESET-DRIVE-SETTINGS.js [port]   (needs: python3 tests/serve.py <port>)
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8921);
const SHOTS = process.env.SHOTS || '';
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const KEYS_KEEP = ['flux/driveMore', 'flux/driveAirAdv', 'flux/driveHaloAdv', 'flux/roadView'];

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = 'http://localhost:' + port + '/index.html';

  const boot = async () => {
    await page.goto(url);
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene, null, { timeout: 60000 });
  };
  const loadFixture = async () => {
    await page.evaluate((text) => RF.UI.loadScene(RF.State.deserialize(text), 'reset-drive fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.evaluate(() => document.querySelector('.modes button[data-mode="D"]').click());
    await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx && RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 180000, polling: 200 });
    await page.waitForTimeout(500);
  };
  const dismissTip = async () => { const b = page.getByRole('button', { name: 'Got it' }); if (await b.isVisible().catch(() => false)) await b.click(); };
  const btnDisplay = () => page.evaluate(() => { const b = document.getElementById('ab-reset-drive'); return b ? getComputedStyle(b).display : 'absent'; });
  const opts = () => page.evaluate(() => JSON.stringify(RF.UI.dvOpts));
  const rawKeys = () => page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS_KEEP);
  const safe = () => page.evaluate(() => ({ safeMode: !!RF.UI.safeMode, banner: document.getElementById('safe-banner').hidden === false }));

  // ---- 1. first boot: defaults baseline, then set non-default drive options and layout keys
  await boot();
  await loadFixture();
  await dismissTip();
  const baseline = await opts();
  const sentinel = { driveMore: '{"sentinel":"more"}', driveAirAdv: '{"sentinel":"air"}', driveHaloAdv: '{"sentinel":"halo"}', roadView: '{"sentinel":"road"}' };
  await page.evaluate(({ s, keys }) => {
    const o = Object.assign({}, RF.UI.dvOpts, { samples: 'auto', trafficNearest: '16' });
    localStorage.setItem('flux/driveView', RF.Options.serialize(o));
    localStorage.setItem('flux/driveMore', s.driveMore); localStorage.setItem('flux/driveAirAdv', s.driveAirAdv);
    localStorage.setItem('flux/driveHaloAdv', s.driveHaloAdv); localStorage.setItem('flux/roadView', s.roadView);
  }, { s: sentinel, keys: KEYS_KEEP });
  const beforeKeys = await rawKeys();
  ok('S1 non-default drive options saved', await page.evaluate(() => (localStorage.getItem('flux/driveView') || '').length > 0));

  // ---- 2. reload plainly: the saved non-default options are loaded (proves the saved state is live)
  await boot();
  await loadFixture();
  await dismissTip();
  ok('S2 saved options are read back after reload', (await opts()) !== baseline, 'options differ from defaults before the reset');
  ok('S3 spec mode: button visible next to Solve cache (computed display)', (await btnDisplay()) !== 'none' && (await btnDisplay()) !== 'absent', 'display=' + (await btnDisplay()));
  if (SHOTS) await page.locator('.result-pane > .pane-head').screenshot({ path: path.join(SHOTS, 'after-solvecache-bar.png') });

  // ---- 3. first click only arms the confirm step; the saved key must still exist
  await page.locator('#ab-reset-drive').click();
  const armedText = await page.locator('#ab-reset-drive').textContent();
  ok('R1 first click arms confirm step', /Reset all drive options to defaults\?/.test(armedText), armedText);
  ok('R2 key still present before confirm', (await page.evaluate(() => localStorage.getItem('flux/driveView'))) !== null);
  if (SHOTS) await page.locator('.result-pane > .pane-head').screenshot({ path: path.join(SHOTS, 'confirm-step.png') });

  // ---- 4. second click confirms: key removed, plain reload
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.locator('#ab-reset-drive').click()]);
  const landed = page.url();
  ok('R3 reloaded to the plain URL (no query, no hash)', landed === url, landed);
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene, null, { timeout: 60000 });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx && RF.UI.run.ctx.done, null, { timeout: 180000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(500);

  // ---- 5. after the reset: key gone, options default, layout keys untouched, no safe mode
  const keyAfter = await page.evaluate(() => localStorage.getItem('flux/driveView'));
  ok('R4 flux/driveView removed', keyAfter === null, 'value=' + (keyAfter === null ? 'null' : 'present'));
  ok('R5 drive options back to defaults in memory', (await opts()) === baseline);
  const afterKeys = await rawKeys();
  ok('R6 layout keys + flux/roadView unchanged', JSON.stringify(afterKeys) === JSON.stringify(beforeKeys), JSON.stringify(afterKeys));
  const s = await safe();
  ok('R7 safe mode is NOT on (no banner)', !s.safeMode && !s.banner, JSON.stringify(s));

  // ---- 6. button visibility: shown in spec mode, absent in non-spec mode
  await page.evaluate(() => document.querySelector('.modes button[data-mode="D"]').click());
  ok('V1 visible in spec mode after reset', (await btnDisplay()) !== 'none', 'display=' + (await btnDisplay()));
  await page.evaluate(() => document.querySelector('.modes button[data-mode="A"]').click());
  await page.waitForTimeout(300);
  ok('V2 hidden in non-spec mode (A)', (await btnDisplay()) === 'none', 'display=' + (await btnDisplay()));
  await page.evaluate(() => document.querySelector('.modes button[data-mode="D"]').click());
  await page.waitForTimeout(300);
  ok('V3 visible again back in spec mode', (await btnDisplay()) !== 'none');

  ok('E1 no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
