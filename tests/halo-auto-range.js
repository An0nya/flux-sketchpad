// qwen3.8max / backlog §7: registry test for haloAutoRange — the two table divisors the lamp-count rule picks between.
// Node: node tests/halo-auto-range.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
const loadHalo = () => {
  const sh = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  vm.runInThisContext(sh.replace(/^import .*$/gm, '').replace(/^export /gm, ''), { filename: 'shaders.js' });
  const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace("const D = globalThis.RF.Drive;", "const D = globalThis.RF.Drive; const T = { DataUtils: null }; const SM_DECL = '';");
  delete globalThis.__ar; delete globalThis.SL_HALO_DIV;
  vm.runInThisContext(src + '\nglobalThis.__ar = { HALO_FEW, HALO_DIV, HALO_DIV_FEW, haloTableSize };', { filename: 'halo.js' });
  return globalThis.__ar;
};
load();
const H = loadHalo();
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const e = Opt.OPTIONS.find((x) => x.id === 'haloAutoRange');
// the parser haloPass itself uses (js/drive-three-halo.js): a value that does not match silently falls back to the old rule
const parse = (v) => { const m = /^([\d.]+)-([\d.]+)$/.exec(String(v || '4-8')) || ['', '4', '8']; return [+m[1], +m[2]]; };

// 1. the registry entry: declared once, an enum, GPU-only rule attached.
ok('registry: haloAutoRange is declared once, a profile enum, default "4-8"', Opt.OPTIONS.filter((x) => x.id === 'haloAutoRange').length === 1 && !!e && e.kind === 'profile' && e.type === 'enum' && e.default === '4-8');
ok('registry: defaults() carries "4-8"', Opt.defaults().haloAutoRange === '4-8');
ok('registry: it lists exactly the four documented ranges', e.values.join(',') === '4-8,2-4,2-8,1.4-2', e.values);
ok('registry: it is gated on gpu, air and haloOn', ['gpu', 'air', 'haloOn'].every((r) => e.requires.some((q) => q.rule === r)), e.requires.map((q) => q.rule));

// 2. every listed value must survive the code's own parser. A typo here would not throw: it would quietly
//    render the old 4-8 rule while the UI shows something else.
for (const v of e.values) {
  const [fine, coarse] = parse(v);
  ok(`value "${v}": parses to two finite positive divisors`, Number.isFinite(fine) && Number.isFinite(coarse) && fine > 0 && coarse > 0, [fine, coarse]);
  ok(`value "${v}": the first divisor is the finer one (smaller divisor = bigger table)`, fine < coarse, [fine, coarse]);
}
for (const bad of ['', 'auto', '4', 'x-y', '4-', undefined, null]) {
  const [a, b] = parse(bad);
  ok(`junk ${JSON.stringify(bad)} falls back to the old 4-8, not to NaN`, a === 4 && b === 8, [a, b]);
}

// 3. the default IS the pre-option behaviour: '4-8' is exactly the fixed pair haloTableSize uses on its own.
{
  const [fine, coarse] = parse(e.default);
  ok("the default '4-8' is the old rule (HALO_DIV_FEW fine, HALO_DIV coarse)", fine === H.HALO_DIV_FEW && coarse === H.HALO_DIV, { fine, coarse, HALO_DIV_FEW: H.HALO_DIV_FEW, HALO_DIV: H.HALO_DIV });
}

// 4. the divisors really reach the table sizer, and the lamp-count rule still switches where the note says.
{
  const w = 1440, h = 900;
  for (const v of e.values) {
    const [fine, coarse] = parse(v);
    const a = H.haloTableSize(w, h, 99, fine), b = H.haloTableSize(w, h, 99, coarse);
    ok(`value "${v}": the fine divisor gives a strictly bigger table than the coarse one`, a[0] > b[0] && a[1] > b[1], { fine: a, coarse: b });
  }
  ok('a fixed haloDiv bypasses the lamp-count rule', H.haloTableSize(w, h, 1, 8)[0] === H.haloTableSize(w, h, 99, 8)[0]);
  // haloTableSize's own threshold is HALO_FEW; the +2 hysteresis (5 lamps keeps the last divisor) is state in
  // haloPass (autoFew) and is not reachable from a node test, so it is not claimed here.
  ok('the lamp-count threshold in haloTableSize is HALO_FEW (=4) lamps', H.HALO_FEW === 4 && H.haloTableSize(w, h, 4)[0] > H.haloTableSize(w, h, 5)[0] && H.haloTableSize(w, h, 5)[0] === H.haloTableSize(w, h, 6)[0],
    { at4: H.haloTableSize(w, h, 4), at5: H.haloTableSize(w, h, 5), at6: H.haloTableSize(w, h, 6) });
}

// 5. the page-test pin holds the old rule, so no page test silently changes table resolution.
{
  const t = fs.readFileSync(path.join(ROOT, 'tests', 'pinned-defaults.js'), 'utf8');
  const pin = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  ok('the page-test pin holds haloAutoRange at "4-8"', pin.haloAutoRange === '4-8', pin.haloAutoRange);
}

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
