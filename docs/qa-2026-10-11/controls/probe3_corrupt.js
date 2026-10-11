// Corrupt the autosave key (and a few UI-pref keys) by hand, reload, see if the app boots.
const { boot } = require('./h.js');
const K = 'faceted-reflector-demo/scene/v1';
const CASES = [
  ['not JSON', { [K]: '{garbage' }],
  ['JSON null', { [K]: 'null' }],
  ['JSON number', { [K]: '42' }],
  ['empty object', { [K]: '{}' }],
  ['mode Z', { [K]: JSON.stringify({ mode: 'Z' }) }],
  ['source null', { [K]: JSON.stringify({ source: null }) }],
  ['target.res string', { [K]: JSON.stringify({ target: { res: 'abc' } }) }],
  ['target.res 0', { [K]: JSON.stringify({ target: { res: 0 } }) }],
  ['sim.rays NaN-ish', { [K]: JSON.stringify({ sim: { rays: 'lots' } }) }],
  ['source.pos short', { [K]: JSON.stringify({ source: { pos: [1] } }) }],
  ['groups.A null', { [K]: JSON.stringify({ groups: { A: null } }) }],
  ['groups.A.surfaces junk', { [K]: JSON.stringify({ groups: { A: { surfaces: [{ type: 'facet' }] } } }) }],
  ['modeB.stamps null', { [K]: JSON.stringify({ modeB: { stamps: null } }) }],
  ['lenses obj', { [K]: JSON.stringify({ lenses: {} }) }],
  ['envelope.half null', { [K]: JSON.stringify({ envelope: { half: null } }) }],
  ['modeD junk', { [K]: JSON.stringify({ mode: 'D', modeD: 'x' }) }],
  ['flux/layout junk', { 'flux/layout': '{"panes":5}' }],
  ['flux/layout str', { 'flux/layout': '"hi"' }],
  ['flux/ffView junk', { 'flux/ffView': '{"view":"zzz","scale":"x"}' }],
  ['flux/patterns junk', { 'flux/patterns': '[1,2,3]' }],
  ['flux/rayPaths junk', { 'flux/rayPaths': 'abc' }],
  ['flux/solverChoice bogus', { 'flux/solverChoice': 'no-such-solver' }],
  ['flux/solvers junk', { 'flux/solvers': '{"a":1}' }],
  ['flux/autoSolve junk', { 'flux/autoSolve': '"x"' }],
];
(async () => {
  const pwb = await require('./h.js').pw.chromium.launch();
  for (const [name, ls] of CASES) {
    let res;
    try {
      const { ctx, page, errors } = await boot({ browser: pwb, ls, noWait: 6000 });
      res = await page.evaluate(() => { const be = document.getElementById('boot-error'); return { bootErr: be && !be.hidden ? be.textContent.slice(0, 160) : null, store: !!(window.RF && RF.UI && RF.UI.store), mode: RF.UI && RF.UI.store && RF.UI.store.scene.mode, notice: RF.UI && RF.UI.store && RF.UI.store.notices[0] && RF.UI.store.notices[0].msg.slice(0, 90), side: (document.getElementById('side') || {}).children ? document.getElementById('side').children.length : -1 }; });
      // second reload: does it stay broken?
      await page.reload(); await page.waitForTimeout(5000);
      res.after2 = await page.evaluate(() => { const be = document.getElementById('boot-error'); return be && !be.hidden ? 'BOOT-ERROR' : 'ok'; });
      res.errors = errors.slice(0, 2).map((e) => e.slice(0, 200));
      await ctx.close();
    } catch (e) { res = { harness: String(e).slice(0, 200) }; }
    console.log(name.padEnd(26), JSON.stringify(res));
  }
  await pwb.close();
})();
