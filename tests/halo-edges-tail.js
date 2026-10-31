// step5-preview: the halo edge array's tail past the in-use bins (qwen3.8max's RN §5 latent bug, fixed at the source).
// edgesV is one array of HALO_MAX floats built once when haloPass() is made (HALO_RANGE is still its module default
// there), and haloEdgesFor used to fill only slots 0 .. HALO_BINS-1. With haloRange 250 the slot past the last bin
// still held 120, so any reader past HALO_BINS (haloRefineNeighbour's rnHi on the last tile today, a lit-interval
// trigger or a moment-bin consumer tomorrow) silently read the wrong range.
// haloEdgesFor now fills its whole output array: in-use slots unchanged (the shader's behaviour), tail = the true
// continuation (HALO_EDGES[HALO_BINS]). Node: node tests/halo-edges-tail.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHalo = (file) => {   // same shims as tests/step5-lampwin.js: shader text first, then the halo module as a classic script
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: file + '/shaders.js' });
  const g = globalThis; delete g.__fw;
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null };");
  vm.runInThisContext(src + '\nglobalThis.__fw = { haloEdgesFor, setHaloRange, setHaloBins, haloEdgesOf, HALO_MAX, get HALO_BINS() { return HALO_BINS; }, get HALO_RANGE() { return HALO_RANGE; } };', { filename: file + '/halo.js' });
  return g.__fw;
};
load();
const F = loadHalo(ROOT);

// ---- 1. the in-use edges are exactly what they were (no behaviour change for the shipped paths)
{
  F.setHaloBins(24);
  const v = F.haloEdgesFor(199, new Array(F.HALO_MAX).fill(120));
  const expect = []; for (let i = 0; i < 24; i++) expect.push(F.haloEdgesOf(24, 120)[i + 1]);
  ok('the in-use edges still come from HALO_EDGES (unchanged)', JSON.stringify(v.slice(0, 24)) === JSON.stringify(expect), v.slice(0, 3));
  ok('they still ascend (the log spacing the table shader reads)', v.slice(0, 24).every((x, i) => i === 0 || x > v[i - 1]));
  ok('the far edge is still the range', v[23] === 120, v[23]);
  ok('a shorter output array is not extended (haloEdgesFor keeps its default length)', (() => { const a = F.haloEdgesFor(199); return a.length === 24; })(), F.haloEdgesFor(199).length);
}

// ---- 2. the tail follows the range instead of going stale
{
  F.setHaloRange(250);
  const v = F.haloEdgesFor(199, new Array(F.HALO_MAX).fill(120));   // what edgesV holds at construction
  ok('after setHaloRange(250) the slot past the in-use bins is 250, not the stale 120', v[F.HALO_BINS] === 250, v[F.HALO_BINS]);
  ok('every tail slot holds the continuation (a reader anywhere past HALO_BINS is right)', v.slice(F.HALO_BINS).every((x) => x === 250), v.slice(F.HALO_BINS, F.HALO_BINS + 4));
  ok('so the last in-use tile\'s upper bound is above its own hi: the crossing bin can never drop out', v[F.HALO_BINS] >= v[F.HALO_BINS - 1], { pastEnd: v[F.HALO_BINS], lastEdge: v[F.HALO_BINS - 1] });
  F.setHaloRange(120);
  const back = F.haloEdgesFor(199, new Array(F.HALO_MAX).fill(250));
  ok('and back again at the default range', back[F.HALO_BINS] === 120, back[F.HALO_BINS]);
}

// ---- 3. a smaller bin count still fills its own tail (the URL may set fewer bins than HALO_MAX)
// HALO_EDGES ends exactly at the in-use bins (setHaloBins keeps HALO_BINS === HALO_N), so the tail can only carry the
// far edge - which is the right sentinel: the last in-use tile's upper bound equals its own hi.
{
  F.setHaloBins(16);
  const v = F.haloEdgesFor(199, new Array(F.HALO_MAX).fill(120));
  ok('with 16 bins the tail starts at index 16', v.length === F.HALO_MAX && F.HALO_BINS === 16, { len: v.length, bins: F.HALO_BINS });
  ok('and every tail slot is the far edge (the last in-use bin\'s own hi)', v.slice(16).every((x) => x === v[15]), { tail: v.slice(16, 20), lastEdge: v[15] });
  F.setHaloBins(24);
  ok('restored to 24 bins', F.HALO_BINS === 24, F.HALO_BINS);
}
process.exit(fails ? 1 : 0);
