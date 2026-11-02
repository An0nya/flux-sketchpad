// frenchie, 11-01 — pool item 4 (halo half): js/drive-three-halo.js composes its shader texts through hrep(), a guarded
// replace (string anchor: exactly-once unless optional, regex: at-least-once unless optional; both throw on a total miss).
// Checks: (1) the shipped module exports hrep and every .replace call site goes through it; (2) the guards throw on a
// moved/duplicated anchor and optional sites pass through; (3) composed table texts are pinned (sha256) so a future edit that
// changes any composed variant fails loudly here instead of silently in the renderer.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { load, ROOT } = require('./load.js');
load();
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (d ? '  - ' + JSON.stringify(d).slice(0, 200) : '')); } };
// exercise the SHIPPED module (require(esm), same pattern as beam-atlas/frenchie-touge-anchors), not a copy
const H = require(path.join(ROOT, 'js', 'drive-three-halo.js'));
const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
ok('hrep exported from the shipped module', typeof H.hrep === 'function');
ok('no bare .replace( call sites remain outside hrep', !/\.replace\(/.test(src.replace(/export function hrep[\s\S]*?\n}/, '').replace(/s\.replace\(anchor, repl\)/, '')), null);
ok('guard: duplicated string anchor throws', (() => { try { H.hrep('aa', 'a', 'b'); return false; } catch (e) { return /count 2/.test(e.message); } })());
ok('guard: missed string anchor throws', (() => { try { H.hrep('xyz', 'qq', 'w'); return false; } catch (e) { return /missed/.test(e.message); } })());
ok('guard: missed regex throws', (() => { try { H.hrep('xyz', /qq/g, 'w'); return false; } catch (e) { return /missed/.test(e.message); } })());
ok('optional: missed anchor passes through unchanged', H.hrep('xyz', /qq/g, 'w', true) === 'xyz' && H.hrep('xyz', 'qq', 'w', true) === 'xyz');
ok('optional: present duplicated anchor keeps first-occurrence semantics', H.hrep('aXbXc', 'X', 'Y', true) === 'aYbXc');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const pins = {
  plain: sha(H.haloTableSource(false)),
  atlas: sha(H.haloTableSource(true)),
  polar: sha(H.haloTableSource(false, true)),
  occ: sha(H.haloTableSource(false, false, true)),
  polarOccWb: sha(H.haloTableSource(false, true, true, '', false, false, 0, 0, false, 0, 0, true)),
  band: sha(H.haloTableSource(false, false, false, 'band')),
  splitMoment: sha(H.haloTableSource(false, false, false, 'split', false, false, 0, 0, false, 1)),
  jitLw: sha(H.haloTableSource(false, false, false, '', true, false, 8)),
  refineWs: sha(H.haloTableSource(false, false, false, '', false, false, 0, 32, true, 0, 0.5)),
  moment2WbOff: sha(H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 3, 0, true)),
  wbPlain: sha(H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, true)),
};
const want = {"plain": "d454860887a09754", "atlas": "ded4067cc6bf5eca", "polar": "118349c73e0e71d9", "occ": "00dcdb352415f8db", "polarOccWb": "2bc1ffb021df66a2", "band": "f9292fe256ce53e8", "splitMoment": "974c603cbe6b21fd", "jitLw": "84b2d366648d0a87", "refineWs": "4b9fd375575cb9f2", "moment2WbOff": "ccd399f180bdb109", "wbPlain": "c77acc33fdd54002"};;
for (const [k, v] of Object.entries(want)) ok('pin ' + k, pins[k] === v, pins[k] + ' != ' + v);
// (appended 11-02) qwen T10-F1 completion: consumption-site clamps for ranged options whose display clamp lives elsewhere.
{
  const halo = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
  ok('haloConeAngle clamped at consumption (drive-three-halo.js), registry range 0..90', /Math\.min\(90, Math\.max\(0, look\.haloConeAngle/.test(halo));
  const drive = fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8');
  ok('powerlineReflectance clamped at consumption (drive.js:122), registry range 0.02..0.60', /Math\.min\(0\.60, Math\.max\(0\.02, look\.powerlineReflectance\)/.test(drive));
}
console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
