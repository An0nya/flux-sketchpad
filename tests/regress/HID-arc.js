// Tester only: python3 tests/serve.py 8797; node tests/regress/HID-arc.js 8797
const pw = require(process.env.PLAYWRIGHT || require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const port = +(process.argv[2] || 8797); let fails = 0;
const ok = (name, value, detail) => { console.log((value ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!value) fails++; };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--enable-unsafe-webgpu'] }), page = await browser.newPage(), errors = [];
  try {
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store);
    await page.waitForFunction(() => !RF.UI.solving && !RF.SolverHost.loading(), null, { timeout: 120000 });
    ok('HID correct app and worktree port', await page.evaluate((p) => !!RF.UI && location.port === String(p), port));
    const ui = await page.evaluate(() => {
      const u = RF.UI, C = RF.Controller, S = RF.SourcePresets, s = u.store.scene.source;
      C.actions.applySourcePreset(u.store, 'd4s-transverse'); u.afterChange(); RF.Panels.renderSourcePreset(u);
      const side = s.axis.join(',') === '0,1,0' && s.kind === 'arc';
      const options = [...document.querySelectorAll('select[aria-label="Emitter preset"] option')].filter((o) => S.PRESETS[o.value] && S.PRESETS[o.value].hid).length;
      const controls = ['gap', 'bow', 'fwhm', 'hot', 'tipWidth', 'tube', 'stripes', 'mount'].every((k) => !!document.querySelector('[data-control="src.arc.' + k + '"]'));
      C.setControl(u.store, 'src.arc.mount', 'axial'); C.setControl(u.store, 'src.arc.tube', true); C.setControl(u.store, 'src.arc.stripes', true);
      const changed = s.axis[0] === 1 && s.arc.tube && s.arc.stripes;
      const json = RF.State.serialize(u.store.scene), roundTrip = RF.State.serialize(RF.State.deserialize(json)) === json;
      C.actions.applySourcePreset(u.store, 'h7'); return { side, options, controls, changed, roundTrip, cleared: !s.arc && s.kind === 'volume' };
    });
    for (const k of ['side', 'controls', 'changed', 'roundTrip', 'cleared']) ok('HID source editor ' + k, ui[k], JSON.stringify(ui));
    ok('HID sixteen mounting/category presets exposed', ui.options === 16);
    await page.addScriptTag({ url: 'http://localhost:' + port + '/tests/gpu-page.js' });
    const ready = await page.evaluate(async () => { await GpuCompare.init(); return GpuCompare.info(); });
    ok('HID WebGPU adapter and shader compile', ready.ready, JSON.stringify(ready));
    if (ready.ready) {
      const rays = await page.evaluate(() => GpuCompare.run('emission'));
      for (const [name, r] of Object.entries(rays).filter(([k]) => k.startsWith('hid-'))) {
        ok(name + ' CPU/GPU directions and all three origin coordinates', r.p999 < 3e-5 && r.over < .002 && r.originP999 < 3e-4 && r.originOver < .002, JSON.stringify(r));
      }
      const energy = await page.evaluate(() => GpuCompare.run('hidArc'));
      ok('HID quartz + R stripes full CPU/GPU energy ledger', energy.ledgerWorst < .002 && Math.abs(energy.conservationCpu) < 1e-8 && Math.abs(energy.conservationGpu) < 1e-5, JSON.stringify(energy));
    }
    ok('HID no page errors', !errors.length, errors.join('\n'));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' HID page checks FAILED' : 'all HID page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('[FAIL] HID page check threw', e); process.exitCode = 1; });
