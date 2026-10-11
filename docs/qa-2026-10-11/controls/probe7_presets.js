// Preset chain through the real UI (select + confirm button). After each preset, compare the scene intent + solver + display
// with the same preset applied on a fresh page. Any difference = state leaking from the previous preset.
const { boot, pw } = require('./h.js');
const NAMES = ['headlamp', 'spec-box', 'spec-slim', 'spec-module', 'spec-sealed7', 'deepbox', 'stamps', 'parabola', 'cpc', 'lenscup', 'tir', 'fresnel'];
async function applyPreset(page, name) {
  await page.selectOption('#preset-select', name);
  await page.click('#preset-confirm button.primary');
  await page.waitForTimeout(300);
  return page.evaluate(() => { const sc = RF.UI.store.scene, it = RF.History.intent(sc); delete it.modeA.paint;
    return { key: RF.History.key(it), mode: sc.mode, solver: RF.Solvers.current(sc), display: RF.UI.display, groupsEnabled: Object.fromEntries(Object.entries(sc.groups).map(([k, g]) => [k, g.enabled])), paintSum: sc.modeA.paint.reduce((a, b) => a + b, 0).toFixed(3), res: sc.target.res, sel: document.getElementById('preset-select').value }; });
}
function diff(a, b, p = '') { const out = []; if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p + ': ' + JSON.stringify(a).slice(0, 60) + ' vs fresh ' + JSON.stringify(b).slice(0, 60)); return out; } for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diff(a[k], b[k], p + '.' + k)); return out; }
(async () => {
  const browser = await pw.chromium.launch();
  const fresh = {};
  for (const n of NAMES) { const { ctx, page } = await boot({ browser }); fresh[n] = await applyPreset(page, n); await ctx.close(); }
  const seqs = [NAMES, NAMES.slice().reverse(), ['spec-box', 'stamps', 'spec-sealed7', 'cpc', 'headlamp', 'tir', 'deepbox', 'fresnel', 'spec-slim', 'lenscup', 'parabola', 'spec-module']];
  for (const seq of seqs) {
    const { ctx, page, errors } = await boot({ browser });
    // dirty the state first: mode D, edit a few controls
    await page.evaluate(() => { RF.UI.setMode('D'); RF.UI.setControl('bounces', 7); RF.UI.setControl('A.budget', 333); });
    for (const n of seq) {
      const got = await applyPreset(page, n);
      const f = fresh[n];
      const d = diff({ mode: got.mode, solver: got.solver, display: got.display, en: got.groupsEnabled, paint: got.paintSum, res: got.res }, { mode: f.mode, solver: f.solver, display: f.display, en: f.groupsEnabled, paint: f.paintSum, res: f.res });
      if (got.key !== f.key) { const a = await page.evaluate(() => { const it = RF.History.intent(RF.UI.store.scene); delete it.modeA.paint; return it; }); d.push('INTENT differs'); got._it = a; }
      if (d.length) console.log('after', seq[seq.indexOf(n) - 1] || '(edited start)', '→', n, ':', d.join(' | '));
    }
    console.log('seq done, errors:', [...new Set(errors)].slice(0, 3));
    await ctx.close();
  }
  await browser.close();
})();
