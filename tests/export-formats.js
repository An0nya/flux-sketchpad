// EX format checks (no browser). Optional independent npm check: IESNA_MODULE=/tmp/.../package/dist/index.js.
const assert = require('assert'), fs = require('fs'), path = require('path');
const RF = require('./load.js').load();
function parseIes(text) {
  assert(/^IES(?:NA)?:LM-63-(2019|2002)\r?\n/.test(text));
  const m = text.match(/TILT=NONE\r?\n([\s\S]*)/); assert(m);
  const a = m[1].trim().split(/\s+/).map(Number); assert(a.every(Number.isFinite));
  const [lamps, lumens, mult, ng, nc, type, units] = a; assert.equal(type, 1); assert.equal(units, 2); assert.equal(lamps, 1); assert.equal(lumens, -1);
  assert.equal(a.length, 13 + ng + nc + ng * nc);
  return { C: a.slice(13 + ng, 13 + ng + nc), gamma: a.slice(13, 13 + ng), cd: Array.from({ length: nc }, (_, i) => a.slice(13 + ng + nc + i * ng, 13 + ng + nc + (i + 1) * ng).map((x) => x * mult)) };
}
function parseLdt(text) {
  const a = text.trim().split(/\r?\n/), nc = +a[3], ng = +a[5];
  assert.equal(+a[2], 0); assert.equal(+a[25], 1); assert.equal(+a[26], -1); assert.equal(a.length, 42 + nc + ng + nc * ng);
  const factor = +a[23] * +a[28] / 1000;
  return { C: a.slice(42, 42 + nc).map(Number), gamma: a.slice(42 + nc, 42 + nc + ng).map(Number), lumens: +a[28], cd: Array.from({ length: nc }, (_, i) => a.slice(42 + nc + ng + i * ng, 42 + nc + ng + (i + 1) * ng).map((s) => +s * factor)) };
}
function webAt(p, c, g) {
  const C = p.C.slice(), cd = p.cd.slice(); if (C[C.length - 1] < 360) { C.push(360); cd.push(cd[0]); }
  const bracket = (a, x) => { let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] > x) hi = m; else lo = m; } return [lo, hi, (x - a[lo]) / (a[hi] - a[lo])]; };
  const [i, ii, u] = bracket(C, ((c % 360) + 360) % 360), [j, jj, v] = bracket(p.gamma, g);
  return (1 - v) * ((1 - u) * cd[i][j] + u * cd[ii][j]) + v * ((1 - u) * cd[i][jj] + u * cd[ii][jj]);
}
function atHV(p, h, v, conv) {
  const [x, y, z] = RF.FarField.dirOf(h, v, conv);
  return webAt(p, Math.atan2(y, x) * 180 / Math.PI, Math.acos(-z) * 180 / Math.PI);
}
function validateGltf(text) {
  const g = JSON.parse(text); assert.equal(g.asset.version, '2.0'); assert(g.scenes[g.scene]);
  assert(g.buffers.length === 1 && g.buffers[0].uri.startsWith('data:application/octet-stream;base64,'));
  const b = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64'); assert.equal(b.length, g.buffers[0].byteLength);
  for (const v of g.bufferViews) { assert.equal(v.buffer, 0); assert.equal(v.byteOffset % 4, 0); assert(v.byteLength > 0 && v.byteOffset + v.byteLength <= b.length); }
  const read = (n) => { const a = g.accessors[n], v = g.bufferViews[a.bufferView]; assert(a); assert.equal(a.componentType, 5126); assert.equal(a.type, 'VEC3'); assert(Number.isInteger(a.count) && a.count > 0); assert.equal(v.byteLength, a.count * 12); return Array.from({ length: a.count * 3 }, (_, i) => b.readFloatLE(v.byteOffset + i * 4)); };
  for (const mesh of g.meshes) for (const p of mesh.primitives) {
    assert.equal(p.mode, 4); const pos = read(p.attributes.POSITION), normal = read(p.attributes.NORMAL), acc = g.accessors[p.attributes.POSITION];
    assert(pos.every(Number.isFinite) && normal.every(Number.isFinite)); assert.equal(pos.length, normal.length); assert.equal(acc.count % 3, 0);
    for (let k = 0; k < 3; k++) { const vals = pos.filter((_, i) => i % 3 === k); assert.equal(acc.min[k], Math.min(...vals)); assert.equal(acc.max[k], Math.max(...vals)); }
    for (let i = 0; i < normal.length; i += 3) assert(Math.abs(Math.hypot(...normal.slice(i, i + 3)) - 1) < 1e-6);
    for (let i = 0; i < pos.length; i += 9) { const a = pos.slice(i, i + 3), b = pos.slice(i + 3, i + 6), c = pos.slice(i + 6, i + 9), n = RF.V.cross(RF.V.sub(b, a), RF.V.sub(c, a)); assert(RF.V.dot(n, normal.slice(i, i + 3)) > 0); }
  }
  const visited = new Set(), visit = (i) => { assert(g.nodes[i] && !visited.has(i)); visited.add(i); const n = g.nodes[i]; if (n.mesh !== undefined) assert(g.meshes[n.mesh]); (n.children || []).forEach(visit); };
  g.scenes[g.scene].nodes.forEach(visit); assert.equal(visited.size, g.nodes.length);
  return { g, read };
}
function fixture(conv, pattern) {
  const step = 0.5, nh = 88, nv = 56, h0 = -19, v0 = -11, E = [], Om = []; let lmWindow = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) {
    const h = h0 + (i + 0.5) * step, v = v0 + (j + 0.5) * step, om = RF.FarField.binOmega(h - step / 2, h + step / 2, v - step / 2, v + step / 2, conv), cd = pattern ? pattern(i, j) : 2000 + 17 * h + 23 * v;
    Om.push(om); E.push(om * cd); lmWindow += om * cd;
  }
  return { step, nh, nv, h0, v0, E, Om, lmWindow, lmExit: lmWindow + 123, conv, distance: Infinity };
}
async function checks(ok) {
  const check = async (name, fn) => { try { const detail = await fn(); ok(name, true, detail); } catch (e) { ok(name, false, e.stack); } };
  await check('EX physical axes: forward gamma90/C0, right C270, down gamma0, up gamma180', () => {
    assert(Math.abs(RF.Exports.direction(0, 90)[0] - 1) < 1e-12); assert(Math.abs(RF.Exports.direction(270, 90)[1] + 1) < 1e-12); assert.equal(RF.Exports.direction(0, 0)[2], -1); assert.equal(RF.Exports.direction(0, 180)[2], 1);
  });
  for (const conv of ['A', 'B', 'S']) await check('EX ' + conv + ' write -> independent IES/LDT parse -> sample original asymmetric grid', () => {
    const G = fixture(conv), p = parseIes(RF.Exports.ies(G)), l = parseLdt(RF.Exports.ldt(G)); let worst = 0; const samples = [];
    assert.equal(p.C[0], 0); assert.equal(p.C[p.C.length - 1], 360); assert(l.C[l.C.length - 1] < 360); assert(Math.abs(l.lumens - G.lmWindow) < 1e-5);
    for (const w of [p, l]) { assert(w.C.every((x, i) => !i || x > w.C[i - 1])); assert(w.gamma.every((x, i) => !i || x > w.gamma[i - 1])); assert.equal(w.gamma[0], 0); assert.equal(w.gamma[w.gamma.length - 1], 180); assert.equal(webAt(w, 180, 90), 0); }
    for (const [i, j] of [[6, 6], [24, 14], [37, 31], [55, 39], [78, 48]]) {
      const h = G.h0 + (i + 0.5) * G.step, v = G.v0 + (j + 0.5) * G.step, q = j * G.nh + i, expected = G.E[q] / G.Om[q], got = atHV(p, h, v, conv), ld = atHV(l, h, v, conv);
      worst = Math.max(worst, Math.abs(got - expected), Math.abs(ld - expected)); assert(Math.abs(ld - got) < 1e-5); samples.push([h, v, +expected.toFixed(4), +got.toFixed(4)]);
    }
    assert(worst < (conv === 'A' ? 1e-5 : 0.02), JSON.stringify({ worst, samples })); return JSON.stringify({ maxCdError: worst, samples });
  });
  await check('EX A asymmetric impulse retains bin intensities, seam agrees and no symmetry is invented', () => {
    const G = fixture('A', (i, j) => i === 43 && j === 20 ? 17000 : 0), p = parseIes(RF.Exports.ies(G));
    for (const [i, j] of [[43, 20], [44, 20], [43, 21], [1, 1]]) assert(Math.abs(atHV(p, G.h0 + (i + 0.5) * G.step, G.v0 + (j + 0.5) * G.step, 'A') - G.E[j * G.nh + i] / G.Om[j * G.nh + i]) < 1e-5);
    assert.deepEqual(p.cd[0], p.cd[p.cd.length - 1]); assert(atHV(p, 2.75, -0.75, 'A') > 16000 && atHV(p, -2.75, -0.75, 'A') === 0);
  });
  await check('EX real traced exit rays export absolute cd and preserve window lumens', () => {
    const sc = RF.State.testScene(); sc.source.axis = [1, 0, 0]; const P = RF.Engine.prepare(sc, []), opts = { win: [-10, 10, -6, 6], step: 1, conv: 'A', distance: Infinity }; P.ffStreams = [opts];
    const c = RF.Engine.runSync(P, 50000), G = RF.FarField.build(c, opts), p = parseIes(RF.Exports.ies(G)), l = parseLdt(RF.Exports.ldt(G)); let worst = 0;
    const top = Array.from(G.E, (e, q) => [e / G.Om[q], q]).sort((a, b) => b[0] - a[0]).slice(0, 5), raw = [];
    for (const [cd, q] of top) { const h = G.h0 + (q % G.nh + 0.5) * G.step, v = G.v0 + (Math.floor(q / G.nh) + 0.5) * G.step, got = atHV(p, h, v, 'A'); worst = Math.max(worst, Math.abs(got - cd)); assert(Math.abs(atHV(l, h, v, 'A') - cd) < 1e-5); raw.push([h, v, cd, got]); }
    assert(worst < 1e-5 && G.lmExit > G.lmWindow); return JSON.stringify({ lmWindow: G.lmWindow, lmExit: G.lmExit, maxCdError: worst, raw });
  });
  await check('EX glTF schema essentials, renderer vertices, metre scale, names, normals and disabled groups', () => {
    const store = RF.Controller.createStore(RF.State.testScene()); RF.Controller.regenerateA(store); const sc = store.scene;
    sc.lenses = [{ id: 'ex-lens', kind: 'tir', params: RF.Lenses.defaults('tir') }]; sc.groups.L.surfaces = RF.Lenses.buildAll(sc).surfaces;
    assert(sc.groups.A.surfaces.length && sc.groups.L.surfaces.length);
    const before = RF.State.serialize(sc), { g, read } = validateGltf(RF.Exports.gltf(sc)), compiled = RF.Geo.compile(RF.State.allSurfaces(sc));
    assert.equal(g.meshes.length, compiled.n); assert.equal(before, RF.State.serialize(sc));
    const raw = RF.Geo.mesh(compiled, 0)[0][0], first = read(g.meshes[0].primitives[0].attributes.POSITION).slice(0, 3), expected = [raw[0], raw[2], -raw[1]].map((x) => Math.fround(x * 0.001)); assert.deepEqual(first, expected);
    assert(g.meshes.some((m) => m.name.startsWith('L/')) && g.meshes.some((m) => m.name.startsWith('A/')));
    const total = g.meshes.length; sc.groups.L.enabled = false; const fewer = validateGltf(RF.Exports.gltf(sc)).g.meshes.length; assert(fewer < total); return JSON.stringify({ surfaces: total, withoutLens: fewer, firstVertexMetres: first });
  });
  await check('EX export errors: finite-distance grid, empty LDT, empty geometry', () => {
    const G = fixture('A'); assert.throws(() => RF.Exports.ies({ ...G, distance: 25000 }), /infinity/); assert.throws(() => RF.Exports.ldt({ ...G, lmWindow: 0 }), /positive/); assert.throws(() => RF.Exports.gltf(RF.State.testScene()), /No enabled/);
    assert(RF.Exports.ies(G, { legacy: true }).startsWith('IESNA:LM-63-2002'));
  });
  if (process.env.IESNA_MODULE) await check('EX independent npm iesna parser accepts 2019 AND 2002 headers, counts and absolute candela', async () => {
    const { parse } = await import(require('url').pathToFileURL(process.env.IESNA_MODULE).href), G = fixture('A');
    for (const legacy of [false, true]) { const text = RF.Exports.ies(G, { legacy }), own = parseIes(text), external = parse(text); assert.equal(external.lamp.lumensPerLamp, -1); assert.equal(external.photometricData.goniometerType, 1); assert.deepEqual(external.photometricData.verticalAngles, own.gamma); assert.deepEqual(external.photometricData.horizontalAngles, own.C); assert.deepEqual(external.photometricData.candela, own.cd); }
    return 'iesna@2.0.1 (MIT), isolated downloaded npm tarball; no repository/global install';
  });
  else console.log('[SKIP] independent npm parser: set IESNA_MODULE to isolated iesna/dist/index.js');
}
module.exports = { checks, parseIes, parseLdt, atHV, validateGltf };
if (require.main === module) { let fails = 0; checks((name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!pass) fails++; }).then(() => { console.log('EX export formats: ' + (fails ? fails + ' FAILED' : 'all checks passed')); process.exitCode = fails ? 1 : 0; }); }
