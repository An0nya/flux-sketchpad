// Shader balance guard (pencroff 11-04, Anya's engine-hardening ask): every exported
// shader-splicing function in js/drive-three-shaders.js, applied to ground and composed the way
// the app composes them, must have balanced parens+braces after // comments are stripped.
//
// ORIGIN: Anya's B6 — a // comment mid-expression in withShimmer's spliced GLSL swallowed
// `,vec2(12.9898,78.233)))*43758.5453); ray=normalize(...); }`, so the shader never compiled and
// heatShimmer on GPU always dropped to CPU (and withWetBounce(withShimmer(ground)) inherited it).
// frenchie's B6 fix moved the comment off the code line and added a balance guard for withShimmer
// alone (tests/frenchie-heat-shimmer.js:30-37). This test generalises that guard to EVERY splicing
// function and the app's real compositions, so the same class cannot recur in withWetBounce,
// withLighting, tableSource, tablePassSource or tableBlurSource without a loud node-phase failure.
//
// What this catches that a JS linter cannot: the // is inside a template-literal string (the GLSL),
// so the JS is syntactically valid — the string just contains broken GLSL. A text balance check
// after comment-strip is the cheapest oracle for the "comment eats closing tokens" class. It does
// NOT catch semantic compile failures (undeclared identifiers, type mismatches, varying mismatches);
// tests/regress/BG-wetbounce-compile.js is the driver-level oracle for those.
//
// Node: node tests/shader-balance-guard.js — exits 1 on any failure.
const path = require('path'), fs = require('fs');
const { ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };

// comment-strip + paren/brace balance, identical to frenchie-heat-shimmer.js:33-34 (one oracle, not two)
const stripC = (s) => s.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const bal = (s) => { s = stripC(s); let q = 0, b = 0; for (const c of s) { if (c === '(') q++; if (c === ')') q--; if (c === '{') b++; if (c === '}') b--; } return q + b; };

const sh = require(path.join(ROOT, 'js', 'drive-three-shaders.js'));
const g = sh.ground;

// 1. the shipped ground + vertex templates themselves balance (the baseline)
ok('ground balances after comment-strip', bal(g) === 0);
ok('vertex balances after comment-strip', bal(sh.vertex) === 0);
ok('tableBlurSource balances after comment-strip', bal(sh.tableBlurSource) === 0);

// 2. each splicing function applied to ground (the single-compose arms)
ok('withShimmer(ground) balances after comment-strip', bal(sh.withShimmer(g)) === 0);
ok('withWetBounce(ground) balances after comment-strip', bal(sh.withWetBounce(g)) === 0);
ok('withLighting(ground) balances after comment-strip', bal(sh.withLighting(g)) === 0);
ok('withLighting(ground,false) balances after comment-strip (atlas default false)', bal(sh.withLighting(g, false)) === 0);
ok('withLighting(ground,true) balances after comment-strip', bal(sh.withLighting(g, true)) === 0);
ok('tableSource(ground) balances after comment-strip', bal(sh.tableSource(g)) === 0);
ok('tableSource(ground,true) balances after comment-strip', bal(sh.tableSource(g, true)) === 0);
ok('tablePassSource(ground) balances after comment-strip', bal(sh.tablePassSource(g)) === 0);

// 3. the app's real compositions (drive-three.js:82/100/312-314) — the arms that actually ship
ok('withWetBounce(withShimmer(ground)) balances (drive-three.js:314, shimAmp>0)', bal(sh.withWetBounce(sh.withShimmer(g))) === 0);
ok('withWetBounce(withLighting(ground,true)) balances (drive-three.js:82, wb+lit atlas)', bal(sh.withWetBounce(sh.withLighting(g, true))) === 0);
ok('withWetBounce(withLighting(ground,false)) balances (drive-three.js:82, wb+lit no-atlas default)', bal(sh.withWetBounce(sh.withLighting(g, false))) === 0);
ok('tablePassSource(withWetBounce(ground)) balances (drive-three.js:100, the table path)', bal(sh.tablePassSource(sh.withWetBounce(g))) === 0);
ok('tablePassSource(withWetBounce(withLighting(ground,true))) balances (drive-three.js:100, full composition atlas)', bal(sh.tablePassSource(sh.withWetBounce(sh.withLighting(g, true)))) === 0);
ok('tablePassSource(withWetBounce(withLighting(ground,false))) balances (drive-three.js:100, full composition no-atlas default)', bal(sh.tablePassSource(sh.withWetBounce(sh.withLighting(g, false)))) === 0);

console.log('\n' + (n - fails) + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
