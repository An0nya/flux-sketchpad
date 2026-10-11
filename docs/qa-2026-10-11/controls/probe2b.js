// Per case: fresh page, set extreme values through ui.setControl (UI path), wait for trace, scan text for NaN/Infinity. Detects hangs.
const { boot, pw } = require('./h.js');
const CASES = JSON.parse(process.argv[2]);
(async () => {
  const browser = await pw.chromium.launch();
  for (const [mode, sets] of CASES) {
    const { ctx, page, errors } = await boot({ browser });
    const t0 = Date.now();
    const p = page.evaluate(async ([mode, sets]) => {
      const ui = RF.UI; ui.setMode(mode); ui.store.scene.sim.rays = 20000;
      for (const [id, v] of sets) ui.setControl(id, v);
      ui.requestRun(false);
      const t0 = performance.now();
      while (performance.now() - t0 < 30000) { await new Promise((r) => setTimeout(r, 150)); if (ui.run && ui.run.ctx.done && !ui.solving && !ui.solveArmed) break; }
      await new Promise((r) => setTimeout(r, 400));
      const txt = (id) => (document.getElementById(id) || {}).textContent || '';
      const hay = { stats: txt('stats'), feas: txt('feasibility'), side: txt('side'), footer: txt('footer') };
      const hits = {}; for (const [k, v] of Object.entries(hay)) { const m = v.match(/.{0,50}\b(NaN|Infinity|undefined)\b.{0,20}/g); if (m) hits[k] = [...new Set(m)].slice(0, 4); }
      return { mode: ui.store.scene.mode, done: !!(ui.run && ui.run.ctx.done), hits };
    }, [mode, sets]);
    const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ HANG: true }), 60000))]);
    console.log(mode, JSON.stringify(sets), ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(r), errors.length ? 'ERR ' + [...new Set(errors)].slice(0, 2).join(' | ').slice(0, 300) : '');
    await ctx.close().catch(() => {});
  }
  await browser.close();
})();
