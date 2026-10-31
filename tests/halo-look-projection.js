// nemotron / backlog 1 proxy: every halo option must be projected into the renderer's `look` literal.
// qwen3.8max found (QUESTIONS-FOR-CLAUDE ~20:40, REVIEW-haloMoment.md) that haloMoment was inert when switched
// on because p.look is a hand-written projection (js/drive-anim.js) and the new key was missing: the option reached
// nothing at all. This locks the invariant for every halo-group option, so the next option that forgets its key
// fails here instead of silently doing nothing.
// Node: node tests/halo-look-projection.js - exits 1 on any failure.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
load();
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));

// 1. the projected set: halo-group options that are stored. kind 'derived' entries (haloQuality, haloRangeRow) are
//    never stored and write a bundle instead, so they are legitimately not projected.
const halo = Opt.OPTIONS.filter((o) => o.group === 'halo' && o.kind !== 'derived');
const derived = Opt.OPTIONS.filter((o) => o.group === 'halo' && o.kind === 'derived');
ok('the registry declares a halo group large enough to be worth locking', halo.length >= 25, halo.length);
ok('the derived halo selectors are exactly haloQuality and haloRangeRow (excluded)', derived.length > 0 && derived.every((o) => ['haloQuality', 'haloRangeRow'].includes(o.id)), derived.map((o) => o.id));

// 2. the projection literal itself, js/drive-anim.js:  p = { ..., look: { ... }, src: ... }
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const a = anim.indexOf('look: {'), b = anim.indexOf('}, src:', a);
ok('the look projection literal is found once', a > 0 && b > a, { a, b });
const lit = anim.slice(a, b);
// a projected option carries its own key AND its value is derived from o.<id> (plain `o.id`, or a boolean like
// `o.trafficSubTick === 'on'`). A key present with a constant/other value would still be a wiring bug.
const projIn = (s, id) => { const m = new RegExp('(^|[{,\\s])' + id + ': ([^,}]*)').exec(s); return !!m && m[2].indexOf('o.' + id) >= 0; };
const proj = (id) => projIn(lit, id);

// 3. every non-derived halo option must be projected.
for (const o of halo) ok('projected key present: ' + o.id, proj(o.id));
// 4. the option that was inert, named so a regression is unmistakable.
ok('haloMoment is projected (the option that silently did nothing)', proj('haloMoment'));

// 5. positive controls: the detector fails when the key is removed, and when the key is present but points elsewhere.
ok('positive control: the detector fails when a key is removed', !projIn(lit.replace('haloMoment: o.haloMoment,', ''), 'haloMoment'));
ok('positive control: the detector fails when the value does not read the option', !projIn(lit.replace('haloMoment: o.haloMoment,', 'haloMoment: 1,'), 'haloMoment'));
ok('positive control: the detector passes on the untouched literal', proj('haloMoment'));

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
