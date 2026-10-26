// TOUGE-AIR-RIBBON: the air beam shows on the road of the mountain pass, and the slope table agrees with direct mode.
// Two changes: (a) the pass ribbon main calls inScatter (direct, or the table lookup at the surface distance t), as the flat ground main does; (b) the table pre-pass
// is built from the car-frame eye and lamps (drive-three.js render(): the rotated world-aligned copies are swapped out for the table only), so its level car-frame ray
// and the beam lookup live in one frame. Before (b) the table disagreed with direct mode on grades (up to 5.7 deg pitch, 3.4 deg roll).
// Checks: (1) ribbon pixels are lit: lower-half pixels brighter than air off, direct and table, at the TOUGE-AIR pose (d=750). Floor 60000 px = about 2.7x the pre-change
//   count (22k: objects only; measured on exp/touge-air 9495055, 912x513 clip); measured after: direct 117k, table 111k (scatterNearFadeRange off).
// (2) slope A/B: air contribution = frame(air on) - frame(air off), summed over the frame; table/direct ratio and the relative L1 difference of the two contribution
//   images, at d=750 / 1100 (pitch -5.7 deg) / 600, must sit within RATIO_TOL / L1_TOL of the FLAT pose measured the same way. The flat pose is the baseline that
//   isolates the integral (table = 12 log bins, half resolution; direct = 16 steps) from the frame. scatterNearFadeRange is 'off' for this comparison because the table has
//   a near-eye fade and direct does not (the fade alone makes flat table/direct = 0.58). Measured (2026-10-23, real GPU): flat ratio 0.949 relL1 0.265; pass 750: 0.946 / 0.255;
//   1100: 0.953 / 0.262; 600: 0.939 / 0.256. With the OLD basis (swap disabled by hand, same code otherwise): 0.794 / 0.713; 1.071 / 0.754; 0.719 / 0.701 (not run in the test).
//   Display space, 8 bit, tone-mapped: the ratio is an approximation of the radiance ratio, not the radiance ratio.
// (3) flat frames equal main (pinned hashes: air off, direct, table cache off) and pass air off equals main; off after on equals the first off, flat and pass.
// (4) the air presets (table + cache 8 + cycle blend + halo) render on the GPU with no link failure and no gpuFailure; every linked program declares <= 16 samplers and the
//   pass ribbon with the table declares <= 13 (measured 13 declared / 12 active).
// Pass DIRECT is no longer equal to main (the ribbon is lit now: the TOUGE-AIR pin abd1716ffbc3cbe5 was re-baselined to c61ed72727ebe7b3; cause: ribbon in-scatter; the old hash
// reproduces on exp/touge-air 9495055, where the ribbon main has no inScatter).
// Pins: sha1 of the 912x513 clip at y=140, samples '1', real GPU (Apple M4, Metal), 2026-10-23. Run: python3 tests/serve.py <port>, then node tests/regress/TOUGE-AIR-RIBBON.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8808);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const PIN = { flatOff: 'aebd2efecedf013b', flatDirect: '20b772fd22a494fb', flatTable: '4ae1db90b4e48d2b', passOff: '56f9dbe5248ce7e0', passDirect: '82394e38742fa84b' };   // REVIEW integ 2026-10-26: passOff 63f8badcba9151b0 -> 56f9dbe5248ce7e0 and passDirect 52d3bb530057cdd2 -> 82394e38742fa84b, cause: B6 (shadow normal n instead of dFdx in the lamp loop): proved, the old hash returns with only that line reverted   // REVIEW B4 (2026-10-26): c61ed72727ebe7b3 -> 52d3bb530057cdd2, cause: the pass sky now adds our own in-scatter (proved: removing only that line gives c61ed72727ebe7b3 again)
const DEFAULT_FADE = 'medium';   // registry default of scatterNearFadeRange: set in BASE so the NOFADE rows do not leak into later shots
const LIT_FLOOR = 60000, RATIO_TOL = 0.06, L1_TOL = 0.06;
const BASE = { trafficBeams: true, oncoming: true, preceding: false, seed: 1, ambient: 0, samples: '1', visibility: 60, scatter: 0, scatterMode: 'direct', scatterCache: 'off', scatterCycle: 1, scatterCycleFade: 'off', trafficHalo: 0, scatterNearFadeRange: DEFAULT_FADE };
const D16 = { scatter: 16 }, T16 = { scatter: 16, scatterMode: 'table' }, NOFADE = { scatterNearFadeRange: 'off' };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => {
      localStorage.clear(); window.__linkFail = []; window.__progs = []; window.__f = {};
      const P = WebGL2RenderingContext.prototype, link = P.linkProgram;
      P.linkProgram = function (prog) {
        link.call(this, prog);
        try {
          if (!this.getProgramParameter(prog, this.LINK_STATUS)) window.__linkFail.push(String(this.getProgramInfoLog(prog)).slice(0, 120));
          let raw = ''; for (const s of this.getAttachedShaders(prog) || []) if (this.getShaderParameter(s, this.SHADER_TYPE) === this.FRAGMENT_SHADER) raw = this.getShaderSource(s);
          let n = 0; for (const m of raw.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler\w+\s+([^;]+);/g)) n += m[1].split(',').length;
          window.__progs.push({ n, ribbonTable: /roadNormal/.test(raw) && /scatBank0/.test(raw) });
        } catch (e) {}
      };
    });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'TOUGE-AIR-RIBBON'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  // one frame: set the options and the distance, wait, screenshot; keep the decoded pixels under `name` for the metrics
  const shot = async (page, name, o, dist = 750) => {
    await page.evaluate(async ([o, dist]) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); RF.UI.dvAnim.dist = dist; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 4000)); }, [{ ...BASE, ...o }, dist]);
    const st = await page.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, fail: RF.DriveAnim._.V.gpuFailure || null, link: window.__linkFail.length }));
    const buf = await page.screenshot({ clip: { x: 0, y: 140, width: 912, height: 513 } });
    await page.evaluate(async ([name, b64]) => { const bm = await createImageBitmap(await fetch('data:image/png;base64,' + b64).then((r) => r.blob())); const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0); window.__f[name] = x.getImageData(0, 0, bm.width, bm.height).data; }, [name, buf.toString('base64')]);
    return { h: sha(buf), st };
  };
  // air contribution = on - off (luminance, 8 bit); compare direct and table over the frame and over the lower half
  const contrib = (page, off, d, t) => page.evaluate(([off, d, t]) => {
    const O = window.__f[off], Dd = window.__f[d], Tb = window.__f[t], lum = (X, i) => 0.2126 * X[i] + 0.7152 * X[i + 1] + 0.0722 * X[i + 2], H = O.length / 4 / 912 | 0, res = {};
    for (const [rn, y0, y1] of [['all', 0, H], ['lower', H >> 1, H]]) {
      let sd = 0, st = 0, sdiff = 0, litD = 0, litT = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 912; x++) { const i = (y * 912 + x) * 4, cd = lum(Dd, i) - lum(O, i), ct = lum(Tb, i) - lum(O, i); sd += cd; st += ct; sdiff += Math.abs(cd - ct); if (cd > 2) litD++; if (ct > 2) litT++; }
      res[rn] = { ratio: +(st / sd).toFixed(3), relL1: +(sdiff / Math.max(1, Math.abs(sd))).toFixed(3), litD, litT };
    }
    return res;
  }, [off, d, t]);
  try {
    const flat = await open(); await flat.evaluate(() => RF.DriveAnim._.V.setOwn('mountainPass', false));
    const f0 = await shot(flat, 'f0', {}), fd = await shot(flat, 'fd', D16), ft = await shot(flat, 'ft', T16);
    ok('(3) flat air off equals main', f0.h === PIN.flatOff, f0.h); ok('(3) flat direct equals main', fd.h === PIN.flatDirect, fd.h); ok('(3) flat table (cache off) equals main', ft.h === PIN.flatTable, ft.h);
    await shot(flat, 'fOff', NOFADE); await shot(flat, 'fDir', { ...D16, ...NOFADE }); await shot(flat, 'fTab', { ...T16, ...NOFADE });
    const f1 = await shot(flat, 'f1', {});
    ok('(3) flat off after on equals the first off', f1.h === f0.h, f1.h);
    const base = await contrib(flat, 'fOff', 'fDir', 'fTab'); console.log('flat baseline (integral error only)', JSON.stringify(base)); await flat.close();

    const pass = await open(); await pass.evaluate(() => RF.DriveAnim._.V.setOwn('mountainPass', true));
    const p0 = await shot(pass, 'p0', {}), pd = await shot(pass, 'pd', D16);
    ok('(3) pass air off equals main', p0.h === PIN.passOff && p0.st.touge, p0); ok('(3) pass direct = the re-baselined pin (ribbon lit)', pd.h === PIN.passDirect && pd.st.touge, pd);
    const rows = {};
    for (const d of [750, 1100, 600]) {
      const a = await shot(pass, 'o' + d, NOFADE, d), b = await shot(pass, 'd' + d, { ...D16, ...NOFADE }, d), c = await shot(pass, 't' + d, { ...T16, ...NOFADE }, d);
      rows[d] = { ...(await contrib(pass, 'o' + d, 'd' + d, 't' + d)), touge: a.st.touge && b.st.touge && c.st.touge, fail: a.st.fail || b.st.fail || c.st.fail };
      console.log('pass d=' + d, JSON.stringify(rows[d]));
    }
    ok('(1) ribbon lit with air direct (lower half, d=750)', rows[750].lower.litD >= LIT_FLOOR && rows[750].touge, { litD: rows[750].lower.litD, floor: LIT_FLOOR });
    ok('(1) ribbon lit with air table (lower half, d=750)', rows[750].lower.litT >= LIT_FLOOR, { litT: rows[750].lower.litT, floor: LIT_FLOOR });
    for (const d of [750, 1100, 600]) {
      const r = rows[d].all;
      ok('(2) slope table vs direct, d=' + d + ': ratio and relative L1 within tolerance of the flat baseline', !rows[d].fail && Math.abs(r.ratio - base.all.ratio) <= RATIO_TOL && r.relL1 <= base.all.relL1 + L1_TOL, { ratio: r.ratio, relL1: r.relL1, flatRatio: base.all.ratio, flatRelL1: base.all.relL1, RATIO_TOL, L1_TOL });
    }
    const pp = await shot(pass, 'pp', { ...T16, scatterCache: 'on', scatterCycle: 8, scatterCycleFade: 'on', trafficHalo: 16 });
    ok('(4) pass + table + cache 8 + blend on + halo (the air presets) renders on the GPU, no link failure', pp.st.touge && !pp.st.fail && pp.st.link === 0, pp);
    const progs = await pass.evaluate(() => window.__progs);
    ok('(4) every linked program declares <= 16 samplers; the pass ribbon with the table <= 13', progs.every((q) => q.n <= 16) && progs.filter((q) => q.ribbonTable).every((q) => q.n <= 13) && progs.some((q) => q.ribbonTable), { max: Math.max(...progs.map((q) => q.n)), ribbon: progs.filter((q) => q.ribbonTable).map((q) => q.n) });
    const p1 = await shot(pass, 'p1', {});
    ok('(3) pass off after on equals the first off', p1.h === p0.h && !p1.st.fail, p1); await pass.close();
  } catch (e) { ok('no exception', false, String(e)); }
  await browser.close();
  console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED'); process.exit(checks.every(Boolean) ? 0 : 1);
})();
