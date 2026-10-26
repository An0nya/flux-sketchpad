// BF-lamp-halo-over-objects (Brief F, B13): the lamp veil lies over the object layer, scaled by how much of the lamp head is visible.
// Option lampHalos 'on', urban tile at night, sodium street lamps, samples '1' (real GPU). Frames are page screenshots, decoded here (PNG, 8-bit, no interlace).
// Before the fix the veil was drawn into the ground and any opaque object hid it. The checks, on the nearest street lamp's sprite disk:
//  1. object BEHIND the lamp (object distance > lamp distance + 1 m, opaque): the veil is there after the fix (mean on-minus-off > 0.5) and absent before
//     (setOverObjects(false) = the pre-fix frame: exactly 0 on opaque pixels).
//  2. lamp head fully behind an opaque object IN FRONT (every tap depth 0.01 m, test override): the veil is gone everywhere (max |on - off| <= 1).
//  3. partial (2 of 5 taps in front, override): the veil is 0.6 of the all-clear value on ground pixels (within 0.03).
//  4. the GPU visibility (ratio on real taps / all-clear, ground pixels) equals the CPU visibility from objectBuffers() depth at the lamp head pixel,
//     to within 0.05. This is the check that catches a Y flip or a supersampling mapping error; the override checks cannot.
//  5. no page errors.
// Run: python3 tests/serve.py <port> ; PLAYWRIGHT=... node tests/regress/BF-lamp-halo-over-objects.js <port>   (env SHOTS=<dir> saves the frames)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8985);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' - ' + detail : '')); };
const errors = [];
const SHOTS = process.env.SHOTS || '';
const RAD = 150;   // px, the disk around the lamp head (fragcoord units); the veil reaches tens of px, so the disk must too

function decodePng(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!ch || bd !== 8) throw Error('PNG format not supported: colour type ' + ct + ' depth ' + bd);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w, h, ch, px: out };
}
const sumRGB = (img, x, y) => { const i = (y * img.w + x) * img.ch; return img.px[i] + img.px[i + 1] + img.px[i + 2]; };
const maxCh = (img, x, y) => { const i = (y * img.w + x) * img.ch; return Math.max(img.px[i], img.px[i + 1], img.px[i + 2]); };

async function open(p) {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + p + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.setViewportSize({ width: 1920, height: 1400 }); await sleep(1500);
  await page.evaluate(() => {
    const u = RF.UI, D = RF.DriveAnim;
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, leafyFoliage: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, lampHalos: 'off', wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, glare: 'off', onMode: 'generic', tiles: true, streetLamps: 'sodium', samples: '1' });
    const tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban');
    Object.assign(u.dvAnim, { view: 'anim', dist: tile.s0 + 55, t: 2, playing: false });
    u.redrawSpec();
  });
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  return { browser, page };
}
// A frame once it stops changing (a visibility change can take a frame or two), decoded.
async function frame(page, name) {
  let prev = null, b = null;
  for (let i = 0; i < 12; i++) {
    await sleep(1200);
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
    const dims = await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', zIndex: '99999' }); return [c.width, c.height]; });
    b = await page.screenshot({ clip: { x: 0, y: 0, width: dims[0], height: dims[1] } });
    const h = require('crypto').createHash('sha256').update(b).digest('hex'); if (h === prev) break; prev = h;
  }
  if (SHOTS && name) fs.writeFileSync(path.join(SHOTS, name + '.png'), b);
  return decodePng(b);
}
const setLH = (page, v) => page.evaluate((v) => RF.DriveAnim._.V.setOwn('lampHalos', v), v).then(() => sleep(600));
// Test hooks are not options, so they do not redraw by themselves: ask for a redraw after each one (LCM1 does the same through redrawSpec).
const hook = (page, fn, arg) => page.evaluate(([fn, arg]) => { RF.DriveAnim._.V.three[fn](arg); RF.UI.redrawSpec(); }, [fn, arg]).then(() => sleep(1000));

(async () => {
  let A = null;
  try {
    A = await open(port);
    const { page } = A;
    const renderer = await page.evaluate(() => RF.DriveAnim.stats().renderer);
    ok('BF GPU renderer is on', renderer === 'three', renderer);
    await setLH(page, 'on'); await sleep(1500);
    // Pick the nearest street lamp, read its head pixel (fragcoord, bottom-left origin) and the object buffers of the same frame.
    const probe = await page.evaluate(() => {
      const V = RF.DriveAnim._.V, lh = V.three.lampHaloState(), ob = V.three.objectBuffers();
      const i = (lh.lamps || []).findIndex((l) => l.kind === 'street');
      if (i < 0 || !lh.objPx) return { none: true, lamps: (lh.lamps || []).length, objPx: !!lh.objPx };
      const { W, H, rgba, t } = ob;
      const a = [], d = [];
      for (let k = 0; k < W * H; k++) { a.push(rgba[4 * k + 3]); d.push(t[4 * k]); }
      return { none: false, r: lh.lamps[i].r, x0: lh.objPx[i][0], y0: lh.objPx[i][1], W, H, a, d };
    });
    if (probe.none) { ok('BF a street lamp with an object-pixel probe exists', false, JSON.stringify({ lamps: probe.lamps, objPx: probe.objPx })); return; }
    const { r, x0, y0, W, H } = probe, objA = probe.a, objT = probe.d, rr = r;
    ok('BF nearest street lamp listed', r > 0, 'r ' + r + ' m, head at px (' + x0.toFixed(1) + ', ' + y0.toFixed(1) + ') of ' + W + 'x' + H);
    const inDisk = (x, y) => (x - x0) ** 2 + (y - y0) ** 2 <= RAD * RAD;
    // Object buffers are bottom-left origin like fragcoord; the screenshot is top-left, so screen row = H - 1 - y.
    const cls = (x, y) => { const i = y * W + x, a = objA[i], d = objT[i]; if (!(a > 0.5)) return 'ground'; if (d > rr + 1) return 'behind'; if (d < rr - 1) return 'front'; return 'near'; };

    await setLH(page, 'off'); const off = await frame(page, SHOTS ? 'bf_off' : '');
    await setLH(page, 'on');
    const real = await frame(page, SHOTS ? 'bf_on_fix' : '');
    const linReal = { v: await page.evaluate(() => { const s = RF.DriveAnim._.V.three.lampHaloLinear(); const o = new Array(s.W * s.H); for (let k = 0; k < s.W * s.H; k++) o[k] = s.rgba[4 * k] + s.rgba[4 * k + 1] + s.rgba[4 * k + 2]; return o; }) };
    const toScreen = (x, y) => [Math.floor(x), H - 1 - Math.floor(y)];
    const diskDelta = (img) => {
      const out = []; for (let y = Math.floor(y0 - RAD); y <= Math.ceil(y0 + RAD); y++) for (let x = Math.floor(x0 - RAD); x <= Math.ceil(x0 + RAD); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !inDisk(x, y)) continue; const [sx, sy] = toScreen(x, y);
        // m = the brightest channel of this frame: the veil clips at 255 near the lamp, and a clipped pixel cannot show a ratio. Ratios use m < 250 only.
        out.push({ c: cls(x, y), d: sumRGB(img, sx, sy) - sumRGB(off, sx, sy), m: maxCh(img, sx, sy), x, y });
      } return out;
    };
    // 1. behind: fix on, pre-fix off
    const fixDelta = diskDelta(real);
    await hook(page, 'lampHaloOverObjects', false); await setLH(page, 'on');
    const pre = await frame(page, SHOTS ? 'bf_on_prefix' : '');
    const preDelta = diskDelta(pre);
    await hook(page, 'lampHaloOverObjects', true);
    const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN;
    const bFix = mean(fixDelta.filter((e) => e.c === 'behind').map((e) => e.d)), bPre = mean(preDelta.filter((e) => e.c === 'behind').map((e) => e.d));
    const nBehind = fixDelta.filter((e) => e.c === 'behind').length;
    ok('BF behind: sample exists (opaque object pixels behind the lamp in the disk)', nBehind >= 20, nBehind + ' pixels');
    ok('BF behind: veil kept after the fix (mean on-off over those pixels > 0.5)', bFix > 0.5, 'fix ' + bFix.toFixed(2) + ' (sum of RGB, 8-bit)');
    ok('BF behind: veil hidden before the fix (|mean| <= 0.5 = the old bug)', Math.abs(bPre) <= 0.5, 'pre-fix ' + bPre.toFixed(2));
    // 4. CPU visibility vs GPU visibility (ground pixels), needs all-clear frame: taps 1000 m
    // Linear veil buffers (float, before bloom and tone mapping): the sprite on ground pixels is the buffer value itself. The screenshot is bloomed and
    // ACES-mapped, so ratios are taken here, not on the 8-bit frame.
    await hook(page, 'lampHaloTapOverride', [1000, 1000, 1000, 1000, 1000]);
    await frame(page, SHOTS ? 'bf_on_allclear' : '');
    const linClear = await page.evaluate(() => { const s = RF.DriveAnim._.V.three.lampHaloLinear(); const o = new Array(s.W * s.H); for (let k = 0; k < s.W * s.H; k++) o[k] = s.rgba[4 * k] + s.rgba[4 * k + 1] + s.rgba[4 * k + 2]; return o; });
    // ground pixels in the disk where the clear veil is visible
    const groundIdx = [];
    for (let y = Math.floor(y0 - RAD); y <= Math.ceil(y0 + RAD); y++) for (let x = Math.floor(x0 - RAD); x <= Math.ceil(x0 + RAD); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || !inDisk(x, y) || cls(x, y) !== 'ground') continue; const k = y * W + x; if (linClear[k] > 1e-3) groundIdx.push(k);
    }
    const sumAt = (arr) => groundIdx.reduce((s, k) => s + arr[k], 0);
    const gpuVis = sumAt(linReal.v) / sumAt(linClear);
    // CPU visibility from the object buffers at the lamp head pixel, same 5 taps and rule as the shader
    const cpu = (() => { const taps = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]; let n = 0; for (const [dx, dy] of taps) { const qx = Math.min(W - 1, Math.max(0, Math.floor(x0 + dx))), qy = Math.min(H - 1, Math.max(0, Math.floor(y0 + dy))); if (objT[qy * W + qx] >= rr - 0.5) n++; } return n / 5; })();
    ok('BF GPU visibility = CPU visibility from the object depth (within 0.05)', Math.abs(gpuVis - cpu) <= 0.05, 'GPU ' + gpuVis.toFixed(3) + ' vs CPU ' + cpu.toFixed(2) + ' (' + groundIdx.length + ' ground pixels, linear buffer)');
    // 2. all taps in front: the veil is gone everywhere (screenshot: exact zero delta)
    await hook(page, 'lampHaloTapOverride', [0.01, 0.01, 0.01, 0.01, 0.01]);
    const allFront = await frame(page, SHOTS ? 'bf_on_allfront' : '');
    const frontMax = Math.max(...diskDelta(allFront).map((e) => Math.abs(e.d)));
    // ground pixels only: the lamp head itself is emissive in the object layer (emit 9000 x colour), so the whole buffer is not a veil measure
    const frontSum = await page.evaluate((idx) => { const s = RF.DriveAnim._.V.three.lampHaloLinear(); let m = 0; for (const k of idx) m = Math.max(m, Math.abs(s.rgba[4 * k] + s.rgba[4 * k + 1] + s.rgba[4 * k + 2])); return m; }, groundIdx);
    const frontLin = frontSum;
    ok('BF front: lamp fully behind an opaque object in front loses the veil (screen max |on-off| <= 1, linear sprite max = 0)', frontMax <= 1 && frontLin === 0, 'screen max ' + frontMax + ', linear max ' + frontLin);
    // 3. two taps in front of three: 0.6 of the all-clear veil on ground pixels (linear buffer)
    await hook(page, 'lampHaloTapOverride', [0.01, 0.01, 1000, 1000, 1000]);
    await frame(page, SHOTS ? 'bf_on_partial' : '');
    const linPartial = await page.evaluate(() => { const s = RF.DriveAnim._.V.three.lampHaloLinear(); const o = new Array(s.W * s.H); for (let k = 0; k < s.W * s.H; k++) o[k] = s.rgba[4 * k] + s.rgba[4 * k + 1] + s.rgba[4 * k + 2]; return o; });
    const ratio = sumAt(linPartial) / sumAt(linClear);
    ok('BF partial: 2 of 5 taps in front gives 0.6 of the all-clear veil (within 0.03)', Math.abs(ratio - 0.6) <= 0.03, 'ratio ' + ratio.toFixed(3) + ' over ' + groundIdx.length + ' ground pixels, linear buffer');
    await hook(page, 'lampHaloTapOverride', null);
    const errs = errors.filter((e) => !/favicon|404/.test(e));
    ok('BF no page errors', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : 'none');
  } catch (e) {
    ok('BF run completed', false, String(e && e.stack || e).slice(0, 400));
  } finally {
    if (A) await A.browser.close();
  }
  const pass = checks.filter(Boolean).length;
  console.log('BF-lamp-halo-over-objects: ' + pass + '/' + checks.length + ' passed');
  process.exit(pass === checks.length && checks.length > 0 ? 0 : 1);
})();
