// glm5.2 / P3 (option haloMoment): first-moment bins — each bin's glow mass is placed at its
// glow-weighted mean depth (the first moment rides in the table's free alpha channel) instead of
// the bin edge. Node: node tests/halo-moment.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };

// Load the halo module from a given tree (shaders first, then halo). Exposes haloTableSource + haloLookup.
const loadHalo = (file) => {
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: file + '/shaders.js' });
  const g = globalThis; delete g.__fw;
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  vm.runInThisContext(src + '\nglobalThis.__fw = { haloTableSource, haloLookup, HALO_EDGES };', { filename: file + '/halo.js' });
  return g.__fw;
};
// Load in a FRESH context (so a second tree can be loaded without redeclaring top-level consts).
// RF (set up by load()) is copied in so the halo source's `globalThis.RF.Drive` resolves.
const loadHaloFresh = (file) => {
  const ctx = vm.createContext({ RF: globalThis.RF, URLSearchParams, location: null });
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  vm.runInContext(sh, ctx, { filename: file + '/shaders.js' });
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  vm.runInContext(src + '\nthis.__fw = { haloTableSource, haloLookup, HALO_EDGES };', ctx, { filename: file + '/halo.js' });
  return ctx.__fw;
};
load();
const F = loadHalo(ROOT);   // the workspace tree (this test runs against the tree it lives in)

// 1. The lookup shader carries the moment switch: a haloMoment uniform, the haloCurveP3H Hermite-through-means,
//    and the runtime branch that picks it when haloMoment != 0 (0 = the shipped edge-knot haloCurve).
{
  const sh = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  ok('lookup: the haloMoment uniform is declared', /uniform int haloMoment;/.test(sh));
  ok('lookup: haloCurveP3H (the monotone Hermite through the means) is present', /vec3 haloCurveP3H\(/.test(sh));
  ok('lookup: haloPchipSlope (the Fritsch-Carlson knot slope) is present', /vec3 haloPchipSlope\(/.test(sh));
  ok('lookup: the runtime branch picks haloCurveP3H when haloMoment == 1', /if\s*\(haloMoment\s*==\s*1\)\s*return haloCurveP3H/.test(sh));
  ok('lookup: haloCurveP3L2d (the sin² blend variant) is present', /vec3 haloCurveP3L2d\(/.test(sh));
  ok('lookup: the runtime branch picks haloCurveP3L2d when haloMoment == 2', /if\s*\(haloMoment\s*==\s*2\)\s*return haloCurveP3L2d/.test(sh));
  ok('lookup: the mean is the per-bin moment over the per-bin glow mass', /\(K[23]\.a ?- ?K[12]\.a\) ?\/ ?lum[0-9]/.test(sh));
}

// 2. The table shader: OFF (moment = 0) compiles the shipped text byte-for-byte (no surgery); ON (moment = 1) rewrites the march to
//    split the scalar weight, declares accM, writes vec4(acc, accM), and scales accM with the share. TBLUR and TCUM carry the alpha
//    unconditionally (it is unread when haloMoment = 0, so the OFF render is byte-identical); the uniform only switches the lookup.
{
  const off = F.haloTableSource(false, false, false, '', false, false, 0, 0, 0, 0), on = F.haloTableSource(false, false, false, '', false, false, 0, 0, 0, 1);
  ok('table: OFF (moment=0) carries no moment (no accM, no float w) — byte-identical to the shipped text is covered by the frozen-text tests', !/accM|float w =/.test(off), { off: off.length });
  ok('table: ON declares the first-moment accumulator', /float accM = 0\.0;/.test(on));
  ok('table: ON writes the moment into alpha', /gl_FragColor = vec4\(acc, accM\);/.test(on));
  ok('table: ON splits the march (float w) and accumulates the moment (accM += s * w)', /float w = sigma/.test(on) && /accM \+= s \* w;/.test(on));
  const onSplit = F.haloTableSource(false, false, false, 'split', false, false, 0, 0, 0, 1);
  ok('table: ON split scales the moment with the share (accM *= swt) and zeroes the early-out alpha', /accM \*= swt;/.test(onSplit) && /vec4\(0\.0, 0\.0, 0\.0, 0\.0\)/.test(onSplit));
  ok('table: the blend sums source alpha on the moment variant (OneFactor when moment), not discards it (ZeroFactor when off)', /blendSrcAlpha:\s*moment \? T\.OneFactor : T\.ZeroFactor/.test(fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8')));
  // glm5.3flash review canary: momentText/moment2Text throw if the march accumulation line moves (prevents a silent no-op that would produce a table declaring accM/accM2 but never accumulating it)
  const haloSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
  ok('canary: momentText has the MOMENT_MARCH guard (throws on anchor move)', /const MOMENT_MARCH = 'acc \+= sigma/.test(haloSrc) && /momentText: march accumulation line not found/.test(haloSrc));
  ok('canary: moment2Text has the same MOMENT_MARCH guard', /moment2Text: march accumulation line not found/.test(haloSrc));
}

// 3. The CPU twin haloLookup: OFF (no moment) is the shipped Hermite, byte for byte. Load the shipped
//    tree from /workspace (the host copy without P3) and compare over a sweep of depths. The moment
//    param is additive: undefined / 0 take the shipped path; a truthy value takes the step-at-mean.
{
  const WS = path.join(__dirname, '..');   // the shared tree (shipped, no P3) — the OFF baseline
  const hasShipped = fs.existsSync(path.join(WS, 'js', 'drive-three-halo.js'));
  const shW = fs.readFileSync(path.join(WS, 'js', 'drive-three-shaders.js'), 'utf8');
  const shippedHasMoment = /uniform int haloMoment;/.test(shW);
  let shipped = null;
  if (hasShipped && !shippedHasMoment) shipped = loadHaloFresh(WS);   // only if /workspace is the pre-P3 build
  const edges = F.HALO_EDGES.slice(1);
  // a fixture: one mid bin (10) carries all the glow, at its midpoint (mean clearly inside the bin); the rest is dark.
  // Uses the test context's own edges (which run to ~120, the default haloSMax), not the 250 m state-pose edges.
  const kBin = 10, meanK = (edges[kBin - 1] + edges[kBin]) / 2;
  const bins = Array.from({ length: 24 }, (_, k) => (k === kBin ? [1, 1, 1, meanK] : [0, 0, 0, 0]));   // [r,g,b,moment]
  const ddSweep = [edges[kBin - 1] + 0.01, meanK - 2, meanK - 0.001, meanK + 0.001, meanK + 2, edges[kBin] - 0.01];
  let offEqShipped = true, offVsOn = false;
  for (const dd of ddSweep) {
    const off = F.haloLookup(bins.map((b) => b.slice(0, 3)), dd, edges);          // no moment → shipped Hermite
    const on = F.haloLookup(bins, dd, edges, 1);                                  // moment → Hermite through the means
    if (shipped) { const w = shipped.haloLookup(bins.map((b) => b.slice(0, 3)), dd, edges); offEqShipped = offEqShipped && w[0] === off[0] && w[1] === off[1] && w[2] === off[2]; }
    if (Math.abs(on[0] - off[0]) > 1e-9 || Math.abs(on[1] - off[1]) > 1e-9) offVsOn = true;   // ON differs from OFF somewhere
  }
  // ON is smooth at the mean (the Hermite ramps, no hard step) and monotone (PCHIP never overshoots)
  const before = F.haloLookup(bins, meanK - 0.001, edges, 1), after = F.haloLookup(bins, meanK + 0.001, edges, 1);
  const onSmooth = Math.abs(after[0] - before[0]) < 0.5;   // the Hermite is C1 continuous: no jump at the mean
  let onMono = true, prevOn = -1; for (const dd of [...ddSweep].sort((a, b) => a - b)) { const v = F.haloLookup(bins, dd, edges, 1); if (v[0] < prevOn - 1e-9) onMono = false; prevOn = v[0]; }
  ok('cpu twin: OFF (no moment) is byte-identical to the shipped Hermite' + (shipped ? '' : ' (skipped: /workspace already has P3)'), !shipped || offEqShipped, { offEqShipped });
  ok('cpu twin: ON (moment) differs from OFF somewhere in the bin', offVsOn);
  ok('cpu twin: ON is smooth at the mean (the Hermite ramps, no hard step)', onSmooth, { before: before[0], after: after[0], meanK });
  ok('cpu twin: ON is monotone (PCHIP never overshoots across the sweep)', onMono);
  // OFF does NOT step at the mean (the Hermite ramps across the bin)
  const offBefore = F.haloLookup(bins.map((b) => b.slice(0, 3)), meanK - 0.001, edges), offAfter = F.haloLookup(bins.map((b) => b.slice(0, 3)), meanK + 0.001, edges);
  ok('cpu twin: OFF does not step at the mean (the Hermite is smooth there)', Math.abs(offAfter[0] - offBefore[0]) < 0.5, { offBefore: offBefore[0], offAfter: offAfter[0] });
}

// 4. The registry entry: declared once, default off, GPU/air/haloOn required, ignored while P1c is on.
{
  const Opt = require(path.join(ROOT, 'js', 'options-registry.js')), e = Opt.OPTIONS.find((x) => x.id === 'haloMoment');
  ok('registry: haloMoment is declared once, default off, with off, on, blend and moment2', !!e && e.default === 'off' && e.values.join(',') === 'off,on,blend,moment2' && e.type === 'enum');
  ok('registry: defaults() carries it as off', Opt.defaults().haloMoment === 'off');
  ok('registry: requires gpu, air and haloOn', e && e.requires.some((r) => r.rule === 'gpu') && e.requires.some((r) => r.rule === 'air') && e.requires.some((r) => r.rule === 'haloOn'));
  ok('registry: cites the node test', e && e.tests.join(',') === 'node:halo-moment');
}

// 5. haloState() exposes the moment flag (so a page test can read it, like lw and cross).
{
  const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
  ok('haloState: exposes moment next to lw and cross', /moment:\s*halo\.moment\s*\|\|\s*0/.test(src));
}

// 6. L2d (haloMoment 'blend'): the sin² blend variant. Same first-moment data as 'on', but each mean is blended
//    toward its bin's upper edge by w = sin²(πu) (u = the evaluation depth's normalized within-bin position).
//    w=0 at both bin edges (knots = means, so blend = on there); w=1 at mid-bin (knots = edges, so blend = off there).
//    A zero-new-data fallback: no extra channel, no extra texture. ~20-25% better than shipped, does not fully fix either field.
{
  const HP = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
  ok('l2d: the uniform feed maps blend to 2 and moment2 to 3', /look\.haloMoment === 'on' \? 1 : look\.haloMoment === 'blend' \? 2 : look\.haloMoment === 'moment2' \? 3 : 0/.test(HP));
  ok('l2d: the CPU twin has the blend branch', /if \(moment === 'blend'\)/.test(HP));
  ok('l2d: the blend uses sin²(πu)', /Math\.sin\(Math\.PI \* u\) \*\* 2/.test(HP));
  // same fixture as section 3: bin 10 carries all the glow at its midpoint
  const edges = F.HALO_EDGES.slice(1);
  const kBin = 10, meanK = (edges[kBin - 1] + edges[kBin]) / 2;
  const bins = Array.from({ length: 24 }, (_, k) => (k === kBin ? [1, 1, 1, meanK] : [0, 0, 0, 0]));
  const mid = meanK, lo = edges[kBin - 1] + 0.001, hi = edges[kBin] - 0.001;   // just inside each edge of bin 10
  const off = (dd) => F.haloLookup(bins.map((b) => b.slice(0, 3)), dd, edges);            // shipped (edge knots)
  const on = (dd) => F.haloLookup(bins, dd, edges, 1);                                       // P3 (Hermite through means)
  const blend = (dd) => F.haloLookup(bins, dd, edges, 'blend');                              // L2d (sin² blend)
  // (a) at mid-bin (u=0.5, w=1): knots = edges, so blend = shipped (off), exact
  const bMid = blend(mid), oMid = off(mid), onMid = on(mid);
  ok('l2d: at mid-bin (w=1) blend equals shipped (edge knots)', Math.abs(bMid[0] - oMid[0]) < 1e-9 && Math.abs(bMid[1] - oMid[1]) < 1e-9, { bMid: bMid[0], oMid: oMid[0] });
  ok('l2d: at mid-bin blend differs from on (means)', Math.abs(bMid[0] - onMid[0]) > 1e-9 || Math.abs(bMid[1] - onMid[1]) > 1e-9, { bMid: bMid[0], onMid: onMid[0] });
  // (b) near both bin edges (u→0 or u→1, w→0): knots ≈ means, so blend ≈ on (P3). w is small but nonzero off the exact edge,
  //     so the match is within ~1e-4 (w ≈ (π·0.001/binwidth)² ≈ 1e-5, propagated through the PCHIP)
  const bLo = blend(lo), onLo = on(lo), bHi = blend(hi), onHi = on(hi);
  ok('l2d: near the lower edge (w≈0) blend ≈ on (means)', Math.abs(bLo[0] - onLo[0]) < 1e-4 && Math.abs(bLo[1] - onLo[1]) < 1e-4, { bLo: bLo[0], onLo: onLo[0], diff: Math.abs(bLo[0] - onLo[0]) });
  ok('l2d: near the upper edge (w≈0) blend ≈ on (means)', Math.abs(bHi[0] - onHi[0]) < 1e-4 && Math.abs(bHi[1] - onHi[1]) < 1e-4, { bHi: bHi[0], onHi: onHi[0], diff: Math.abs(bHi[0] - onHi[0]) });
  // (c) monotone: the PCHIP through the blended knots never overshoots
  const ddSweepL2d = [edges[kBin - 1] + 0.01, meanK - 2, meanK - 0.001, meanK + 0.001, meanK + 2, edges[kBin] - 0.01];
  let blendMono = true, prev = -1; for (const dd of [...ddSweepL2d].sort((a, b) => a - b)) { const v = blend(dd); if (v[0] < prev - 1e-9) blendMono = false; prev = v[0]; }
  ok('l2d: blend is monotone (PCHIP through blended knots never overshoots)', blendMono);
  // (d) no NaN/Inf over a wide sweep (the clamp + strictly-increasing guard holds for the blend too)
  let bad = 0; for (let i = 0; i <= 300; i++) { const d = 0.6 * Math.pow(250 / 0.6, i / 300); const v = blend(d); if (!isFinite(v[0]) || !isFinite(v[1]) || !isFinite(v[2])) bad++; }
  ok('l2d: no NaN/Inf over 301 depths', bad === 0, { bad });
}

// 7. M2 (haloMoment 'moment2'): the log-normal second-moment CDF lookup. A second texture carries Σw·s² per bin;
//    the lookup places mass via a renormalized log-normal CDF using the bin's own (mean, variance). Monotone by construction
//    (the CDF is monotone), so the Hermite clamp apparatus is retired. ~6-8× better than shipped (allAbs 0.048/0.069 vs 0.388/0.411).
{
  const SH = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  const DT = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
  ok('m2: the GPU dispatch picks haloCurveP3M2 when haloMoment == 3 (behind #ifdef HALO_M2)', /#ifdef HALO_M2\n  if\(haloMoment==3\) return haloCurveP3M2/.test(SH));
  ok('m2: drive-three.js toggles material.defines.HALO_M2 when moment2 flips (OFF = stripped, ON = compiled in)', /delete mat\.defines\.HALO_M2/.test(DT) && /mat\.defines\.HALO_M2 = 1/.test(DT));
  ok('m2: haloCurveP3M2 is present', /vec3 haloCurveP3M2\(/.test(SH));
  ok('m2: haloBin4M2 (the second-moment table read) is present', /vec4 haloBin4M2\(/.test(SH));
  ok('m2: erf (A&S 7.1.26) is present', /float haloErf\(float x\)/.test(SH));
  ok('m2: the haloM2Tex sampler is declared behind #ifdef HALO_M2 (compiled in only when moment2 is on, via material.defines — keeps the static sampler count at 13)', /#ifdef HALO_M2\nuniform sampler2D haloM2Tex/.test(SH));
  // CPU twin: same fixture as section 3 (bin 10 carries all the glow at its midpoint)
  const edges = F.HALO_EDGES.slice(1);
  const kBin = 10, meanK = (edges[kBin - 1] + edges[kBin]) / 2;
  // (a) the second moment: a point mass at meanK → var = 0 → linear interp (degenerate case)
  const binsPoint = Array.from({ length: 24 }, (_, k) => (k === kBin ? [1, 1, 1, meanK] : [0, 0, 0, 0]));
  const m2Point = Array.from({ length: 24 }, (_, k) => (k === kBin ? meanK * meanK : 0));   // Σw·s² = meanK² (point mass)
  const vp = F.haloLookup(binsPoint, meanK, edges, 'moment2', m2Point);
  ok('m2: point mass (var=0) → linear interp, no NaN', isFinite(vp[0]) && isFinite(vp[1]) && isFinite(vp[2]), { vp: vp[0] });
  // (b) the second moment: a spread mass → the CDF places mass between the edges (not at the edge, not at the mean)
  const lo = edges[kBin - 1], hi = edges[kBin];
  const spread = (lo + 2 * hi) / 3;   // a mean biased toward hi
  const binsSpread = Array.from({ length: 24 }, (_, k) => (k === kBin ? [1, 1, 1, spread] : [0, 0, 0, 0]));
  // var > 0: accM2/Σw > mean² → accM2 = Σw * (mean² + var) = spread² + var
  const varTest = (hi - lo) * (hi - lo) / 12;   // a uniform-like spread
  const m2Spread = Array.from({ length: 24 }, (_, k) => (k === kBin ? spread * spread + varTest : 0));
  const vs = F.haloLookup(binsSpread, spread, edges, 'moment2', m2Spread);
  ok('m2: spread mass → no NaN/Inf', isFinite(vs[0]) && isFinite(vs[1]) && isFinite(vs[2]), { vs: vs[0] });
  // (c) monotone: the CDF is monotone by construction — sweep dd across the bin, the result never decreases
  let m2Mono = true, prev = -1; for (let i = 0; i <= 50; i++) { const dd = lo + (hi - lo) * i / 50; const v = F.haloLookup(binsSpread, dd, edges, 'moment2', m2Spread); if (v[0] < prev - 1e-9) m2Mono = false; prev = v[0]; }
  ok('m2: the log-normal CDF is monotone (never decreases across the bin)', m2Mono);
  // (d) at the bin edges, the CDF matches the cumulative values (u=0 at lo, u=1 at hi)
  const vLo = F.haloLookup(binsSpread, lo + 0.001, edges, 'moment2', m2Spread);
  const vHi = F.haloLookup(binsSpread, hi - 0.001, edges, 'moment2', m2Spread);
  const Cc = [0, 0, 0]; for (let k = 0; k < kBin; k++) { Cc[0] += binsSpread[k][0]; Cc[1] += binsSpread[k][1]; Cc[2] += binsSpread[k][2]; }
  ok('m2: near the lower edge (u≈0) ≈ cumulative at lo', Math.abs(vLo[0] - Cc[0]) < 0.15, { vLo: vLo[0], Cc: Cc[0] });
  ok('m2: near the upper edge (u≈1) ≈ cumulative at hi', Math.abs(vHi[0] - (Cc[0] + 1)) < 0.15, { vHi: vHi[0], CcHi: Cc[0] + 1 });
  // (e) no NaN/Inf over a wide sweep
  let bad2 = 0; for (let i = 0; i <= 300; i++) { const d = 0.6 * Math.pow(250 / 0.6, i / 300); const v = F.haloLookup(binsSpread, d, edges, 'moment2', m2Spread); if (!isFinite(v[0]) || !isFinite(v[1]) || !isFinite(v[2])) bad2++; }
  ok('m2: no NaN/Inf over 301 depths', bad2 === 0, { bad2 });
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
