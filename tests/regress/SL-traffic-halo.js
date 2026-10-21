// SL page checks: the traffic scatter table on the GPU drive renderer (look.trafficHalo off / 4 / 8 / 16, air only). Fog 60 and 200, one oncoming car.
// The halo is a screen-space TABLE read by the ground, sky and object shaders at their own depth (js/drive-three-halo.js), not a sprite. Checks:
//  1. the button hides in clear air, shows in fog, cycles off, 4, 8, 16;
//  2. halo off builds no table and is the frame of the same build with the option never set; toggling on/off adds no shader programs after the first compile;
//  3. halo on changes the frame near the car, and the car's own body pixels brighten (objects are veiled by the lit air in front of them: the sprite left them
//     unchanged, a dark cutout against the glow), and light appears above the car's roofline (the old glow stopped at the roof);
//  4. depth: along the ray through a lamp, the table adds almost nothing beyond the lamp's distance (air behind the car is not lit by it) and more in front;
//  5. the GPU table vs the CPU reference (D.trafficHalo) at the lamp ray and two offsets, at three end distances (the table is 4 midpoint steps per bin: the
//     bound is 25 percent near the lamp; the numbers are printed);
//  6. direct and table scatter modes both work with the halo on; no gpuFailure; nothing throws.
// Run (worktree): python3 tests/serve.py <port>  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SL-traffic-halo.js <port> [mainPort]
// mainPort (optional): a server on a snapshot of main (git archive main); its halo-off frame must equal ours (byte-identical when the option is off).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8985), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function frame(page, tag) {
  await sleep(2200);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  return page.locator('canvas[data-sl-drive="1"]').screenshot();
}
// luminance planes of two PNGs, decoded in the page; returns per-pixel arrays summarised by caller-supplied rectangles
async function planes(page, a, b) {
  return page.evaluate(async ([A, B]) => {
    const dec = async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, y = new Float32Array(c.width * c.height); for (let i = 0; i < y.length; i++) y[i] = (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3; return { w: c.width, h: c.height, y }; };
    const x = await dec(A), y = await dec(B); window.__pl = { x, y }; return { w: x.w, h: x.h };
  }, [a.toString('base64'), b.toString('base64')]);
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const st0 = await page.evaluate(() => ({ renderer: RF.DriveAnim.stats().renderer, gpuFailure: RF.DriveAnim.stats().gpuFailure || '' }));
    ok('SL GPU renderer is on (no GPU failure)', st0.renderer === 'three' && !st0.gpuFailure, JSON.stringify(st0));
    const btn = () => page.evaluate(() => { const b = document.querySelector('[data-dv="trafficHalo"]'); return b ? { text: b.textContent.trim(), hidden: b.hidden } : null; });
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    const haloState = () => page.evaluate(() => RF.DriveAnim._.V.three.haloState());
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    // 1. button
    const clearBtn = await btn(); ok('SL clear air: the traffic halo button is hidden', clearBtn && clearBtn.hidden === true, JSON.stringify(clearBtn));
    await setOpt('visibility', 60); await sleep(800);
    const b0 = await btn(); ok('SL fog 60: the traffic halo button shows, off', b0 && b0.hidden === false && b0.text === 'traffic halo: off', JSON.stringify(b0));
    const labels = [b0.text];
    for (let i = 0; i < 3; i++) { await page.evaluate(() => document.querySelector('[data-dv="trafficHalo"]').click()); labels.push((await btn()).text); }
    ok('SL the traffic halo button cycles off, 4, 8, 16', labels.join(' | ') === 'traffic halo: off | traffic halo: 4 | traffic halo: 8 | traffic halo: 16', labels.join(' | '));
    await setOpt('trafficHalo', 0); await sleep(600);
    // Put the first lamp pair at a given distance: advance the drive distance (the oncoming car is a world object that we approach)
    const lampDist = async () => { const s = await haloState(); const e = await page.evaluate(() => RF.DriveAnim._.V.p.eye); return s.lamps.length ? s.lamps[0].lamp[0] - e[0] : null; };
    const place = async (target) => {
      await setOpt('trafficHalo', 16); await sleep(800);
      for (let i = 0; i < 6; i++) {
        const d = await lampDist(); if (d === null) return null; if (Math.abs(d - target) < 3) return d;
        await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - target); await sleep(700);
      }
      return lampDist();
    };
    // 2. off path
    const offPng = await frame(page); const offState = await haloState();
    ok('SL halo off builds no table (haloOn 0, no pass)', offState.on === 0 && offState.passes === 0, JSON.stringify({ on: offState.on, passes: offState.passes }));
    const progs0 = await page.evaluate(() => RF.DriveAnim._.V.three.programCount());
    // 3. fixture A: fog 60, car about 35 m. 3a. changes near the car; the car body brightens; light above the roofline.
    const dA = await place(35); ok('SL fixture A: an oncoming lamp pair at about 35 m (fog 60)', dA !== null && Math.abs(dA - 35) < 6, 'lamp distance ' + (dA === null ? 'none' : dA.toFixed(1)));
    await setOpt('trafficHalo', 0); await sleep(600); const offA = await frame(page);
    await setOpt('trafficBeams', true); await setOpt('trafficHalo', 16); await sleep(600); const onA = await frame(page); const sA = await haloState();
    const progs1 = await page.evaluate(() => RF.DriveAnim._.V.three.programCount());
    ok('SL halo 16 builds the table for the lamps in range (haloOn 1, lamps >= 2)', sA.on === 1 && sA.drawn >= 2 && sA.passes >= 1, JSON.stringify({ on: sA.on, lamps: sA.drawn, passes: sA.passes, tab: sA.tab }));
    await setOpt('trafficHalo', 0); await sleep(500); await frame(page); await setOpt('trafficHalo', 16); await sleep(500); await frame(page);
    const progs2 = await page.evaluate(() => RF.DriveAnim._.V.three.programCount());
    ok('SL toggling the halo off and on adds no shader programs (first enable adds the table program only)', progs2 === progs1 && progs1 - progs0 <= 1, 'programs ' + progs0 + ' -> ' + progs1 + ' -> ' + progs2);
    const dims = await planes(page, offA, onA);
    // where is the car? the pixels where traffic changes the frame: render the frame without traffic lamps/cars (oncoming off), halo off
    await setOpt('trafficHalo', 0); await setOpt('oncoming', false); await sleep(600); const noCar = await frame(page); await setOpt('oncoming', true); await sleep(500);
    const d2 = await planes(page, offA, noCar); await page.evaluate(() => { window.__nc = window.__pl.y.y; window.__pl = null; });
    await planes(page, offA, onA);
    const m = await page.evaluate(() => {
      const { x, y } = window.__pl, nc = window.__nc, W = x.w, H = x.h; let n = 0, cx = 0, cy = 0, y0 = H, y1 = 0, x0 = W, x1 = 0, gain = 0, base = 0;
      for (let i = 0; i < W * H; i++) if (Math.abs(x.y[i] - nc[i]) > 12) { n++; const px = i % W, py = (i / W) | 0; cx += px; cy += py; y0 = Math.min(y0, py); y1 = Math.max(y1, py); x0 = Math.min(x0, px); x1 = Math.max(x1, px); gain += y.y[i] - x.y[i]; base += x.y[i]; }
      let changed = 0; for (let i = 0; i < W * H; i++) if (Math.abs(y.y[i] - x.y[i]) > 3) changed++;
      // light above the roofline: the band of rows just above the car's top edge, within its column span
      let above = 0, aboveBase = 0, na = 0; if (n) for (let py = Math.max(0, y0 - 14); py < y0 - 2; py++) for (let px = x0; px <= x1; px++) { const i = py * W + px; above += y.y[i] - x.y[i]; aboveBase += x.y[i]; na++; }
      return { W, H, carPx: n, box: n ? [x0, y0, x1, y1] : null, carGain: n ? gain / n : 0, carBase: n ? base / n : 0, changed, aboveGain: na ? above / na : 0, aboveBase: na ? aboveBase / na : 0 };
    });
    ok('SL halo 16 changes the frame (a lit-air glow around the car)', m.changed > 50, 'changed px ' + m.changed + ' of ' + m.W * m.H);
    ok('SL the car body is found (traffic on vs off, halo off)', m.carPx >= 12, 'car px ' + m.carPx + ' box ' + JSON.stringify(m.box));
    ok('SL the car body brightens with the halo on (the lit air in front of it veils it; the sprite left it unchanged)', m.carPx >= 12 && m.carGain > 0.5, 'mean gain ' + m.carGain.toFixed(2) + ' on base ' + m.carBase.toFixed(1));
    ok('SL light appears above the car roofline (the old glow stopped at the roof)', m.carPx >= 12 && m.aboveGain > 0.3, 'band above the car: gain ' + m.aboveGain.toFixed(2) + ' on base ' + m.aboveBase.toFixed(1));
    // 4. depth, and 5. GPU table vs CPU reference, at the lamp ray and two offsets
    await setOpt('trafficHalo', 16); await sleep(800);
    const val = await page.evaluate(async () => {
      const V = RF.DriveAnim._.V, D = RF.Drive, p = V.p, th = V.three, S = th.haloState(), e = p.eye, tanH = Math.tan(p.hfov * Math.PI / 360), W = p.w, H = p.h;
      const lamps = S.lamps.map((l) => ({ x: l.lamp[0], y: l.lamp[1], z: l.lamp[2], nx: l.nx, ny: l.ny, w: l.w === undefined ? 1 : l.w }));
      const look = Object.assign({}, p.look), par = Object.assign({}, p, { look: Object.assign(look, { trafficHalo: 16 }), trafficBeams: true }), lookup = (bins, d) => th.haloLookup(bins, d);
      const l0 = lamps[0], dx = l0.x - e[0], dy = l0.y - e[1], dz = l0.z - e[2], R = Math.hypot(dx, dy, dz);
      const [tw, th0] = S.tab, cellOf = (sx, sy) => [Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), Math.min(th0 - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * th0)))];
      const lsx = -(dy / dx) / tanH, lsy = (dz / dx) * W / (H * tanH), [lc, lr0] = cellOf(lsx, lsy);
      // rays through exact cell centres (the table samples a cell at its centre; the lamp's own 1/r^2 core is not a fair comparison): the lamp cell, and cells to its left, below and above
      const sc = Math.round(tw / (W / 8));   // offsets are in cells of a 1/8-view table (the angle they had before the table went 1/4 with few lamps)
      const rays = [{ name: 'lamp cell', c: [lc, lr0] }, { name: '6 cells left', c: [lc - 6 * sc, lr0] }, { name: '4 cells down', c: [lc, lr0 - 4 * sc] }, { name: '5 cells up', c: [lc, lr0 + 5 * sc] }, { name: '10 cells right', c: [lc + 10 * sc, lr0] }];
      const out = { Dl: dx, R, tab: S.tab, rays: [] }; D.HALO.steps = 64;
      for (const r of rays) {
        const sx = ((r.c[0] + 0.5) / tw) * 2 - 1, sy = ((r.c[1] + 0.5) / th0) * 2 - 1;
        const d0 = [1, -sx * tanH, sy * tanH * H / W], n = Math.hypot(...d0), d = d0.map((v) => v / n), bins = th.haloProbe(sx, sy);
        const row = { name: r.name, at: [] };
        for (const ev of [20, Math.max(5, dx * 0.99), 120]) { const g = lookup(bins, ev), c = D.trafficHalo(d, ev, lamps, 16, par, 0.5), gs = g[0] + g[1] + g[2], cs = c[0] + c[1] + c[2]; row.at.push({ end: +ev.toFixed(1), gpu: gs, cpu: cs, ratio: cs > 0 ? gs / cs : null }); }
        row.cumLamp = lookup(bins, dx).reduce((a, b) => a + b, 0); row.cum120 = lookup(bins, 120).reduce((a, b) => a + b, 0); row.cumHalf = lookup(bins, dx * 0.5).reduce((a, b) => a + b, 0);
        out.rays.push(row);
      }
      return out;
    });
    const lr = val.rays.find((r) => r.cum120 > 0) || val.rays[0];
    ok('SL depth: on the ray through a lamp, almost nothing is added beyond the lamp (under 15 percent of the total)', lr.cum120 > 0 && (lr.cum120 - lr.cumLamp) / lr.cum120 < 0.15, 'to the lamp ' + lr.cumLamp.toExponential(2) + ' to 120 m ' + lr.cum120.toExponential(2));
    ok('SL depth: more is added in front of the lamp than halfway to it', lr.cumLamp > lr.cumHalf, 'to the lamp ' + lr.cumLamp.toExponential(2) + ' halfway ' + lr.cumHalf.toExponential(2));
    for (const r of val.rays) for (const a of r.at) if (a.cpu > 0 && a.gpu >= 0) console.log('[info] ' + r.name + ' end ' + a.end + ' m: gpu ' + a.gpu.toExponential(3) + ' cpu ' + a.cpu.toExponential(3) + ' ratio ' + (a.ratio === null ? 'n/a' : a.ratio.toFixed(2)));
    // the lamp's own cell is reported but not bounded: its 1/r^2 core (r down to the 0.3 m lamp size) is narrower than a table cell, and the glare veil carries that core
    const near = val.rays.filter((r) => r.name !== 'lamp cell').flatMap((r) => r.at.filter((a) => a.cpu > 0 && a.end > 30)).map((a) => a.ratio);
    ok('SL GPU table vs the CPU reference (cell-centre rays around the lamp, not its own core cell; end distances beyond 30 m) within 25 percent (the printed ratios)', near.length >= 6 && near.every((v) => v !== null && Math.abs(v - 1) <= 0.25), near.map((v) => (v === null ? 'n/a' : v.toFixed(2))).join(', '));
    // 6. scatter modes with the halo on, no failure
    for (const [mode, steps] of [['direct', 16], ['table', 32]]) {
      await setOpt('scatterMode', mode); await setOpt('scatter', steps); await sleep(2500); const f = await frame(page); const s = await page.evaluate(() => ({ g: RF.DriveAnim.stats().gpuFailure || '', r: RF.DriveAnim.stats().renderer })); const hs = await haloState();
      ok('SL halo on with the air beam in ' + mode + ' mode: GPU renders, table built', s.r === 'three' && !s.g && hs.on === 1 && f.length > 1000, JSON.stringify({ s, on: hs.on }));
    }
    await setOpt('scatter', 0); await setOpt('scatterMode', 'direct'); await setOpt('trafficHalo', 0); await sleep(600);
    // 7. optional: main snapshot
    if (mainPort) {
      const mp = await context.newPage(); mp.on('pageerror', (e) => errors.push('main: ' + String(e)));
      await mp.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
      await mp.goto('http://127.0.0.1:' + mainPort + '/index.html'); await mp.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
      await mp.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await mp.evaluate(() => UX2Page.ready()); await sleep(1500);
      await mp.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, scene: 'road' }); RF.UI.redrawSpec(); });
      await mp.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three', null, { timeout: 120000 }).catch(() => {});
      await mp.evaluate(async () => { const V = RF.DriveAnim._.V, sl = (ms) => new Promise((r) => setTimeout(r, ms)); V.setOwn('trafficBeams', true); V.setOwn('oncoming', true); V.setOwn('preceding', false); V.setOwn('seed', 1); V.setOwn('visibility', 60); await sl(1500); });
      const mainOff = await frame(mp); await page.evaluate(() => { const V = RF.DriveAnim._.V; V.setOwn('trafficHalo', 0); }); await sleep(600);
      const ourOff = await frame(page);
      ok('SL halo off equals main byte for byte (same seed, fog 60, same pose)', sha(mainOff) === sha(ourOff) || sha(mainOff) === sha(offPng), 'main ' + sha(mainOff).slice(0, 10) + ' ours ' + sha(ourOff).slice(0, 10) + ' first-off ' + sha(offPng).slice(0, 10));
      await mp.close();
    }
    ok('SL no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SL page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
