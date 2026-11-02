// frenchie (10-31): open pool item 4 — js/drive-touge-three.js shader anchors are guarded: every .replace
// site goes through rep(), which throws when the anchor count != 1 (a moved anchor fails loudly instead of
// silently no-oping, the failure mode behind qwen's 16-anchor break and nemotron's wetLobe patch).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
// shader modules are ES modules: shared strip-and-evaluate helper tests/esm.js (qwen's offer, glm5.2-greenlit 11-01)
const { esm } = require('./esm.js');
const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-touge-three.js'), 'utf8');

ok('rep() guard is defined and exported (with optional passthrough for ground-only anchors)', /export function rep\(s, anchor, repl, optional\) \{ const n = anchor instanceof RegExp \?/.test(src) && /if \(n === 0 && optional\) return s; if \(n !== 1\) throw new Error\('touge shader anchor moved/.test(src));
const stripped = src.replace(/export function rep\(s, anchor, repl[^)]*\)[\s\S]*?\n/, '');
ok('no bare .replace( remains outside the rep() helper (all shader anchors guarded)', (stripped.match(/\.replace\(/g) || []).length === 0, (stripped.match(/\.replace\(/g) || []).length);
ok('ground-only anchors are explicitly marked optional (cornerIntensity, traffic loopCall)', /cornerIntensity\(vec3 d,vec3 origin\) \{ d=carFromWorld\*d; origin=carFromWorld\*origin;', true\)/.test(src) && /otherIntensity\(local\)`, true\)/.test(src));
ok('every former anchor site is optional (per-family passthrough preserved) + passShader has a hits floor', (src.match(/, true\);/g) || []).length >= 12 && /if \(repHits\.n < 4\) throw/.test(src), (src.match(/, true\);/g) || []).length);
ok('duplicate anchors still throw (n>1 never passthrough)', /if \(n !== 1\) throw new Error\('touge shader anchor moved/.test(src));
ok('all 13 former anchor sites now call rep(', (src.match(/\brep\(/g) || []).length >= 14, (src.match(/\brep\(/g) || []).length);   // 13 sites + the helper's own body mentions

// qwen REVIEW P2 (proposed AGENTS.md point 24, NOT ratified): exercise the SHIPPED module, not a copy — shared esm() helper tests/esm.js
const S = esm('drive-three-shaders.js', null, ['withLighting', 'ground']);
const TG = esm('drive-touge-three.js', { ground: S.ground }, ['rep', 'repHits', 'passShader']);
const rep = TG.rep;
ok('shipped rep is exercised: returns the patched text on a hit', rep('abcXYZdef', 'XYZ', '123') === 'abc123def');
let threw = false; try { rep('no anchor here', 'XYZ', '123'); } catch (e) { threw = /anchor moved/.test(e.message); }
ok('shipped rep throws "anchor moved" when a required anchor is gone (silent no-op impossible)', threw);
ok('shipped rep optional anchor passes through unchanged when absent (today\'s exact behaviour)', rep('no anchor here', 'XYZ', '123', true) === 'no anchor here');
let threw2 = false; try { rep('X X X', 'X', 'y'); } catch (e) { threw2 = /anchor moved \(3x\)/.test(e.message); }
ok('shipped rep throws on duplicate anchors too', threw2);
ok('shipped rep counts RegExp anchors correctly (capture groups do not inflate the count)', rep('r+=rho*vec3(1,1,0.93)*otherIntensity(local) more text', /r\+=rho\*(vec3\(1,1,0\.93\)|otint)\*otherIntensity\(local\)/, 'PATCHED') === 'PATCHED more text');
// output pins: guarded passShader must compose byte-identical pass text to the shipped replace chain (sha256/16)
const crypto = require('crypto'); const h = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const S2 = esm('drive-three-shaders.js', null, ['withLighting', 'ground', 'tablePassSource']);
const pins = { ground: '23189982652af2c6', lit: '7c9ec2d5f08370f6', litAtlas: '38c8c9a8010a4874', table: '24445bc209cbe8f7' };
ok('shipped passShader output pinned byte-identical on all four composed sources (ground/lit/litAtlas/table)', Object.entries(pins).every(([k, pin]) => {
  const src = { ground: S2.ground, lit: S2.withLighting(S2.ground, false), litAtlas: S2.withLighting(S2.ground, true), table: S2.tablePassSource(S2.withLighting(S2.ground, false)) }[k];
  return h(TG.passShader(src)) === pin;
}), Object.fromEntries(Object.entries(pins).map(([k, pin]) => [k, h(TG.passShader({ ground: S2.ground, lit: S2.withLighting(S2.ground, false), litAtlas: S2.withLighting(S2.ground, true), table: S2.tablePassSource(S2.withLighting(S2.ground, false)) }[k]))])));
ok('shipped passShader hits floor fires on an unrecognized source', (() => { try { TG.passShader('void main(){}'); return false; } catch (e) { return /anchors matched/.test(e.message); } })());
ok('gate + all registered', fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8').includes("'frenchie-touge-anchors'") && fs.readFileSync(path.join(ROOT, 'tests/all.js'), 'utf8').includes('frenchie-touge-anchors'));

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
