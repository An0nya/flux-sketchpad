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
const e = Opt.OPTIONS.find((x) => x.id === 'heatShimmer');

// 1. registry
ok('registry: heatShimmer declared once, enum [off,low,high], default "off", control, group surface', Opt.OPTIONS.filter((x) => x.id === 'heatShimmer').length === 1 && !!e && e.type === 'enum' && JSON.stringify(e.values) === '["off","low","high"]' && e.default === 'off' && e.control === '[data-anim="heat-shimmer"]' && e.group === 'surface');
ok('registry: note records GPU-only per Anya; default in DV_DEF', /GPU ONLY per Anya/.test(e.note) && Opt.defaults().heatShimmer === 'off');

// 2. OFF = byte-identical: the shipped `ground` export itself carries NO shimmer code
const groundText = shSrc.match(/export const ground = `([\s\S]*?)`;/)[1];
ok('shipped ground text has no shimmer (OFF byte-identical, pinned)', !groundText.includes('shimmer'));
ok('withShimmer splices at guarded markers and throws if they moved', /export function withShimmer/.test(shSrc) && /ground shader markers changed/.test(shSrc) && /shimmerAmp, shimmerT/.test(shSrc) && /shimmerAmp>0\.0/.test(shSrc));

// 3. executed: withShimmer produces a shader that declares the uniforms and wobbles the ray
const mod = require(path.join(ROOT, 'js', 'drive-three-shaders.js'));
const spliced = mod.withShimmer(mod.ground);
ok('executed: withShimmer(ground) declares shimmerAmp/shimmerT and gates on shimmerAmp>0', spliced.includes('uniform float shimmerAmp, shimmerT;') && spliced.includes('if (shimmerAmp>0.0)') && spliced.includes('ray=normalize(ray+vec3(0.0,(n-0.5)*2.0*shimmerAmp*g,0.0))'));
ok('executed: OFF path is untouched — withShimmer is the only producer, ground export unchanged', mod.ground === groundText && !mod.ground.includes('shimmer'));

// 4. wiring: drive-three update() recompile + uniforms, drive-anim select/labels/look, keys, layout
ok('update() recompiles the ground program only on on/off flip and sets both uniforms', three.includes("mat.userData.shim") && three.includes("mat.fragmentShader = shimAmp > 0 ? withShimmer(ground) : ground") && three.includes("set('shimmerAmp', shimAmp); set('shimmerT'") && three.includes("look.heatShimmer === 'high' ? 0.0025 : look.heatShimmer === 'low' ? 0.0008 : 0"));
ok('u defaults carry the uniforms', /shimmerAmp: 0, shimmerT: 0/.test(three));
ok('drive bar has the [data-anim="heat-shimmer"] select -> setDV', /data-anim': 'heat-shimmer'/.test(anim) && /hs\.addEventListener\('change', \(\) => setDV\(ui, 'heatShimmer', hs\.value\)\)/.test(anim));
ok('labels() syncs it; look carries heatShimmer', anim.includes("[data-anim=\"heat-shimmer\"]').value = ['off', 'low', 'high'].includes(o.heatShimmer)") && /heatShimmer:\s*o\.heatShimmer\s*\|\|\s*'off'/.test(anim));   // qwen P3-b: whitespace-tolerant
ok('both spec-ui picture-cache keys carry o.heatShimmer', ui.split('\n').filter((l) => l.includes('JSON.stringify') && l.includes('o.heatShimmer')).length === 2);   // append-safe: any later option appended after heatShimmer must not break this
ok('drive-layout row lists it', lay.includes("an('heat-shimmer')"));
ok('CPU renderer (drive.js) never reads it (GPU-only per Anya)', !fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8').includes('heatShimmer'));   // qwen P3-a: the drive.js half is the real guarantee

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
