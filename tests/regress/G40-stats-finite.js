// G40 regression (Playwright): node tests/regress/G40-stats-finite.js [port]
// The statistics and limits text never prints NaN / Infinity / a share over 100 %: default scene (hot zone row), a point source (ceiling row), Profile focal 0.01 mm (occlusion).  Needs: python3 tests/serve.py 8830
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8830);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), errors = [];
  for (const [label, mode, sets] of [['default scene', 'A', []], ['point source', 'A', [['src.kind', 'point']]], ['Profile focal 0.01 mm', 'C', [['C.f', 0.01]]]]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 150000 });
    ok(label + ': page identifies as the Flux app (RF.UI exists)', await page.evaluate(() => !!(RF.UI && RF.UI.setMode && RF.Panels)));
    await page.evaluate(([mode, sets]) => { RF.UI.setMode(mode); RF.UI.store.scene.sim.rays = 50000; for (const [id, v] of sets) RF.UI.setControl(id, v); }, [mode, sets]);
    await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done && !RF.UI.solving, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    const t = await page.evaluate(() => ['stats', 'feasibility', 'min-row'].map((id) => (document.getElementById(id) || {}).textContent || '').join('\n'));
    const bad = (t.match(/[^\n]{0,40}(NaN|Infinity)[^\n]{0,20}/g) || []).slice(0, 3), over = (t.match(/[^\n]{0,30}\b\d{3,}(\.\d)?%[^\n]{0,10}/g) || []).filter((x) => /block|occlu|shadow|lost|worst/i.test(x) && (x.match(/\b(\d{3,}(?:\.\d)?)%/g) || []).some((n) => parseFloat(n) > 100)).slice(0, 3);
    ok(label + ': no NaN / Infinity text', bad.length === 0, bad.join(' | '));
    ok(label + ': no occlusion share over 100 %', over.length === 0, over.join(' | '));
    if (label === 'default scene') { const hot = await page.evaluate(() => { const g = RF.UI.goal; return g && g.kind; }); console.log('       (goal kind: ' + hot + ')'); }
    await page.close();
  }
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
