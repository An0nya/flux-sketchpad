// WT page checks: the road button cycles dry, damp, wet (wetness 0, 0.4, 1) and reaches the GPU drive renderer. A legacy
// localStorage {"wet":true} loads as wet. The dry and wet GPU frames hash to the pre-change values (captured on main before
// WT1), the damp frame is a third, different picture, and no page or console errors appear.
// Run: PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/WT-wetness.js 8981   (server: python3 tests/serve.py 8981)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8981);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Pre-change GPU frames: sha256 of the drive canvas PNG, captured on main (194bee9) with this file's launch (channel chromium) after the
// UX2 start with wet and wetSheen set explicitly: dry = wet false, wet = wet true with the sheen off.
// LAZYCPU (2026-10-22): while the GPU view shows, the CPU still under the GPU canvas is no longer rendered, so the 1-px sub-pixel edge column of the element screenshot
// now shows the page background instead of the CPU still. Proven by forcing RF.SpecUI.forceCpuStill = true: both old hashes below then match again (7/7). Re-baselined, no tolerance change.
// Before (LAZYCPU): dry 26104b34d5d8066816b7828b8c93737189079d78340b9c74f9cb86c7dfa8f5f5, wet 44a8d9ef6bd4f6a0cfd602403274f95c3a30fb06eed56f7892dc83b962042e3c.
// PED-CLOTHING-MODES: people are off in this session (walkers' clothes changed in every mode). The pins are main b38c628's frames with people off,
// captured on main and equal to the new build with people off (full sha256 of the PNG). With people on, the old pins are f8ce6e90... / a4aa8a8c... and no longer match.
const OLD = { dry: '8eb4e35ccda362c43f749ba920f616b3dd255b61bf6461a1f2f44378666fa879', wet: '1f69234ee88e1ec3938d2730daacdc3f35a2629665f0b654053ebfa0b177adc0' };

// Two contexts. The legacy-seeded one only checks the loaded option (no frame: a page that starts wet and then goes dry keeps a
// residue that depends on the start, measured on main as well, so the frame checks start from a fresh dry load).
// The fresh one: dry (no click), then the road button: dry -> damp -> wet, one capture per step.
async function legacySeeded(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await context.addInitScript(() => { try { if (!sessionStorage.getItem('wtSeeded')) { localStorage.setItem('flux/driveView', JSON.stringify({ wet: true })); sessionStorage.setItem('wtSeeded', '1'); } } catch (e) { /* ignore */ } });
  const page = await context.newPage();
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  const loaded = await page.evaluate(() => ({ wetness: RF.UI.dvOpts.wetness, wet: RF.UI.dvOpts.wet, stored: JSON.parse(localStorage.getItem('flux/driveView') || '{}').wet }));
  await context.close();
  return loaded;
}
async function session(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage(), errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
  await page.evaluate(() => UX2Page.ready());
  await sleep(1500);
  // the UX2 start sets wet and wetSheen on; the dry start sets the road to dry with the sheen off (the baseline state)
  await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, people: false }); RF.UI.redrawSpec(); });
  const capture = async (label) => {
    await sleep(2500);
    const state = await page.evaluate(() => { const s = RF.DriveAnim.stats(); return { wetness: RF.UI.dvOpts.wetness, label: document.querySelector('[data-dv="wetness"]').textContent, renderer: s.renderer, gpuFailure: s.gpuFailure || '' }; });
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-wt-drive', '1'));
    const png = await page.locator('canvas[data-wt-drive="1"]').screenshot();
    return { state, png, hash: crypto.createHash('sha256').update(png).digest('hex'), label };
  };
  const click = () => page.evaluate(() => document.querySelector('[data-dv="wetness"]').click());
  const dry = await capture('dry');
  await click(); const damp = await capture('damp');
  await click(); const wet = await capture('wet');
  await context.close();
  return { dry, damp, wet, errors };
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }); let failed = false;
  const report = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); failed ||= !pass; };
  try {
    const loaded = await legacySeeded(browser);
    const { dry: toDry, damp: toDamp, wet: toWet, errors } = await session(browser);
    report('WT legacy stored {"wet":true} loads as wetness 1 (wet)', loaded.wetness === 1 && loaded.wet === true && loaded.stored === true, loaded);
    report('WT the road button cycles dry, damp, wet (labels and wetness)',
      toDry.state.wetness === 0 && toDry.state.label.endsWith('dry') && toDamp.state.wetness === 0.4 && toDamp.state.label.endsWith('damp') && toWet.state.wetness === 1 && toWet.state.label.endsWith('wet'),
      [toDry.state.label, toDamp.state.label, toWet.state.label]);
    report('WT GPU renderer active at every step with no shader failure', [toDry, toDamp, toWet].every(r => r.state.renderer === 'three' && !r.state.gpuFailure), [toDry.state, toDamp.state, toWet.state]);
    report('WT dry frame equals the pre-change dry hash', toDry.hash === OLD.dry, { got: toDry.hash.slice(0, 16), want: OLD.dry.slice(0, 16) });
    report('WT wet frame equals the pre-change wet hash', toWet.hash === OLD.wet, { got: toWet.hash.slice(0, 16), want: OLD.wet.slice(0, 16) });
    report('WT damp frame differs from dry and from wet', toDamp.hash !== toDry.hash && toDamp.hash !== toWet.hash, { damp: toDamp.hash.slice(0, 16) });
    report('WT no page or console errors', errors.length === 0, errors.slice(0, 3));
  } finally { await browser.close(); }
  console.log(failed ? 'WT FAILED' : 'all WT page checks passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
