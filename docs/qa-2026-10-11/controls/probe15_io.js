// Save to disk → Open from disk round trip; then bad files through the file input; snapshot save/restore.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => { RF.UI.setControl('A.budget', 222); RF.UI.setControl('src.domeR', 1.5); RF.UI.setControl('tgt.linked', false); RF.UI.setControl('aim.y', 33); });
  const before = await page.evaluate(() => RF.History.key(RF.History.intent(RF.UI.store.scene)));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Save to disk')]);
  const path = 'files/roundtrip.json'; await dl.saveAs(path);
  await page.evaluate(() => RF.UI.setControl('A.budget', 5));
  await page.setInputFiles('#file-input', path); await page.waitForTimeout(1500);
  const after = await page.evaluate(() => RF.History.key(RF.History.intent(RF.UI.store.scene)));
  console.log('round trip intent equal:', before === after, 'budget', await page.evaluate(() => RF.UI.store.scene.modeA.budget), 'notice', await page.evaluate(() => RF.UI.store.notices[0].msg));
  if (before !== after) { const a = JSON.parse(before), b = JSON.parse(after); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  differs:', k, JSON.stringify(a[k]).slice(0, 150), '|', JSON.stringify(b[k]).slice(0, 150)); }
  for (const f of ['garbage', 'array', 'modeZ', 'lensesobj']) {
    errors.length = 0;
    const pre = await page.evaluate(() => RF.UI.store.scene.modeA.budget);
    await page.setInputFiles('#file-input', 'files/' + f + '.json'); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, budget: RF.UI.store.scene.modeA.budget, notice: RF.UI.store.notices[0] && RF.UI.store.notices[0].msg.slice(0, 100), modeTabs: [...document.querySelectorAll('.modes button[aria-selected=true]')].map((b) => b.dataset.mode), ls: (() => { try { return JSON.parse(localStorage.getItem('faceted-reflector-demo/scene/v1')).mode; } catch (e) { return 'unparsable'; } })() }));
    console.log(f.padEnd(10), 'budget before', pre, JSON.stringify(r), 'errors', [...new Set(errors)].slice(0, 2).map((e) => e.slice(0, 120)));
    // does a follow-up interaction work?
    const ok = await page.evaluate(() => { try { RF.UI.setControl('A.budget', 77); return 'setControl ok, budget=' + RF.UI.store.scene.modeA.budget; } catch (e) { return 'setControl threw ' + e.message; } });
    console.log('           follow-up:', ok);
    await page.waitForTimeout(1200);
    console.log('           autosaved mode now:', await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('faceted-reflector-demo/scene/v1')).mode; } catch (e) { return 'unparsable'; } }));
    await page.evaluate(() => { RF.UI.loadScene(RF.State.defaultScene()); }).catch((e) => console.log('reset failed', String(e).slice(0, 100)));
  }
  await browser.close();
})();
