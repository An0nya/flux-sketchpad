// qwen3.8max / RN (option haloRefineNeighbour): widen P1c's crossing-bin trigger to that bin's eye-side neighbour.
// Why: sCross is pinned at the lamp's forward-plane crossing (~the lamp depth) while the glow centroid slides toward
// the eye, so the bin holding the light is usually the next one nearer. At the valley pose (D=199 m) the dominant bin
// was one nearer in 24/30 rows, always exactly one, and refining only the crossing bin left it byte-identical to the
// shipped six steps (qwen3.8max/LANDED-FIXES-VALIDATION.md, data/stage11-13.json).
// Node: node tests/halo-refine-neighbour.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'step5-lampwin-off.fixture.json'), 'utf8'));
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHalo = () => {
  const sh = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: 'shaders.js' });
  const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  delete globalThis.__rn;
  vm.runInThisContext(src + '\nglobalThis.__rn = { haloTableSource, haloEdgesFor, setHaloBins, setHaloRange, HALO_MAX, get HALO_BINS() { return HALO_BINS; }, get HALO_RANGE() { return HALO_RANGE; } };', { filename: 'halo.js' });
  return globalThis.__rn;
};
load();
const F = loadHalo();
const src = (nb, refine = 2048, ...rest) => F.haloTableSource(false, false, false, '', false, false, 0, refine, nb);

// 1. OFF is byte-identical: no refine at all, and refine with the neighbour off.
for (const [k, args] of Object.entries({ off: [false, false, false, '', false, false], atlas: [true, false, false, '', false, false], split: [false, false, false, 'split', false, false], jit: [false, false, false, '', 'interleaved', false], polar: [false, true, false, '', false, false], band: [false, true, false, 'band', false, false] }))
  ok('RN off: the ' + k + ' table pass text is byte-identical to the frozen pre-option build', F.haloTableSource(...args) === FIX[k]);
for (const nn of [512, 2048]) {
  ok('RN off: P1c ' + nn + ' text is unchanged by the new parameter', src(false, nn) === F.haloTableSource(false, false, false, '', false, false, 0, nn));
  ok('RN off: P1c ' + nn + ' still triggers on the crossing bin alone', src(false, nn).includes('bool crossingBin = sCross >= lo && sCross <= hi;') && !src(false, nn).includes('rnHi'));
}

// 2. ON widens the trigger by exactly one bin toward the eye, and changes nothing else.
for (const nn of [512, 2048]) {
  const t = src(true, nn), off = src(false, nn);
  ok('RN on ' + nn + ': the trigger covers [lo, the next bin\'s far edge]', t.includes('bool crossingBin = sCross >= lo && sCross <= rnHi;') && t.includes('haloEdges[tile + 1]'));
  ok('RN on ' + nn + ': the last tile cannot read past the uniform array', t.includes('tile + 1 < ' + F.HALO_MAX));
  ok('RN on ' + nn + ': rnHi is clamped up to hi, so the crossing bin still refines when it is the LAST bin', t.includes('float rnHi = max(tile + 1 < ' + F.HALO_MAX + ' ? haloEdges[tile + 1] : hi, hi);'));
  ok('RN on ' + nn + ': the near bound is untouched, so it is one bin wider, not open-ended', !t.includes('sCross >= 0') && t.includes('sCross >= lo'));
  ok('RN on ' + nn + ': the step count and both sample bodies are unchanged', t.includes('int rn = ' + nn + ' / haloP;')
    && (t.match(/vec3 d = haloEye \+ s \* ray - lamp;/g) || []).length === 1 && (t.match(/vec3 d = haloEye \+ rs \* ray - lamp;/g) || []).length === 1);
  ok('RN on ' + nn + ': the lamp-window block is still not compiled with it', !t.includes('haloLampW > 0.0'));
  ok('RN on ' + nn + ': the only difference from OFF is the one extra rnHi line and the widened bound', t.replace(/ *float rnHi = [^\n]*\n/, '').replace('sCross <= rnHi', 'sCross <= hi') === off);
}

// 3. The neighbour variant composes with the split / polar / jitter / occlusion / shadow-map paths.
{
  const split = F.haloTableSource(false, false, false, 'split', false, false, 0, 2048, true), polar = F.haloTableSource(false, true, false, 'band', false, false, 0, 2048, true);
  const jit = F.haloTableSource(false, false, false, '', 'interleaved', false, 0, 2048, true);
  const occ = F.haloTableSource(false, false, true, '', false, false, 0, 2048, true), sm = F.haloTableSource(false, false, true, '', false, true, 0, 2048, true);
  ok('RN on: split and polar variants carry the widened trigger', split.includes('sCross <= rnHi') && split.includes('acc *= swt;') && polar.includes('sCross <= rnHi') && polar.includes('haloBandA'));
  ok('RN on: jitter still moves the ordinary ladder sample', jit.includes('haloJitAmt') && jit.includes('sCross <= rnHi'));
  ok('RN on: the crest hook reaches both sample bodies', (occ.match(/if \(crestOcc\(lamp, haloEye \+ (?:s|rs) \* ray\)\) continue;/g) || []).length === 2);
  ok('RN on: the shadow-map hook reaches both sample bodies', (sm.match(/if \(smM >= 0 \? !smLit\(smM, haloEye \+ (?:s|rs) \* ray\) : crestOcc/g) || []).length === 2);
}

// 4. Without P1c the option is inert: refine = 0 never builds the crossing text, so nb cannot leak into any variant.
for (const nb of [false, true]) {
  const t = F.haloTableSource(false, false, false, '', false, false, 0, 0, nb);
  ok('RN ' + (nb ? 'on' : 'off') + ' with P1c off: no crossing text at all, and identical to the frozen build', !t.includes('sCross') && t === FIX.off);
}
ok('RN: lw and nb are mutually exclusive in the source (P1c wins, as before)', !F.haloTableSource(false, false, false, '', false, false, 16, 2048, true).includes('haloLampW > 0.0'));

// 5. The invariant the last-tile case rests on: the slot past the in-use bins holds HALO_RANGE, and the last bin's own
//    hi IS HALO_RANGE — so on the farthest tile rnHi == hi and the crossing bin still triggers.
{
  F.setHaloBins(24);
  const R = F.HALO_RANGE, v = F.haloEdgesFor(199, new Array(F.HALO_MAX).fill(R));
  ok('the last in-use edge is HALO_RANGE', v[F.HALO_BINS - 1] === R, { last: v[F.HALO_BINS - 1], HALO_RANGE: R });
  ok('the slot just past it is the HALO_RANGE fill, so the last tile\'s rnHi equals its own hi', v[F.HALO_BINS] === R, v[F.HALO_BINS]);
  ok('edges ascend, so widening the upper bound adds exactly the eye-side neighbour', v.slice(0, F.HALO_BINS).every((x, i) => i === 0 || x > v[i - 1]));
  // The trap that WAS here: edgesV is filled once at haloPass construction (HALO_RANGE = 120) and setHaloRange
  // rebuilds only HALO_EDGES, so the slot past the in-use bins kept the OLD range. Without max(..., hi) the last tile's
  // rnHi sat below its own hi and the crossing bin stopped refining.
  // step5-preview fixed it at the source 10-30 (haloEdgesFor now fills its whole output array), so the check below
  // moved from "the tail is stale" to "the tail follows the range". The max(..., hi) guard stays: harmless, and it
  // keeps the trigger correct for any other padded reader.
  F.setHaloRange(250);
  const tail = new Array(F.HALO_MAX).fill(120);
  F.haloEdgesFor(199, tail);
  ok('after a range change the slot past the in-use bins follows it (source fix, no longer stale)', tail[F.HALO_BINS - 1] === 250 && tail[F.HALO_BINS] === 250, { lastEdge: tail[F.HALO_BINS - 1], pastEnd: tail[F.HALO_BINS] });
  F.setHaloRange(R);
}

// 6. The registry entry, and the wiring that makes the option reachable and cache-correct.
{
  const Opt = require(path.join(ROOT, 'js', 'options-registry.js')), e = Opt.OPTIONS.find((x) => x.id === 'haloRefineNeighbour');
  ok('registry: haloRefineNeighbour is declared once, an enum, default off', Opt.OPTIONS.filter((x) => x.id === 'haloRefineNeighbour').length === 1 && !!e && e.kind === 'profile' && e.type === 'enum' && e.default === 'off' && e.values.join(',') === 'off,on');
  ok('registry: defaults() carries it as off', Opt.defaults().haloRefineNeighbour === 'off');
  ok('registry: it is gated on gpu, air, haloOn and crossingRefineOn (inert unless P1c is on)', ['gpu', 'air', 'haloOn', 'crossingRefineOn'].every((r) => e.requires.some((q) => q.rule === r)), e.requires.map((q) => q.rule));
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
  ok('spec-ui: the control is built and joined to the advanced group', ui.includes("dvSelect('haloRefineNeighbour'") && /data-dv-group/.test(ui) && ui.includes("'haloCrossingRefine', 'haloRefineNeighbour', 'haloMoment', 'haloPolar'"));
  ok('spec-ui: the control is disabled unless the crossing refinement is on', /k === 'haloRefineNeighbour'[\s\S]{0,220}b\.disabled = !\+o\.haloCrossingRefine/.test(ui));
  ok('spec-ui: it is in BOTH picture-cache keys, next to haloCrossingRefine', (ui.match(/o\.haloCrossingRefine, o\.haloRefineNeighbour/g) || []).length === 2, (ui.match(/o\.haloCrossingRefine, o\.haloRefineNeighbour/g) || []).length);
  const d3 = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
  ok('drive-three: haloState() exposes nb, so a page test can read it (the gap P1c has)', d3.includes('cross: halo.cross || 0, nb: halo.nb || 0,'));
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
