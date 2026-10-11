// D-S03 / D-S16 / D-S18 regression (Playwright): node tests/regress/D-spec-decisions.js [port]   Needs: python3 tests/serve.py 8827
//  D-S03: new scene measures at ∞; Road / beam quality / goals read the far field, so they do not move with "Measure at"
//  D-S16: a live judgement (trace still running) searches for no aim: it holds the last finished judgement's aim, else the design aim
//  D-S18: beam quality and the ideal-beam goals ignore the Road's "Aim on the car" (they are measured at the judge's aim)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8827);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
  ok('page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.SpecUI && RF.Road)));
  ok('D-S03 a new scene measures at the far field (distance 0)', await page.evaluate(() => RF.UI.store.scene.modeD.distance === 0));
  await page.evaluate(() => RF.UI.setMode('D'));
  await page.waitForFunction(() => { const ui = RF.UI; return ui.store.scene.mode === 'D' && !ui.solving && ui.run && ui.run.ctx.done && ui.spec && ui.spec.ctx === ui.run.ctx && ui.spec.full && ui.spec.ev; }, null, { timeout: 180000, polling: 500 });

  // D-S03: design aim (so the shift is 0 whatever the grid), then the road at each Measure at
  const rs = await page.evaluate(() => {
    const ui = RF.UI, md = ui.store.scene.modeD, out = {}; md.aimMode = 'design';
    for (const d of [0, 25000, 10000]) {
      md.distance = d; const s = RF.SpecUI.update(ui, true); s.road = null; const rd = RF.SpecUI.roadModel(ui);
      out[d] = { right: rd.iihs.right, left: rd.iihs.left, farRight: rd.iihs.farRight, farLeft: rd.iihs.farLeft, lux: rd.mdl.lux([60, -1.65, 0.25]), gDist: String(s.G.distance), gfDist: String((s.Gf || {}).distance), q: JSON.stringify(rd.quality), ideal: JSON.stringify(rd.ideal) };
    }
    md.distance = 0; return out;
  });
  ok('D-S03 the judged grid follows Measure at but the road grid is always the far field', rs[25000].gDist === '25000' && rs[10000].gDist === '10000' && rs[25000].gfDist === 'Infinity' && rs[10000].gfDist === 'Infinity', JSON.stringify([rs[25000].gDist, rs[25000].gfDist]));
  ok('D-S03 road reach / lux do not change with Measure at', ['right', 'left', 'farRight', 'farLeft', 'lux'].every((k) => rs[0][k] === rs[25000][k] && rs[0][k] === rs[10000][k]), JSON.stringify([rs[0].right, rs[25000].right, rs[10000].right, rs[0].lux, rs[25000].lux, rs[10000].lux]));
  ok('D-S03 beam quality and goals do not change with Measure at', rs[0].q === rs[25000].q && rs[0].q === rs[10000].q && rs[0].ideal === rs[25000].ideal && rs[0].ideal === rs[10000].ideal);

  // D-S18: the Road's manual aim moves the road, not beam quality / goals
  const aimR = await page.evaluate(() => {
    const ui = RF.UI, md = ui.store.scene.modeD; md.aimMode = 'cutoff'; md.distance = 0; RF.SpecUI.update(ui, true);
    const get = (road) => { md.road = Object.assign(RF.Road.defaults(), road); ui.spec.road = null; const rd = RF.SpecUI.roadModel(ui); return { sh: rd.sh, right: rd.iihs.right, lux: rd.mdl.lux([40, -1.65, 0.25]), q: JSON.stringify(rd.quality), ideal: JSON.stringify(rd.ideal) }; };
    return { spec: get({ aim: 'spec' }), man: get({ aim: 'manual', aimPct: -3 }) };
  });
  ok('D-S18 the manual aim really moved the road (test has teeth)', aimR.spec.sh[1] !== aimR.man.sh[1] && aimR.spec.lux !== aimR.man.lux, JSON.stringify([aimR.spec.sh, aimR.man.sh, aimR.spec.lux, aimR.man.lux]));
  ok('D-S18 beam quality is the same at either Road aim', aimR.spec.q === aimR.man.q);
  ok('D-S18 ideal-beam goals are the same at either Road aim', aimR.spec.ideal === aimR.man.ideal);

  // D-S16: a live judgement holds the finished aim (or the design aim), never searches
  const lv = await page.evaluate(() => {
    const ui = RF.UI, sc = ui.store.scene, md = sc.modeD, c = ui.run.ctx, real = RF.Spec.evaluate, calls = [];
    md.aimMode = 'cutoff'; md.distance = 0; md.road = RF.Road.defaults();
    const fin = RF.SpecUI.update(ui, true), finAim = fin.ev.aim.base.slice(), finShift = fin.ev.shift.slice();
    RF.Spec.evaluate = function (G, m, o) { calls.push(o ? Object.keys(o).join(',') : 'full'); return real.apply(this, arguments); };
    let live1, live0;
    try {
      c.done = false;                                   // as if the trace were still running
      live1 = RF.SpecUI.update(ui, true);
      const keep = ui._specFinal; ui._specFinal = null; live0 = RF.SpecUI.update(ui, true); ui._specFinal = keep;
    } finally { c.done = true; RF.Spec.evaluate = real; }
    return { calls, finAim, finShift, live1Aim: live1.ev.aim.base, live1Shift: live1.ev.shift, live1Note: live1.ev.aim.note, live0Aim: live0.ev.aim.base, live0Note: live0.ev.aim.note, cut: fin.ev.aim.cutV };
  });
  ok('D-S16 the full judgement before the trace found a real aim (test has teeth)', Math.abs(lv.finAim[1]) > 0.01 || Math.abs(lv.finAim[0]) > 0.01, JSON.stringify(lv.finAim));
  ok('D-S16 live judgements only ever ran with a frozen aim (no aim search, no noBox)', lv.calls.length >= 2 && lv.calls.slice(1).every((x) => x === 'frozen'), JSON.stringify(lv.calls));
  ok('D-S16 live judgement holds the last finished aim', lv.live1Aim[0] === lv.finAim[0] && lv.live1Aim[1] === lv.finAim[1] && /held while the trace runs/.test(lv.live1Note), JSON.stringify([lv.live1Aim, lv.live1Note]));
  ok('D-S16 with no finished judgement the live aim is the design aim [0,0], and says so', lv.live0Aim[0] === 0 && lv.live0Aim[1] === 0 && /design aim/.test(lv.live0Note), JSON.stringify([lv.live0Aim, lv.live0Note]));
  const after = await page.evaluate(() => { const ui = RF.UI; ui.run.ctx.done = true; const s = RF.SpecUI.update(ui, true); return { full: s.full, note: s.ev.aim.note }; });
  ok('D-S16 the finished run is judged fully again (re-aims once)', after.full && !/held while/.test(after.note), JSON.stringify(after));
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
