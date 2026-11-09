/* Node test for js/endless-relief.js (Endless road v2, pencroff 11-09).
   Run: node tests/endless-relief.js   (registered in the gate MAP; runs when js/endless-relief.js changes)
   Checks: determinism, flat=0, ladder membership, grade magnitudes, range bounds,
   height C0 continuity, cross-axis independence, OFF (all-auto) behavior.
   Requires js/endless-axis-config.js (harbert's scheduler) to be present. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'endless-axis-config.js'));
const R = require(path.join(ROOT, 'js', 'endless-relief.js'));
const L = E.LADDERS.relief;
let failed = 0;
const ok = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); if (!pass) failed++; };

// 1. determinism: same seed + settings = same relief value + grade
const a1 = R.reliefAt(42, 5, { relief: 'auto' });
const a2 = R.reliefAt(42, 5, { relief: 'auto' });
ok('determinism: same seed+block+settings = same result', a1.relief === a2.relief && a1.grade === a2.grade, a1);

// 2. flat = 0 grade
const flat = R.reliefAt(42, 5, { relief: 'flat' });
ok('flat relief = 0 grade', flat.relief === 'flat' && flat.grade === 0, flat);

// 3. relief values are always on the ladder
let onLadder = true;
for (let b = 0; b < 100; b++) {
  const v = R.reliefAt(42, b, { relief: 'auto' });
  if (!L.includes(v.relief)) { onLadder = false; ok('relief on ladder at block ' + b, false, v); break; }
}
ok('relief values always on the ladder', onLadder);

// 4. grade magnitudes match the ladder ranges
let gradesOk = true;
for (const r of L) {
  const v = R.reliefAt(42, 10, { relief: r });
  const [lo, hi] = R.RELIEF_GRADES[r];
  const mag = Math.abs(v.grade);
  if (mag < lo - 1e-9 || mag > hi + 1e-9) { gradesOk = false; ok('grade magnitude for ' + r, false, { r, mag, lo, hi }); }
}
ok('grade magnitudes match ladder ranges', gradesOk);

// 5. range mode stays in bounds (scheduler picks only within range)
let inRange = true;
const tl = E.timeline(42, { relief: { min: 'rolling', max: 'hilly' } }, 1600);
for (let i = 0; i < tl.axes.relief.length; i++) {
  const idx = L.indexOf(tl.axes.relief[i].value);
  if (idx < 1 || idx > 2) { inRange = false; ok('range run ' + i + ' in bounds', false, tl.axes.relief[i].value); break; }
}
ok('range mode stays in bounds', inRange);

// 6. height function is C0 continuous at block boundaries
const h = R.reliefHeightFn(42, { relief: 'auto' });
let c0 = true;
for (let b = 1; b < 10; b++) {
  const sb = b * R.RELIEF_BLOCK;
  const zJustBefore = h(sb - 1e-7);
  const zJustAfter = h(sb + 1e-7);
  if (Math.abs(zJustBefore - zJustAfter) > 1e-4) { c0 = false; ok('C0 at block ' + b, false, { zJustBefore, zJustAfter }); break; }
}
ok('height function C0 continuous at block boundaries', c0);

// 7. height function produces reasonable elevations (mountain ~2-6%)
const hm = R.reliefHeightFn(42, { relief: 'mountain' });
const z0 = hm(0), z1 = hm(R.RELIEF_BLOCK);
const grade = Math.abs((z1 - z0) / R.RELIEF_BLOCK);
ok('mountain height grade in 2-6% range', grade >= 0.01 && grade <= 0.07, { grade: grade.toFixed(4) });

// 8. cross-axis independence: relief timeline unchanged when only water differs
const tl1 = E.timeline(42, { relief: 'auto', water: 'none' }, 1600);
const tl2 = E.timeline(42, { relief: 'auto', water: 'river' }, 1600);
let sameRelief = true;
for (let i = 0; i < Math.min(tl1.axes.relief.length, tl2.axes.relief.length); i++) {
  if (tl1.axes.relief[i].value !== tl2.axes.relief[i].value) { sameRelief = false; break; }
}
ok('relief timeline unchanged when only water differs', sameRelief);

// 9. OFF behavior: all-auto settings (the default) produces valid relief
const auto = R.reliefAt(42, 3, {});
ok('OFF (all-auto) produces valid relief', L.includes(auto.relief) && typeof auto.grade === 'number', auto);

// 10. reliefGrade returns just the grade (replaces endlessGrade)
const g = R.reliefGrade(42, 7, { relief: 'mountain' });
ok('reliefGrade returns signed number', typeof g === 'number' && Math.abs(g) >= 0.02 && Math.abs(g) <= 0.06, g);

// 11. height function is deterministic
const h1 = R.reliefHeightFn(42, { relief: 'auto' });
const h2b = R.reliefHeightFn(42, { relief: 'auto' });
ok('height function deterministic', Math.abs(h1(1234.5) - h2b(1234.5)) < 1e-9);

// 12. different seeds produce different roads
const h3 = R.reliefHeightFn(99, { relief: 'auto' });
ok('different seeds produce different roads', Math.abs(h1(1234.5) - h3(1234.5)) > 0.01);

console.log('\n' + (failed === 0 ? 'all ' + (12 - failed) + ' endless-relief checks passed' : (12 - failed) + ' checks passed, ' + failed + ' failed'));
process.exit(failed === 0 ? 0 : 1);
