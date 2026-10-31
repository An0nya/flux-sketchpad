// minimaxai/minimax-m3.1-flash / WIDTH (option haloWidthStep): a per-bin sample count from the bin's width, so the samples spread evenly in DEPTH.
// Node: node tests/halo-width-step.js — exits 1 on any failure.
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

// 1. OFF builds the shipped ladder and nothing of the width variant. (The byte-for-byte OFF guarantee against the frozen
// fixture lives in tests/halo-crossing-refine.js: it compares the same table-pass text and passes there.)
for (const [k, args] of Object.entries({ off: [false, false, false, '', false, false], atlas: [true, false, false, '', false, false], split: [false, false, false, 'split', false, false], splitAtlas: [true, false, false, 'split', false, false], polar: [false, true, false, '', false, false], band: [false, true, false, 'band', false, false] })) {
  const t = F.haloTableSource(...args);
  ok('WIDTH off: the ' + k + ' table pass keeps the shipped six-step ladder', t.includes('float qq = pow(hi / lo, 1.0 / float(6 * haloP));') && t.includes('for (int m = 0; m < 6; m++) {'));
  ok('WIDTH off: the ' + k + ' table pass has no width uniform and no width ladder', !t.includes('haloWidthStep') && !t.includes('ceil(bw /') && !t.includes('float bw = hi - lo;'));
}

// 2. ON builds a distinct variant: the ladder takes its count from the bin's width and spaces the samples in depth
for (const step of [1, 0.5, 0.25]) {
  const t = F.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, step);
  ok('WIDTH ' + step + ': the uniform is declared', t.includes('uniform float haloWidthStep;'));
  ok('WIDTH ' + step + ': the count comes from the bin width', t.includes('int nk = int(clamp(ceil(bw / max(haloWidthStep, 0.001)), 1.0, 128.0));'));
  ok('WIDTH ' + step + ': the samples are evenly spaced in depth', t.includes('float sa = lo + bw * float(m) / float(nk), sb = lo + bw * float(m + 1) / float(nk), s = 0.5 * (sa + sb), ds = sb - sa;'));
  ok('WIDTH ' + step + ': the loop has a constant bound and a runtime break', t.includes('for (int m = 0; m < 128; m++) {') && t.includes('if (m >= nk) break;'));
  ok('WIDTH ' + step + ': the shipped log ladder is gone', !t.includes('float qq = pow(hi / lo, 1.0 / float(6 * haloP));'));
  ok('WIDTH ' + step + ': the march body is unchanged (one sample body)', (t.match(/vec3 d = haloEye \+ s \* ray - lamp;/g) || []).length === 1);
}

// 3. the width ladder composes with P1c: the crossing bin uses the refined ladder, the other bins use the width ladder
const both = F.haloTableSource(false, false, false, '', false, false, 0, 512, true, 0, 0.25);
ok('WIDTH + P1c: the width uniform is declared (the width ladder runs in the non-crossing bins)', both.includes('uniform float haloWidthStep;'));
ok('WIDTH + P1c: the crossing ladder is intact (the crossing bin uses the refined ladder)', both.includes('crossingBin') && both.includes('int rn = 512 / haloP;'));
ok('WIDTH + P1c: the width ladder is present (the non-crossing bins use the width ladder)', both.includes('ceil(bw /') && both.includes('float bw = hi - lo;'));

// 4. the option is declared once, default off, with a control and a test
const reg = fs.readFileSync(path.join(ROOT, 'js', 'options-registry.js'), 'utf8'), ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
ok('the option is declared exactly once in the registry', (reg.match(/id: 'haloWidthStep'/g) || []).length === 1);
const block = (reg.match(/\{[^{}]*id: 'haloWidthStep'[^{}]*\}/) || [''])[0];
ok('the option defaults to off', /default: 'off'/.test(block));
ok('the option lists the three measured spacings', /values: \['off', '1', '0\.5', '0\.25'\]/.test(block));
ok('the option names its control', /control: '\[data-dv="haloWidthStep"\]'/.test(block));
ok('the option names its node test', /tests: \['node:halo-width-step'\]/.test(block));
ok('js/spec-ui.js has the control', /dvSelect\('haloWidthStep'/.test(ui));
ok('js/spec-ui.js syncs the control', /k === 'haloWidthStep'/.test(ui));
ok('the look projection carries the option', /haloWidthStep: o\.haloWidthStep/.test(fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8')));

// the material picker must take the width: with it ON the fast path (the pre-built materials) must not be used
{
  const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
  ok('the material picker takes the width', /const pick = \([^)]*widthStep = 0\)/.test(src));
  ok('the material picker does not take the fast path when the width is on', /!jit && !sm && !lw && !refine && !moment && !widthStep/.test(src));
  ok('every material pick passes the width', (src.match(/pick\(atlas,[^)]*widthStep\)/g) || []).length >= 3);
}

console.log(fails ? `\n${fails} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(fails ? 1 : 0);
