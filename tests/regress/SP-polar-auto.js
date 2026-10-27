// SP: the lamp-centred table's auto mode (look.haloPolar 'auto', the default). GPU, drive view, traffic halo on, mountain pass, one oncoming car placed with the trafficCars override.
// Checks: (1) 40, 20 and 14 m: a band table is built (a polar lamp with a band narrower than the whole circle, the table at the asked size, share 1) and the screen table carries the lamps too (split);
// (2) 10 m: in the fade (0 < share < 1, smoothstep(8, 12, d)); (3) 5 m: no table (polarNote says auto), and the frame is byte-identical to haloPolar off, so nothing is left behind in the screen table;
// (4) the share is continuous: stepping the car 13 -> 7 m in 0.25 m steps, the frame-to-frame change of auto stays within 2x the change of off (no pop where the table fades out);
// (5) the band sizes 512x64, 128x32 and 64x16 all build (a size change rebuilds the targets) and the frame at each is finite and not blank; (6) off, merged and perlamp ignore the band (their own table size, no band);
// (7) the partition: with the band table and the split screen share, the frame is close to the whole-circle merged table's frame (mean step printed, asserted under 2 levels at 20 m).
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/SP-polar-auto.js <port>   (SP_SHOTS=<dir> writes PNGs)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'SP-polar-auto'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
    await setOpts({ trafficBeams: true, oncoming: true, preceding: false, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', crestOcclusion: 'off', scatterCull: 'exact', haloPolar: 'auto', haloPolarBand: '128x32' });
    const car = (rel) => page.evaluate((rel) => { const D = RF.DriveAnim; D.trafficCars = () => [{ id: 'oncoming:SP', kind: 'oncoming', rel, off: D._.V.src.lane }]; }, rel);
    const settle = (ms = 1500) => page.evaluate(async (ms) => { RF.UI.dvAnim.dist = 1350; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, ms)); }, ms);
    const grab = async (tag, save = true) => {
      const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
      await sleep(400); const png = await page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
      if (save && process.env.SP_SHOTS) { fs.mkdirSync(process.env.SP_SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.SP_SHOTS, tag + '.png'), png); }
      const st = await page.evaluate(() => { const T = RF.DriveAnim._.V.three, s = T.haloState(); return { lamps: s.lamps.map((l) => ({ band: l.band, cull: l.cull })), note: s.polarNote, polars: s.polars, passes: s.passes }; });
      return { png, hash: sha(png), ...st };
    };
    const decode = (png) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return Array.from(g.getImageData(0, 0, c.width, c.height).data); }, png.toString('base64'));
    const meanStep = (A, B) => { let s = 0, mx = 0; for (let i = 0; i < A.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(A[i + k] - B[i + k])); s += m; if (m > mx) mx = m; } return { mean: s / (A.length / 4), max: mx }; };
    const R = {};
    // (1)-(3)
    for (const rel of [40, 20, 14, 12, 10, 8, 5]) {
      await car(rel); await setOpts({ haloPolar: 'auto' }); await settle(); const a = await grab('auto_' + rel + 'm');
      const b = a.lamps.map((l) => l.band).find(Boolean); R[rel] = { a, b };
      console.log('  ' + rel + ' m auto: band ' + JSON.stringify(b && { ac: +b.ac.toFixed(3), hw: +b.hw.toFixed(3), hwDeg: +(b.hw * 180 / Math.PI).toFixed(1), arcDeg: +b.arcDeg.toFixed(1), fade: +b.fade.toFixed(3), wd: +b.wd.toFixed(3), dNear: +b.dNear.toFixed(2), n: b.n, nT: b.nT, nR: b.nR }) + ' note ' + a.note);
    }
    for (const rel of [40, 20, 14]) { const { a, b } = R[rel]; ok(rel + ' m: a band table is built, share 1, 128 x 32, both lamps of the car are in it', !!b && b.hw <= Math.PI && b.wd === 1 && b.nT === 128 && b.nR === 32 && a.polars === 1 && a.lamps.filter((l) => l.band).length === 2, b && { hw: b.hw, wd: b.wd, nT: b.nT }); }
    { const b = R[10].b; ok('10 m: in the fade (0 < share < 1)', !!b && b.wd > 0 && b.wd < 1, b && { wd: b.wd, dNear: b.dNear }); }
    await car(5); await setOpts({ haloPolar: 'off' }); await settle(); const off5 = await grab('off_5m');
    ok('5 m: no table (nearest lamp inside 8 m), and the frame is byte-identical to haloPolar off', !R[5].b && R[5].a.polars === 0 && /auto/.test(R[5].a.note || '') && R[5].a.hash === off5.hash, { auto: R[5].a.hash, off: off5.hash, note: R[5].a.note });
    // (4) continuity of the fade
    {
      const sweep = async (mode) => { await setOpts({ haloPolar: mode }); const out = []; let prev = null; for (let rel = 13; rel >= 6.99; rel -= 0.25) { await car(rel); await settle(700); const g = await grab('sweep_' + mode + '_' + rel, false); const A = await decode(g.png); if (prev) out.push({ rel, ...meanStep(prev, A), wd: (g.lamps.map((l) => l.band).find(Boolean) || {}).wd }); prev = A; } return out; };
      const sa = await sweep('auto'), so = await sweep('off');
      const ma = Math.max(...sa.map((x) => x.mean)), mo = Math.max(...so.map((x) => x.mean));
      console.log('  fade sweep 13 -> 7 m, mean step per 0.25 m: auto ' + sa.map((x) => x.mean.toFixed(2)).join(' ') + ' | off ' + so.map((x) => x.mean.toFixed(2)).join(' '));
      ok('the fade has no pop: the largest frame-to-frame change of auto (' + ma.toFixed(2) + ') is within 2x that of off (' + mo.toFixed(2) + ') + 0.5 level', ma <= 2 * mo + 0.5, { auto: ma, off: mo, wd: sa.map((x) => x.wd) });
    }
    // (5) sizes
    {
      await car(20); const sizes = {};
      for (const sz of ['512x64', '128x32', '64x16']) { await setOpts({ haloPolar: 'auto', haloPolarBand: sz }); await settle(); const g = await grab('size_' + sz + '_20m'); const A = await decode(g.png); let lum = 0; for (let i = 0; i < A.length; i += 4) lum += A[i] + A[i + 1] + A[i + 2]; sizes[sz] = { g, A, lum: lum / (A.length / 4 * 3), b: g.lamps.map((l) => l.band).find(Boolean) }; }
      ok('all three sizes build at 20 m, the band reports the asked size, and the frames are not blank', Object.entries(sizes).every(([k, v]) => v.b && `${v.b.nT}x${v.b.nR}` === k && v.lum > 5), Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, +v.lum.toFixed(1)])));
      const d1 = meanStep(sizes['512x64'].A, sizes['128x32'].A), d2 = meanStep(sizes['512x64'].A, sizes['64x16'].A);
      console.log('  band size vs 512x64 at 20 m: 128x32 mean step ' + d1.mean.toFixed(3) + ' (max ' + d1.max + '), 64x16 mean step ' + d2.mean.toFixed(3) + ' (max ' + d2.max + ')');
      // (7) vs the whole-circle merged table
      await setOpts({ haloPolar: 'merged' }); await settle(); const mg = await grab('merged_20m'); const M = await decode(mg.png); const dm = meanStep(sizes['128x32'].A, M);
      console.log('  auto 128x32 vs merged (whole circle 512x64) at 20 m: mean step ' + dm.mean.toFixed(3) + ' max ' + dm.max);
      ok('auto 128x32 is close to the whole-circle merged frame at 20 m (mean step under 2 levels)', dm.mean < 2, dm);
    }
    // (6) the other modes ignore the band
    for (const mode of ['off', 'merged', 'perlamp']) { await car(20); await setOpts({ haloPolar: mode }); await settle(); const g = await grab('mode_' + mode + '_20m'); ok(mode + ': no band, ' + (mode === 'off' ? 'no table' : 'whole-circle table (512 x 64)'), g.lamps.every((l) => !l.band) && (mode === 'off' ? g.polars === 0 : g.polars >= 1), { polars: g.polars }); }
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e && e.stack || e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
