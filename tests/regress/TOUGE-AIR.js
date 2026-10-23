// TOUGE-AIR: the air beam in table mode no longer crashes the mountain pass. The pass object program linked 18 samplers with the table (limit 16)
// because the table declared a second bank set (scatBankB0..2, the cycle blend) in every program; the pass programs now leave that set out (15).
// Checks: (1) text pins: the flat table shader text is byte-identical to main (sha1 of tableSource for plain / lit / lit+atlas, measured on main a62026d);
// (2) pass + table + cache + cycle blend + halo (the air presets) renders on the GPU: touge true, no gpuFailure, no program failed to link;
// (3) flat frames equal main (pinned hashes: air off, direct, table cache off; same-run A/B against a git archive of main a62026d), off after on equals
// the first off; (4) pass air off and direct equal main (pins); (5) pass table frame differs from pass air off (the beam shows on objects) and is the same
// with the blend on or off (the pass ignores the blend); (6) pass off after on equals the first off.
// Not pinned: flat cache 8 + blend on (the cycle phase is paced by time: main varies run to run, 3 different hashes in 4 main runs).
// TOUGE-AIR-RIBBON (2026-10-23): pass DIRECT is no longer equal to main: the ribbon main now has inScatter, so the road is lit. passDirect re-baselined abd1716ffbc3cbe5 -> c61ed72727ebe7b3;
// cause shown by running the tree before the ribbon change (exp/touge-air 9495055), which reproduces abd1716ffbc3cbe5. Air off and the flat pins are unchanged.
// Pins: sha1 of the 912x513 clip at y=140, samples '1', real GPU (Apple M4, Metal), 2026-10-23. Run: python3 tests/serve.py <port>, then node tests/regress/TOUGE-AIR.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8807);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const TEXT_PINS = { 'plain': '735d6fcb271f366e', 'lit': '583d6d40c21be702', 'lit+atlas': '7b8f49fc12e6d9c6' };
const PIN = { flatOff: 'aebd2efecedf013b', flatDirect: '20b772fd22a494fb', flatTable: '4ae1db90b4e48d2b', passOff: '63f8badcba9151b0', passDirect: 'c61ed72727ebe7b3' };
const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, ambient: 0, samples: '1', visibility: 60, scatter: 0, scatterMode: 'direct', scatterCache: 'off', scatterCycle: 1, scatterCycleFade: 'off', trafficHalo: 0 };
const T = { scatter: 16, scatterMode: 'table' };
(async () => {
  // (1) text pins (Node side: the shader module is plain ESM)
  const S = await import('file://' + path.join(__dirname, '../../js/drive-three-shaders.js'));
  const text = {}; for (const [k, lit, atlas] of [['plain', false, false], ['lit', true, false], ['lit+atlas', true, true]]) text[k] = sha(Buffer.from(S.tableSource(lit ? S.withLighting(S.ground, atlas) : S.ground)));
  ok('(1) flat table shader text equals main (default and blend=true)', Object.keys(TEXT_PINS).every((k) => text[k] === TEXT_PINS[k]) && S.tableSource(S.ground, true) === S.tableSource(S.ground), text);
  ok('(1b) blend=false leaves the second bank set out', !/scatBankB/.test(S.tableSource(S.ground, false)) && /scatBankB/.test(S.tableSource(S.ground, true)));
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => {
      localStorage.clear(); window.__linkFail = [];
      const P = WebGL2RenderingContext.prototype, link = P.linkProgram;
      P.linkProgram = function (prog) { link.call(this, prog); try { if (!this.getProgramParameter(prog, this.LINK_STATUS)) window.__linkFail.push(String(this.getProgramInfoLog(prog)).slice(0, 120)); } catch (e) {} };
    });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'TOUGE-AIR'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  const shot = async (page, o) => {
    await page.evaluate(async (o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); RF.UI.dvAnim.dist = 750; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 4000)); }, { ...BASE, ...o });
    const st = await page.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, fail: RF.DriveAnim._.V.gpuFailure || null, link: window.__linkFail.length }));
    return { h: sha(await page.screenshot({ clip: { x: 0, y: 140, width: 912, height: 513 } })), st };
  };
  try {
    const flat = await open(); await flat.evaluate(() => RF.DriveAnim._.V.setOwn('mountainPass', false));
    const f0 = await shot(flat, {}), fd = await shot(flat, { scatter: 16 }), ft = await shot(flat, T), f1 = await shot(flat, {});
    ok('(3) flat air off equals main', f0.h === PIN.flatOff, f0.h); ok('(3) flat direct equals main', fd.h === PIN.flatDirect, fd.h); ok('(3) flat table (cache off) equals main', ft.h === PIN.flatTable, ft.h);
    ok('(3) flat off after on equals the first off', f1.h === f0.h, f1.h); await flat.close();
    const pass = await open(); await pass.evaluate(() => RF.DriveAnim._.V.setOwn('mountainPass', true));
    const p0 = await shot(pass, {}), pd = await shot(pass, { scatter: 16 });
    ok('(4) pass air off equals main', p0.h === PIN.passOff && p0.st.touge, p0); ok('(4) pass direct = the TOUGE-AIR-RIBBON pin (was main abd1716ffbc3cbe5 until the ribbon got inScatter)', pd.h === PIN.passDirect && pd.st.touge, pd);
    const pt = await shot(pass, T);
    ok('(2) pass + table renders on the GPU (touge, no gpuFailure, no link failure)', pt.st.touge && !pt.st.fail && pt.st.link === 0, pt);
    const pp = await shot(pass, { ...T, scatterCache: 'on', scatterCycle: 8, scatterCycleFade: 'on', trafficHalo: 16 });
    ok('(2) pass + table + cache 8 + blend on + halo (the presets) renders on the GPU', pp.st.touge && !pp.st.fail && pp.st.link === 0, pp);
    const pb = await shot(pass, { ...T, scatterCache: 'on', scatterCycle: 8, scatterCycleFade: 'off', trafficHalo: 16 });
    ok('(5) pass table frame differs from pass air off (beam shows on objects)', pt.h !== p0.h, { off: p0.h, on: pt.h });
    ok('(5) pass ignores the cycle blend (blend on == blend off, same halo/cache)', pp.h === pb.h, { on: pp.h, off: pb.h });
    const p1 = await shot(pass, {});
    ok('(6) pass off after on equals the first off', p1.h === p0.h && !p1.st.fail, p1); await pass.close();
  } catch (e) { ok('no exception', false, String(e)); }
  await browser.close();
  console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED'); process.exit(checks.every(Boolean) ? 0 : 1);
})();
