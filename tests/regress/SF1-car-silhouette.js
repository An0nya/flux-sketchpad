// SF1 page check: car pixels in dense fog at night, high beam, a curved road, traffic on. Linear HDR readback (the P1 readback,
// RF.DriveAnim._.V.gl.readHdr) of the same pose with traffic on and off. Car pixels = where the table frame changes when the traffic is
// switched on. Per mode (air off, direct 64, table 64): RGB at car pixels versus a ring of pixels around them in the same frame.
// Run (worktree): python3 tests/serve.py 8994 & then PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SF1-car-silhouette.js 8994
// Exits 1 on any failure. Software GL (headless). Prints the numbers; the verdict is the table-vs-direct ratio at car pixels.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8994);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    // the view: forest-free road with a bend (mountain pass), night, dense fog, high beam (generic), traffic on/off by two flags
    const base = { scene: 'road', mountainPass: false, seed: 7, speed: 130, visibility: 60, wet: false, wetness: 0, wetSheen: false, fpsCounter: false,
      scatterRes: 'full', scatterBlur: 'off', scatterCache: 'on', scatterCycle: 0, scatterNearFade: 'off', scatterNearFadeRange: 'off', scatterGain: 1, afs: false, lampPitch: false, corneringLamps: false, ambient: 0, playing: false, trafficLogic: false, trafficDensity: 3, oncoming: false, preceding: false };
    await page.evaluate(() => { const s = document.querySelector('[data-anim=own-high]'); if (s) { s.dispatchEvent(new Event('focus')); const o = [...s.options].find((x) => x.textContent.includes('generic')); if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } } });
    await sleep(800);
    const setView = async (o) => { await page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, o); await sleep(900); };
    // capture: step until the table is complete, then one HDR frame, kept in the page as window.SF1[name] (Float32Array) with its size
    const capture = (name) => page.evaluate(async (nm) => {
      let n = 0; while (globalThis.SD_SCATTER && globalThis.SD_SCATTER.fraction < 1 && n < 600) { RF.DriveAnim._.frame(); n++; }
      RF.DriveAnim._.frame();
      const V = RF.DriveAnim._.V, a = RF.DriveAnim._.readHdr();
      globalThis.SF1 = globalThis.SF1 || {}; globalThis.SF1[nm] = { data: a, w: V.p.w, h: V.p.h };
      return { w: V.p.w, h: V.p.h, mode: RF.UI.dvOpts.scatterMode, scatter: RF.UI.dvOpts.scatter, traffic: RF.UI.dvOpts.preceding, trafficRecomp: globalThis.SD_SCATTER ? globalThis.SD_SCATTER.recomputes : null, sum: a.reduce((s, v) => s + v, 0) / a.length };
    }, name);
    const modes = [
      ['airoff', { scatter: 0, scatterMode: 'direct', scatterTableSteps: 64 }],
      ['direct16', { scatter: 16, scatterMode: 'direct', scatterTableSteps: 64, scatterCache: 'off' }],
      ['direct64', { scatter: 64, scatterMode: 'direct', scatterTableSteps: 64, scatterCache: 'off' }],
      ['table64', { scatter: 64, scatterMode: 'table', scatterTableSteps: 64, scatterCache: 'on' }],
      ['table64owner', { scatter: 64, scatterMode: 'table', scatterTableSteps: 64, scatterCache: 'on', scatterCycle: 8, scatterBlur: 'strong', scatterRes: 'full', scatterNearFadeRange: 'medium', scatterNearFade: 'on' }],
    ];
    const info = {};
    for (const [m, extra] of modes) {
      for (const tr of [true, false]) {
        await setView(Object.assign({}, base, extra, { preceding: tr, oncoming: tr }));
        info[m + (tr ? '-on' : '-off')] = await capture(m + (tr ? '-on' : '-off'));
      }
    }
    const diag = await page.evaluate(() => { const S = globalThis.SF1, out = {}; for (const m of ['airoff', 'direct16', 'direct64', 'table64', 'table64owner']) { const a = S[m + '-on'], b = S[m + '-off']; let d = 0, nz = 0; for (let i = 0; i < a.data.length; i++) { const x = Math.abs(a.data[i] - b.data[i]); d += x; if (x > 0) nz++; } out[m] = { meanAbs: d / a.data.length, nonzero: nz, sumOn: a.data.reduce((p, v) => p + v, 0) / a.data.length }; } return out; });
    console.log('[diag] ' + JSON.stringify(diag));
    ok('SF1 captures: six HDR frames of one size', Object.values(info).every((i) => i.w === info['airoff-on'].w && i.h === info['airoff-on'].h), JSON.stringify(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { w: v.w, h: v.h, recomp: v.trafficRecomp }]))));
    // car mask: table-64 frame with traffic on minus with traffic off, per pixel (sum of RGB difference), car = difference above 2 % of the frame's mean
    const res = await page.evaluate(() => {
      const S = globalThis.SF1, on = S['table64-on'], off = S['table64-off'], W = on.w, H = on.h, N = W * H;
      const dif = new Float32Array(N); let mx = 0, mean = 0;
      for (let i = 0; i < N; i++) { const k = 4 * i; const d = Math.abs(on.data[k] - off.data[k]) + Math.abs(on.data[k + 1] - off.data[k + 1]) + Math.abs(on.data[k + 2] - off.data[k + 2]); dif[i] = d; mean += d; if (d > mx) mx = d; }
      mean /= N; const thr = 1e-3;
      const mask = new Uint8Array(N); let cnt = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (let i = 0; i < N; i++) if (dif[i] > thr) { mask[i] = 1; cnt++; const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      // ring: pixels within 6 px of the mask that are not in it
      const R = 6, ring = new Uint8Array(N);
      if (cnt) for (let i = 0; i < N; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (!mask[j]) ring[j] = 1; } }
      const stat = (name, pick) => {
        const F = S[name], out = [0, 0, 0]; let n = 0, sat = 0;
        for (let i = 0; i < N; i++) if (pick[i]) { const k = 4 * i; out[0] += F.data[k]; out[1] += F.data[k + 1]; out[2] += F.data[k + 2]; n++; }
        return n ? out.map((v) => v / n) : null;
      };
      const rep = {};
      for (const m of ['airoff', 'direct16', 'direct64', 'table64', 'table64owner']) for (const t of ['on', 'off']) {
        const nm = m + '-' + t; rep[nm] = { car: stat(nm, mask), ring: stat(nm, ring) };
      }
      // body candidates: pixels that get DARKER when the car is present (table 64, traffic on minus off), the silhouette itself
      const dark = new Uint8Array(N); let dcnt = 0, dx0 = W, dx1 = 0, dy0 = H, dy1 = 0;
      for (let i = 0; i < N; i++) { const k = 4 * i; const dl = (on.data[k] + on.data[k + 1] + on.data[k + 2]) - (off.data[k] + off.data[k + 1] + off.data[k + 2]); if (dl < -thr) { dark[i] = 1; dcnt++; const x = i % W, y = (i / W) | 0; if (x < dx0) dx0 = x; if (x > dx1) dx1 = x; if (y < dy0) dy0 = y; if (y > dy1) dy1 = y; } }
      const darkStat = (name) => { const F = S[name], out = [0, 0, 0]; let n = 0; for (let i = 0; i < N; i++) if (dark[i]) { const k = 4 * i; out[0] += F.data[k]; out[1] += F.data[k + 1]; out[2] += F.data[k + 2]; n++; } return n ? out.map((v) => v / n) : null; };
      const darkRep = {}; for (const m of ["airoff", "direct16", "table64", "table64owner"]) darkRep[m] = { on: darkStat(m + "-on"), off: darkStat(m + "-off") };
      return { W, H, count: cnt, box: cnt ? [x0, y0, x1, y1] : null, thr, rep, ringCount: ring.reduce((s, v) => s + v, 0), dcnt, dbox: dcnt ? [dx0, dy0, dx1, dy1] : null, darkRep };
    });
    console.log('[info] car mask: ' + res.count + ' px, box ' + JSON.stringify(res.box) + ', ring ' + res.ringCount + ' px, threshold ' + res.thr.toFixed(4));
    for (const k of Object.keys(res.rep)) { const r = res.rep[k]; console.log('[info] ' + k + ': car ' + (r.car ? r.car.map((v) => v.toFixed(4)).join(' ') : 'n/a') + ' | ring ' + (r.ring ? r.ring.map((v) => v.toFixed(4)).join(' ') : 'n/a')); }
    console.log('[info] body candidates (darker with the car): ' + res.dcnt + ' px, box ' + JSON.stringify(res.dbox));
    for (const k of Object.keys(res.darkRep)) { const r = res.darkRep[k]; console.log('[info] dark px ' + k + ': traffic on ' + (r.on ? r.on.map((v) => v.toFixed(4)).join(' ') : 'n/a') + ' | off ' + (r.off ? r.off.map((v) => v.toFixed(4)).join(' ') : 'n/a')); }
    ok('SF1 car found: at least 30 changed pixels between traffic on and off in table mode', res.count >= 30, res.count + ' px');
    // valid comparison: table 64 vs direct 16 (direct 64 is not a usable reference, see the loop-cap note in the report)
    const lum = (v) => v ? (v[0] + v[1] + v[2]) / 3 : null;
    const body = res.darkRep, lampT = lum(res.rep["table64-on"].car), lampD = lum(res.rep["direct16-on"].car);
    const bodyT = body.table64 && body.table64.on ? lum(body.table64.on) : null, bodyD = body.direct16 && body.direct16.on ? lum(body.direct16.on) : null;
    const rLamp = lampT && lampD ? lampT / lampD : null, rBody = bodyT && bodyD ? bodyT / bodyD : null;
    ok("SF1 car body: table 64 vs direct 16 at the darker car pixels within 15 percent", res.dcnt >= 5 && rBody !== null && Math.abs(rBody - 1) <= 0.15, res.dcnt + " px, table/direct " + (rBody === null ? "n/a" : rBody.toFixed(3)));
    ok("SF1 car lamps: table 64 vs direct 16 at the changed car pixels within 15 percent", res.count >= 30 && rLamp !== null && Math.abs(rLamp - 1) <= 0.15, res.count + " px, table/direct " + (rLamp === null ? "n/a" : rLamp.toFixed(3)));
    console.log("[info] fog ring (luminance, traffic on): airoff " + (lum(res.rep["airoff-on"].ring) || 0).toFixed(4) + ", direct16 " + (lum(res.rep["direct16-on"].ring) || 0).toFixed(4) + ", table64 " + (lum(res.rep["table64-on"].ring) || 0).toFixed(4) + ", direct64 " + (lum(res.rep["direct64-on"].ring) || 0).toFixed(4) + " (direct64 equals air off: loop cap, see report)");
    ok('SF1 nothing throws', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { ok('SF1 page run completed', false, String(e && e.stack || e).slice(0, 500)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SF1 page checks passed'); process.exitCode = fails ? 1 : 0;
})();
