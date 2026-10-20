// TL1/TL2: the road light from other cars fades out instead of popping on or off. Real trafficSources/trafficAt, no browser.
// Each probe reads the summed road light at a point fixed relative to every car, so the sum changes only through the weights.
function run(RF, ok) {
  const D = RF.Drive, EYE = [0, 0, 1.2], R = 150, N = 8, STEP = 0.05;
  const lamp = (x, id) => ({ k: 'disc', x, y: 0, z: 0.68, r: 0.08, nx: -1, ny: 0, nz: 0, mat: 'lamp-head', headlamp: true, traffic: id, emit: [1, 1, 1] });
  const car = (x, id) => [lamp(x, id), { ...lamp(x, id), y: 1.24 }];
  const beam = D.trafficBeam({ trafficBeams: true, src: { traffic: { onMode: 'symmetric' } } });
  // road light summed over the sources, each evaluated at a point 10 m in front of its own lamp (constant beam angle)
  const light = (sources) => sources.reduce((s, q) => s + D.trafficAt(q, beam, q.x - 10, q.y, 0.68), 0);
  const peak = light(D.trafficSources([lamp(20, 'p')], EYE, { lightRange: R, lightCars: N }).map(q => ({ ...q, w: 1 })));
  // largest change over one STEP, in units of peak per metre. Taper slope is 0.03/m; a cap fade is 0.75/m per car, and two cars can fade at once (1.5/m), so the bound is 2.
  const maxStep = (fn, a, b) => { let worst = 0, prev = fn(a); for (let x = a + STEP; x <= b + 1e-9; x += STEP) { const v = fn(x); worst = Math.max(worst, Math.abs(v - prev) / (STEP * peak)); prev = v; } return worst; };
  // negative control: the old hard edge (weight 1 inside the range, nothing outside) must fail the same check
  const hardOne = (x) => light(D.trafficSources(car(x, 'a'), EYE, { lightRange: R, lightCars: N }).map(q => ({ ...q, w: 1 })));
  const single = (x) => light(D.trafficSources(car(x, 'a'), EYE, { lightRange: R, lightCars: N }));

  ok('TL1 weight is 1 well inside 65% of the range and 0 at the range', (() => {
    const near = D.trafficSources(car(5, 'a'), EYE, { lightRange: R, lightCars: N }), far = D.trafficSources(car(R - 0.01, 'a'), EYE, { lightRange: R, lightCars: N });
    return near.every(q => q.w === 1) && far.every(q => q.w < 1e-3) && D.trafficSources(car(R, 'a'), EYE, { lightRange: R, lightCars: N }).length === 0;
  })());
  const worstSingle = maxStep(single, 5, R + 20);
  ok('TL1 one car 5 m to range+20 m: road light never steps by more than the Lipschitz bound', worstSingle <= 2.0, { worstStepOverPeak: +worstSingle.toFixed(4) });
  ok('TL1 negative control: the old hard edge at the range steps by the full peak', maxStep(hardOne, 5, R + 20) > 5, { hardWorst: +maxStep(hardOne, 5, R + 20).toFixed(4) });
  ok('TL1 road light is zero beyond the range', single(R + 0.5) === 0 && single(R + 20) === 0);

  // nearest-N swap: eight fixed cars at 20..90 m, a ninth car sweeps through 84..96 m, so it swaps with the car at 90 m.
  const fixed = [20, 30, 40, 50, 60, 70, 80, 90].map((x, i) => car(x, 'f' + i)).flat();
  // per-car weights: a sum of road light can hide a swap when two cars give equal light, so check each car's weight
  const carWeights = (objs, sources) => { const w = new Map(); for (const q of sources) w.set(q.car, (w.get(q.car) || 0) + (q.w === undefined ? 1 : q.w) / 2); return w; };
  const weightsAt = (x) => carWeights(null, D.trafficSources([...fixed, ...car(x, 'swept')], EYE, { lightRange: R, lightCars: N }));
  const oldWeightsAt = (x) => {   // the old rule: nearest N whole cars, weight 1, nothing else
    const all = D.trafficSources([...fixed, ...car(x, 'swept')], EYE, { lightRange: R, lightCars: 1000 }), dist = new Map(all.map(q => [q.car, q.x]));
    const keep = new Set([...dist.entries()].sort((a, b) => a[1] - b[1]).slice(0, N).map(e => e[0]));
    return new Map([...keep].map(id => [id, 1]));
  };
  // largest change of any one car's weight over one STEP, in weight per metre
  const maxWeightStep = (fn, a, b) => { let worst = 0, prev = fn(a); for (let x = a + STEP; x <= b + 1e-9; x += STEP) { const v = fn(x); for (const id of new Set([...prev.keys(), ...v.keys()])) worst = Math.max(worst, Math.abs((v.get(id) || 0) - (prev.get(id) || 0)) / STEP); prev = v; } return worst; };
  const swapWorst = maxWeightStep(weightsAt, 84, 96), oldSwapWorst = maxWeightStep(oldWeightsAt, 84, 96);
  ok('TL1 nearest-N swap: each car weight is continuous as the 9th car passes the 8th', swapWorst <= 2.0, { worstWeightPerM: +swapWorst.toFixed(3) });
  ok('TL1 negative control: the old nearest-N cut jumps a car weight by 1 when the 9th car passes', oldSwapWorst > 5, { oldWorstWeightPerM: +oldSwapWorst.toFixed(1) });
  const nSwept = D.trafficSources([...fixed, ...car(90, 'swept')], EYE, { lightRange: R, lightCars: N }).length;
  ok('TL1 never more than N cars (2N sources) at any sweep point', [84, 88, 90, 92, 96].every(x => D.trafficSources([...fixed, ...car(x, 'swept')], EYE, { lightRange: R, lightCars: N }).length <= 2 * N) && nSwept <= 2 * N);

  // TL2: the options. Range and car count come in as options; 16 and 32 cars give 32 and 64 sources.
  const many = Array.from({ length: 40 }, (_, i) => car(20 + i * 5, 'c' + i)).flat();
  const s16 = D.trafficSources(many, EYE, { lightRange: 400, lightCars: 16 }), s32 = D.trafficSources(many, EYE, { lightRange: 400, lightCars: 32 });
  ok('TL2 nearest 16 and 32 cars give at most 32 and 64 sources (GPU slots)', s16.length <= 32 && s32.length <= 64 && s16.length > 16 && s32.length > 32, { s16: s16.length, s32: s32.length });
  const dflt = D.trafficSources(many, EYE), dIds = new Set(dflt.map(q => q.car));
  ok('TL2 defaults (no options) are the nearest eight cars inside 150 m', dIds.size <= 8 && [...dIds].every(id => +id.slice(1) < 8) && dflt.length <= 16);
  ok('TL2 range option moves the edge: a car at 300 m lights at 400 m, not at 250 m', D.trafficSources(car(300, 'x'), EYE, { lightRange: 400, lightCars: N }).length > 0 && D.trafficSources(car(300, 'x'), EYE, { lightRange: 250, lightCars: N }).length === 0);
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, detail) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (detail ? ' ' + JSON.stringify(detail) : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all TL1/TL2 Node checks passed'); process.exitCode = fails ? 1 : 0; }
