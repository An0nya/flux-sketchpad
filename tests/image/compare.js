// Tolerance-based image comparison for page tests: replaces exact sha256 frame pins.
// References live at tests/refs/<test>/<case>.<gpuClass>.png (one per renderer/platform class: a frame from SwiftShader and one from an
// Apple M4 are different, equally valid pictures). A frame passes when it is within tolerance of the reference for the class it ran on.
//
//   const IMG = require('../image/compare.js');
//   const cls = await IMG.gpuClass(page);                                  // e.g. chromium-swiftshader, chromium-apple-m4, webkit-apple
//   const r = IMG.checkRef({ test: 'FG-fog', name: 'clear', png, cls, pin: OLD_CLEAR, tol: { flipMean: 0.005 } });
//   ok('FG clear frame matches its reference', r.pass, r.detail);
//
// Env:
//   REF_UPDATE=1        write the frame as the reference for its class (all cases), and pass. REF_UPDATE=FG-fog,SC-beam-scatter limits it to those tests.
//   IMG_STRICT=1        also require the old exact sha256 pin (only meaningful on the GPU that recorded it: the owner's Apple M4).
//   IMG_GPU_CLASS=name  override the detected class (e.g. to compare against another machine's references on purpose).
// On a failure the frame, the reference and a FLIP heatmap are written to tests/shots/imgdiff/ (git-ignored).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const PNG = require('./png.js'), { flip, heatmap, quantiles } = require('./flip.js');
const ROOT = path.join(__dirname, '..', 'refs'), SHOTS = path.join(__dirname, '..', 'shots', 'imgdiff');
// Defaults are PROVISIONAL (not yet calibrated): measure run-to-run noise per class and the smallest real render change
// worth catching, then set these between the two.
const DEFAULT_TOL = { flipMean: 0.001, flipP99: 0.1, pixelFrac: 0.002, pixelThreshold: 0.1 };

// pixelmatch-style per-pixel test: YIQ colour distance (Kotsarenko & Ramos 2009, as pixelmatch uses), a pixel "differs" when its
// squared distance exceeds threshold^2 of the maximum (35215). No anti-alias detection: references are per class, so AA matches.
function pixelDiff(a, b, threshold, mask) {
  const n = a.w * a.h, maxD = 35215 * threshold * threshold; let count = 0, counted = 0, maxCh = 0;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) continue; counted++;
    const o = i * 4, r = a.data[o] - b.data[o], g = a.data[o + 1] - b.data[o + 1], bl = a.data[o + 2] - b.data[o + 2];
    const y = r * 0.29889531 + g * 0.58662247 + bl * 0.11448223, iq = r * 0.59597799 - g * 0.2741761 - bl * 0.32180189, q = r * 0.21147017 - g * 0.52261711 + bl * 0.31114694;
    if (0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q > maxD) count++;
    maxCh = Math.max(maxCh, Math.abs(r), Math.abs(g), Math.abs(bl));
  }
  return { count, frac: counted ? count / counted : 0, maxChannel: maxCh };
}
// rects [{x, y, w, h}] in image pixels -> Uint8Array mask (1 = ignored)
function maskOf(w, h, rects) {
  if (!rects || !rects.length) return null; const m = new Uint8Array(w * h);
  for (const r of rects) for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(h, Math.ceil(r.y + r.h)); y++) for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(w, Math.ceil(r.x + r.w)); x++) m[y * w + x] = 1;
  return m;
}
// compare two decoded images; masked pixels are copied from the reference into the test (so FLIP's filters see no difference there)
function compare(ref, test, opts) {
  opts = opts || {}; const tol = Object.assign({}, DEFAULT_TOL, opts.tol);
  if (ref.w !== test.w || ref.h !== test.h) return { pass: false, sizeMismatch: true, detail: 'size ' + test.w + 'x' + test.h + ' vs reference ' + ref.w + 'x' + ref.h };
  const mask = maskOf(ref.w, ref.h, opts.mask);
  if (mask) { test = { w: test.w, h: test.h, data: Uint8Array.from(test.data) }; for (let i = 0; i < mask.length; i++) if (mask[i]) for (let c = 0; c < 4; c++) test.data[i * 4 + c] = ref.data[i * 4 + c]; }
  const px = pixelDiff(ref, test, tol.pixelThreshold, mask), F = flip(ref, test, { ppd: opts.ppd });
  let mean = F.mean;
  if (mask) { let s = 0, k = 0; for (let i = 0; i < F.map.length; i++) if (!mask[i]) { s += F.map[i]; k++; } mean = k ? s / k : 0; Object.assign(F, quantiles(F.map, mask)); }
  const fails = [];
  if (mean > tol.flipMean) fails.push('FLIP mean ' + mean.toFixed(5) + ' > ' + tol.flipMean);
  if (F.p99 > tol.flipP99) fails.push('FLIP p99 ' + F.p99.toFixed(4) + ' > ' + tol.flipP99);
  if (px.frac > tol.pixelFrac) fails.push('pixels differing ' + (100 * px.frac).toFixed(3) + '% > ' + (100 * tol.pixelFrac).toFixed(3) + '%');
  const stats = 'FLIP mean ' + mean.toExponential(2) + ' p99 ' + F.p99.toFixed(4) + ' max ' + F.max.toFixed(3) + ', ' + px.count + ' px differ (' + (100 * px.frac).toFixed(3) + '%), max channel delta ' + px.maxChannel;
  return { pass: fails.length === 0, flip: { mean, p50: F.p50, p95: F.p95, p99: F.p99, max: F.max }, pixels: px, map: F.map, tol, detail: (fails.length ? fails.join('; ') + ' — ' : '') + stats };
}
// WebGL renderer string -> a short class name. Engine first (Chromium's ANGLE and WebKit's Metal path draw differently on one GPU).
function classify(engine, renderer) {
  const r = String(renderer || '').toLowerCase(); let gpu;
  if (/swiftshader/.test(r)) gpu = 'swiftshader';
  else if (/llvmpipe/.test(r)) gpu = 'llvmpipe';
  else if (/apple m\d+/.test(r)) gpu = 'apple-' + r.match(/apple (m\d+)/)[1];
  else if (/apple/.test(r)) gpu = 'apple';                                       // Safari reports only "Apple GPU"
  else gpu = (r.match(/nvidia|amd|radeon|intel|adreno|mali/) || ['unknown'])[0];
  return engine + '-' + gpu;
}
async function gpuClass(page) {
  if (process.env.IMG_GPU_CLASS) return process.env.IMG_GPU_CLASS;
  const renderer = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); if (!c) return 'none'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); });
  let engine = 'chromium'; try { engine = page.context().browser().browserType().name(); } catch (e) { /* not a Playwright page: keep chromium */ }
  return classify(engine, renderer);
}
const refPath = (test, name, cls) => path.join(ROOT, test, name + '.' + cls + '.png');
const updating = (test) => { const u = process.env.REF_UPDATE; return !!u && (u === '1' || u.split(',').includes(test)); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Check a captured PNG (Buffer) against tests/refs/<test>/<name>.<cls>.png. Returns { pass, detail, ... }.
// pin: the old exact sha256 (strict mode, IMG_STRICT=1). mask: rects to ignore (e.g. UI overlays). tol: overrides DEFAULT_TOL.
function checkRef({ test, name, png, cls, pin, mask, tol, ppd }) {
  const file = refPath(test, name, cls), hash = sha(png), rel = path.relative(path.join(__dirname, '..', '..'), file);
  if (updating(test)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png); return { pass: true, updated: true, hash, detail: 'REF_UPDATE: wrote ' + rel + ' (sha256 ' + hash + ')' }; }
  const strict = process.env.IMG_STRICT === '1' && pin ? (hash === pin ? ' [strict: sha256 pin matches]' : null) : '';
  if (strict === null) return { pass: false, hash, detail: 'IMG_STRICT: sha256 ' + hash + ' != pin ' + pin };
  if (!fs.existsSync(file)) return { pass: false, missing: true, hash, detail: 'no reference ' + rel + ' for class ' + cls + ' (record one: REF_UPDATE=' + test + ' node ...; sha256 ' + hash + ')' };
  const ref = PNG.decode(fs.readFileSync(file)), cur = PNG.decode(png), r = compare(ref, cur, { mask, tol, ppd });
  if (!r.pass && !r.sizeMismatch) {
    fs.mkdirSync(SHOTS, { recursive: true }); const base = path.join(SHOTS, test + '-' + name + '.' + cls);
    fs.writeFileSync(base + '.test.png', png); fs.copyFileSync(file, base + '.ref.png'); fs.writeFileSync(base + '.flip.png', PNG.encode(ref.w, ref.h, heatmap(r.map, ref.w, ref.h)));
    r.detail += ' (wrote ' + path.relative(path.join(__dirname, '..', '..'), base) + '.{test,ref,flip}.png)';
  }
  delete r.map; return Object.assign(r, { hash, detail: r.detail + (strict || '') });
}
// Rects (in the element screenshot's pixels) of visible elements drawn over the canvas: the drive toolbar and side panels overlay the
// canvas in a small pane, and their text/layout moved several old pins without a render change. Masked by default in the converted tests.
async function overlayRects(page, canvasSelector) {
  return page.evaluate((sel) => {
    const cv = document.querySelector(sel); if (!cv) return []; const cb = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1, out = [];
    const step = 4, seen = new Set();
    for (let y = cb.top + 1; y < cb.bottom; y += step) for (let x = cb.left + 1; x < cb.right; x += step) {
      let el = document.elementFromPoint(x, y); if (!el || el === cv || cv.contains(el) || el.contains(cv)) continue;
      while (el.parentElement && !el.parentElement.contains(cv) && el.parentElement.getBoundingClientRect().width < cb.width * 0.98) el = el.parentElement;   // the overlay's own box
      if (seen.has(el)) continue; seen.add(el); const r = el.getBoundingClientRect();
      const x0 = Math.max(r.left, cb.left), y0 = Math.max(r.top, cb.top), x1 = Math.min(r.right, cb.right), y1 = Math.min(r.bottom, cb.bottom);
      if (x1 > x0 && y1 > y0) out.push({ x: (x0 - cb.left) * dpr - 1, y: (y0 - cb.top) * dpr - 1, w: (x1 - x0) * dpr + 2, h: (y1 - y0) * dpr + 2 });
    }
    return out;
  }, canvasSelector);
}
module.exports = { compare, pixelDiff, checkRef, gpuClass, classify, overlayRects, refPath, sha, DEFAULT_TOL, decode: PNG.decode, encode: PNG.encode };
