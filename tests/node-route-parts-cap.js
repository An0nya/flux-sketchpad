// node: B7 "too many route parts" — the 16 was a chosen constant in FOUR places and nothing asserted they
// agree. js/drive-three.js:55 (the uniform arrays) · js/drive-three-shaders.js:16 (the shader declaration)
// · js/drive-three-shaders.js:322 (the loop bound) · js/drive-three.js:333 (the app-side throw).
// Changing one and not the others makes three.js fail with a uniform-array-size mismatch, which is a CPU
// fallback — the very bug Anya reported. This check makes that impossible silently.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); cond ? pass++ : fail++; };

const js = read('js/drive-three.js');
const gl = read('js/drive-three-shaders.js');

// the four sites
const arrDecl = /part:\s*array\((\d+),\s*T\.Vector4\)/.exec(js);
const arrDecl2 = /partShape:\s*array\((\d+),\s*T\.Vector4\)/.exec(js);
const uniDecl = /uniform\s+vec4\s+part\[(\d+)\],\s*partShape\[(\d+)\]/.exec(gl);
const loopBound = /for\(int i=0;i<(\d+);i\+\+\)\s*\{\s*if\(i>=nPart\)\s*break/.exec(gl);
const appCap = /if\s*\(parts\.length\s*>\s*(\d+)\)\s*throw\s+Error\('too many route parts'\)/.exec(js);

ok('route-parts: app-side uniform arrays declared in drive-three.js', !!arrDecl && !!arrDecl2, arrDecl && arrDecl[1]);
ok('route-parts: shader declares part[]/partShape[]', !!uniDecl, uniDecl && uniDecl.slice(1));
ok('route-parts: shader loop bound is nPart-guarded', !!loopBound, loopBound && loopBound[1]);
ok('route-parts: app-side cap throws a visible fallback', !!appCap, appCap && appCap[1]);

const all = [arrDecl && arrDecl[1], arrDecl2 && arrDecl2[1], uniDecl && uniDecl[1], uniDecl && uniDecl[2], loopBound && loopBound[1], appCap && appCap[1]].filter(Boolean);
const same = all.length === 6 && new Set(all).size === 1;
ok('route-parts: ALL FOUR sites use the SAME constant (a mismatch is a three.js uniform-array error → CPU fallback)', same, all);

const n = same ? Number(all[0]) : 0;
ok('route-parts: the cap is raised to at least 64 (Anya: endless/3d road hits >16 at elevation changes)', n >= 64, { n, needed: 64 });

// the sibling class Anya did not report but has the same shape
const crossCap = /if\s*\(crossings\.length\s*>\s*(\d+)\)\s*throw\s+Error\('too many crossings'\)/.exec(js);
const crossArr = /crossing:\s*array\((\d+),\s*T\.Vector4\)/.exec(js);
const crossUni = /uniform\s+vec4\s+crossing\[(\d+)\]/.exec(gl);
ok('route-parts: the crossings cap is at least the same size (same false-rejection class)', !!crossCap && !!crossArr && !!crossUni && crossCap[1] === crossArr[1] && crossArr[1] === crossUni[1] && Number(crossCap[1]) >= 64, { cap: crossCap && crossCap[1], arr: crossArr && crossArr[1], uni: crossUni && crossUni[1] });

// the shader must keep the nPart break, or a padded array would cost every frame
ok('route-parts: the loop still breaks at nPart (cost stays O(nPart), not O(array))', /i>=nPart\)\s*break/.test(gl));

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
