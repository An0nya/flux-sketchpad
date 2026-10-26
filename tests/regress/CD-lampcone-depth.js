// CD: the ground-pass lamp cone is limited by the scene depth (drive-three-lampcone.js header). Before, every eye ray was marched to 300 m whatever stood in front of it, so on the
// mountain pass the cone of a street lamp hidden behind a crest of the road was drawn THROUGH the crest (owner-observed, 1000 m haze, lamps on).
// Poses (mountain pass, seed default, visibility 1000, sodium lamps, cone on; the screen delta is frame(cone on) - frame(cone off), same pose):
//   CREST   d = 130: the lamps in the cone's list (212 m and 252 m ahead) are behind the crest; RF.Touge.blocked() says the line eye -> head is cut for every one. The cone must add ~nothing.
//   VISIBLE d = 980: three heads 109 to 189 m ahead stand ABOVE the crest line (the road falls away behind a crest 30 m ahead). POSITIVE CONTROL: the cone must still add plenty of light.
// Checks: (1) CREST poses are really hidden; (2) CREST: the cone adds ~nothing (sum of added light < 1 % of what it added on the base 6c9313e, measured); (3) with the depth limit switched off
// (hook lampConeDepth('off'), the pre-CD frame) the same pose adds a lot: the pose does show the bug and the limit is what removes it; (4) VISIBLE: still adds light, warm, and some of it in a
// box around each visible head; (5) FLAT road frame (F2 pose, seed 7, haze 1000, cone on, 3 lamps drawn): byte-identical to the pin AND byte-identical with the depth path forced on
// (lampConeDepth('on')): a flat frame writes no depth (the ground quad has depthWrite false, the target's depth stays at its clear value, 5000 m), so the limit cannot change it. The pin is
// the one E2-pass-lamp-cone holds, measured on 5d3047b: unmoved. (6) Cone off and clear air frames: unchanged (cone off = the E2/other tests' pins; here: off frame with the depth path on = off frame with it off).
// MEASURED on the base 6c9313e (CD_PRINT=1): see the constants below. Run: python3 tests/serve.py <port>, then PLAYWRIGHT=... node tests/regress/CD-lampcone-depth.js <port>
//   (CD_SHOTS=<dir> writes the on/off PNGs of each pose there)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const port = +(process.argv[2] || 8806);
const scene = fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const PIN_FLAT_CONE = '59d1bc8161539e9a';   // = E2-pass-lamp-cone's pin: flat urban frame, cone on, 3 lamps; the CD change must not move it
const CREST_BASE_SUM = 74555;   // added light (sum over pixels and channels of on - off) at the CREST pose on the base 6c9313e, 5563 pixels changed
const errors = [];
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 760 } });
    await page.addInitScript(() => localStorage.clear());
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    await page.evaluate((s) => RF.UI.loadScene(RF.State.deserialize(s), 'CD-lampcone-depth'), scene);
    await page.addScriptTag({ url: '/tests/drive-three-page.js' }); await page.addScriptTag({ url: '/tests/touge-page.js' });
    await page.evaluate(() => TGPage.ready()); await sleep(1500);
    return page;
  };
  const setOpts = (page, o) => page.evaluate((o) => { const V = RF.DriveAnim._.V; for (const [k, v] of Object.entries(o)) V.setOwn(k, v); }, o);
  const pose = (page, d) => page.evaluate(async (dd) => { RF.UI.dvAnim.dist = dd; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1500)); }, d);
  const depthMode = (page, m) => page.evaluate((m) => { const T = RF.DriveAnim._.V.three; return T && T.lampConeDepth ? T.lampConeDepth(m) : 'no hook'; }, m);
  const shot = async (page) => {
    const wh = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    await sleep(600); return page.screenshot({ clip: { x: 0, y: 0, width: wh[0], height: wh[1] } });
  };
  const px = (page, buf) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, im.width, im.height).data; return { w: im.width, h: im.height, d: Array.from(d) }; }, buf.toString('base64'));
  const save = (name, buf) => { if (process.env.CD_SHOTS) { fs.mkdirSync(process.env.CD_SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.CD_SHOTS, name + '.png'), buf); } };
  // the light the cone adds: positive part of (on - off), summed over pixels and channels; count of pixels that changed; red and blue parts
  const added = (A, B) => { let sum = 0, n = 0, r = 0, b = 0, neg = 0; for (let i = 0; i < A.d.length; i += 4) { let ch = 0; for (let c = 0; c < 3; c++) { const dv = A.d[i + c] - B.d[i + c]; if (dv > 0) { sum += dv; ch = 1; if (c === 0) r += dv; if (c === 2) b += dv; } else if (dv < 0) neg += -dv; } n += ch; } return { sum, n, r, b, neg }; };
  const hiddenHeads = (page, d) => page.evaluate((dd) => {   // for each cone lamp: is the line eye -> head cut by the terrain (the CPU test the traffic lights use)?
    const V = RF.DriveAnim._.V, w = RF.Touge.world(V.p, dd, 0), a = RF.Touge.attitude(dd), eye = [0, 1, 2].map((j) => a.forward[j] * -2 + a.left[j] * .37 + a.up[j] * 1.2);
    const lamps = V.three.lampConeState().lamps;
    return lamps.map((L) => { const h = w.objects.filter((o) => o.cls === 'street-lamp' && o.mat === 'lamp-head').find((o) => Math.abs(o.x - L.x) < 1e-3 && Math.abs(o.y - L.y) < 1e-3); return { r: Math.round(L.r), hidden: !!h && RF.Touge.blocked(w.A, eye, [h.x, h.y, h.z]) }; });
  }, d);
  // one pose: frame with the cone on and off; returns { on, off, lamps, delta }
  const pair = async (page, d, name) => {
    await setOpts(page, { lampCone: 'on' }); await pose(page, d);
    const st = await page.evaluate(() => { const s = RF.DriveAnim._.V.three.lampConeState(); return { on: s.on, count: s.count, depthLimited: s.depthLimited }; });
    const lamps = await hiddenHeads(page, d);
    const on = await shot(page); save(name + '-on', on);
    await setOpts(page, { lampCone: 'off' }); await pose(page, d);
    const off = await shot(page); save(name + '-off', off);
    const A = await px(page, on), B = await px(page, off);
    return { st, lamps, delta: added(A, B), A, B };
  };
  try {
    const page = await open();
    await setOpts(page, { visibility: 1000, oncoming: false, preceding: false, streetLamps: 'sodium', lampCone: 'on', animals: false, expMode: 'fixed', ev: 1, dynamicResolution: false });
    // CREST
    const C = await pair(page, 130, 'crest');
    ok('CREST pose d=130: the cone draws >= 2 lamps and every one of them is hidden behind terrain (CPU line-of-sight)', C.st.on === 1 && C.st.count >= 2 && C.lamps.length === C.st.count && C.lamps.every((l) => l.hidden), { st: C.st, lamps: C.lamps });
    ok('CREST: the cone adds ~nothing (added light < 1% of the ' + CREST_BASE_SUM + ' it added on the base, the depth limit is on)', C.delta.sum < 0.01 * CREST_BASE_SUM && C.delta.n < 50, C.delta);
    // the same pose with the limit off: the pre-CD frame. On the base there is no hook and the frame is that frame anyway.
    const mode = await depthMode(page, 'off');
    await setOpts(page, { lampCone: 'on' }); await pose(page, 130);
    const onOff = await px(page, await shot(page));
    ok('CREST, depth limit OFF (pre-CD frame): the same pose adds a lot (> 50% of the base value), so the pose shows the bug and the limit is what removes it', added(onOff, C.B).sum > 0.5 * CREST_BASE_SUM, { mode, ...added(onOff, C.B) });
    await depthMode(page, 'auto');
    // VISIBLE (positive control)
    const Vp = await pair(page, 980, 'visible');
    ok('VISIBLE pose d=980: the cone draws the 3 street heads', Vp.st.on === 1 && Vp.st.count === 3, { st: Vp.st, lamps: Vp.lamps });
    ok('VISIBLE: the cone still adds a lot of warm light (sum > 150000, > 3000 pixels, red > 3x blue) and no pixel gets darker', Vp.delta.sum > 150000 && Vp.delta.n > 3000 && Vp.delta.r > 3 * Vp.delta.b && Vp.delta.neg === 0, Vp.delta);
    // (7) the limit removes light ONLY where something is nearer than the 300 m march: at VISIBLE, frame(limit on) and frame(limit off) are identical on every pixel whose scene depth is >= 300 m, and differ on some pixels nearer than that.
    {
      const sd = await page.evaluate(() => { const T = RF.DriveAnim._.V.three; const d = T.sceneDepth && T.sceneDepth(); return d ? { W: d.W, H: d.H, t: Array.from(d.t), min: d.t.reduce((m, v) => (v < m ? v : m), 1e9), nz: d.t.filter((v) => v < 300).length } : null; }); if (process.env.CD_PRINT) console.log('sd', sd && [sd.W, sd.H, sd.min, sd.nz], Vp.A.w, Vp.A.h);
      await depthMode(page, 'off'); await setOpts(page, { lampCone: 'on' }); await pose(page, 980);
      const Aoff = await px(page, await shot(page)); await depthMode(page, 'auto');
      let farDiff = 0, nearDiff = 0, nearPx = 0, farPx = 0;
      // the screenshot can be one row taller than the target (513 vs 512, OBSERVED), so a pixel is "far" only if the scene depth is >= 300 on the three target rows around it, "near" only if < 300 on all three.
      if (sd && sd.W === Vp.A.w && Math.abs(sd.H - Vp.A.h) <= 1) for (let y = 1; y < sd.H - 1; y++) for (let x = 0; x < sd.W; x++) {
        const r = sd.H - 1 - y, t0 = sd.t[(r - 1) * sd.W + x], t1 = sd.t[r * sd.W + x], t2 = sd.t[(r + 1) * sd.W + x], i = 4 * (y * sd.W + x);
        const dif = Vp.A.d[i] !== Aoff.d[i] || Vp.A.d[i + 1] !== Aoff.d[i + 1] || Vp.A.d[i + 2] !== Aoff.d[i + 2];
        if (Math.min(t0, t1, t2) >= 300) { farPx++; if (dif) farDiff++; } else if (Math.max(t0, t1, t2) < 300) { nearPx++; if (dif) nearDiff++; }
      }
      ok('VISIBLE: limit on vs off differ only on pixels whose scene depth is < 300 m (0 differ among the far pixels), and some do differ among the near ones', !!sd && farDiff === 0 && nearDiff > 1000, { farPx, farDiff, nearPx, nearDiff });
    }
    // flat identity
    await page.close();
    const flat = await open();
    await setOpts(flat, { mountainPass: false, scene: 'road', tiles: true, visibility: 1000, oncoming: false, preceding: false, streetLamps: 'sodium', lampCone: 'on', animals: false, people: false, expMode: 'fixed', ev: 1, dynamicResolution: false, trafficLogic: false });
    await flat.evaluate(async () => { const D = RF.DriveAnim, tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban'); Object.assign(RF.UI.dvAnim, { view: 'anim', playing: false, dist: tile.s0 + 55, t: 2 }); RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 3500)); });
    const f0 = await flat.evaluate(() => ({ touge: !!RF.DriveAnim._.V.p.touge, cone: RF.DriveAnim._.V.three.lampConeState().count }));
    const hAuto = sha(await shot(flat));
    const m1 = await depthMode(flat, 'on'); await flat.evaluate(() => RF.UI.redrawSpec()); await sleep(2500);
    const lim = await flat.evaluate(() => RF.DriveAnim._.V.three.lampConeState().depthLimited);
    const hOn = sha(await shot(flat));
    if (process.env.CD_PRINT) console.log('FLAT HASHES', hAuto, hOn, m1, lim, 'crest', JSON.stringify(C.delta), 'visible', JSON.stringify(Vp.delta));
    ok('flat urban frame, cone on: byte-identical to the pin ' + PIN_FLAT_CONE, !f0.touge && f0.cone === 3 && hAuto === PIN_FLAT_CONE, { hash: hAuto, ...f0 });
    ok('flat urban frame with the depth path FORCED on (the depth blit + depth shader actually ran) is the same bytes: a flat frame writes no depth', m1 === 'on' && lim === true && hOn === PIN_FLAT_CONE, { hash: hOn, mode: m1, depthLimited: lim });
    ok('no page errors', errors.length === 0, errors.slice(0, 3));
    await flat.close();
  } catch (e) { ok('run completed', false, String(e)); }
  finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length; console.log(fails ? 'FAILED ' + fails : 'ALL PASS ' + checks.length); process.exit(fails ? 1 : 0);
})();
