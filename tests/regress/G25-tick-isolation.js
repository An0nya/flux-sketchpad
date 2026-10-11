// G25: a draw error must not kill the run loop (trace stalls part-way, status frozen), and a facet selection left over from
// before a re-solve must not crash the Result overlay.
// node tests/regress/G25-tick-isolation.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8829);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 120000 });
  ok('page identified as the app', await page.evaluate(() => !!RF.UI));

  // 1. injected draw error: the trace still finishes and the status line leaves "tracing"
  await page.evaluate(() => { window.__gc = RF.Render2D.gridCanvas; RF.Render2D.gridCanvas = () => { throw new Error('injected draw error'); }; });
  await page.evaluate(() => { RF.UI.store.invalidate(['A']); RF.UI.requestRun(false); RF.UI.generateA(); });
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 10000 });           // the solve starts, ends, and its result is traced
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 90000 });
  try { await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 40000 }); } catch (e) { /* reported below */ }
  await page.waitForTimeout(500);
  const st1 = await page.evaluate(() => ({ solving: !!RF.UI.solving, done: !!(RF.UI.run && RF.UI.run.ctx.done), next: RF.UI.run && RF.UI.run.ctx.next, N: RF.UI.run && RF.UI.run.ctx.N, status: document.getElementById('run-state').textContent, raf: RF.UI.raf }));
  ok('with a throwing draw the solve and the trace still finish', st1.done && !st1.solving, JSON.stringify(st1));
  ok('and the status line is not frozen on "Solving" / "tracing"', !/Solving|tracing/i.test(st1.status), st1.status);
  await page.evaluate(() => { RF.Render2D.gridCanvas = window.__gc; });
  await page.evaluate(() => { RF.UI.sceneDirty = true; RF.UI.requestRun(false); });
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(500);

  // 2. a selected facet that is gone after a re-solve
  const errs0 = errors.length;
  await page.evaluate(() => { const fs = RF.UI.store.scene.groups.A.surfaces; RF.UI.select({ kind: 'facet', id: fs[fs.length - 1].id }); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { RF.UI.setControl('A.budget', 10); RF.UI.generateA(); });
  await page.waitForFunction(() => !RF.UI.solving && !RF.UI.solveArmed, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  const st2 = await page.evaluate(() => ({ status: document.getElementById('run-state').textContent, done: !!(RF.UI.run && RF.UI.run.ctx.done), sel: RF.UI.sel }));
  ok('stale selection after a re-solve: no page error', errors.length === errs0, errors.slice(errs0).join(' | ').slice(0, 300));
  ok('and the trace finished with a settled status', st2.done && !/Solving|tracing/i.test(st2.status), JSON.stringify(st2));
  await browser.close(); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
