// DC drive controls, headless: node tests/drive-controls2.js — exits 1 on any failure.
// Real functions: RF.DriveAnim._.source + trafficCars (the traffic window), RF.Drive.eyeFor / dollyBack (the telephoto dolly).
// Fixtures: tests/drive-controls-fixtures/dc-main-traffic-230.json = main (58bccea) car lists, generated from a scratch copy of main (not the worktree);
//           tests/drive-controls-fixtures/drive-view-main-58bccea.json = a drive-view preference as main stores it (fov 45).
// POSITIVE CONTROL: DC_WRONG_RANGE=400 makes "230 m reproduces main" use a 400 m window. That check must then FAIL (exit 1).
const fs = require('fs'), path = require('path');
const { load } = require('./load.js'); const RF = load(); const A = RF.DriveAnim._, D = RF.Drive;
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = JSON.parse(read('tests/drive-controls-fixtures/dc-main-traffic-230.json'));
const storedMain = JSON.parse(read('tests/drive-controls-fixtures/drive-view-main-58bccea.json'));
const EYE = [-2.0, 0.37, 1.2];
const carsOf = (opts, dist, t) => A.trafficCars(A.source('road', 3.5, false, {}, opts), dist, t).map((c) => ({ id: c.id, kind: c.kind, rel: c.rel, off: c.off }));
const idsOf = (list) => list.map((c) => c.id);

// 1. option defaults, read from the shipped DV_DEF (spec-ui.js is a DOM module, so the literal is evaluated, not required)
const specUI = read('js/spec-ui.js');
const dvDefText = specUI.match(/const DV_DEF = (\{[^;]*\});/);
ok('DV_DEF literal found in js/spec-ui.js', !!dvDefText);
const DV_DEF = new Function('return ' + dvDefText[1])();
ok('option defaults: fov 60, trafficRange 400, dolly off', DV_DEF.fov === 60 && DV_DEF.trafficRange === 400 && DV_DEF.dolly === false, { fov: DV_DEF.fov, trafficRange: DV_DEF.trafficRange, dolly: DV_DEF.dolly });

// 2. stored settings from main still load: the merge dvOpts() does, and the merged values drive the scene
const merged = Object.assign({}, DV_DEF, storedMain);
ok('stored main settings: fov 45 kept, new keys take defaults', merged.fov === 45 && merged.trafficRange === 400 && merged.dolly === false && merged.ev === 2.5 && merged.seed === 19, { fov: merged.fov, trafficRange: merged.trafficRange, dolly: merged.dolly, ev: merged.ev, seed: merged.seed });
ok('stored main settings: traffic window of the merged settings is 400 m', A.source('road', 3.5, false, {}, merged).traffic.cull === 400);

// 3. traffic range 230 reproduces main's car list exactly (ids, kinds, rel, off), for every recorded case
const WRONG = process.env.DC_WRONG_RANGE ? +process.env.DC_WRONG_RANGE : 230;
for (const name of [...new Set(fixture.cases.map((c) => c.config))]) {
  const cases = fixture.cases.filter((c) => c.config === name);
  const mismatches = cases.filter((c) => JSON.stringify(carsOf(Object.assign({}, c.opts, { trafficRange: WRONG }), c.dist, c.t)) !== JSON.stringify(c.cars));
  ok('230 m reproduces main car list exactly: ' + name + (WRONG !== 230 ? ' [POSITIVE CONTROL range ' + WRONG + ']' : ''), mismatches.length === 0, { cases: cases.length, mismatches: mismatches.map((c) => ({ dist: c.dist, t: c.t })) });
}

// 4. 400 and 600 (and 800) are supersets of 230, with the same rel for shared cars; the wider window must add cars somewhere
const ranges = [230, 400, 600, 800];
let grew = 0, supersetOk = true, relOk = true;
for (const c of fixture.cases) {
  const lists = ranges.map((r) => carsOf(Object.assign({}, c.opts, { trafficRange: r }), c.dist, c.t));
  for (let i = 1; i < ranges.length; i++) {
    const prev = new Map(lists[i - 1].map((x) => [x.id, x])), cur = new Map(lists[i].map((x) => [x.id, x]));
    for (const id of prev.keys()) if (!cur.has(id)) supersetOk = false;
    for (const [id, x] of prev) if (cur.has(id) && cur.get(id).rel !== x.rel) relOk = false;
    if (cur.size > prev.size) grew++;
  }
}
ok('superset: cars(230) ⊆ cars(400) ⊆ cars(600) ⊆ cars(800), same rel for shared cars', supersetOk && relOk);
ok('the wider windows add cars in at least one recorded case', grew > 0, { casesWithMoreCars: grew });
ok('400 m window reaches cars beyond 230 m', fixture.cases.some((c) => carsOf(Object.assign({}, c.opts, { trafficRange: 400 }), c.dist, c.t).some((x) => x.rel > 230)));

// 5. non-traffic CULL users keep the 230 m window: scenery objects do not depend on the traffic range
const srcA = A.source('road', 3.5, false, {}, Object.assign({}, fixture.cases[0].opts, { trafficRange: 230 }));
const srcB = A.source('road', 3.5, false, {}, Object.assign({}, fixture.cases[0].opts, { trafficRange: 800 }));
ok('scenery objects identical at 230 m and 800 m (the range is traffic only)', JSON.stringify(srcA.objects) === JSON.stringify(srcB.objects), { count: srcA.objects && srcA.objects.length });
const anim = read('js/drive-anim.js');
const scenery = ['mid > CULL + 110', 's > CULL', 'ev.s - dist < CULL', 'rel <= CULL', 'rel > CULL) continue;'];
ok('scenery, lamp, crossing and actor culls still read CULL (text)', scenery.slice(0, 4).every((s) => anim.includes(s)), scenery);
ok('auto-high sensing range is 160 m oncoming, 100 m preceding (owner, 2026-10-18)', D.AUTO.onRange === 160 && D.AUTO.preRange === 100);

// 6. telephoto dolly math
const back = (fov, on) => D.dollyBack(fov, on);
ok('dolly off: eye is the fixed eye at 45, 60, 90', [45, 60, 90].every((f) => JSON.stringify(D.eyeFor(f, false)) === JSON.stringify(EYE)));
ok('dolly on at 60 and wider: eye is the fixed eye (offset 0)', [60, 75, 90].every((f) => JSON.stringify(D.eyeFor(f, true)) === JSON.stringify(EYE)));
ok('dolly on at 45: eye moves back about 7.9 m (20 m × (tan30/tan22.5 − 1))', Math.abs(back(45, true) - 7.879) < 0.01, { back: back(45, true) });
ok('dolly on at 45: eye moves along x only (y, z unchanged)', (() => { const e = D.eyeFor(45, true); return e[0] === EYE[0] - back(45, true) && e[1] === EYE[1] && e[2] === EYE[2]; })());
ok('dolly keeps apparent size: (20 + back) × tan(fov/2) = 20 × tan30 at 45', Math.abs((20 + back(45, true)) * Math.tan(22.5 * Math.PI / 180) - 20 * Math.tan(30 * Math.PI / 180)) < 1e-9);
ok('dolly on at 30: formula back = 23.09 m (brief said ~14 m; see report)', Math.abs(back(30, true) - 23.094) < 0.01, { back: back(30, true) });
ok('the dolly is opt-in: the function is a no-op with dolly undefined', JSON.stringify(D.eyeFor(45, undefined)) === JSON.stringify(EYE));

// 7. wiring (text): the controls and cache keys carry the new options
ok('view angle: sidebar row removed, drive-bar select data-dv=fov present', !/Drive view: field of view/.test(specUI) && specUI.includes("'data-dv': 'fov'") && specUI.includes("setDV(ui, 'fov', +fov.value)"));
ok('view angle: render uses the shared eye (eyeFor)', specUI.includes('eye: RF.Drive.eyeFor(o.fov, o.dolly)') && !specUI.includes('eye: [-2.0, 0.37, 1.2]'));
ok('traffic range: cache key (tkey) and worker options carry it', anim.includes('o.trafficDensity, o.trafficRange, o.safeGap') && anim.includes('trafficRange: o.trafficRange, safeGap'));
ok('traffic range: worker cfg key carries the eye (dolly changes it)', anim.includes('p.hfov, p.eye, p.lane'));
ok('telephoto dolly: bar button and aria-pressed sync present', anim.includes("btn('telephoto-dolly'") && anim.includes("['telephoto-dolly', 'dolly']"));
ok('three path: eye comes from the frame, not a constant', read('js/drive-three.js').includes('fromArray(p.eye || [-2,.37,1.2])') && read('js/drive-three-objects.js').includes('eye=p.eye||[-2,.37,1.2]'));

console.log(fails ? fails + ' of ' + n + ' drive-controls2 checks FAILED' : 'all ' + n + ' drive-controls2 checks passed');
process.exit(fails ? 1 : 0);
