const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  const openSec = () => page.evaluate(() => { let e = document.getElementById('group-list'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  const G = () => page.evaluate(() => { const sc = RF.UI.store.scene; const o = {}; for (const [k, g] of Object.entries(sc.groups)) o[k] = (g.enabled ? 'on' : 'off') + ':' + g.surfaces.length; return { mode: sc.mode, groups: o, stamps: sc.modeB.stamps.length, prof: sc.modeC.profile.length, lenses: sc.lenses.length, past: RF.UI.hist.past.slice(-1).map((e) => e.label), sel: RF.UI.profSel }; });
  const clear = async (k) => { await openSec(); const idx = ['A', 'B', 'C', 'L', 'M'].indexOf(k); for (let i = 0; i < 2; i++) { const b = await page.evaluateHandle((idx) => document.querySelectorAll('#group-list .item')[idx].querySelector('button'), idx); await b.click(); await page.waitForTimeout(150); } await page.waitForTimeout(400); };
  for (const [preset, g] of [['stamps', 'B'], ['parabola', 'C'], ['tir', 'L']]) {
    await L.loadPreset(page, preset); await page.waitForTimeout(800);
    console.log(preset, 'before', JSON.stringify(await G()));
    await clear(g); console.log(preset, 'after clear ' + g, JSON.stringify(await G()));
    await page.click('#btn-undo'); await page.waitForTimeout(600);
    console.log(preset, 'after undo', JSON.stringify(await G()), await page.evaluate(() => document.getElementById('toast').textContent));
  }
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
