// minimaxai/minimax-m3.1-flash / P1c (option haloCrossingRefine): reference-quality quadrature in the lamp's forward-plane crossing bin.
// Node: node tests/halo-crossing-refine.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'step5-lampwin-off.fixture.json'), 'utf8'));
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHalo = (file) => {
  const sh = fs.readFileSync(path.join(file, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: file + '/shaders.js' });
  const g = globalThis; delete g.__fw;
  const src = fs.readFileSync(path.join(file, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  vm.runInThisContext(src + '\nglobalThis.__fw = { haloTableSource };', { filename: file + '/halo.js' });
  return g.__fw;
};
load();
const F = loadHalo(ROOT);

// 1. OFF is the pre-option table text, byte for byte. This is the same frozen fixture the LW option uses.
for (const [k, args] of Object.entries({ off: [false, false, false, '', false, false], atlas: [true, false, false, '', false, false], split: [false, false, false, 'split', false, false], splitAtlas: [true, false, false, 'split', false, false], jit: [false, false, false, '', 'interleaved', false], polar: [false, true, false, '', false, false], band: [false, true, false, 'band', false, false] }))
  ok('P1c off: the ' + k + ' table pass text is byte-identical to the pre-P1c build', F.haloTableSource(...args) === FIX[k]);

// 2. ON builds a distinct variant: the crossing bin gets N steps, the ordinary ladder stays, and the LW window does not double-count it.
for (const n of [32, 64, 128, 256, 512, 2048]) {
  const t = F.haloTableSource(false, false, false, '', false, false, 0, n);
  ok('P1c ' + n + ': the crossing bin has its own step count', t.includes('int rn = ' + n + ' / haloP;') && t.includes('bool crossingBin = sCross >= lo && sCross <= hi;'));
  ok('P1c ' + n + ': the ordinary and crossing sample bodies are both present', (t.match(/vec3 d = haloEye \+ s \* ray - lamp;/g) || []).length === 1 && (t.match(/vec3 d = haloEye \+ rs \* ray - lamp;/g) || []).length === 1);
  ok('P1c ' + n + ': the lamp-window block is not compiled with it', !t.includes('haloLampW > 0.0'));
}

// 3. The variants compose with the split / polar / jitter / occlusion paths. The E2 and SM hooks must reach both sample bodies.
{
  const split = F.haloTableSource(false, false, false, 'split', false, false, 0, 2048), polar = F.haloTableSource(false, true, false, 'band', false, false, 0, 2048), jit = F.haloTableSource(false, false, false, '', 'interleaved', false, 0, 2048);
  const occ = F.haloTableSource(false, false, true, '', false, false, 0, 2048), sm = F.haloTableSource(false, false, true, '', false, true, 0, 2048);
  ok('P1c: split and polar variants are built', split.includes('acc *= swt;') && polar.includes('haloBandA'));
  ok('P1c: jitter still moves the ordinary ladder sample', jit.includes('haloJitAmt'));
  ok('P1c: the crest hook reaches both sample bodies', (occ.match(/if \(crestOcc\(lamp, haloEye \+ (?:s|rs) \* ray\)\) continue;/g) || []).length === 2);
  ok('P1c: the shadow-map hook reaches both sample bodies', (sm.match(/if \(smM >= 0 \? !smLit\(smM, haloEye \+ (?:s|rs) \* ray\) : crestOcc/g) || []).length === 2);
}

// 4. The registry entry: declared once, default off, GPU-only rule attached.
{
  const Opt = require(path.join(ROOT, 'js', 'options-registry.js')), e = Opt.OPTIONS.find((x) => x.id === 'haloCrossingRefine');
  ok('registry: haloCrossingRefine is declared once, default off, with 32 to 2048', !!e && e.default === 0 && e.values.join(',') === '0,32,64,128,256,512,2048' && e.type === 'enum');
  ok('registry: defaults() carries it as off', Opt.defaults().haloCrossingRefine === 0);
  ok('registry: haloLampWin is ignored while the crossing refinement is on', e && e.requires.some((r) => r.rule === 'gpu') && Opt.OPTIONS.find((x) => x.id === 'haloLampWin').ignoredWhen.some((r) => r.rule === 'crossingRefineOn'));
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
