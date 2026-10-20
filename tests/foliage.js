// FO placement and main-off identity. Compare actual main source, including function materials.
const fs = require('fs'), vm = require('vm'), cp = require('child_process');
function run(RF, ok) {
  const D = RF.Drive, A = RF.DriveAnim;
  const encode = x => JSON.stringify(x, (_, v) => typeof v === 'function' ? String(v) : v);
  const ctx = { Lw: 3.5, seed: 7, density: 1.5 }, flags = { leafyFoliage: true };
  const plants = D.vergeFoliage(ctx, flags);
  ok('FO seeded undergrowth repeats exactly', encode(plants) === encode(D.vergeFoliage(ctx, flags)));
  ok('FO another seed changes placement', encode(plants) !== encode(D.vergeFoliage({ ...ctx, seed: 8 }, flags)));
  ok('FO off and vegetation off produce no prototype bushes', !D.vergeFoliage(ctx, {}).length && !D.vergeFoliage(ctx, { ...flags, veg: false }).length);
  ok('FO density scales bush count', D.vergeFoliage({ ...ctx, density: 3 }, flags).length === 2 * plants.length && !D.vergeFoliage({ ...ctx, density: 0 }, flags).length);
  let clear = true, bounded = true, n = 0;
  for (const Lw of [2.8, 3.5, 4.4]) for (let seed = 0; seed < 32; seed++) {
    for (const o of D.vergeFoliage({ Lw, seed, density: 3 }, flags)) {
      clear &&= o.y < 0 ? o.y + o.ry <= -Lw / 2 - .3 : o.y - o.ry >= 1.5 * Lw + .3;
      bounded &&= o.z - o.rz === 0 && o.z + o.rz >= .3 && o.z + o.rz <= 1.2;
      n++;
    }
  }
  ok('FO entire bush clears carriageway and edge line by .3 m (' + n + ' lobes)', clear);
  ok('FO bushes grounded and .3–1.2 m tall', bounded);
  const sandbox = { RF: { ...RF, Drive: { ...D } } };
  vm.createContext(sandbox);
  for (const file of ['drive-scenes', 'drive-anim']) vm.runInContext(cp.execFileSync('git', ['show', '322d119:js/' + file + '.js'], { encoding: 'utf8' }), sandbox);
  let identical = true, compared = 0, retained = true;
  const oldD = sandbox.RF.Drive, oldA = sandbox.RF.DriveAnim;
  for (const scene of ['road', 'forest', 'city']) for (const wild of [false, true]) for (const veg of [false, true]) {
    const f = { people: true, animals: true, veg }, opts = { wild, seed: 17, density: 1.5, trafficDensity: 0 };
    const before = oldA.source(scene, 3.5, false, f, opts);
    const after = A.source(scene, 3.5, false, f, { ...opts, leafyFoliage: false });
    identical &&= encode(before.objects) === encode(after.objects);
    if (before.chunk) for (const chunk of [-1, 0, 1, 19]) identical &&= encode(before.chunk(chunk)) === encode(after.chunk(chunk));
    const on = A.source(scene, 3.5, false, f, { ...opts, leafyFoliage: true });
    retained &&= encode(after.objects) === encode(on.objects.filter(o => !o.foliage));
    ok('FO vegetation/scene controls undergrowth ' + [scene, wild, veg].join('/'), on.objects.some(o => o.foliage) === (veg && ['forest', 'road'].includes(scene)));
    for (const dist of [0, 37.5, 299.9, 611]) for (const arc of [null, RF.Road.arc(150, 'left')]) {
      identical &&= encode(oldA.place(before, dist, arc)) === encode(A.place(after, dist, arc)); compared++;
    }
  }
  ok('FO off object lists identical to main 322d119 (' + compared + ' worlds)', identical);
  ok('FO adding bushes preserves all original scenery and random streams', retained);
  const c = { Lw: 3.5, seed: 17, density: 1.5 };
  ok('FO buildScene off identical to main', ['road', 'forest', 'city'].every(s => encode(D.buildScene(s, c, { leafyFoliage: false })) === encode(oldD.buildScene(s, c, {}))));
  // Verify the literal default shader, not just its output against another current renderer.
  const current = fs.readFileSync('js/drive-three-objects.js', 'utf8'), base = cp.execFileSync('git', ['show', '322d119:js/drive-three-objects.js'], { encoding: 'utf8' });
  const shader = s => s.slice(s.indexOf('export const objectFragment'), s.indexOf('export function objects'));
  // FG2 added one view-path fog line to this fragment (off when sigma is 0). Strip exactly that line; everything else must match the pinned literal.
  const FOG_LINE = ' if(sigma>0.0){float T=exp(-sigma*t); color=color*T+vec3(flags.y>0.0?0.0:ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(ray.z)*8.0))*(1.0-T));}\n';
  // SC2 added one in-scatter line after it (off when scatterSteps is 0). Strip that line too.
  const SCAT_LINE = ' if(scatterSteps>0 && flags.y<=0.0) color+=inScatter(ray,t,scatterJitter());\n';
  const stripped = shader(current).split(FOG_LINE).join('').split(SCAT_LINE).join('');
  ok('FO default shader literal unchanged apart from the FG fog line and the SC scatter line', stripped.split('// Only leaf buckets')[0].trim() === shader(base).trim() && shader(current).split(FOG_LINE).length === 2 && shader(current).split(SCAT_LINE).length === 2);
}
module.exports = { run };
if (require.main === module) {
  let failures = 0;
  run(require('./load.js').load(), (name, pass) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name); if (!pass) failures++; });
  console.log(failures ? failures + ' FO checks FAILED' : 'all FO Node checks passed'); process.exitCode = failures ? 1 : 0;
}
