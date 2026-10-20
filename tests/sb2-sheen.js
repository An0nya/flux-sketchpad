// SB2: wet sheen from lane studs and painted lines. Node, no browser: node tests/sb2-sheen.js — exits 1 on any failure.
// Checks: (1) studs are admitted as sheen sources by their kind, and no other tilted disc is; (2) the source caps hold with studs dense;
// (3) paint takes the sheen only when the sheen is on; (4) the GPU shader tests the same material ids as the CPU (by number, as the shader does).
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');

function run(RF, ok) {
  const D = RF.Drive;
  const lut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false));
  const p = { eye: [-2, 0.37, 1.2], lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut, look: { wet: true, wetSheen: true, RL: 0.2, ambient: 0.05 }, lane: 3.5 };
  // a stud as the kit places it: a disc tilted 8.5 degrees toward the car (the same numbers as drive-scenes.js rpm())
  const stud = (x, y) => ({ k: 'disc', x, y, z: 0.035, r: 0.035, nx: -Math.sqrt(1 - 0.148 * 0.148), ny: 0, nz: 0.148, sub: true, glow: true, mat: 'rpm-white', cls: 'rpm' });
  // the same tilt on a non-stud disc: a sign-like disc at the same place, which must NOT be admitted
  const tilted = (x, y) => Object.assign(stud(x, y), { cls: 'post', mat: 'reflector-white' });
  const studs = [], others = [];
  for (let i = 0; i < 12; i++) studs.push(stud(8 + 3 * i, 1.75));
  for (let i = 0; i < 4; i++) others.push(tilted(6 + 5 * i, -1.5));
  const srcS = D.surfaceSources(studs, p), srcO = D.surfaceSources(others, p), srcMix = D.surfaceSources(studs.concat(others), p);
  ok('SB2 studs are admitted as sheen sources (12 studs in view give some sources)', srcS.length > 0, 'sources ' + srcS.length);
  ok('SB2 a tilted non-stud disc is not admitted (same geometry, cls post)', srcO.length === 0, 'sources ' + srcO.length);
  ok('SB2 the stud cap: at most STUD_SOURCES (8) studs, nearest first', srcS.length <= 8 && srcS.every(q => q.stud === true) && srcS[0].x === 8, 'studs ' + srcS.length + ' first at x ' + (srcS[0] && srcS[0].x));
  ok('SB2 mixed scene: the non-stud tilted discs add nothing to the studs\' list', srcMix.length === srcS.length, 'mixed ' + srcMix.length + ' studs-only ' + srcS.length);
  // the regular cap is unchanged: 8 upright sources at most, whatever the studs do
  const upright = Array.from({ length: 12 }, (_, i) => ({ k: 'disc', x: 10 + 4 * i, y: -3, z: 2, r: 0.2, nx: 0, ny: 1, nz: 0, mat: 'sign-white', cls: 'sign' }));
  const srcUp = D.surfaceSources(upright, p);
  ok('SB2 the upright-source cap is unchanged (8)', srcUp.length <= 8 && srcUp.every(q => !q.stud), 'upright ' + srcUp.length);
  ok('SB2 combined: upright cap 8 and stud cap 8 together, at most 16 sources', D.surfaceSources(upright.concat(studs), p).length <= 16, 'combined ' + D.surfaceSources(upright.concat(studs), p).length);

  // paint: a wet gloss only with the sheen on; dry and sheen-off wet frames keep their paint as it was
  const on = D.materials({ wet: true, wetSheen: true, RL: 0.2 }), off = D.materials({ wet: true, wetSheen: false, RL: 0.2 }), dry = D.materials({ wet: false, wetSheen: true, RL: 0.2 });
  ok('SB2 paint gets the wet gloss only with wet and sheen on (white and yellow)',
    on['white-paint'].gloss && on['white-paint'].gloss.a === 0.25 && on['yellow-paint'].gloss.a === 0.25 && !off['white-paint'].gloss && !dry['white-paint'].gloss && !dry['yellow-paint'].gloss,
    JSON.stringify({ on: on['white-paint'].gloss, off: off['white-paint'].gloss }));
  ok('SB2 paint ids match the shader (white 5, yellow 6): the ids the GLSL tests', on['white-paint'].id === 5 && on['yellow-paint'].id === 6, 'ids ' + on['white-paint'].id + ',' + on['yellow-paint'].id);
  // the shader source: the sheen lines test exactly the ids the JS sheen list uses (asphalt 0, concrete 4, paint 5 and 6; the own-lamp streak without concrete)
  const sh = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
  const reflLine = (sh.match(/if\(sheen>0\.0 && \(([^)]*)\)\) for\(int i=0;i<64;i\+\+\)/) || [])[1] || '';
  const streakLine = (sh.match(/if\(sheen>0\.0 && \(([^)]*)\)\) r\+=vec3/) || [])[1] || '';
  ok('SB2 GPU sheen ids match the CPU list (reflections: 0,4,5,6)', ['id==0', 'id==4', 'id==5', 'id==6'].every(t => reflLine.includes(t)) && reflLine.split('||').length === 4, 'GLSL: ' + reflLine);
  ok('SB2 GPU own-lamp streak ids match the CPU list (0,5,6: asphalt and paint, not concrete)', ['id==0', 'id==5', 'id==6'].every(t => streakLine.includes(t)) && streakLine.split('||').length === 3, 'GLSL: ' + streakLine);
  const jsSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8');
  ok('SB2 CPU sheen lists are the named sets (SHEEN_IDS and OWN_STREAK_IDS)', /SHEEN_IDS\.includes\(m\.id\)/.test(jsSrc) && /OWN_STREAK_IDS\.includes\(m\.id\)/.test(jsSrc));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0;
  run(load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all SB2 sheen checks passed');
  process.exitCode = fails ? 1 : 0;
}
