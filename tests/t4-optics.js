// T4: Optics/solver invariants in Node.  Node tests only — no browser, no Playwright.
// Run: node tests/t4-optics.js  |  exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
console.log('T4 Optics/solver invariants — node test suite');

const RF = load();
// beams.js is not in the load() FILES list; load it manually
let Beams = RF.Beams;
if (!Beams) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'beams.js'), 'utf8'), { filename: 'js/beams.js' });
  Beams = RF.Beams;
}

// ------- 1. Beams: round-trip, energy, checksums, combine -------
console.log('\n--- 1. Beams: round-trip, energy, checksums, combine ---');
{
  const { build, serialise, readFile, uniformWash, pointBeam, coarsen, combine, resample, sameGrid,
          checksumOf, floatsToBytes, bytesToB64, b64ToBytes, bytesToFloats, fnv1a,
          uniqueName, lampFor } = Beams;

  // 1a. FNV-1a checksum: known test vectors
  ok('FNV-1a empty = 0x811c9dc5', fnv1a(new Uint8Array(0)) === 0x811c9dc5);
  ok('FNV-1a "a" = 0xe40c292c', fnv1a(new TextEncoder().encode('a')) === 0xe40c292c);
  ok('FNV-1a deterministic (two identical buffers give same hash)', fnv1a(new Uint8Array([1, 2, 3])) === fnv1a(new Uint8Array([1, 2, 3])));
  ok('FNV-1a different for different buffers', fnv1a(new Uint8Array([1, 2, 3])) !== fnv1a(new Uint8Array([1, 2, 4])));

  // 1b. float ↔ byte round trip
  const fv = Float32Array.of(1.0, 0.0, -1.0, 3.14159, 1e-30, 1e30);
  const fbytes = floatsToBytes(fv);
  ok('floatsToBytes returns 24 bytes for 6 floats', fbytes.length === 6 * 4);
  const fback = bytesToFloats(fbytes, 6);
  ok('bytesToFloats recovers exact values', fback.every((v, i) => v === fv[i]));
  ok('bytesToB64 6 floats round trip', bytesToFloats(b64ToBytes(bytesToB64(fbytes)), 6).every((v, i) => v === fv[i]));

  // 1c. uniformWash: all cells = cd
  const wash = uniformWash(1000, { hMin: -5, hMax: 5, vMin: -2, vMax: 0 }, 0.5);
  ok('uniformWash: all cells = 1000', wash.nh > 0 && wash.nv > 0 && wash.data.every(v => v === 1000));
  const areaDeg2 = (5 - (-5)) * (0 - (-2)); // 10 * 2 = 20
  const cellArea = 0.25;
  const cells = Math.round(areaDeg2 / cellArea);
  ok('uniformWash: cell count matches area/step²', wash.nh * wash.nv === cells, { nh: wash.nh, nv: wash.nv, cells });

  // 1d. pointBeam deposits values correctly
  const pg = { h0: -5, v0: -5, step: 0.5, nh: 20, nv: 20 };
  const pb = pointBeam([[0.1, 0.2, 100], [2.5, 1.0, 50]], pg);
  ok('pointBeam: total flux conserved', pb.data.reduce((a, v) => a + v, 0) === 150);
  const cellIdx = (h, v, g) => {
    const i = Math.floor((h - g.h0) / g.step), j = Math.floor((v - g.v0) / g.step);
    return j * g.nh + i;
  };
  ok('pointBeam: point at (0.1,0.2) → cell (10,10)', pb.data[cellIdx(0.1, 0.2, pg)] === 100);
  ok('pointBeam: point at (2.5,1.0) → cell (15,12)', pb.data[cellIdx(2.5, 1.0, pg)] === 50);

  // 1e. combine is linear: low + high ≡ combine(low, high)
  const lowLut = uniformWash(500, { hMin: -10, hMax: 10, vMin: -3, vMax: 1 }, 0.5);
  const highLut = uniformWash(300, { hMin: -5, hMax: 5, vMin: -1, vMax: 0.5 }, 0.25);
  const highOnLow = resample(highLut, { h0: lowLut.h0, v0: lowLut.v0, step: lowLut.step, nh: lowLut.nh, nv: lowLut.nv });
  const combined = combine(lowLut, highLut);
  ok('combine: same grid as low', combined.nh === lowLut.nh && combined.nv === lowLut.nv && combined.step === lowLut.step);
  const N = lowLut.nh * lowLut.nv;
  const checkCombine = combined.data[0] === lowLut.data[0] + highOnLow.data[0] &&
    combined.data[Math.floor(N / 2)] === lowLut.data[Math.floor(N / 2)] + highOnLow.data[Math.floor(N / 2)] &&
    combined.data[N - 1] === lowLut.data[N - 1] + highOnLow.data[N - 1];
  ok('combine = low + resample(high, low.grid) [spot-check]', checkCombine);

  // 1f. resample idempotent on same grid
  ok('sameGrid(lowLut, lowLut) = true', sameGrid(lowLut, lowLut) === true);

  // 1g. coarsen preserves grid window
  const coarse = coarsen(lowLut, 2.0);
  ok('coarsen step >= requested', coarse.step >= 2.0);
  ok('coarsen h0/v0 unchanged', coarse.h0 === lowLut.h0 && coarse.v0 === lowLut.v0);

  // 1h. build/parse/serialise round trip through JSON
  {
    const g = { h0: -3, v0: -1, step: 0.5, nh: 12, nv: 8 };
    const data = Float32Array.from(Array(12 * 8).fill(0).map((_, i) => 100 + i * 10));
    const beam = build({ name: 't4-beam', beamKind: 'low', conv: 'A', notes: 'test', grid: g, data, colour: { cct: 4300 } });
    ok('build: checksum is present', typeof beam.checksum === 'string' && beam.checksum.startsWith('fnv1a32:'));
    const text = JSON.stringify(beam);
    const parsed = readFile(JSON.parse(text));
    ok('JSON round trip: 1 beam', parsed.length === 1);
    ok('JSON round trip: data matches', parsed[0].values.length === data.length && parsed[0].values.every((v, i) => v === data[i]));
    ok('JSON round trip: grid matches', parsed[0].grid.nh === g.nh && parsed[0].grid.step === g.step);
    ok('JSON round trip: colour cct kept', parsed[0].colour.cct === 4300);
  }

  // 1i. uniqueName generates collision-free names
  ok('uniqueName with collision appends " 2"', uniqueName('my beam', ['my beam', 'other']) === 'my beam 2');
  ok('uniqueName without collision returns base', uniqueName('new beam', ['old beam']) === 'new beam');

  // 1j. lampFor: beam with colour gives its own rgb
  const lf1 = lampFor({ rgb: [1, 0.5, 0.1] }, [1, 1, 1]);
  ok('lampFor: own rgb used', lf1.rgb[0] === 1 && lf1.rgb[1] === 0.5 && lf1.rgb[2] === 0.1 && !lf1.fromSource);
  const lf2 = lampFor(null, [0.5, 0.5, 0.5]);
  ok('lampFor: no colour → fallback with fromSource=true', lf2.rgb[0] === 0.5 && lf2.fromSource === true);
}

// ------- 2. Ideal Beam: defaults, check(), cutTop, topOf -------
console.log('\n--- 2. Ideal Beam: defaults, check(), cutTop, energy conservation ---');
{
  const IB = RF.IdealBeam;
  const d = IB.defaults();
  ok('IdealBeam.defaults returns object with all keys', typeof d === 'object' && d.on === true && d.hotH === 1.5);
  ok('IdealBeam.defaults: washRatio is positive', d.washRatio > 0);
  ok('IdealBeam.defaults: hotContrast >= 1', d.hotContrast >= 1);

  // cutTop: ECE and FMVSS give different cut-off functions
  const ece = IB.cutTop({ preset: 'generic-broad' });
  const fmvss = IB.cutTop({ preset: 'fmvss-108' });
  ok('cutTop ECE: on own side (h=0) ≈ -0.57°', Math.abs(ece(0) + 0.57) < 0.01, ece(0));
  ok('cutTop FMVSS: on own side (h=0) ≈ -0.4°', Math.abs(fmvss(0) + 0.4) < 0.01, fmvss(0));
  ok('cutTop ECE: at 10° R ≥ 0 (rise)', ece(10) >= 0, ece(10));

  // of() merges with md.ideal
  const g = IB.of({ ideal: { hotContrast: 2.0, washRatio: 0.3 } });
  ok('IB.of: custom overrides default', g.hotContrast === 2.0 && g.washRatio === 0.3);
  ok('IB.of: default kept when not overridden', g.streakCd === 6000 && g.edgeCd === 8000);
  ok('IB.of: edgeTo > edgeFrom', g.edgeTo > g.edgeFrom);

  // Legacy hotW support in of()
  const g2 = IB.of({ ideal: { hotW: 3 } });
  ok('IB.of: legacy hotW sets hotLeft/hotRight symmetrically', g2.hotLeft === 3 - g2.hotH && g2.hotRight === g2.hotH + 3,
    { hotLeft: g2.hotLeft, hotRight: g2.hotRight, hotH: g2.hotH });

  // check() returns expected shape
  const I = (h, v) => Math.max(0, 100000 * Math.exp(-(h * h + v * v) / 20));
  const result = IB.check(I, {});
  ok('IB.check returns { goals, info, met, n, score, q }', 'goals' in result && 'info' in result && 'met' in result && 'n' in result && 'score' in result);
  ok('IB.check: met ≤ n', result.met <= result.n);
  ok('IB.check: score ≥ 0', result.score >= 0);

  // topOf: finds the hotspot top
  const top = IB.topOf(I, 1.5);
  ok('IB.topOf returns a number for a Gaussian beam', typeof top === 'number');
  if (top !== null) ok('IB.topOf: top > -5 (somewhere above -5° D)', top > -5, { top });
}

// ------- 3. Sealed-beam source: layout, POSE_KEYS, isH4 -------
console.log('\n--- 3. Sealed-beam source: layout, POSE_KEYS ---');
{
  const SB = RF.SealedBeamSource;
  const V = RF.V;

  // POSE_KEYS
  ok('POSE_KEYS: 6 keys', SB.POSE_KEYS.length === 6, SB.POSE_KEYS);

  // layout with a simple input: lamp radius comes through
  const input = { source: { pos: [0, 0, 100], axis: [1, 0, 0], preset: 'generic', power: 1500 },
    envelope: { center: [20, 0, 95], half: [30, 40, 25] } };
  const lo7 = SB.layout(input, { lamp: '7', beam: 'low', focal: 0, lowFwd: 0, lowLeft: 0, lowUp: 0, mount: 'fixed', focusX: 0, focusY: 0, focusZ: 0 });
  ok('LAMPS: 7" round r=85 via layout', lo7.lamp.r === 85);
  const lo575 = SB.layout(input, { lamp: '5.75', beam: 'low', focal: 0, lowFwd: 0, lowLeft: 0, lowUp: 0, mount: 'fixed', focusX: 0, focusY: 0, focusZ: 0 });
  ok('LAMPS: 5.75" round r=69.5 via layout', lo575.lamp.r === 69.5);
  ok('layout: returns lamp, f, F, S, a fields', 'lamp' in lo7 && 'f' in lo7 && 'F' in lo7 && 'S' in lo7 && 'a' in lo7);
  ok('layout: a = lamp.r', lo7.a === 85);
  ok('layout: depth = a²/(4f) computed', lo7.depth > 0, { depth: lo7.depth });

  // isH4 detection
  ok('isH4: auto + h4 presets → true', SB.isH4({ preset: 'h4-assembly-low' }, { assembly: 'auto' }) === true);
  ok('isH4: non-h4 → false', SB.isH4({ preset: 'generic' }, { assembly: 'sealed' }) === false);
  ok('isH4: explicit h4 assembly', SB.isH4({ preset: 'generic' }, { assembly: 'h4' }) === true);

  // bulbSurfaces returns an array (even if empty for non-h4)
  const bulbs = SB.bulbSurfaces(input.source, { assembly: 'h4', beam: 'low', bulbRadius: 2, bulbWall: 0.3, bulbIor: 1.5, bulbGlass: false, bulbTip: false, bulbCup: false });
  ok('bulbSurfaces: returns array (may be empty for bare settings)', Array.isArray(bulbs));
}

// ------- 4. Solve cache: canonical, bytes, victims, timed -------
console.log('\n--- 4. Solve cache: canonical(), bytes(), victims() ---');
{
  const SC = RF.SolveCache;
  const a = SC.canonical({ b: 2, a: 1 });
  const b = SC.canonical({ a: 1, b: 2 });
  ok('canonical: key order independent', a === b);
  ok('canonical: same value same output', SC.canonical({ x: [1, 2, 3] }) === SC.canonical({ x: [1, 2, 3] }));
  ok('canonical: different value different output', SC.canonical({ x: 1 }) !== SC.canonical({ x: 2 }));

  const sz = SC.bytes({ a: 1 });
  ok('bytes: returns a number > 0', typeof sz === 'number' && sz > 0);
  ok('bytes: same object → same bytes', SC.bytes({ a: 1 }) === SC.bytes({ a: 1 }));

  // victims: eviction by used time
  const rows = [
    { key: 'a', bytes: 100, used: 1 },
    { key: 'b', bytes: 200, used: 5 },
    { key: 'c', bytes: 300, used: 3 },
  ];
  const evict = SC.victims(rows, 400, 10);
  ok('victims: with 600B total and 400B cap → evicts oldest (a, used=1)', evict.includes('a'));
  const evict2 = SC.victims(rows, 1000, 2);
  ok('victims: evicts oldest by used time under count cap', evict2.includes('a') && !evict2.includes('b'));
  const evict3 = SC.victims(rows, 0, 0);
  ok('victims: zero cap evicts all', evict3.length === 3);

  // timed: detects Date/performance
  ok('timed: worker solver = true', SC.timed({ worker: true, solve: 'function(){return{}}' }) === true);
  ok('timed: solver with Date = true', SC.timed({ worker: false, solve: 'function(){Date.now();return{}}' }) === true);
  ok('timed: solver with Math' + '.random = true', SC.timed({ worker: false, solve: 'function(){' + 'Math.' + 'random();return{}}' }) === true);
  ok('timed: pure solver = false', SC.timed({ worker: false, solve: 'function(){return{}}' }) === false);

  ok('MAX_BYTES = 32 MiB', SC.MAX_BYTES === 32 * 1024 * 1024);
  ok('MAX_ENTRIES = 40', SC.MAX_ENTRIES === 40);
}

// ------- 5. Solver: facetFrame, tileModel sigma, apertureCov, partitionZones flux, solveVergence -------
console.log('\n--- 5. Solver: facetFrame, tileModel, apertureCov, partitionZones, solveVergence ---');
{
  const S = RF.Solver, V = RF.V;
  const T = RF.Engine.designFrame({ distance: 2000, size: 500, res: 10 });

  // 5a. facetFrame: orthonormal basis
  {
    const fq = { n: V.norm([0, 0.447, 0.894]) };
    const { ex, ey } = S.facetFrame(fq, [0, 1, 0]);
    ok('facetFrame: ex ⟂ n', Math.abs(V.dot(ex, fq.n)) < 1e-12);
    ok('facetFrame: ey ⟂ n', Math.abs(V.dot(ey, fq.n)) < 1e-12);
    ok('facetFrame: ex ⟂ ey', Math.abs(V.dot(ex, ey)) < 1e-12);
    ok('facetFrame: unit vectors', Math.abs(V.len(ex) - 1) < 1e-12 && Math.abs(V.len(ey) - 1) < 1e-12);
  }

  // 5b. polarFrame: orthonormal basis
  {
    const w0 = V.norm([0, 0, 1]);
    const pf = S.polarFrame(w0, T);
    ok('polarFrame: e1 ⟂ w0', Math.abs(V.dot(pf.e1, w0)) < 1e-12);
    ok('polarFrame: e2 = w0 × e1', Math.abs(V.dot(V.cross(w0, pf.e1), pf.e2) - 1) < 1e-12);
  }

  // 5c. dirOf + areaMap consistency
  {
    const w0 = V.norm([0, 0, 1]);
    const pf = S.polarFrame(w0, T);
    const d = S.dirOf(pf, 0.1, 0.2);
    const [p, q] = S.areaMap(pf, d);
    const th = Math.acos(Math.max(-1, Math.min(1, V.dot(d, w0))));
    ok('dirOf/areaMap: ||(p,q)|| = 2sin(th/2)', Math.abs(Math.sqrt(p * p + q * q) - 2 * Math.sin(th / 2)) < 1e-10);
  }

  // 5d. apertureCov for rect and disc
  {
    const ref = V.norm([0, 1, 0]);
    const { ex, ey } = S.facetFrame({ n: V.norm([1, 0, 0]) }, ref);
    const P = [0, 0, 0];
    const rect = S.apertureCov({ kind: 'rect', hx: 3, hy: 2 }, P, ex, ey);
    ok('apertureCov rect: cxx = hx²/3 = 3', Math.abs(rect[0] - 3) < 1e-10, { cxx: rect[0] });
    ok('apertureCov rect: cyy = hy²/3 = 4/3', Math.abs(rect[2] - 4 / 3) < 1e-10, { cyy: rect[2] });
    ok('apertureCov rect: cxy = 0', rect[1] === 0);

    const disc = S.apertureCov({ kind: 'disc', r: 2 }, P, ex, ey);
    ok('apertureCov disc: cxx = r²/4 = 1', Math.abs(disc[0] - 1) < 1e-10, { cxx: disc[0] });
    ok('apertureCov disc: cyy = r²/4', Math.abs(disc[2] - 1) < 1e-10);
  }

  // 5e. solveVergence: focus branch returns min sigma at wF
  {
    const scene = RF.State.testScene();
    const f = { P: [0, 0, 50], S0: [0, 0, 0], Z: [400, 0, 250], flat: false, apCov: [4, 0, 4], ref: [0, 1, 0] };
    const r = S.solveVergence(T, scene.source, f, 1000);
    ok('solveVergence: returns {ok, di, sigma, branch}', r.ok && 'di' in r && 'sigma' in r && 'branch' in r, { branch: r.branch });
    if (r.ok && r.sigmaMin !== undefined) {
      ok('solveVergence: sigmaMin <= sigma (focus is smallest tile)', r.sigmaMin <= r.sigma);
    }
  }

  // 5f. partitionZones: flux conservation
  {
    const res = 10, paint = new Array(res * res).fill(1);
    const info = S.paintInfo({ modeA: { paint }, target: { distance: 2000, size: 500, res } });
    ok('paintInfo: sum > 0 for full grid', info.sum > 0);
    ok('paintInfo: cells count = 100', info.cells.length === 100);

    const items = [
      { w: 25, p: 0, q: 0 }, { w: 25, p: 1, q: 0 },
      { w: 25, p: 0, q: -1 }, { w: 25, p: -1, q: 0 },
    ];
    const zones = S.partitionZones(items, info);
    ok('partitionZones: returns 4 zones', zones.length === 4);
    const totalInZones = zones.reduce((s, z) => s + (z.W || 0), 0);
    ok('partitionZones: total flux conserved', Math.abs(totalInZones - info.sum) < 1e-9, { totalInZones, sum: info.sum });
  }

  // 5g. tileModel: ok on a simple flat facet
  {
    const scene = RF.State.testScene();
    const f = { P: [0, 0, 50], S0: [0, 0, 0], Z: [500, 0, 200], flat: true, apCov: [3, 0, 3], ref: [0, 1, 0] };
    const tm = S.tileModel(T, scene.source, f);
    ok('tileModel: ok for a flat reflector', tm.ok === true);
    if (tm.ok) {
      ok('tileModel: sigma > 0', tm.sigma > 0);
      ok('tileModel: cov[0] ≥ 0 (variance is non-negative)', tm.cov[0] >= 0);
    }
  }
}

// ------- 6. Geometry: quadric shapes, envelope containment -------
console.log('\n--- 6. Geometry: quadric shapes, envelope containment ---');
{
  const Geo = RF.Geo, V = RF.V;

  // 6a. facetQuadric: flat facet returns {n, A, b, flat} with A as 9-element all-zero array
  const fq = Geo.facetQuadric([0, 0, 10], [0, 0, 0], [100, 0, 10], null);
  ok('facetQuadric: flat facet has flat=true', fq.flat === true);
  ok('facetQuadric: flat facet has |n|=1', Math.abs(V.len(fq.n) - 1) < 1e-12);
  ok('facetQuadric: flat facet A is all zeros, 9 elements', Array.isArray(fq.A) && fq.A.length === 9 && fq.A.every(v => v === 0));

  // 6b. facetQuadric: curved facet (ellipsoid with foci S0 and image point at di=50)
  const fq2 = Geo.facetQuadric([0, 0, 10], [0, 0, 0], [100, 0, 10], 50);
  ok('facetQuadric: curved facet: not flat', !fq2.flat);
  ok('facetQuadric: curved facet: A is 9-element array', Array.isArray(fq2.A) && fq2.A.length === 9);
  ok('facetQuadric: curved facet: b is 3-element array', Array.isArray(fq2.b) && fq2.b.length === 3);

  // 6c. quadricRay(A, b, P, o, d): plane intersection
  // Build a flat quadric and test intersection
  // For a flat quadric: A is all zeros, b = normal. The equation is b·(o-P+t*d) = 0
  // Use a simple scenario: plane normal [0,0,1] at origin, ray from [0,0,-5] toward [0,0,1]
  const qA2 = Geo.facetQuadric([0, 0, 10], [0, 0, 0], [50, 0, 20], null);
  // This flat quadric has normal ≈ [0,0,1] since S0 and Z are both roughly above P
  const r2 = Geo.quadricRay(qA2.A, qA2.b, [0, 0, 10], [0, 0, -5], [0, 0, 1]);
  ok('quadricRay: flat quadric gives at least 1 root', r2.length >= 1, { n: r2.length, b: qA2.b, n: qA2.n });

  // 6d. envInside(env, p, tol)
  const env = { center: [0, 0, 0], half: [10, 10, 10] };
  ok('envInside: point inside = true', Geo.envInside(env, [1, 2, 3]) === true);
  ok('envInside: point outside = false', Geo.envInside(env, [11, 0, 0]) === false);

  // 6e. compile: a facet compiles to a flat typed array (via Engine.prepare → Geo.compile)
  {
    const sc = RF.State.testScene();
    const facet = { type: 'facet', id: 't4', P: [0, 0, 30], S0: [0, 0, 0], Z: [100, 0, 50], flat: true, clip: { kind: 'rect', hx: 5, hy: 5 } };
    const prep = RF.Engine.prepare(sc, [facet]);
    ok('compile: prepare returns an object', typeof prep === 'object');
    ok('compile: flat array surfaces property exists', Array.isArray(prep.surfaces));
  }

  // 6f. conicSag(R, k, r): sag for a sphere with R=100, k=0
  ok('conicSag: at r=0, sag = 0', Math.abs(Geo.conicSag(100, 0, 0) - 0) < 1e-12);
  // For sphere: z = R - sqrt(R² - r²), at r=10 ≈ 10²/(2*100) = 0.5 (paraxial approximation)
  const s10 = Geo.conicSag(100, 0, 10);
  ok('conicSag: sag(10) ≈ 0.5 for R=100 sphere', Math.abs(s10 - 0.5) < 0.02, { sag10: s10 });
}

// ------- 7. State: scene shape, testScene invariants, serialize/deserialize round-trip -------
console.log('\n--- 7. State: scene shape, round-trip, invariants ---');
{
  const ST = RF.State;
  const ts = ST.testScene();
  ok('testScene returns object with groups', ts && typeof ts === 'object' && ts.groups && ts.groups.A);
  ok('testScene: source has pos, axis, power', Array.isArray(ts.source.pos) && Array.isArray(ts.source.axis) && ts.source.power > 0);
  ok('testScene: envelope has center, half', Array.isArray(ts.envelope.center) && Array.isArray(ts.envelope.half));
  ok('testScene: groups.A.surfaces is an array', Array.isArray(ts.groups.A.surfaces));

  // serialize / deserialize round trip
  const text = ST.serialize(ts);
  ok('serialize returns a string', typeof text === 'string' && text.length > 100);
  const back = ST.deserialize(text);
  ok('deserialize round trip: same source pos', back.source.pos[0] === ts.source.pos[0] && back.source.pos[1] === ts.source.pos[1]);
  ok('deserialize round trip: same envelope half[0]', back.envelope.half[0] === ts.envelope.half[0]);
  ok('deserialize round trip: same target distance', back.target.distance === ts.target.distance);

  // defaultScene is different from testScene (Anya's defaults applied)
  const ds = ST.defaultScene();
  ok('defaultScene: different source pos from testScene', ds.source.pos[0] !== ts.source.pos[0]);
  ok('defaultScene: has no solve key (opens with Auto)', ds.solve === undefined);

  // scaleScene: uniform scaling preserves shape ratios
  const scaled2 = ST.scaleScene(ts, 2);
  ok('scaleScene: envelope.half doubles', scaled2.envelope.half[0] === ts.envelope.half[0] * 2);

  // mirrorSceneY: keeps x and z, negates y
  const mirrored = ST.mirrorSceneY(ts);
  ok('mirrorSceneY: source pos y negated', mirrored.source.pos[1] === -ts.source.pos[1]);
  ok('mirrorSceneY: source pos x unchanged', mirrored.source.pos[0] === ts.source.pos[0]);

  // defaultPaint: non-trivial pattern (has both 0 and non-zero)
  const dp = ST.defaultPaint(10);
  ok('defaultPaint: returns array of 100', Array.isArray(dp) && dp.length === 100);
  ok('defaultPaint: has painted cells (non-zero)', dp.some(v => v > 0));
  ok('defaultPaint: has unpainted cells (zero)', dp.some(v => v === 0));
}

// ------- summary -------
console.log('\n--- summary ---');
console.log((fails ? '[FAIL] ' : '[PASS] ') + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);