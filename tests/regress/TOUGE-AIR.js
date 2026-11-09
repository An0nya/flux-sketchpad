// REVIEW-C integ 2026-10-26: halo lookup now reads 4 knots from a prefix-summed table (shader text changed on purpose; halo-on frames differ from main by <= 2/255, agent-measured on 4 poses). Moved: TEXT_PINS plain/lit/lit+atlas 735d6fcb271f366e/583d6d40c21be702/7b8f49fc12e6d9c6 -> ef2b9e069354ff4a/05150d64f23f89ed/e177a47091528b30 (the table text includes the halo lookup).
// B10/B14 2026-10-26 (sampler packing): the six table banks are two 3-layer array textures (scatBanks, scatBanksB), the polar halo tables one 2-layer array, and marks is declared only in the ground/ribbon mains.
// Moved on purpose: TEXT_PINS plain/lit/lit+atlas ef2b9e069354ff4a/05150d64f23f89ed/e177a4709152 -> 282a872bc9a49a3a/e9f5d7be75a10e76/c82b6cb939f2683d (cause: the table text itself changed, scatBank0..2 -> scatBanks layers; the frame pins did not move);
// (1b) now looks for scatBanksB; (5) changed from "the pass ignores the cycle blend" to "the pass applies it" (cause: the pass programs no longer drop the blend bank set, 13 samplers worst case).
// Unchanged and still passing: every flat pin and passOff/passDirect (frames equal main), measured also as a same-run A/B against main 5079676 (max pixel diff 0 over 10 flat and 5 pass scenes).
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
// UI step C (2026-10-29): the frame is the drive canvas pinned at page 0,0 (was the page region y >= 140, which sat on the canvas only while the large view had
// its 30 px header; the layout shell dropped it and the region moved off the picture). Pins below re-baselined for that capture (old -> new: 115fb318 -> dfc80ab3, 3266a5da -> 62d70c92, f77ebc71 -> fee8105e, 56f9dbe5 -> bf839917, 82394e38 -> faa17959); the halo tables (bin, cum) still match.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8807);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
// RE-PIN 11-03 (murchison halo/cone sweep, rule 23): were 98f6730813fd8380 / c93c4f177e51566c / c97699b1f2d224cc (the 10-29 OHR+GGXV re-pin). Cause: the table text changed with the accumulated halo feature landings after 10-29; first validated today because the module-load crash (fixed, data-URL import) stopped this test BEFORE check (1) on every host run until now. Deterministic text (pure function of source), so no flake risk.
const TEXT_PINS = { 'plain': '8e3a2033d3edd33b', 'lit': '3c42b9206e9a0b6c', 'lit+atlas': '51a61c964c54d17a' };   /* road-surfaces-s2 re-pin v2 (le-chonk 11-05, rule 23): surfKind + surfTex helper; road band keeps the shipped s1 expression on the else-branch so stock frames are hash-stable; TEXT pins only (frame hashes untouched — claude hold #1) */   /* road-surfaces-s1 re-pin (le-chonk 11-05, rule 23): shade(...,roadId) + uniform int roadId move the table text; values derived by frenchie 03:55Z from base 78954754 + these hunks */   /* road-surfaces re-pin (frenchie 11-04): kSurf decl + ext-B sites move the table text */   /* route-parts-64 re-pin (frenchie 11-04): part[16]->part[64] moves the ground prefix hashed here; values measured by the gate on the staged tree */   // OHR + GGXV re-pin 2026-10-29 (was 76bf5e43fafaefef/1ef55b069a093d40/1f347f322868d62f): the haloSMax uniform is declared beside scatSMax and the halo lookups clamp at it (= scatSMax while haloRange is 0, the pinned value); wetGGX returns 0 for n.z <= 0.7. Pinned-default frames unchanged (touched gate frame hashes). Earlier:   // SR re-pin 2026-10-27 (were 2b3417497e504fc2/dcaa54d3b4c40589/00cbfbad6582de64): the table's 120.0 / 240.0 literals became the scatSMax uniform (value 120 at the default). Frames: checks (3) and (4) in this file (flat and pass, air off / direct / table) still equal main; the table text is the only change. // SP re-pin 2026-10-26 (were 282a872bc9a49a3a/e9f5d7be75a10e76/c82b6cb939f2683d): the halo polar lookup gained the band branch and one uniform line (haloPolar auto). Proof: reversing exactly that edit in memory reproduces the three old pins   // B10: moved from ef2b9e069354ff4a/05150d64f23f89ed/e177a47091528b30, cause above
// FLAT-PEDS re-pin 2026-10-26 (overnight integration): the 3 flat pins moved twice from pedestrian scene content, not from the air beam: S 1a410c9 (seeded walker kinds) alone gives fb1d593fb29629fd/3c9e451ffd49640b/2a15ef2c7aa258b3 (== wave-2 main e51c4bc; G d51aedb alone is clean, so D/G did not move them), then T 228686b (drive-anim walkers seeded) gives the values below. Pass pins unchanged (no pedestrians on the pass). Moved: aebd2efecedf013b, 20b772fd22a494fb, 4ae1db90b4e48d2b -> 115fb31893469501, 3266a5da9b5cf2d9, f77ebc71307f9284.
// RE-PIN 11-03 (murchison halo/cone sweep, rule 23): were dfc80ab335bcccd5 / 62d70c92cf4d3128 / fee8105ea61877f0 / bf839917bac17c7f / faa1795930af7149. Cause: accumulated halo landings - same values as TOUGE-AIR-RIBBON's re-pin (shared frames, both measured byte-identical across runs); first host run today (crash fixed). Functional checks (2)(5)(6) all green.
const PIN = { flatOff: 'dfc80ab335bcccd5', flatDirect: '62d70c92cf4d3128', flatTable: 'fee8105ea61877f0', passOff: '658d6cc8d44493bd', passDirect: 'faa1795930af7149' };   // RE-PIN 11-09 (nicholl, rule 23, item-1 quarantine verify): the five frames are BACK to the 11-03 measured values (dfc80ab3/62d70c92/fee8105e/658d6cc8/faa17959), byte-identical across gpuq runs 4a34+9397 (tree 4b78939f). Cause: the drift between was the intervening landings (not localized to one pin move); self-consistency ('flat off after on equals the first off') passes; (1)/(2)/(4) all green. Pins shared with the other file (le-chonk rule-23 note)   // REVIEW integ 2026-10-26: passOff 63f8badcba9151b0 -> 56f9dbe5248ce7e0 and passDirect 52d3bb530057cdd2 -> 82394e38742fa84b, cause: B6 (shadow normal n instead of dFdx in the lamp loop): proved, the old hash returns with only that line reverted   // REVIEW B4 (2026-10-26): c61ed72727ebe7b3 -> 52d3bb530057cdd2, cause: the pass sky now adds our own in-scatter (proved: removing only that line gives c61ed72727ebe7b3 again)
const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, ambient: 0, samples: '1', visibility: 60, scatter: 0, scatterMode: 'direct', scatterCache: 'off', scatterCycle: 1, scatterCycleFade: 'off', trafficHalo: 0 };
const T = { scatter: 16, scatterMode: 'table' };
(async () => {
  // (1) text pins (Node side: the shader module is plain ESM)
  const S = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../../js/drive-three-shaders.js')).toString('base64'));   // murchison: data-URL import — on the host node 25.8.1 a file:// .js import is classified CJS (no type:module above it) -> SyntaxError 'export' at line 3, 0.2 s, before any browser (gpuq murchison-20261103-103824-ff15); in-VM node 24 loads it fine, so the host trigger (package.json type above the harness copy vs node-25 detection) is NOT established — the data URL sidesteps module resolution entirely either way, and shaders.js is self-contained (0 imports, 0 import.meta: measured 12 exports + tableSource fn)
  const text = {}; for (const [k, lit, atlas] of [['plain', false, false], ['lit', true, false], ['lit+atlas', true, true]]) text[k] = sha(Buffer.from(S.tableSource(lit ? S.withLighting(S.ground, atlas) : S.ground)));
  ok('(1) flat table shader text equals its pin (default and blend=true)', Object.keys(TEXT_PINS).every((k) => text[k] === TEXT_PINS[k]) && S.tableSource(S.ground, true) === S.tableSource(S.ground), text);
  ok('(1b) blend=false leaves the second bank set out', !/scatBanksB/.test(S.tableSource(S.ground, false)) && /scatBanksB/.test(S.tableSource(S.ground, true)));
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
    const st = await page.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, fail: RF.DriveAnim._.V.gpuFailure || null, link: window.__linkFail.length, blend: globalThis.SD_SCATTER ? globalThis.SD_SCATTER.blend : null }));
    return { h: sha(await (await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); }), page.screenshot({ clip: { x: 0, y: 0, width: 912, height: 513 } }))), st };
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
    ok('(5) pass applies the cycle blend (B10: blend on picks a second slot and the frame differs from blend off, same halo/cache)', pp.st.blend >= 0 && pb.st.blend === -1 && pp.h !== pb.h, { on: pp.h, off: pb.h, blendSlotOn: pp.st.blend, blendSlotOff: pb.st.blend });
    const p1 = await shot(pass, {});
    ok('(6) pass off after on equals the first off', p1.h === p0.h && !p1.st.fail, p1); await pass.close();
  } catch (e) { ok('no exception', false, String(e)); }
  await browser.close();
  console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED'); process.exit(checks.every(Boolean) ? 0 : 1);
})();
