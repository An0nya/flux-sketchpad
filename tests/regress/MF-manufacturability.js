// MF: real Optics controls, pixels in Canvas/GL, invalid settings, F5 selection, rebuild and scene immutability.
// Tester only: python3 tests/serve.py 8747; node tests/regress/MF-manufacturability.js 8747
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8747);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }), page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), errors = [];
  try {
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
    const idle = () => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA && RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 180000 });
    await idle();
    ok('MF page identifies RF.UI and port ' + port, await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
    ok('MF overlay defaults off, panel hidden, no measurements paid for', await page.evaluate(() => !document.getElementById('mf-on').checked && document.getElementById('mf-panel').hidden && !RF.UI.mfResult));
    await page.evaluate(() => {
      const s = RF.State.testScene(); s.mode = 'B'; s.modeB.stamps = []; s.groups.A.surfaces = []; s.sim.rays = 2000;
      s.source.pos = [0, 60, 0]; s.source.axis = [0, 0, 1]; s.groups.M.enabled = true;
      s.groups.M.surfaces = [
        { type: 'plane', id: 'MF-flat', P: [-16, 0, 0], n: [0, 0, 1], clip: { kind: 'rect', hx: 4, hy: 4, ref: [1, 0, 0] } },
        { type: 'plane', id: 'MF-back', P: [0, 0, 0], n: [0, 0, -1], clip: { kind: 'rect', hx: 4, hy: 4, ref: [1, 0, 0] } },
        { type: 'quad', id: 'MF-sphere', P: [16, 0, 0], n: [0, 0, 1], curv: [0.1, 0.1, 0, 0.1], clip: { kind: 'disc', r: 4 } },
      ];
      RF.UI.setAuto('paint', false); RF.UI.setAuto('settings', false); RF.UI.loadScene(s, 'MF known shapes');
      RF.RenderGL.setPref(false); RF.UI.orbitFirst = false; RF.UI.orbitIdle = Infinity;
      RF.UI.opticsSetup = false; RF.UI.opticsEnv = false;
    });
    await idle();
    const before = await page.evaluate(() => RF.State.serialize(RF.UI.store.scene));
    await page.check('#mf-on'); await page.waitForFunction(() => RF.UI.mfResult && RF.UI.mfResult.summary.surfaces === 3);
    ok('MF known shapes appear in legend/summary and undercut list', await page.evaluate(() => !document.getElementById('mf-panel').hidden && /1\/mm/.test(document.getElementById('mf-legend').textContent) && RF.UI.mfResult.summary.undercutSurfaces === 1 && RF.UI.mfResult.surfaces.find((r) => r.id === 'MF-back').undercut));
    // Screenshot pixels include the GL underlay (getImageData on surface-canvas alone would miss it).
    const pixels = async () => {
      await page.evaluate(() => { const u = RF.UI; document.getElementById('mf-panel').hidden = true; u.camS.setAngles(0, 90); u.camS.focal = Infinity; u.camS.center = [0, 0, 0]; u.camS.pan = [0, 0]; u.camS.scale = 4; u.camS.fitted = true; u.camS.holdFit = true; u.sceneDirty = true; u.redrawSpec(); });
      await page.waitForTimeout(300);
      const b64 = (await page.locator('#surface-canvas').screenshot()).toString('base64');
      const data = await page.evaluate(async (b64) => {
        const image = new Image(); image.src = 'data:image/png;base64,' + b64; await image.decode();
        const cv = document.createElement('canvas'); cv.width = image.width; cv.height = image.height; const ctx = cv.getContext('2d'); ctx.drawImage(image, 0, 0);
        const u = RF.UI, box = document.getElementById('surface-canvas').getBoundingClientRect();
        return ['MF-flat', 'MF-sphere', 'MF-back'].map((id) => { const s = u.store.scene.groups.M.surfaces.find((s) => s.id === id), pt = u.camS.project(s.P), x = Math.round(pt[0] * cv.width / box.width), y = Math.round(pt[1] * cv.height / box.height); return { id, rgb: [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3) }; });
      }, b64);
      await page.evaluate(() => { document.getElementById('mf-panel').hidden = false; }); return data;
    };
    const canvas = await pixels(), near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
    ok('MF Canvas actually paints plane navy and sphere yellow from analytic curvature', near(canvas[0].rgb, [0, 32, 77]) && near(canvas[1].rgb, [255, 234, 70]), JSON.stringify(canvas));
    await page.evaluate(() => { RF.RenderGL.setPref(true); RF.UI.sceneDirty = true; RF.UI.redrawSpec(); });
    const gl = await pixels();
    const activeGL = await page.evaluate(() => { const info = RF.RenderGL.info(document.getElementById('surface-canvas')); return !!info && info.canvas.style.display !== 'none' && !RF.RenderGL.failure(); });
    ok('MF WebGL is active and actual facet colours match Canvas', activeGL && gl.every((v, i) => near(v.rgb, canvas[i].rgb)), JSON.stringify(gl));
    // Metric changes must invalidate uploaded GL styles; pairs must still show measured fills.
    await page.selectOption('#mf-metric', 'draft'); await page.selectOption('[data-control-view="surfaceView"]', 'pairs');
    const draft = await pixels();
    ok('MF metric switch updates GL buffers; negative-draft back face stays filled in pairs mode', near(draft[2].rgb, [0, 32, 77]) && !near(draft[0].rgb, canvas[0].rgb), JSON.stringify(draft));
    const old = await page.evaluate(() => { window.__mfResult = RF.UI.mfResult; return RF.UI.mfResult.summary.sampledPoints; });
    await page.evaluate(() => { RF.UI.camS.scale *= 1.05; RF.UI.camS.pan[0] += 2; RF.UI.sceneDirty = true; RF.UI.redrawSpec(); }); await page.waitForTimeout(250);
    ok('MF camera redraw reuses measurements', await page.evaluate(() => window.__mfResult === RF.UI.mfResult), 'sampled points ' + old);
    await page.click('[data-mf-facet="MF-back"]');
    ok('MF offender click uses the facet inspector selection', await page.evaluate(() => RF.UI.sel && RF.UI.sel.kind === 'facet' && RF.UI.sel.items[0] === 'MF-back'));
    await page.selectOption('#mf-pull', 'custom');
    for (const k of ['x', 'y', 'z']) { await page.fill('#mf-' + k, '0'); await page.locator('#mf-' + k).dispatchEvent('change'); }
    await page.waitForFunction(() => /non-zero/.test(document.getElementById('mf-error').textContent));
    ok('MF invalid zero pull shows error and clears stale offender list', await page.evaluate(() => !RF.UI.mfResult && !document.querySelector('#mf-worst button')));
    await page.fill('#mf-z', '-1'); await page.locator('#mf-z').dispatchEvent('change'); await page.waitForFunction(() => RF.UI.mfResult && RF.UI.mfResult.pull[2] === -1);
    ok('MF custom pull reversal updates undercuts', await page.evaluate(() => RF.UI.mfResult.surfaces.find((r) => r.id === 'MF-flat').undercut && !RF.UI.mfResult.surfaces.find((r) => r.id === 'MF-back').undercut));
    ok('MF all view controls/selection preserve saved scene byte-for-byte', before === await page.evaluate(() => RF.State.serialize(RF.UI.store.scene)));
    await page.uncheck('#mf-on'); await page.waitForTimeout(250);
    ok('MF toggle off restores original Optics path', await page.evaluate(() => document.getElementById('mf-panel').hidden && !RF.UI.mf.on));
    // F5 known topology, list→shell plumbing, design invalidation.
    await page.evaluate(() => {
      const s = RF.State.testScene(); s.mode = 'C'; s.sim.rays = 2000; s.groups.M.surfaces = [];
      Object.assign(s.modeC, { sweep: 'revolve', interaction: 'reflect', axisMode: 'source', mirror: false, flipFacing: false, shell: { on: true, R: 24, k: -1, zv: -12, r1: 45, nRad: 12, nAng: 24, cells: {} } });
      RF.UI.loadScene(s, 'MF F5 shell');
    }); await idle();
    await page.check('#mf-on'); await page.selectOption('#mf-pull', 'lamp'); await page.selectOption('#mf-metric', 'step');
    await page.waitForFunction(() => RF.UI.mfResult && RF.UI.mfResult.summary.surfaces === 288);
    ok('MF F5 unedited shell seams are continuous', await page.evaluate(() => RF.UI.mfResult.summary.matchedSeams === 552 && RF.UI.mfResult.summary.maxStepMm === 0));
    await page.click('#mf-worst button');
    ok('MF F5 offender selection also sets shell cell controls', await page.evaluate(() => { const c = RF.UI.store.shellSel; return c && RF.UI.sel.items[0] === 'S' + c.i + '_' + c.a; }));
    await page.evaluate(() => { RF.UI.setControl('C.cth', 2); }); await idle();
    await page.waitForFunction(() => RF.UI.mfResult && RF.UI.mfResult.summary.maxStepMm > 0);
    ok('MF rebuilt edited shell invalidates metrics and finds a nonzero seam', await page.evaluate(() => RF.UI.mfResult.summary.maxStepMm > 0));
    await page.evaluate(() => { RF.RenderGL.setPref(false); RF.UI.sceneDirty = true; RF.UI.redrawSpec(); }); await page.waitForTimeout(250);
    ok('MF WebGL can be disabled while overlay stays on', await page.evaluate(() => RF.UI.mf.on && !RF.RenderGL.on()));
    ok('MF no page errors', !errors.length, errors.join('\n'));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all MF manufacturability page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('[FAIL] MF page regression', e); process.exitCode = 1; });
