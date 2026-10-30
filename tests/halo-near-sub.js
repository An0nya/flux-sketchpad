// qwen3.8max / backlog §7: registry test for haloNearSub — sub-passes for the nearest oncoming lamps inside HALO_NEAR.
// Node: node tests/halo-near-sub.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
const loadHalo = () => {
  const sh = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: 'shaders.js' });
  vm.runInThisContext(SRC.replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';")
    + '\nglobalThis.__ns = { HALO_SUB, HALO_REFINE, HALO_NEAR, HALO_BIN_STEPS };', { filename: 'halo.js' });
  return globalThis.__ns;
};
load();
const H = loadHalo();
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const e = Opt.OPTIONS.find((x) => x.id === 'haloNearSub');

// 1. the registry entry: declared once, an enum, GPU-only rule attached.
ok('registry: haloNearSub is declared once, a profile enum, default 1', Opt.OPTIONS.filter((x) => x.id === 'haloNearSub').length === 1 && !!e && e.kind === 'profile' && e.type === 'enum' && e.default === 1);
ok('registry: defaults() carries 1', Opt.defaults().haloNearSub === 1);
ok('registry: it lists exactly the halving sequence 4, 2, 1', e.values.join(',') === '4,2,1', e.values);
ok('registry: it is gated on gpu, air and haloOn', ['gpu', 'air', 'haloOn'].every((r) => e.requires.some((q) => q.rule === r)), e.requires.map((q) => q.rule));

// 2. the constants the note quotes ("the nearest 4 oncoming lamps within 45 m", "4 = as before").
ok('HALO_SUB is 4, the value the note calls "as before"', H.HALO_SUB === 4, H.HALO_SUB);
ok('HALO_REFINE is 4 bins and HALO_NEAR is 45 m', H.HALO_REFINE === 4 && H.HALO_NEAR === 45, { HALO_REFINE: H.HALO_REFINE, HALO_NEAR: H.HALO_NEAR });

// 3. every listed value must be in the set the clamp accepts. Anything else is not an error: it silently
//    renders HALO_SUB, so the UI would show a quality the frame does not use.
{
  const ACCEPT = [1, 2, 4];   // js/drive-three-halo.js: [1, 2, 4].includes(+look.haloNearSub) ? +look.haloNearSub : HALO_SUB
  ok('the clamp in the source accepts exactly 1, 2 and 4 and falls back to HALO_SUB', /\[1, 2, 4\]\.includes\(\+look\.haloNearSub\) \? \+look\.haloNearSub : HALO_SUB/.test(SRC));
  for (const v of e.values) ok(`value ${v}: is in the accepted set, so it is not silently replaced`, ACCEPT.includes(+v), v);
  ok('the default 1 is in the accepted set', ACCEPT.includes(+e.default), e.default);
}

// 4. the wiring: the clamp appears once, and the sub-pass count it produces reaches BOTH draw paths (the
//    screen table and the polar/cone path). A third path added later without it would render the near lamps at
//    a different quality than the option says.
{
  const clamps = (SRC.match(/\[1, 2, 4\]\.includes\(\+look\.haloNearSub\)/g) || []).length;
  const uses = (SRC.match(/\(globalThis\.SL_HALO_SUB \|\| nearSub\)/g) || []).length;
  ok('the nearSub clamp appears exactly once', clamps === 1, clamps);
  ok('the sub-pass count reaches both draw paths', uses === 2, uses);
  ok('both draw paths gate it on HALO_NEAR metres ahead', (SRC.match(/< HALO_NEAR \? \(globalThis\.SL_HALO_SUB \|\| nearSub\) : 1/g) || []).length === 2
    && (SRC.match(/L\.x - eye\[0\] < HALO_NEAR/g) || []).length === 2, uses);
}

// 5. defaultHistory: the first recorded default is the "as before" value and the last is the live one, so the
//    note's claim stays true if the default moves again.
{
  const h = (e.defaultHistory || []).map((x) => x.value);
  ok('defaultHistory starts at HALO_SUB (4) and ends at the live default', h.length >= 2 && h[0] === H.HALO_SUB && h[h.length - 1] === e.default, { history: h, HALO_SUB: H.HALO_SUB, default: e.default });
}

// 6. the page-test pin holds 4, so every page test still renders the pre-option near-lamp quality.
{
  const t = fs.readFileSync(path.join(ROOT, 'tests', 'pinned-defaults.js'), 'utf8');
  const pin = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  ok('the page-test pin holds haloNearSub at 4 ("as before")', pin.haloNearSub === 4, pin.haloNearSub);
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
