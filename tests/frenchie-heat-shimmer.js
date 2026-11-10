// frenchie / backlog heat shimmer (ACTIVE per Anya 10-31; GPU-only per Anya): registry + behaviour test.
// Node: node tests/frenchie-heat-shimmer.js — exits 1 on any failure. Scope: frenchie/HEAT-SHIMMER-SCOPE.md.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
load();
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
const shSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
const ckFile = path.join(ROOT, 'js', 'cache-keys.js');
const ck = fs.existsSync(ckFile) ? fs.readFileSync(ckFile, 'utf8') : '';
const e = Opt.OPTIONS.find((x) => x.id === 'heatShimmer');
const groundText = require(path.join(ROOT, 'js', 'drive-three-shaders.js')).ground;   // module export, not a source-text read

// 1. registry
const omheatShimmer = require(path.join(ROOT, 'js', 'cache-keys.js')).optionMap();
ok('both picture-cache recipes (stillFrame + ground) carry heatShimmer (asked of the cache-keys module)', omheatShimmer.stillFrame.includes('heatShimmer') && omheatShimmer.ground.includes('heatShimmer'), { still: omheatShimmer.stillFrame.includes('heatShimmer'), ground: omheatShimmer.ground.includes('heatShimmer') });
ok('registry: note records GPU-only per Anya; default in DV_DEF', /GPU ONLY per Anya/.test(e.note) && Opt.defaults().heatShimmer === 'off');

// 2. OFF = byte-identical: the shipped `ground` export itself carries NO shimmer code
ok('shipped ground text has no shimmer (OFF byte-identical, pinned)', !groundText.includes('shimmer'));
ok('[KEEP: text — GPU lane, no headless GL seam in this VM; measured on the host GPU queue] withShimmer splices at guarded markers and throws if they moved', /export function withShimmer/.test(shSrc) && /ground shader markers changed/.test(shSrc) && /shimmerAmp, shimmerT/.test(shSrc) && /shimmerAmp>0\.0/.test(shSrc));

// 3. executed: withShimmer produces a shader that declares the uniforms and wobbles the ray
const mod = require(path.join(ROOT, 'js', 'drive-three-shaders.js'));
const spliced = mod.withShimmer(mod.ground);
ok('executed: withShimmer(ground) declares shimmerAmp/shimmerT and gates on shimmerAmp>0', spliced.includes('uniform float shimmerAmp, shimmerT;') && spliced.includes('if (shimmerAmp>0.0)') && spliced.includes('ray=normalize(ray+vec3(0.0,(n-0.5)*2.0*shimmerAmp*g,0.0))'));
ok('executed: OFF path is untouched — withShimmer is the only producer, ground export unchanged', mod.ground === groundText && !mod.ground.includes('shimmer'));
// B6 shimmer-comment (spilett 11-04): with // comments stripped, the spliced source must balance —
// a // mid-expression truncated the shimmer line and the shader never compiled (GPU drop-to-CPU).
{
  const stripC = (s) => s.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
  const bal = (s) => { s = stripC(s); let q = 0, b = 0; for (const c of s) { if (c === '(') q++; if (c === ')') q--; if (c === '{') b++; if (c === '}') b--; } return q + b; };
  ok('executed: withShimmer(ground) balances after comment-strip (B6 shimmer-comment)', bal(spliced) === 0);
  ok('executed: withWetBounce(withShimmer(ground)) balances after comment-strip (B6 shimmer-comment)', bal(mod.withWetBounce(spliced)) === 0);
}

// 4. wiring: drive-three update() recompile + uniforms, drive-anim select/labels/look, keys, layout
ok('[KEEP: text — GPU lane, no headless GL seam in this VM; measured on the host GPU queue] update() recompiles the ground program only on on/off flip and sets both uniforms', three.includes("mat.userData.shim") && /withShimmer\(/.test(three) && /shimAmp > 0/.test(three));   // append-safe (line-based)
ok('[KEEP: text — GPU lane, no headless GL seam in this VM; measured on the host GPU queue] u defaults carry the uniforms', /shimmerAmp: 0, shimmerT: 0/.test(three));
ok('[KEEP: text — frame-internal (drive-anim prepare/labels/select wiring/look literal, af06 measured no-Node-seam); control existence asserted fleet-wide by control-map (0 without)] drive bar has the [data-anim="heat-shimmer"] select -> setDV', /data-anim': 'heat-shimmer'/.test(anim) && /hs\.addEventListener\('change', \(\) => setDV\(ui, 'heatShimmer', hs\.value\)\)/.test(anim));
ok('[KEEP: text — frame-internal (drive-anim prepare/labels/select wiring/look literal, af06 measured no-Node-seam); control existence asserted fleet-wide by control-map (0 without)] labels() syncs it; look carries heatShimmer', anim.includes("[data-anim=\"heat-shimmer\"]').value = ['off', 'low', 'high'].includes(o.heatShimmer)") && /heatShimmer:\s*o\.heatShimmer\s*\|\|\s*'off'/.test(anim));   // qwen P3-b: whitespace-tolerant
const layRowsResolution = globalThis.RF.DriveLayout.LAYOUT;
const rowResolution = layRowsResolution.find((r) => r[2] === 'Resolution');
ok('drive-layout Resolution row carries the control (asked of the layout module)', !!rowResolution && rowResolution[3].some((x) => x.endsWith('="heat-shimmer"]')), rowResolution && rowResolution[3]);
ok('[KEEP: text — GPU-only option per Anya; the drive.js half never reading it is source text with no Node seam, and the GPU lane is measured on the host queue] CPU renderer (drive.js) never reads it (GPU-only per Anya)', !fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8').includes('heatShimmer'));

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
