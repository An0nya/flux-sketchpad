// SC: oncoming in-scatter culling (option scatterCull off | exact | fast; GPU, drive view with the traffic halo on). The page side of tests/scatter-cull.js.
// Checks, at four poses on the mountain pass (cars placed by replacing RF.DriveAnim.trafficCars, as E2-crest-occlusion does): a car 15 m ahead; a car 100 m ahead at the pass dip (d 1332);
// a car 96 m ahead just behind a crest (d 140); a preceding (tail-lit) car 40 m ahead.
//  (1) exact: the raw halo table bytes (bin and cum) and the frame equal off, byte for byte, at every pose; (2) the culling is active: some lamp draws fewer cells than the full table;
//  (3) CONTROL: with the rectangle shrunk by 2 cells (SL_CULL_SHRINK) the table bytes differ from off at at least one pose, so the comparison can see a wrong cull;
//  (4) with the lamp-centred tables on (haloPolar perlamp and merged) exact equals off (frame), (5) off after exact equals the first off, (6) the rectangle covers every non-zero cell of the off table
//  (printed: the margin in cells), (7) fast changes the frame a little (printed, not asserted beyond "differs or equal") and draws no more cells than exact.
// Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/SCULL-scatter-cull.js <port>   (SC_SHOTS=<dir> also writes PNGs of off/exact/fast at each pose)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const errors = [];
const POSES = [
  ['near_15m', 1350, { id: 'oncoming:SC', kind: 'oncoming', rel: 15 }],
  ['dip_100m', 1332, { id: 'oncoming:SC', kind: 'oncoming', rel: 100 }],
  ['crest_96m', 140, { id: 'oncoming:SC', kind: 'oncoming', rel: 96 }],
  ['preceding_40m', 1350, { id: 'preceding:SC', kind: 'preceding', rel: 40 }],
];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'SCULL-scatter-cull'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    const setOpts = (o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
    await setOpts({ trafficBeams: true, oncoming: true, preceding: true, seed: 1, visibility: 300, trafficHalo: 16, lampCone: 'off', streetLamps: 'off', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', haloPolar: 'off', crestOcclusion: 'off', scatterCull: 'off' });
    const car = (c) => page.evaluate((c) => { const D = RF.DriveAnim; D.trafficCars = () => [{ ...c, off: c.kind === 'oncoming' ? D._.V.src.lane : 0 }]; }, c);
    const pose = (d) => page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1800)); }, d);
    const shot = async () => {
      const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
      await sleep(500); return page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
    };
    // one capture: the frame, the raw table bytes, and this frame's culling stats; nz = the bounding box of the non-zero cells of the bin table (cells of a tile, and the tiles)
    const capture = async (tag) => {
      const buf = await shot();
      if (process.env.SC_SHOTS) { fs.mkdirSync(process.env.SC_SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.SC_SHOTS, tag + '.png'), buf); }
      const t = await page.evaluate(() => {
        const T = RF.DriveAnim._.V.three, b = T.haloTableBytes('bin'), c = T.haloTableBytes('cum'), st = T.haloState(); let nz = null;
        if (b) {
          const bytes = Uint8Array.from(atob(b.b64), (ch) => ch.charCodeAt(0)), u16 = new Uint16Array(bytes.buffer), tw = st.tab[0], th = st.tab[1], N = st.bins; let k0 = 99, k1 = -1, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
          for (let y = 0; y < th; y++) for (let x = 0; x < b.w; x++) { const i = 4 * (y * b.w + x); if ((u16[i] & 0x7fff) || (u16[i + 1] & 0x7fff) || (u16[i + 2] & 0x7fff)) { const k = Math.floor(x / tw), cx = x - k * tw; if (k < k0) k0 = k; if (k > k1) k1 = k; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
          nz = k1 < 0 ? null : { k0, k1, rect: [x0, x1, y0, y1], tw, th, N };
        }
        return { bin: b && b.b64, cum: c && c.b64, lamps: st.lamps.map((l) => l.cull), drawn: st.drawn, passes: st.passes, tab: st.tab, nz, touge: !!RF.DriveAnim._.V.p.touge };
      });
      return { png: sha(buf), bin: t.bin ? sha(Buffer.from(t.bin, 'base64')) : null, cum: t.cum ? sha(Buffer.from(t.cum, 'base64')) : null, lamps: t.lamps, drawn: t.drawn, passes: t.passes, tab: t.tab, nz: t.nz, touge: t.touge };
    };
    const sum = (r, key) => r.lamps.reduce((a, c) => a + (c ? c[key] : 0), 0);
    const R = {};
    for (const [name, d, c] of POSES) {
      await car(c); await setOpts({ scatterCull: 'off' }); await pose(d);
      const off = await capture(name + '_off');
      await setOpts({ scatterCull: 'exact' }); await pose(d);
      const ex = await capture(name + '_exact');
      ok(name + ': preconditions: pass frame, halo on, the car gives halo lamps, off reports no culling', off.touge && off.drawn >= 1 && off.bin && off.lamps.every((l) => l === null), { drawn: off.drawn, lamps: off.lamps.length });
      ok(name + ': exact table bytes (bin and cum) and frame equal off', ex.bin === off.bin && ex.cum === off.cum && ex.png === off.png, { off: [off.bin, off.cum, off.png], exact: [ex.bin, ex.cum, ex.png] });
      const full = sum(ex, 'full'), cells = sum(ex, 'cells');
      console.log('  ' + name + ': exact draws ' + cells + ' of ' + full + ' cells (' + (full ? (100 * cells / full).toFixed(1) : 'n/a') + ' %), passes off ' + off.passes + ' exact ' + ex.passes + '; lamps ' + JSON.stringify(ex.lamps.map((l) => l && { k0: l.k0, k1: l.k1, rect: l.rect, cells: l.cells })));
      // (6) the rectangle covers the non-zero cells of the off table: margin in cells (>= 0 means covered; the bound adds 1 cell of padding)
      let margin = null;
      if (off.nz) {
        const ls = ex.lamps.filter((l) => l && l.rect), U = ls.length ? [Math.min(...ls.map((l) => l.rect[0])), Math.max(...ls.map((l) => l.rect[1])), Math.min(...ls.map((l) => l.rect[2])), Math.max(...ls.map((l) => l.rect[3]))] : null, K = [Math.min(...ex.lamps.filter(Boolean).map((l) => l.k0)), Math.max(...ex.lamps.filter(Boolean).map((l) => l.k1))];
        if (U) margin = { cells: Math.min(off.nz.rect[0] - U[0], U[1] - off.nz.rect[1], off.nz.rect[2] - U[2], U[3] - off.nz.rect[3]), slices: Math.min(off.nz.k0 - K[0], K[1] - off.nz.k1), nz: off.nz, union: U, K };
      }
      ok(name + ': the rectangle and slice range cover every non-zero cell of the off table', off.nz === null ? true : (margin && margin.cells >= 0 && margin.slices >= 0), margin || { nz: off.nz });
      // (3) control: rect shrunk by 2 cells
      await page.evaluate(() => { globalThis.SL_CULL_SHRINK = 2; }); await pose(d);
      const sh = await capture(name + '_shrunk');
      await page.evaluate(() => { globalThis.SL_CULL_SHRINK = 0; });
      R[name] = { off, ex, sh, cells, full, margin, shrunkDiffers: sh.bin !== off.bin };
      console.log('  ' + name + ': shrunk-by-2 control: table ' + (sh.bin !== off.bin ? 'DIFFERS' : 'equal') + ' to off');
    }
    ok('CONTROL: shrinking the rectangle by 2 cells changes the table at at least one pose (the comparison can see a wrong cull)', Object.values(R).some((r) => r.shrunkDiffers), Object.fromEntries(Object.entries(R).map(([k, r]) => [k, r.shrunkDiffers])));
    ok('culling is active: at least one pose draws fewer cells than the full table', Object.values(R).some((r) => r.full > 0 && r.cells < r.full), Object.fromEntries(Object.entries(R).map(([k, r]) => [k, r.cells + '/' + r.full])));
    // (4) lamp-centred tables on
    {
      const [name, d, c] = POSES[0]; await car(c);
      for (const mode of ['perlamp', 'merged']) {
        await setOpts({ haloPolar: mode, scatterCull: 'off' }); await pose(d); const off = await capture('polar_' + mode + '_off');
        await setOpts({ scatterCull: 'exact' }); await pose(d); const ex = await capture('polar_' + mode + '_exact');
        const pc = ex.lamps.filter((l) => l && l.table === 'polar');
        ok(mode + ' polar tables on (' + name + '): exact frame equals off, and a polar lamp was culled to a slice range', ex.png === off.png && pc.length >= 1, { off: off.png, exact: ex.png, polar: pc.map((l) => [l.k0, l.k1, l.cells + '/' + l.full]) });
      }
      await setOpts({ haloPolar: 'off' });
    }
    // (5) off after exact
    {
      const [name, d, c] = POSES[1]; await car(c); await setOpts({ scatterCull: 'off' }); await pose(d); const again = await capture('dip_100m_off_again');
      ok('off after exact equals the first off (dip pose)', again.bin === R.dip_100m.off.bin && again.cum === R.dip_100m.off.cum && again.png === R.dip_100m.off.png, { first: R.dip_100m.off.png, again: again.png });
    }
    // (7) fast
    {
      for (const [name, d, c] of POSES) {
        await car(c); await setOpts({ scatterCull: 'fast', scatterCullEps: 0.1 }); await pose(d); const f = await capture(name + '_fast');
        const fc = sum(f, 'cells'), ec = R[name].cells; R[name].fast = { png: f.png, cells: fc, same: f.png === R[name].off.png };
        ok(name + ': fast draws no more cells than exact', fc <= ec, { fast: fc, exact: ec, full: R[name].full });
        console.log('  ' + name + ': fast eps 0.1 draws ' + fc + ' cells (exact ' + ec + '), frame ' + (f.png === R[name].off.png ? 'equals off' : 'differs from off'));
      }
      await setOpts({ scatterCull: 'exact' });
    }
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();
  } catch (e) { ok('run completed', false, String(e && e.stack || e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
