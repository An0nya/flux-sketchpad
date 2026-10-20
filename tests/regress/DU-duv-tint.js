// DU page checks: a per-source Duv (green/magenta) tint. The YLX N3535B preset sets duv 0.0189; the Drive view's lamp tint
// (V.p.lampRGB) carries it; a saved design keeps the tint in its beam; any other preset clears it.
// Serve the worktree first: python3 tests/serve.py <free port> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/DU-duv-tint.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8997);
const idbBeams = (page) => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('flux-beams', 1); r.onerror = () => rej(String(r.error));
  r.onsuccess = () => { const db = r.result, g = db.transaction('beams').objectStore('beams').getAll(); g.onsuccess = () => { db.close(); res(g.result); }; }; }));
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const tintOf = (page) => page.evaluate(() => RF.DriveAnim._.V.p.lampRGB);
const maxDiff = (a, b) => (a && b && a.length === b.length) ? Math.max(...a.map((x, i) => Math.abs(x - b[i]))) : Infinity;
const clickAnim = (page, k) => page.evaluate((k) => document.querySelector('[data-anim="' + k + '"]').click(), k);
// wait until the Drive view's lamp tint equals want (the view re-reads the store on its own timer)
const tintSettles = (page, want, ms = 20000) => page.waitForFunction((want) => { const p = window.RF?.DriveAnim?._?.V?.p; return !!p && p.lampRGB && Math.max(...p.lampRGB.map((x, i) => Math.abs(x - want[i]))) < 1e-9; }, want, { timeout: ms }).then(() => true, () => false);

(async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { if (!sessionStorage.getItem('du-booted')) { sessionStorage.setItem('du-booted', '1'); localStorage.clear(); } localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    const sc = RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text());
    u.loadScene(sc, 'DU fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });

  const want = await page.evaluate(() => ({
    ylx: RF.CCT.cctToRGB(5928, 0.0189), plain: RF.CCT.cctToRGB(5928), white: RF.CCT.cctToRGB(5928, 0),
    preset: RF.CCT.presetDuv('k3-221071'),
  }));
  ok('YLX preset defines duv 0.0189 in the table', want.preset === 0.0189, want.preset);

  // 1. loading the YLX preset: the lamp tint carries its duv, and it is not the same CCT with duv 0
  await page.evaluate(() => { RF.Controller.actions.applySourcePreset(RF.UI.store, 'k3-221071'); RF.UI.afterChange(); });   // the picker's own path
  const src1 = await page.evaluate(() => ({ cct: RF.UI.store.scene.source.cct, duv: RF.UI.store.scene.source.duv, preset: RF.UI.store.scene.source.preset }));
  ok('YLX preset: cct 5928 and duv 0.0189 on the source', src1.cct === 5928 && src1.duv === 0.0189, src1);
  const settledYlx = await tintSettles(page, want.ylx);
  const ylxTint = await tintOf(page);
  ok('YLX preset: V.p.lampRGB is the 5928 K tint WITH duv (not the duv-0 tint)', settledYlx && maxDiff(ylxTint, want.ylx) < 1e-9 && maxDiff(ylxTint, want.plain) > 1e-3, { lamp: ylxTint, withDuv: want.ylx, duv0: want.plain });

  // 2. the Light source control src.duv: clearing it gives the duv-0 tint back, typing it again tints again
  await page.evaluate(() => RF.UI.setControl('src.duv', null));   // the Light source field, blank
  const cleared = await tintSettles(page, want.plain);
  ok('src.duv blank: the tint is the same CCT with no duv', cleared && maxDiff(await tintOf(page), want.plain) < 1e-9, await tintOf(page));
  await page.evaluate(() => RF.UI.setControl('src.duv', 0.0189));
  ok('src.duv typed back to 0.0189: the tint returns', await tintSettles(page, want.ylx));

  // 3. the saved design keeps its tint: the beam's rgb is the lamp tint in use, with its kelvin
  await clickAnim(page, 'save-design');
  for (let i = 0; i < 50 && !(await idbBeams(page)).length; i++) await page.waitForTimeout(100);
  const saved = await idbBeams(page);
  ok('saved design: beam colour is 5928 K with the duv tint in its rgb', saved.length === 1 && saved[0].colour && saved[0].colour.cct === 5928 && maxDiff(saved[0].colour.rgb, want.ylx) < 1e-9, saved.map((b) => b.colour));

  // 4. another preset clears the duv (the preset rule), and the tint goes back to the plain CCT of its own
  await page.evaluate(() => { RF.Controller.actions.applySourcePreset(RF.UI.store, 'osram-cslpm1'); RF.UI.afterChange(); });
  const src2 = await page.evaluate(() => ({ cct: RF.UI.store.scene.source.cct, duv: RF.UI.store.scene.source.duv }));
  ok('another preset clears duv (cct 6500 kept)', src2.duv === undefined && src2.cct === 6500, src2);
  const plain6500 = await page.evaluate(() => RF.CCT.cctToRGB(6500));
  ok('another preset: the lamp tint is the plain 6500 K, no duv', await tintSettles(page, plain6500), await tintOf(page));

  ok('no page errors', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\nDU duv tint page checks: ' + (fails === 0 ? 'all passed' : fails + ' failed'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('[FAIL] harness error', e); process.exit(1); });
