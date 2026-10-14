// F3: the sealed-beam solver in the real page: it is listed, runs in the worker on the shipped example scenes, and the fluted lens / plain glass / bare
// paraboloid switch changes the design.   node tests/regress/F3-sealed-beam.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8723);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  const here = await page.evaluate(() => ({ app: !!RF.UI, port: location.port }));
  ok('page is the app on my port', here.app && here.port === String(port), JSON.stringify(here));
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: 120000 });
  ok('sealed-beam-v1 is a listed bundled solver', await page.evaluate(() => !!RF.Solvers.get('sealed-beam-v1')));
  for (const ex of ['sealed-beam-7in-low', 'sealed-beam-5.75in-low', 'sealed-beam-7in-high']) {
    const info = await page.evaluate(async (ex) => {
      const sc = RF.State.deserialize(await (await fetch('examples/' + ex + '.json')).text());
      RF.UI.loadScene(sc, ex);
      await new Promise((r) => setTimeout(r, 300));
      return { saved: RF.UI.store.scene.groups.A.surfaces.length, solver: RF.UI.store.scene.solve && RF.UI.store.scene.solve.id };
    }, ex);
    ok(ex + ': loads with its saved design (' + info.saved + ' surfaces) and the sealed-beam solver', info.saved > 100 && info.solver === 'sealed-beam-v1', JSON.stringify(info));
    const n = {};
    for (const lens of ['fluted', 'plain', 'none']) {                      // the worker run, through the host's verify
      await page.evaluate((lens) => { const sc = RF.UI.store.scene; sc.solverSettings = { 'sealed-beam-v1': Object.assign({}, sc.solve.settings, { lens, tune: false }) }; RF.UI.generateA(); }, lens);
      await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
      n[lens] = await page.evaluate(() => { const r = RF.UI.store.reports.A; return { n: RF.UI.store.scene.groups.A.surfaces.length, errors: r && r.facts ? r.facts.errors.length : -1, env: r && r.facts ? r.facts.violations.envelope.length : -1, by: r && r.solver && r.solver.id, bounces: RF.UI.store.scene.sim.bounces }; });
    }
    ok(ex + ': worker solve for fluted / plain / none verifies clean and the designs differ (flutes >> plain > none)',
      ['fluted', 'plain', 'none'].every((k) => n[k].errors === 0 && n[k].env === 0 && n[k].by === 'sealed-beam-v1') && n.fluted.n > 100 && n.plain.n < 10 && n.none.n < 5 && n.fluted.n > n.plain.n && n.plain.n > n.none.n && n.fluted.bounces >= 3, JSON.stringify(n));
  }
  // the tuner runs in the worker too (Spec mode: tools.trace({ spec: true }) from inside the solve)
  await page.evaluate(async () => { RF.UI.loadScene(RF.State.deserialize(await (await fetch('examples/sealed-beam-7in-low.json')).text()), 'tune'); await new Promise((r) => setTimeout(r, 300)); const sc = RF.UI.store.scene; sc.solverSettings = { 'sealed-beam-v1': Object.assign({}, sc.solve.settings, { lens: 'fluted', tune: true, tuneEvals: 6, tuneRays: 40000 }) }; RF.UI.generateA(); });
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 180000 });
  const tn = await page.evaluate(() => { const r = RF.UI.store.reports.A; return { notes: ((r && r.warnings) || []).join(' | '), n: RF.UI.store.scene.groups.A.surfaces.length, err: r && r.facts ? r.facts.errors.length : -1 }; });
  ok('tuner runs inside the worker (6 candidates, 40k rays) and returns a verified lens', tn.n > 100 && tn.err === 0 && /tuner: 7 traces/.test(tn.notes), tn.notes.slice(0, 200) + ' (' + tn.n + ' surfaces)');
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
