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
  ok('lookup: the runtime branch picks haloCurveP3H when haloMoment != 0', /if\s*\(haloMoment\s*!=\s*0\)\s*return haloCurveP3H/.test(sh));
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
  const onCross = F.haloTableSource(false, false, false, '', false, false, 0, 512, true, 1);   // P3+RN: crossing-refined + moment
  ok('table: ON + crossing refinement composes (the refined ladder accumulates accM += rs * w)', /accM \+= rs \* w;/.test(onCross) && /float accM = 0\.0;/.test(onCross) && /vec4\(acc, accM\);/.test(onCross));
  ok('table: the blend sums source alpha on the moment variant (OneFactor when moment), not discards it (ZeroFactor when off)', /blendSrcAlpha:\s*moment \? T\.OneFactor : T\.ZeroFactor/.test(fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8')));
}

// 3. The CPU twin haloLookup: OFF (no moment) is the shipped Hermite, byte for byte. Load the shipped
//    tree from /workspace (the host copy without P3) and compare over a sweep of depths. The moment
//    param is additive: undefined / 0 take the shipped path; a truthy value takes the step-at-mean.
{
  const WS = '/workspace';   // the shared tree (shipped, no P3) — the OFF baseline
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

// 4. The registry entry: declared once, default off, GPU/air/haloOn required, composes with crossing refinement.
{
  const Opt = require(path.join(ROOT, 'js', 'options-registry.js')), e = Opt.OPTIONS.find((x) => x.id === 'haloMoment');
  ok('registry: haloMoment is declared once, default off, with off and on', !!e && e.default === 'off' && e.values.join(',') === 'off,on' && e.type === 'enum');
  ok('registry: defaults() carries it as off', Opt.defaults().haloMoment === 'off');
  ok('registry: requires gpu, air and haloOn; composes with crossingRefine (no ignoredWhen)', e && e.requires.some((r) => r.rule === 'gpu') && e.requires.some((r) => r.rule === 'air') && e.requires.some((r) => r.rule === 'haloOn') && !e.ignoredWhen);
  ok('registry: cites the node test', e && e.tests.join(',') === 'node:halo-moment');
}

// 5. haloState() exposes the moment flag (so a page test can read it, like lw and cross).
{
  const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
  ok('haloState: exposes moment next to lw and cross', /moment:\s*halo\.moment\s*\|\|\s*0/.test(src));
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
