/* Node test for js/endless-axis-config.js (Endless road v2 slice a, harbert 11-09).
   Run: node tests/endless-axis-config.js   (registered in the NODE list when the UI patch lands; until then run directly)
   Checks the contract mailed to pencroff/nemo (m20261109-113402011-4d15):
   determinism, fail-soft parse, fixed axes never move, range axes stay in range, relief steps one rung at a time,
   cross-axis incompatibilities suppressed, run lengths keyed off the cross-axis speed limit, style policy. */
const E = require('../js/endless-axis-config.js');
const L = E.LADDERS;
let failed = 0;
const ok = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); if (!pass) failed++; };

// 1. parse: fail-soft + defaults
const c0 = E.parse({});
ok('empty settings parse to all-auto + curviness 1', E.AXES.every((a) => c0[a] === 'auto') && c0.userCurviness === 1);
const c1 = E.parse({ settlement: 'city', relief: { min: 'hilly', max: 'flat' }, userCurviness: 99, roadClass: 'nonsense' });
ok('fixed value kept', c1.settlement === 'city');
ok('min>max swaps to index range', c1.relief && c1.relief.min === 0 && c1.relief.max === 2);
ok('curviness clamps to 4', c1.userCurviness === 4);
ok('unknown name fails soft to auto', c1.roadClass === 'auto');

// 2. determinism: same seed + settings = identical timelines
const cfg = { settlement: 'auto', roadClass: { min: 'two-lane', max: 'dense-highway' }, relief: 'auto', cover: 'auto', water: 'auto', userCurviness: 1.5 };
const t1 = E.timeline(42, cfg, 4000), t2 = E.timeline(42, cfg, 4000), t3 = E.timeline(43, cfg, 4000);
ok('same seed+config = identical timelines', JSON.stringify(t1.axes) === JSON.stringify(t2.axes));
ok('different seed = different timelines', JSON.stringify(t1.axes) !== JSON.stringify(t3.axes));

// 3. fixed axes: one run, never moves
const tf = E.timeline(7, { settlement: 'city', relief: 'flat', roadClass: 'auto', cover: 'auto', water: 'auto' }, 3000);
ok('fixed axis is a single full run', tf.axes.settlement.length === 1 && tf.axes.settlement[0].value === 'city' && tf.axes.settlement[0].endK === Infinity);
ok('fixed axis valueAt holds at any k', E.valueAt(tf.axes.settlement, 0) === 'city' && E.valueAt(tf.axes.settlement, 2999) === 'city');
ok('fixed relief never leaves its value', E.valueAt(tf.axes.relief, 1500) === 'flat');

// 4. range axes stay in range
const inRange = (tl, axis, cfgv) => {
  const [lo, hi] = E.rangeOf(E.parse(cfgv), axis), Lr = L[axis];
  for (const r of tl.axes[axis]) { const i = Lr.indexOf(r.value); if (i < lo || i > hi) return false; } return true;
};
ok('ranged roadClass stays within its range', inRange(t1, 'roadClass', cfg));

// 5. relief steps one rung at a time in auto mode
const tr = E.timeline(11, { relief: 'auto', settlement: 'auto', roadClass: 'auto', cover: 'auto', water: 'auto' }, 6000);
let maxStep = 0, prev = -1;
for (const r of tr.axes.relief) { const i = L.relief.indexOf(r.value); if (prev >= 0) maxStep = Math.max(maxStep, Math.abs(i - prev)); prev = i; }
ok('relief never skips a rung (auto)', maxStep <= 1, { maxStep });

// 6. cross-axis suppression: pin settlement=city, relief auto — steep-pass/pass runs must be rare-or-never
const tc = E.timeline(5, { settlement: 'city', relief: 'auto', roadClass: 'auto', cover: 'auto', water: 'auto' }, 6000);
const cityRuns = tc.axes.settlement.filter((r) => r.value === 'city');
const steep = tc.axes.relief.filter((r) => ['steep-pass', 'pass'].includes(r.value));
ok('city on steep-pass/pass suppressed to rare', steep.length <= Math.max(1, Math.floor(cityRuns.length * 0.2)), { cityRuns: cityRuns.length, steep: steep.length });

// 7. run lengths keyed off the cross-axis speed limit: a city settlement makes settlement runs SHORTER than a wild one
const tcity = E.timeline(21, { settlement: 'city', roadClass: 'auto', relief: 'auto', cover: 'auto', water: 'auto' }, 4000);
const twild = E.timeline(21, { settlement: 'wild', roadClass: 'auto', relief: 'auto', cover: 'auto', water: 'auto' }, 4000);
const avgLen = (tl, ax) => tl.axes[ax].reduce((a, r) => a + (Math.min(r.endK, 4000) - r.startK), 0) / tl.axes[ax].length;
const cityRelief = avgLen(tcity, 'relief'), wildRelief = avgLen(twild, 'relief');
ok('relief runs shorter under city (speed 50) than wild (80)', cityRelief < wildRelief, { cityRelief: Math.round(cityRelief), wildRelief: Math.round(wildRelief) });

// 8. style policy
ok('sharp on the listed pairs / big jumps present somewhere or default gradual holds', tr.axes.relief.every((r) => r.style === 'gradual' || r.style === 'sharp'));
const ts = E.timeline(3, { settlement: 'city', cover: 'auto', relief: 'auto', roadClass: 'auto', water: 'auto' }, 4000);
const sharpCover = ts.axes.cover.some((r) => r.style === 'sharp' && (r.value === 'park' || r.value === 'forest'));
ok('city->park/forest transitions are sharp', sharpCover, { coverRuns: ts.axes.cover.map((r) => r.from + '>' + r.value + ':' + r.style).slice(0, 6) });

// 9. styleAt / valueAt agree at boundaries
ok('valueAt at k=0 is the first run value', E.valueAt(tr.axes.relief, 0) === tr.axes.relief[0].value);
ok('styleAt returns a style for every k', ['gradual', 'sharp'].includes(E.styleAt(tr, 'relief', 1234)));

// 10. curviness passes through parse untouched (consumer applies it)
const tc2 = E.parse({ userCurviness: 2.5 });
ok('curviness 2.5 preserved for the consumer', tc2.userCurviness === 2.5);

// 11. timeline is stable under an unrelated-axis change (relief schedule identical when only water differs)
const a = E.timeline(99, { water: 'none', relief: 'auto', settlement: 'auto', roadClass: 'auto', cover: 'auto' }, 5000);
const b = E.timeline(99, { water: 'river', relief: 'auto', settlement: 'auto', roadClass: 'auto', cover: 'auto' }, 5000);
ok('relief timeline unchanged when only water differs', JSON.stringify(a.axes.relief) === JSON.stringify(b.axes.relief));
// ...but NOT when settlement differs (speed limit changes run lengths — the whole point of the shared scheduler)
const c = E.timeline(99, { settlement: 'city', relief: 'auto', roadClass: 'auto', cover: 'auto', water: 'auto' }, 5000);
ok('relief timeline DOES change when settlement differs', JSON.stringify(a.axes.relief) !== JSON.stringify(c.axes.relief));

console.log(failed ? '\n' + failed + ' FAILED' : '\nall endless-axis-config checks passed');
process.exit(failed ? 1 : 0);
