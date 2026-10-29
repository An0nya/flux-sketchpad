// CANVAS SHAPE (UI step C, owner 10-29), headless: node tests/canvas-shape.js — exits 1 on failure.
// A 3:4 or square canvas keeps the wide (16:9) view's VERTICAL field of view and crops the sides (RF.DriveAnim.hfovFor), and the sim ceiling is a
// pixel budget (the area of a 16:9 frame that wide), so a narrower shape never costs more pixels (RF.DriveAnim.simSize). The layout's shape rule:
// stacked (phone) with the panel open, 3:4 shows as square (RF.DriveLayout.shapeOf).
const { load } = require('./load.js'); const RF = load(); const A = RF.DriveAnim, DL = RF.DriveLayout;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); if (!cond) fails++; };
const tanHalf = (deg) => Math.tan(deg * Math.PI / 360);
ok('CS layout module loaded headless', !!DL && !!A.hfovFor);
for (const fov of [30, 45, 60, 90]) {
  const v16 = tanHalf(fov) * 9 / 16;
  for (const [name, a] of [['3:4', 3 / 4], ['square', 1]]) {
    const h = A.hfovFor(fov, a);
    ok('CS ' + name + ' at fov ' + fov + ': vertical angle equals the wide view', Math.abs(tanHalf(h) / a - v16) < 1e-12, { hfov: +h.toFixed(3) });
    ok('CS ' + name + ' at fov ' + fov + ': narrower horizontal angle (sides cropped)', h < fov, +h.toFixed(3));
  }
  ok('CS wide at fov ' + fov + ' is the setting itself', A.hfovFor(fov, 16 / 9) === fov && A.hfovFor(fov) === fov);
}
for (const ceiling of [640, 1600, 2560]) {
  const wide = A.simSize(ceiling, 99999, 1, 1), area = wide.W * wide.H;
  ok('CS wide sim at ceiling ' + ceiling + ' is ceiling x 9/16 (unchanged)', wide.W === (ceiling & ~1) && wide.H === (Math.round(wide.W * 9 / 16) & ~1), wide);
  for (const [name, a] of [['3:4', 3 / 4], ['square', 1]]) {
    const s = A.simSize(ceiling, 99999, 1, 1, a);
    ok('CS ' + name + ' sim at ceiling ' + ceiling + ' stays within the 16:9 pixel budget (2% rounding)', s.W * s.H <= area * 1.02, { W: s.W, H: s.H, budget: area });
    ok('CS ' + name + ' sim has the shape', Math.abs(s.W / s.H - a) < 0.01, { W: s.W, H: s.H });
  }
}
ok('CS shapeOf: 3:4 stacked with the panel open shows as square', DL.shapeOf('3:4', true, true) === 'square');
ok('CS shapeOf: 3:4 stacked and stowed, or wide layout, stays 3:4', DL.shapeOf('3:4', true, false) === '3:4' && DL.shapeOf('3:4', false, true) === '3:4');
ok('CS shapeOf: unknown value is wide; square is square everywhere', DL.shapeOf('bogus', false, false) === 'wide' && DL.shapeOf('square', true, true) === 'square');
console.log(fails ? fails + ' FAILED' : 'all canvas-shape checks passed'); process.exit(fails ? 1 : 0);
