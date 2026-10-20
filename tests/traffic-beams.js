// BT: per-car traffic beams on the CPU path. Node, no browser: node tests/traffic-beams.js (exits 1 on any failure).
// BT1: with no pool every car uses the built-in beam, so the CPU frames are byte-identical to main (hashes below, taken on main a9cb102).
// BT1: a pool gives each car its own beam; a one-entry pool must equal passing that entry as the built-in beam.
const { load } = require('./load.js');
const crypto = require('crypto');

const BASE = { 'road-off': '7a01a6a3252e241b', 'road-on': '5dc1b13156241c7d', 'city-off': 'ce1907ba4427a4f3', 'city-on': 'b14ee067ebb3ae52' };
const sha = (a) => crypto.createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);

function run(RF, ok) {
  const A = RF.DriveAnim, D = RF.Drive, EYE = [0, 0, 1.2], R = 150, N = 8;
  const lut = D.lutFrom((h, v) => 30000 * Math.exp(-0.5 * ((h / 2) ** 2 + v ** 2)) + 200, { step: 0.25 });
  const lamp = (x, id) => ({ k: 'disc', x, y: 0, z: 0.68, r: 0.08, nx: -1, ny: 0, nz: 0, mat: 'lamp-head', headlamp: true, traffic: id, emit: [1, 1, 1] });
  const car = (x, id) => [lamp(x, id), { ...lamp(x, id), y: 1.24 }];

  // 1. CPU render hashes: built-in (no pool) unchanged on road and city, traffic beams off and on
  const hashes = {};
  for (const kind of ['road', 'city']) {
    const dist = kind === 'road' ? 215 : 600, t = 8;
    const src = A.source(kind, 3.5, kind === 'road', kind === 'road' ? { people: false, animals: false, signs: false, posts: false, veg: false, obstacle: false, rpm: false } : {}, kind === 'road' ? { oncoming: true, preceding: true, seed: 7 } : { tiles: true, trafficLogic: true, speed: 130, oncoming: true, preceding: false, seed: 7 });
    const objs = A._.trafficObjects(src, A._.trafficCars(src, dist, t), null, { lowLut: lut, conv: 'A' });
    for (const on of [false, true]) {
      const p = { w: 160, h: 90, hfov: 60, eye: [-2, 0.37, 1.2], lamps: [], lut, lowLut: lut, conv: 'A', lane: 3.5, look: { ambient: 0 }, src, scene: { objects: objs, markings: [], verge: ['grass', 1.5, 'grass'] }, ss: 1, trafficBeams: on };
      hashes[kind + (on ? '-on' : '-off')] = sha(D.render(p).rgb);
    }
  }
  for (const k of Object.keys(BASE)) ok('BT1 built-in CPU frame unchanged vs main: ' + k, hashes[k] === BASE[k], { got: hashes[k], want: BASE[k] });

  // 2. no pool: the sources carry no per-car beam fields at all
  const p0 = { trafficBeams: true, src: { traffic: { onMode: 'symmetric', seed: 7 } }, lut, lowLut: lut, conv: 'A', lightRange: R, lightCars: N };
  const objs2 = [...car(20, 'a'), ...car(40, 'b')];
  const plain = D.trafficSources(objs2, EYE, p0);
  ok('BT1 no pool: sources have no beam or tint fields', plain.length > 0 && plain.every(q => q.beam === undefined && q.tint === undefined));

  // 3. one-entry pool: every car gets that entry, so light equals the same beam passed as the built-in
  const bright = D.lutFrom(() => 20000), entry = { id: 'x', lut: bright, conv: 'A', tint: [1, 1, 1] };
  const pooled = D.trafficSources(objs2, EYE, { ...p0, trafficPool: { entries: [entry], weights: null } });
  const builtinBright = D.trafficSources(objs2, EYE, { ...p0, lowLut: bright, lut: bright });
  const bBuiltin = D.trafficBeam({ ...p0, lowLut: bright, lut: bright });
  const probe = (q, b) => D.trafficAt(q, b, q.x - 10, q.y, 0.68);
  ok('BT1 one-entry pool equals that beam as the built-in', pooled.length === builtinBright.length && pooled.every((q, i) => probe(q, null) === probe(builtinBright[i], bBuiltin) && probe(q, null) > 0));
  // negative control: the pool's beam is 4x the built-in lut (5000 vs 20000 cd); if the pick were ignored the ratio would be 1
  const dim = { ...p0, lowLut: D.lutFrom(() => 5000), lut: D.lutFrom(() => 5000), trafficPool: { entries: [entry], weights: null } };
  const q = D.trafficSources(objs2, EYE, dim)[0], fallback = D.trafficSources(objs2, EYE, { ...dim, trafficPool: null })[0];
  const ratio = probe(q, null) / probe(fallback, D.trafficBeam(dim));
  ok('BT1 negative control: the pooled beam, not the built-in, lights the car (ratio 4)', Math.abs(ratio - 4) < 1e-9, { ratio });
  // BT2: weightedPick. Same seed gives the same assignment; a different seed moves cars; equal weights balance over 300 cars.
  const ids = [...Array(300).keys()].map(k => 'oncoming:' + k);
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const assign = (seed, pool, w) => ids.map(id => D.weightedPick(seed, id, pool, w));
  ok('BT2 same seed gives the same assignment', JSON.stringify(assign(7, three)) === JSON.stringify(assign(7, three)));
  // median share of cars that change beam between consecutive seeds (independent picks would give 2/3)
  const movedAt = (s) => assign(s, three).filter((v, i) => v !== assign(s - 1, three)[i]).length / ids.length;
  const movedSorted = [...Array(20).keys()].map(k => movedAt(k + 2)).sort((a, b) => a - b), medMove = movedSorted[10];
  ok('BT2 a different seed reassigns cars: median of 20 seed pairs moves over 40% of cars', medMove > 0.4, { median: +medMove.toFixed(3), min: +movedSorted[0].toFixed(3) });
  const counts = {};
  for (const seed of [1, 2, 3, 4, 5, 7, 8, 42]) {
    const c = [0, 0, 0]; for (const v of assign(seed, three)) c[v]++; counts[seed] = c.join('/');
    ok('BT2 equal weights over 3 beams within 10% over 300 cars (seed ' + seed + ')', c.every(x => Math.abs(x - 100) <= 10), { counts: c });
  }
  ok('BT2 weights [1,0,0] pick only the first beam', assign(7, three, [1, 0, 0]).every(v => v === 0));
  ok('BT2 zero weights or an empty pool pick nothing', D.weightedPick(7, 'oncoming:1', three, [0, 0, 0]) === -1 && D.weightedPick(7, 'oncoming:1', []) === -1);
  ok('BT2 a car keeps its beam on every call (stable per car id)', ids.every(id => D.weightedPick(9, id, three) === D.weightedPick(9, id, three)));
  // colour: a 3200 K entry and a 6500 K entry give cars different tints (the glare path multiplies by the tint)
  const tintOf = (cct) => D.unitTint(RF.CCT.cctToRGB(cct));
  const pool2 = [{ id: 'halogen', lut, conv: 'A', tint: tintOf(3200) }, { id: 'led', lut, conv: 'A', tint: tintOf(6500) }];
  const cp = { ...p0, trafficPool: { entries: pool2, weights: [1, 0] } }, lg = { ...p0, trafficPool: { entries: pool2, weights: [0, 1] } };
  const tHalo = D.trafficSources(objs2, EYE, cp)[0].tint, tLed = D.trafficSources(objs2, EYE, lg)[0].tint;
  ok('BT2 a 3200 K beam tints its car warmer than a 6500 K beam', tHalo[2] / tHalo[0] < tLed[2] / tLed[0], { halogen: tHalo.map(v => +v.toFixed(3)), led: tLed.map(v => +v.toFixed(3)) });
  // a pick with no library colour falls back to the source tint (here 1,1,1), so the car matches the built-in colour
  ok('BT2 tints are chromaticity only: peak channel 1, so the glare brightness is the beam table alone', [3200, 6500].every(k => Math.max(...tintOf(k)) === 1));
  ok('BT2 a beam with no colour keeps the neutral tint', D.trafficSources(objs2, EYE, { ...p0, trafficPool: { entries: [{ ...pool2[0], tint: [1, 1, 1] }], weights: null } })[0].tint.every(v => v === 1));
  // a non-symmetric mode ignores the pool (the generic lamp is used)
  const gen = D.trafficSources(objs2, EYE, { ...dim, src: { traffic: { onMode: 'generic', seed: 7 } } });
  ok('BT1 non-symmetric traffic takes no per-car beam', gen.every(s => s.beam === undefined));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (n, c, detail) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (detail ? ' ' + JSON.stringify(detail) : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all traffic-beams Node checks passed'); process.exitCode = fails ? 1 : 0;
}
