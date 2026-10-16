/* Shared assertions: standalone Playwright test and the owner's existing runner execute the same page code. */
window.qol1Checks = async function (mode, expectedPort) {
  const checks = [], ui = RF.UI, wait = async (fn, ms = 30000) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) throw new Error('Timed out: ' + fn); await new Promise(r => setTimeout(r, 40)); } };
  const ok = (name, cond, detail) => { checks.push({ name, pass: !!cond, detail }); console.log((cond ? '[PASS] ' : '[FAIL] ') + 'QOL1 ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); };
  ok('page identity', RF.UI && location.port === String(expectedPort), { port: location.port });
  if (mode === 'safe') {
    await new Promise(r => setTimeout(r, 500));
    ok('unfinished boot suppresses trace and solve; visible reset', ui.safeMode && !ui.run && !ui.solving && !ui.solveSeq && ui.store.scene.sim.rays <= 100000 && !document.getElementById('safe-banner').hidden);
    document.getElementById('safe-retry').click(); await wait(() => ui.run && ui.run.ctx.done && !ui.bootPending);
    ok('Try again traces capped design and clears guard', !ui.safeMode && localStorage.getItem('flux/booting') === null && !ui.solveSeq, { N: ui.run.ctx.N, marker: localStorage.getItem('flux/booting'), bootPending: ui.bootPending });
  } else if (mode === 'phone') {
    await wait(() => ui.run && ui.run.ctx.done);
    ok('automatic coarse-pointer trace capped even with saved override off', ui.store.scene.sim.rays === 4000000 && ui.run.ctx.N <= 150000, { N: ui.run.ctx.N, mobile: RF.GpuTrace.rayLimit().mobile });
    let confirms = 0; const savedConfirm = window.confirm; window.confirm = () => { confirms++; return false; };
    try { document.getElementById('btn-trace').click(); } finally { window.confirm = savedConfirm; }
    ok('explicit large phone trace asks and cancellation keeps completed run', confirms === 1 && ui.run.ctx.done && ui.run.ctx.N <= 150000);
    window.confirm = () => { confirms++; return true; }; try { document.getElementById('btn-trace').click(); } finally { window.confirm = savedConfirm; }
    await wait(() => ui.run && ui.run.ctx.N === 4000000);
    ok('confirmed explicit trace can exceed automatic phone cap', confirms === 2 && ui.run.ctx.N === 4000000);
  } else if (mode === 'reload') {
    await wait(() => ui.run && ui.run.ctx.done);
    ok('saved geometry is retained and no solve runs', !ui.solveSeq && !ui.solving && !ui.store.reports.A && JSON.stringify(ui.store.scene.groups.A.surfaces) === window.qolSavedGeometry);
    ui.store.scene.solve = { id: 'spoke' }; document.getElementById('btn-generate-top').click(); await wait(() => ui.store.reports.A && ui.run && ui.run.ctx.done);
    ok('explicit Rebuild recomputes the solver report', ui.store.reports.A.solver.id === 'spoke');
  } else if (mode === 'features') {
    document.getElementById('guide-close').click(); document.getElementById('btn-help').click();
    ok('guide dismisses, remembers and reopens', localStorage.getItem('flux/guideSeen') === '1' && !document.getElementById('first-guide').hidden); document.getElementById('guide-close').click();
    for (const name of ['starter-low', 'starter-high']) {
      const sel = document.getElementById('preset-select'); sel.value = name; sel.dispatchEvent(new Event('change'));
      document.querySelector('#preset-confirm .primary').click(); await wait(() => ui.store.scene.name === (name === 'starter-low' ? 'Starter low beam' : 'Starter high beam'));
      await wait(() => ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full);
      ui.setDisplay('drive'); ui.setPane('result', 'activate'); await wait(() => RF.DriveAnim._.V.info && ui.driveShown);
      ok(name + ' loads saved optics and renders Drive without solving', ui.store.scene.groups.A.surfaces.length > 0 && !ui.solveSeq && ui.driveShown.res.rgb.some(v => v > 0), { facets: ui.store.scene.groups.A.surfaces.length, verdict: ui.spec.ev.verdict });
    }
    const original = await RF.StarterLamps.load('starter-low'); ui.loadScene(original.scene, 'QOL1 player low'); await wait(() => ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full); ui.setDisplay('drive');
    const before = RF.State.serialize(ui.store.scene); document.querySelector('[data-game=toggle]').click();
    document.querySelector('[data-game=lamp]').value = 'starter-high'; document.querySelector('[data-game=acceleration]').value = 'gentle'; document.querySelector('[data-game=start]').click();
    await wait(() => ui.dvAnim.game && ui.dvAnim.gameLamp); ui.dvAnim.playing = false; ui.redrawSpec();
    ok('game starter high runs without replacing design', ui.dvAnim.game.highBeam && !ui.dvAnim.game.done && RF.State.serialize(ui.store.scene) === before);
    const g = ui.dvAnim.game; g.next = 1e9; g.v = 0; g.resume = 0; g.t = 0; g.x = 0; g.hazards = []; const _ = RF.DriveAnim._; ui.dvOpts.lampPitch = true; ui.redrawSpec();
    _.advanceCamera(ui.dvAnim, 1);
    ok('page game accelerates gently and P2 gets actual acceleration', Math.abs(g.v - 2.5) < 1e-6 && Math.abs(g.x - 1.25) < 1e-6 && Math.abs(ui.dvAnim.acceleration - 2.5) < 1e-6 && ui.dvAnim.pitch.angle > 0 && ui.dvAnim.pitch.angle < Math.PI / 180, { v: g.v, x: g.x, acceleration: ui.dvAnim.acceleration, pitchRad: ui.dvAnim.pitch && ui.dvAnim.pitch.angle });
    g.done = true; ui.redrawSpec(); document.querySelector('[data-game=lamp]').value = 'your'; document.querySelector('[data-game=start]').click();
    await wait(() => ui.dvAnim.game && ui.dvAnim.game !== g);
    ok('Run again can switch from starter high back to your lamp', !ui.dvAnim.gameLamp && !ui.dvAnim.game.done && !ui.dvAnim.game.highBeam && RF.State.serialize(ui.store.scene) === before);
    document.querySelector('[data-game=toggle]').click();
    ok('exit restores player design and game lamp is released', !ui.dvAnim.gameMode && !ui.dvAnim.gameLamp && RF.State.serialize(ui.store.scene) === before);
    const pick = document.querySelector('[data-dv=onMode]'); pick.value = 'high-dip'; pick.dispatchEvent(new Event('change'));
    const scene = RF.Drive.buildScene('road', { Lw: 3.5 }, { oncoming: { dist: 80, kcd: 30 } });
    RF.Drive.Headlamp.apply(scene.objects, { mode: 'high' }); const high = RF.Drive.glareSources(scene.objects).reduce((s, q) => s + q[3], 0);
    RF.Drive.Headlamp.apply(scene.objects, { mode: 'high-dip', seed: 7 }); const dipped = RF.Drive.glareSources(scene.objects).reduce((s, q) => s + q[3], 0);
    ok('dipping changes actual rendered headlamp emitters', dipped < high, { highEyeLux: high, dippedEyeLux: dipped });
    ok('seeded dip and static high remain selectable', ui.dvOpts.onMode === 'high-dip' && !!pick.querySelector('option[value=high]'));
    ui.dvOpts.oncoming = true; ui.redrawSpec();
  }
  return checks;
};
