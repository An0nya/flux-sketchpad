// Set one extreme value through ui.setControl (the UI path), let the trace finish, scan footer/stats/feasibility/side text for NaN/Infinity/undefined.
const { boot } = require('./h.js');
const CASES = JSON.parse(process.argv[2] || 'null') || [
  ['A', [['env.hx', 1e-6]]], ['A', [['env.hx', 1e-6], ['env.hy', 1e-6], ['env.hz', 1e-6]]], ['A', [['tgt.dist', 1]]], ['A', [['tgt.size', 1]]], ['A', [['tgt.size', 1e12]]],
  ['A', [['tgt.dist', 1e12]]], ['A', [['src.power', 1e-9]]], ['A', [['src.power', 1e300]]], ['A', [['src.x', 1e12]]], ['A', [['src.w', 0.001], ['src.h', 0.001]]],
  ['A', [['src.w', 1e6]]], ['A', [['src.domeR', 1e6]]], ['A', [['src.domeR', 0.001]]], ['A', [['floor', 100]]], ['A', [['A.refl', 0]]], ['A', [['tgt.tiltX', 89], ['tgt.tiltY', -89]]],
  ['A', [['tgt.linked', false], ['aim.x', 0], ['aim.y', 0], ['aim.z', 0]]], ['A', [['src.kind', 'point']]], ['A', [['src.kind', 'volume']]], ['A', [['src.dist', 'cone'], ['src.half', 0.5]]],
  ['C', [['C.rim', 1e300]]], ['C', [['C.f', 0.01]]], ['C', [['C.n', 1]]], ['C', [['C.preset', 'cpc'], ['C.theta', 170]]], ['C', [['C.preset', 'ellipse'], ['C.depth', 0.01]]], ['C', [['C.sweep', 'extrude'], ['C.len', 0.01]]],
  ['D', [['src.power', 1e-9]]], ['D', [['tgt.dist', 1]]], ['D', [['env.hx', 1e-6]]],
];
(async () => {
  const { browser, page, errors } = await boot();
  const base = await page.evaluate(() => RF.State.serialize(RF.UI.store.scene));
  const results = [];
  for (const [mode, sets] of CASES) {
    errors.length = 0;
    const r = await page.evaluate(async ([mode, sets, base]) => {
      const ui = RF.UI; ui.setAuto("paint", false); ui.loadScene(RF.State.deserialize(base)); ui.setMode(mode);
      ui.store.scene.sim.rays = 20000;
      for (const [id, v] of sets) ui.setControl(id, v);
      ui.requestRun(false);
      const t0 = performance.now();
      while (performance.now() - t0 < 30000) { await new Promise((r) => setTimeout(r, 150)); if (ui.run && ui.run.ctx.done && !ui.solving && !ui.solveArmed) break; }
      await new Promise((r) => setTimeout(r, 400));
      const txt = (id) => (document.getElementById(id) || {}).textContent || '';
      const hay = { footer: txt('footer'), stats: txt('stats'), feas: txt('feasibility'), side: txt('side'), status: txt('status') };
      const hits = {}; for (const [k, v] of Object.entries(hay)) { const m = v.match(/.{0,40}\b(NaN|Infinity|undefined|null)\b.{0,30}/g); if (m) hits[k] = m.slice(0, 4); }
      return { mode: ui.store.scene.mode, done: !!(ui.run && ui.run.ctx.done), hits, footer: hay.footer.replace(/\s+/g, ' ').slice(0, 260) };
    }, [mode, sets, base]);
    results.push({ mode, sets, ...r, errors: errors.slice(0, 3) });
    console.log(mode, JSON.stringify(sets), 'done=' + r.done, Object.keys(r.hits).length ? 'HITS ' + JSON.stringify(r.hits) : '', errors.length ? 'ERR ' + errors.slice(0, 2).join(' | ').slice(0, 300) : '');
  }
  require('fs').writeFileSync('probe2_downstream.json', JSON.stringify(results, null, 1));
  await browser.close();
})();
