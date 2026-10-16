// HID source checks shared by regress-node and the standalone Node runner.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
function run(RF, ok) {
  const S = RF.Source, SP = RF.SourcePresets, copy = RF.U.deepCopy, src = copy(RF.State.testScene().source);
  SP.apply(src, 'd2s'); const naked = S.makeSampler(src), o = [], d = [], random = new RF.rng.Rng(319), rng = () => random.next();
  let min = Infinity, max = -Infinity, residual = 0, variance = 0, tips = 0, centre = 0, cos = 0, cos2 = 0, unit = 0, n = 100000; const raw = [];
  for (let i = 0; i < n; i++) {
    S.sampleRay(naked, rng(), rng(), rng(), rng(), rng(), o, d);
    const q = RF.V.sub(o, src.pos), z = RF.V.dot(q, naked.fr.a), u = RF.V.dot(q, naked.fr.u), v = RF.V.dot(q, naked.fr.v), h = src.arc.bow * (1 - (2 * z / src.length) ** 2), ct = RF.V.dot(d, naked.fr.a);
    min = Math.min(min, z); max = Math.max(max, z); residual += v - h; variance += u * u; cos += ct; cos2 += ct * ct; unit = Math.max(unit, Math.abs(RF.V.len(d) - 1));
    if (Math.abs(z) > src.length / 2 - .25) tips++; if (Math.abs(z) < .25) centre++;
    if (i < 5) raw.push({ origin: o.slice(), direction: d.slice() });
  }
  const sigma = src.arc.fwhm / 2.354820045, expected = sigma * sigma * (1 - 4.5 / Math.expm1(4.5));
  ok('HID bowed cloud follows the upward centreline; Gaussian cross-section variance', Math.abs(residual / n) < .003 && Math.abs(variance / n / expected - 1) < .02, JSON.stringify({ meanResidualMm: residual / n, varianceMm2: variance / n, expectedMm2: expected }));
  ok('HID emission stays between the nominal electrode tips; both tips hotter than centre', min >= -2.1 && max <= 2.1 && min < -2.09 && max > 2.09 && tips / centre > 1.8, JSON.stringify({ min, max, tipToCentre: tips / centre }));
  ok('HID optically thin angular emission is isotropic, unit length, full 4π', Math.abs(cos / n) < .006 && Math.abs(cos2 / n - 1 / 3) < .006 && unit < 1e-12 && S.totalIntegral(src) === 4 * Math.PI, JSON.stringify({ meanCos: cos / n, meanCos2: cos2 / n, unitError: unit }));
  console.log('HID raw sampler rays ' + JSON.stringify(raw));
  // Zero radius draws expose the centreline exactly, including arbitrary mounting and gravity direction.
  for (const axis of [[1, 0, 0], [0, 1, 0], [1, 2, 3]]) {
    const a = copy(src); a.axis = axis; const ss = S.makeSampler(a); S.sampleRay(ss, 0, 0, .5, .2, .3, o, d);
    ok('HID bow midpoint follows projected up for axis ' + axis, RF.V.dist(o, RF.V.add(a.pos, RF.V.mul(ss.fr.v, a.arc.bow))) < 1e-6);
  }
  const tube = copy(src); tube.arc.tube = true; const st = S.makeSampler(tube), identity = copy(tube); identity.arc.index = 1; const si = S.makeSampler(identity);
  let surfaceError = 0, identityError = 0, bent = 0, finite = true;
  for (let i = 0; i < 3000; i++) {
    const x = Array.from({ length: 5 }, () => rng()), oo = [], dd = [], p = [], v = [];
    S.sampleRay(st, ...x, o, d); S.sampleRay(si, ...x, oo, dd); S.sampleRay(naked, ...x, p, v);
    const q = RF.V.sub(o, tube.pos), u = RF.V.dot(q, st.fr.u), w = RF.V.dot(q, st.fr.v), z = RF.V.dot(q, st.fr.a), a = st.arc;
    surfaceError = Math.max(surfaceError, Math.abs((u * u + w * w) / (a.tubeRadius + a.wall) ** 2 + z * z / (a.tubeLength / 2 + a.wall) ** 2 - 1));
    identityError = Math.max(identityError, RF.V.dist(dd, v), RF.V.len(RF.V.cross(RF.V.sub(oo, p), v))); bent += RF.V.dist(d, v); finite = finite && o.concat(d).every(Number.isFinite) && Math.abs(RF.V.len(d) - 1) < 1e-10;
  }
  ok('HID hollow quartz: outer-surface exits, unit finite directions; n=1 preserves the ray line', finite && surfaceError < 1e-10 && identityError < 1e-10 && bent / 3000 > .005, JSON.stringify({ surfaceError, identityError, meanDirectionChange: bent / 3000 }));
  const rsrc = copy(src); SP.apply(rsrc, 'd2r'); rsrc.arc.tube = true; const sr = S.makeSampler(rsrc); let blocked = 0;
  for (let i = 0; i < 5000; i++) {
    S.sampleRay(sr, rng(), rng(), rng(), rng(), rng(), o, d);
    const q = RF.V.sub(o, rsrc.pos), u = RF.V.dot(q, sr.fr.u), v = RF.V.dot(q, sr.fr.v), du = RF.V.dot(d, sr.fr.u), dv = RF.V.dot(d, sr.fr.v), A = du * du + dv * dv, B = u * du + v * dv, R = sr.arc.stripeRadius;
    if (A < 1e-12) continue;
    const t = (-B + Math.sqrt(B * B - A * (u * u + v * v - R * R))) / A, ph = sr.arc.stripeAngle * Math.PI / 180;
    if (Math.abs((u + t * du) * Math.sin(ph) - (v + t * dv) * Math.cos(ph)) < R * Math.sin(sr.arc.stripeWidth * Math.PI / 360) - 1e-9) blocked++;
  }
  ok('HID R stripes leave no emitted ray crossing either black band, including quartz refraction', blocked === 0, blocked + ' / 5000 blocked');
  for (const id of ['d2s', 'd2r', 'd4s-transverse']) {
    const sc = RF.State.testScene(); SP.apply(sc.source, id); sc.source.arc.tube = true;
    const ctx = RF.Engine.runSync(RF.Engine.prepare(sc, []), 10000), em = ctx.E.emitted, accounted = ctx.E.direct + ctx.E.reflected + ctx.E.absorbed + ctx.E.backface + ctx.E.interfaceLoss + ctx.E.escaped + ctx.E.targetBack + ctx.E.truncated;
    ok('HID ' + id + ' rated external flux conserved with optional bulb effects', Math.abs(em / sc.source.power - 1) < 1e-10 && Math.abs(accounted / em - 1) < 1e-10, em + ' lm emitted, ' + accounted + ' accounted');
  }
  const ids = Object.keys(SP.PRESETS).filter((id) => SP.PRESETS[id].hid); let presetsOK = true;
  for (const id of ids) {
    const sc = RF.State.testScene(), p = SP.PRESETS[id]; SP.apply(sc.source, id); const reloaded = RF.State.deserialize(RF.State.serialize(sc)).source;
    presetsOK = presetsOK && reloaded.kind === 'arc' && reloaded.length === 4.2 && SP.matches(sc.source) && reloaded.power === (id.slice(0, 3).endsWith('r') ? 2800 : 3200) && p.provenance.regulation.electrodes.cMm === 4.2 && !!p.provenance.manufacturer.url && p.provenance.tuning.status === 'tuning, unverified';
  }
  ok('HID preset integrity: all eight D-series categories × axial/transverse mounting, citations and round trip', ids.length === 16 && presetsOK, ids.join(', '));
  for (const id of ['h7', 'hb4', 'generic', 'measured']) { const a = copy(src); SP.apply(a, id); ok('HID -> ' + id + ' removes arc fields', a.kind !== 'arc' && a.arc === undefined); }
  const bad = (source) => { try { RF.State.deserialize({ source: Object.assign(copy(src), source) }); return false; } catch (e) { return /bad scene/.test(e.message); } };
  ok('HID schema rejects unknown future kinds and malformed arc fields', bad({ kind: 'future-arc' }) && bad({ arc: { fwhm: 'wide' } }) && bad({ arc: { up: [0, 0, 0] } }) && bad({ arc: { tube: 'yes' } }) && bad({ arc: null }));
  const gravity = RF.State.deserialize({ source: Object.assign(copy(src), { arc: { up: [1e308, 1e308, 1e308] } }) }).source.arc.up;
  ok('HID gravity direction remains finite and unit length for very large inputs', gravity.every(Number.isFinite) && Math.abs(RF.V.len(gravity) - 1) < 1e-12);
  const limited = RF.State.deserialize({ source: Object.assign(copy(src), { length: 1e8, arc: { bow: -99, fwhm: 0, hot: 1e8, stripeWidth: 1e8, index: 99 } }) }).source;
  ok('HID schema clamps arc-only fields and keeps the cloud within the quartz cavity', limited.length === 100 && limited.arc.bow === 0 && limited.arc.fwhm === .01 && limited.arc.hot === 20 && limited.arc.stripeWidth === 80 && limited.arc.index === 3 && limited.arc.tubeLength >= 110);
  const scene = RF.State.testScene(); scene.source = copy(src); scene.emitters = [copy(src)]; const scaled = RF.State.scaleScene(scene, 2), mirror = RF.State.mirrorSceneY(scene);
  ok('HID additive transforms scale arc dimensions and rotate gravity for main and extra emitters', scaled.source.length === src.length * 2 && scaled.source.arc.bow === src.arc.bow * 2 && scaled.emitters[0].arc.fwhm === src.arc.fwhm * 2 && scaled.source.arc.tubeLength === src.arc.tubeLength * 2 && scaled.emitters[0].arc.tubeRadius === src.arc.tubeRadius * 2 && mirror.source.arc.stripeAngle === -src.arc.stripeAngle && mirror.source.arc.up[2] === 1);
  // Compare the exact serialized output with the base implementation, not with hand-maintained snapshots.
  const base = '68bc063', original = { RF: Object.assign({}, RF), TextEncoder, console };
  vm.runInNewContext(cp.execFileSync('git', ['show', base + ':js/state.js'], { encoding: 'utf8' }), original);
  const before = original.RF.State, walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []);
  let files = 0;
  for (const file of [...walk(path.join(__dirname, '..', 'examples')), ...walk(path.join(__dirname, 'fixtures'))]) {
    const raw = fs.readFileSync(file, 'utf8'), data = JSON.parse(raw); if (!data.source) { ok('HID legacy fixture is a scene: ' + file, false); continue; }
    const a = before.serialize(before.deserialize(raw)), b = RF.State.serialize(RF.State.deserialize(raw));
    ok('HID legacy serialization byte-identical to base: ' + path.relative(path.join(__dirname, '..'), file), a === b && RF.State.serialize(RF.State.deserialize(b)) === b); files++;
  }
  ok('HID legacy round-trip scan includes examples/ and tests/fixtures/', files >= 13, files + ' scene files');
  // Legacy samplers retain their original exact floating-point output, including LED dome recycling.
  const oldSource = { RF: Object.assign({}, RF) }; vm.runInNewContext(cp.execFileSync('git', ['show', base + ':js/source.js'], { encoding: 'utf8' }), oldSource);
  let same = true;
  for (const id of ['generic', 'hb3', 'h7', 'hb4', 'nichia519a-domed']) {
    const sc = RF.State.testScene(); SP.apply(sc.source, id); const a = S.makeSampler(sc.source), b = oldSource.RF.Source.makeSampler(sc.source);
    for (let i = 0; i < 100; i++) { const x = Array.from({ length: 5 }, () => rng()), oo = [], dd = []; S.sampleRay(a, ...x, o, d); oldSource.RF.Source.sampleRay(b, ...x, oo, dd); same = same && o.every((v, j) => Object.is(v, oo[j])) && d.every((v, j) => Object.is(v, dd[j])); }
  }
  ok('HID old LED, dome and filament sampler rays byte-identical to base', same);
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load').load(), (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!pass) fails++; }); console.log(fails ? fails + ' HID checks FAILED' : 'all HID checks passed'); process.exitCode = fails ? 1 : 0; }
