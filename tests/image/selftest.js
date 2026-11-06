// Self-test for the image tolerance components: FLIP implementation, PNG round-trip, and the known-bad control.
// Run: node tests/image/selftest.js   (plain node, no browser)
'use strict';
const path = require('path'), fs = require('fs');
const PNG = require('./png.js'), { flip, heatmap, quantiles } = require('./flip.js'), { compare, pixelDiff, DEFAULT_TOL } = require('./compare.js');

const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// ---- helpers ----
const solid = (w, h, r, g, b, a) => { const d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a !== undefined ? a : 255; } return { w, h, data: d }; };
const gradient = (w, h) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; d[o] = Math.round(255 * x / (w - 1)); d[o + 1] = Math.round(255 * y / (h - 1)); d[o + 2] = 128; d[o + 3] = 255; } return { w, h, data: d }; };
const copyImg = (img) => ({ w: img.w, h: img.h, data: Uint8Array.from(img.data) });

// ---- 1. PNG round-trip ----
{
  const src = solid(32, 24, 200, 100, 50);
  const buf = PNG.encode(src.w, src.h, src.data);
  const dec = PNG.decode(buf);
  ok('PNG round-trip preserves dimensions', dec.w === src.w && dec.h === src.h, dec.w + 'x' + dec.h);
  let mismatch = 0;
  for (let i = 0; i < src.data.length; i++) if (src.data[i] !== dec.data[i]) mismatch++;
  ok('PNG round-trip is byte-identical RGBA', mismatch === 0, mismatch + ' differing bytes');
}

// ---- 2. FLIP: identical images zero ----
{
  const g = gradient(64, 48), g2 = copyImg(g);
  const F = flip(g, g2);
  ok('FLIP identical images: mean ~= 0', F.mean < 1e-6, 'mean ' + F.mean.toExponential(2));
  ok('FLIP identical images: max ~= 0', F.max < 1e-6, 'max ' + F.max.toExponential(2));
}

// ---- 3. FLIP: opposite images near 1 ----
{
  const black = solid(32, 32, 0, 0, 0), white = solid(32, 32, 255, 255, 255);
  const F = flip(black, white);
  ok('FLIP black vs white: mean near 1', F.mean > 0.9, 'mean ' + F.mean.toFixed(4));
  ok('FLIP black vs white: max == mean (uniform error)', Math.abs(F.max - F.mean) < 1e-6, 'max ' + F.max.toFixed(4) + ' mean ' + F.mean.toFixed(4));
}

// ---- 4. FLIP: small perturbation is small ----
{
  const g = gradient(64, 48), g2 = copyImg(g);
  // add 1 to ~2.5% of pixels' red channel — barely perceptible
  for (let i = 0; i < g2.data.length; i += 160) g2.data[i] = Math.min(255, g2.data[i] + 1);
  const F = flip(g, g2);
  ok('FLIP tiny perturbation: mean > 0', F.mean > 0, 'mean ' + F.mean.toExponential(2));
  ok('FLIP tiny perturbation: mean < 0.002', F.mean < 0.002, 'mean ' + F.mean.toFixed(6));
}

// ---- 5. FLIP: quantiles are monotonic ----
{
  const g = gradient(64, 48);
  const F = flip(g, solid(64, 48, 128, 128, 128));
  ok('FLIP quantiles monotonic: p50 <= p95 <= p99 <= max', F.p50 <= F.p95 && F.p95 <= F.p99 && F.p99 <= F.max,
    'p50 ' + F.p50.toFixed(4) + ' p95 ' + F.p95.toFixed(4) + ' p99 ' + F.p99.toFixed(4) + ' max ' + F.max.toFixed(4));
}

// ---- 6. FLIP: heatmap produces valid RGBA ----
{
  const g = gradient(16, 12), g2 = solid(16, 12, 128, 128, 128);
  const F = flip(g, g2), hm = heatmap(F.map, 16, 12);
  ok('FLIP heatmap: correct size', hm.length === 16 * 12 * 4, String(hm.length));
  ok('FLIP heatmap: all alpha 255', hm.every((v, i) => i % 4 !== 3 || v === 255), 'alpha check');
}

// ---- 7. compare() with identical images ----
{
  const g = gradient(100, 80), g2 = copyImg(g);
  const r = compare(g, g2);
  ok('compare identical: pass', r.pass, r.detail);
  ok('compare identical: FLIP mean ~= 0', r.flip.mean < 1e-6, r.flip.mean.toExponential(2));
  ok('compare identical: 0 differing pixels', r.pixels.count === 0, String(r.pixels.count));
}

// ---- 8. compare() size mismatch ----
{
  const r = compare(solid(32, 32, 0, 0, 0), solid(64, 32, 0, 0, 0));
  ok('compare size mismatch: fails', !r.pass && r.sizeMismatch, r.detail);
}

// ---- 9. pixelDiff ----
{
  const a = solid(10, 10, 200, 100, 50), b = copyImg(a);
  b.data[0] = 255; b.data[1] = 255; b.data[2] = 255;  // one pixel changed
  const px = pixelDiff(a, b, 0.1);
  ok('pixelDiff one pixel changed: count 1', px.count === 1, 'count ' + px.count);
  const px2 = pixelDiff(a, b, 0.0);
  ok('pixelDiff threshold 0: count 1', px2.count === 1, 'count ' + px2.count);
}

// ---- 10. Known-bad control: a deliberately wrong reference MUST fail ----
{
  // Create a "reference" and a "test frame" that differ perceptibly
  const ref = solid(64, 48, 100, 150, 200);
  const testFrame = solid(64, 48, 180, 50, 30);  // clearly different
  const r = compare(ref, testFrame, { tol: { flipMean: 0.005, flipP99: 0.1, pixelFrac: 0.002, pixelThreshold: 0.1 } });
  ok('KNOWN-BAD CONTROL: different images FAIL tolerance', !r.pass, r.detail + ' — THIS FAILURE IS EXPECTED AND REQUIRED');
  
  // Also check with strict tolerance: even tiny differences should fail
  const ref2 = gradient(32, 32);
  const test2 = copyImg(ref2);
  test2.data[0] = test2.data[0] > 200 ? 200 : 255;  // change first pixel significantly
  const r2 = compare(ref2, test2, { tol: { flipMean: 0.0, flipP99: 0.0, pixelFrac: 0.0, pixelThreshold: 0.0 } });
  ok('KNOWN-BAD CONTROL: perturbed image FAILS zero-tolerance', !r2.pass, 'FLIP mean ' + r2.flip.mean.toExponential(2) + ' — THIS FAILURE IS EXPECTED AND REQUIRED');
  
  // But with a lenient tolerance it should pass (proving tolerance works in both directions)
  const r3 = compare(ref2, test2, { tol: { flipMean: 1.0, flipP99: 1.0, pixelFrac: 1.0, pixelThreshold: 1.0 } });
  ok('KNOWN-BAD CONTROL: same perturbation PASSES lenient tolerance', r3.pass, r3.detail);
}

// ---- 11. Mask test ----
{
  const a = solid(32, 32, 100, 100, 100), b = solid(32, 32, 100, 100, 100);
  // make top-left 16x16 different in b
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = (y * 32 + x) * 4; b.data[o] = 200; b.data[o + 1] = 200; b.data[o + 2] = 200; }
  const rNoMask = compare(a, b);
  ok('mask test: without mask, difference detected', !rNoMask.pass, rNoMask.detail);
  const rMasked = compare(a, b, { mask: [{ x: 0, y: 0, w: 16, h: 16 }] });
  ok('mask test: with mask covering changed region, passes', rMasked.pass, rMasked.detail);
}

// ---- 12. DEFAULT_TOL is a reasonable object ----
{
  ok('DEFAULT_TOL has flipMean', typeof DEFAULT_TOL.flipMean === 'number' && DEFAULT_TOL.flipMean > 0, String(DEFAULT_TOL.flipMean));
  ok('DEFAULT_TOL has flipP99', typeof DEFAULT_TOL.flipP99 === 'number' && DEFAULT_TOL.flipP99 > 0, String(DEFAULT_TOL.flipP99));
  ok('DEFAULT_TOL has pixelFrac', typeof DEFAULT_TOL.pixelFrac === 'number', String(DEFAULT_TOL.pixelFrac));
  ok('DEFAULT_TOL has pixelThreshold', typeof DEFAULT_TOL.pixelThreshold === 'number' && DEFAULT_TOL.pixelThreshold > 0, String(DEFAULT_TOL.pixelThreshold));
}

// ---- 13. classify function ----
{
  const { classify } = require('./compare.js');
  ok('classify swiftshader', classify('chromium', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))').endsWith('swiftshader'), classify('chromium', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))'));
  ok('classify apple m4', classify('chromium', 'Apple M4').endsWith('apple-m4'), classify('chromium', 'Apple M4'));
  ok('classify webkit apple', classify('webkit', 'Apple GPU').endsWith('apple'), classify('webkit', 'Apple GPU'));
}

// ---- 14. refPath ----
{
  const { refPath } = require('./compare.js');
  const p = refPath('FG-fog', 'clear', 'chromium-swiftshader');
  ok('refPath ends with class.png', p.endsWith('clear.chromium-swiftshader.png'), p);
  ok('refPath contains test name', p.includes('FG-fog'), p);
}

console.log('');
const fails = checks.filter((c) => !c.pass).length;
console.log(fails ? fails + ' FAILED of ' + checks.length + ' image self-tests' : 'all ' + checks.length + ' image self-tests passed');
process.exitCode = fails ? 1 : 0;