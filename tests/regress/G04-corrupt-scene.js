// G04: a corrupt autosave must not brick boot (the app starts from defaults); a good one still restores.
// node tests/regress/G04-corrupt-scene.js [port]   (needs: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8822), K = 'faceted-reflector-demo/scene/v1';
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const CASES = [['mode Z', { mode: 'Z' }], ['stamps null', { modeB: { stamps: null } }], ['lenses obj', { lenses: {} }], ['envelope.half null', { envelope: { half: null } }],
  ['surface junk', { groups: { A: { surfaces: [{ type: 'facet' }] } } }], ['target.res 0', { target: { res: 0 } }]];
(async () => {
  const browser = await pw.chromium.launch();
  for (const [name, scene] of CASES.concat([['good: mode B', { mode: 'B' }]])) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, [K, JSON.stringify(scene)]);
    await page.goto('http://localhost:' + port + '/index.html');
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => { const be = document.getElementById('boot-error'); return { ui: !!(window.RF && RF.UI), store: !!(window.RF && RF.UI && RF.UI.store), bootErr: be && !be.hidden ? be.textContent.slice(0, 100) : null, mode: window.RF && RF.UI && RF.UI.store ? RF.UI.store.scene.mode : null, res: window.RF && RF.UI && RF.UI.store ? RF.UI.store.scene.target.res : null }; });
    ok(name + ': page identified as the app', r.ui);
    ok(name + ': boots without a boot error', r.store && !r.bootErr, r.bootErr || ('mode ' + r.mode + ', res ' + r.res));
    if (name.startsWith('good')) ok(name + ': the good autosave is restored', r.mode === 'B');
    else if (name === 'target.res 0') ok(name + ': res clamped', r.res === 10, 'res ' + r.res);
    else ok(name + ': fell back to defaults (mode A)', r.mode === 'A');
    await page.close();
  }
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})();
