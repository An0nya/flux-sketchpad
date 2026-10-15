// SB2 headless checks, also called by regress-node.js. Measurements use the public flux CLI.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { RF, ID, makeScene } = require('../tools/sealed-beam/v2-lab.js');
async function checks(ok) {
  const S = RF.SealedBeamSource, B = RF.SealedBeamV2, C = RF.Controller, V = RF.V, root = path.resolve(__dirname, '..');
  const setup = (model, over) => { const sc = makeScene('7', 'low', model || 'sealed', over), s = RF.Solvers.settingsOf(sc, ID), input = RF.Solvers.inputOf(sc), b = B.build(input, s, B.paramsOf(s), 'A'); sc.groups.A.surfaces = b.surfaces; sc.sim.bounces = b.bounces; return { sc, s, input, b }; };
  const optics = (sc) => JSON.stringify(sc.groups.A.surfaces.filter((f) => !f.id.startsWith('sb2_bulb_')));
  const clean = (f) => !f.errors.length && !f.violations.envelope.length && !f.violations.keepOut.length && !f.violations.budget;
  ok('SB2 old H4 preset remains axial; assumed sealed-beam preset is transverse', RF.SourcePresets.PRESETS['h4-low'].axis.join() === '1,0,0' && RF.SourcePresets.PRESETS['sealed-beam-assumed-low'].axis.join() === '0,1,0');
  const bad = [];
  for (const lamp of ['7', '5.75']) for (const beam of ['low', 'high']) for (const model of ['sealed', 'h4']) for (const lens of ['none', 'plain', 'fluted']) {
    const sc = makeScene(lamp, beam, model, { lens }), r = RF.Solvers.runSync(sc, ID);
    if (!clean(r.facts)) bad.push([lamp, beam, model, lens, r.facts]);
  }
  ok('SB2 both sizes, beams, sources and all three lenses verify inside envelope/clearance/budget', !bad.length, JSON.stringify(bad));
  {
    const { sc } = setup('h4'), st = C.createStore(sc); st.dirty.clear();
    const before = optics(sc), oldBulb = JSON.stringify(sc.groups.A.surfaces.filter((f) => f.id.startsWith('sb2_bulb_')));
    C.setControl(st, 'src.x', sc.source.pos[0] + 1); C.setControl(st, 'src.y', -0.5); C.setControl(st, 'src.az', 4);
    ok('SB2 fixed source controls move the bulb, preserve every reflector/lens surface and do not request a solve', optics(sc) === before && JSON.stringify(sc.groups.A.surfaces.filter((f) => f.id.startsWith('sb2_bulb_'))) !== oldBulb && !st.dirty.has('A'));
    ok('SB2 source pose settings and serialized source agree after source controls', Math.abs(sc.solverSettings[ID].sourceFwd - sc.source.pos[0]) < 1e-9 && Math.abs(sc.solverSettings[ID].sourceAz - 4) < 1e-9 && RF.State.deserialize(RF.State.serialize(sc)).source.pos.join() === sc.source.pos.join());
    const s = RF.Solvers.settingsOf(sc, ID); s.sourceUp = 0.5; C.actions.prepareSolverScene(st, ID, s, ['sourceUp']);
    ok('SB2 solver source-offset setting uses the same fixed-source path', sc.source.pos[2] === 0.5 && optics(sc) === before && !st.dirty.has('A'));
    const follow = setup('sealed', { mount: 'follow' }), fstore = C.createStore(follow.sc); fstore.dirty.clear(); C.actions.moveSource(fstore, [1, 2, 3]);
    ok('SB2 follow mode keeps the v1 rebuild-on-source-edit behavior reachable', fstore.dirty.has('A') && B.layout(RF.Solvers.inputOf(follow.sc), follow.s).F.join() === '1,0.5,0.5');
  }
  {
    const { sc, s } = setup('h4', { lens: 'none', shield: false }); sc.groups.A.surfaces = S.bulbSurfaces(sc.source, s);
    const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)), events = (d) => RF.Engine.probeRay(P, sc.source.pos, d).events.map((e) => Object.assign({}, e, { id: e.k === undefined ? '' : P.G.metas[e.k].id }));
    const down = events([0, 0, -1]), up = events([0, 0, 1]), tip = events([1, 0, 0]);
    ok('SB2 H4 lower ray hits the internal cup; axial forward ray hits the opaque tip', down[0].type === 'absorb' && down[0].id.startsWith('sb2_bulb_cup') && tip.some((e) => e.type === 'absorb' && e.id === 'sb2_bulb_tip_front'), JSON.stringify({ down: down.map((e) => [e.id, e.type]), tip: tip.map((e) => [e.id, e.type]) }));
    ok('SB2 upper ray enters the glass at the inner wall and exits its outer wall', up[0].id === 'sb2_bulb_glass_inner' && up[0].front && up[1].id === 'sb2_bulb_glass_outer' && !up[1].front && up[2].type === 'escape', JSON.stringify(up.map((e) => [e.id, e.type, e.front])));
    const round = (v) => JSON.stringify(v, (k, x) => typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x);
    const beforeAssembly = round(S.bulbSurfaces(sc.source, s));
    const high = Object.assign({}, s, { beam: 'high' }); S.adjustSource(sc, high, ['beam']);
    const sameAssembly = beforeAssembly === round(S.bulbSurfaces(sc.source, high));
    ok('SB2 switching H4 low/high moves the active filament inside the same mounted cup, tip and glass', sameAssembly && Math.abs(sc.source.pos[0]) < 1e-9 && Math.abs(sc.source.pos[2]) < 1e-9 && sc.source.preset === 'h4-assembly-high');
    S.adjustSource(sc, s, ['beam']);
    const noParts = Object.assign({}, s, { bulbCup: false, bulbTip: false, bulbGlass: false });
    ok('SB2 H4 cup / tip / glass toggles can restore a bare filament', S.bulbSurfaces(sc.source, noParts).length === 0 && S.bulbSurfaces(sc.source, Object.assign({}, s, { assembly: 'none' })).length === 0);
  }
  {
    const { sc, s, b } = setup('sealed', { lens: 'none', shield: false, lowUp: 0, lowLeft: 0 }); sc.source.pos = [0, 0, 0];
    const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); let aligned = true;
    for (const [y, z] of [[20, 30], [-40, 20], [50, -35], [-70, -10]]) {
      const q = [b.layout.vx + (y * y + z * z) / (4 * b.layout.f), y, z], e = RF.Engine.probeRay(P, [0, 0, 0], V.norm(q)).events[0];
      if (e.type !== 'reflect' || V.dist(e.dOut, [1, 0, 0]) > 1e-10) aligned = false;
    }
    ok('SB2 bare paraboloid sends rays from its true focus parallel to +x at four reflector points', aligned);
  }
  {
    const { sc, s, input, b } = setup('sealed'), lens = b.lens, G = RF.Geo.compile(lens.surfaces);
    let convex = true, spans = false;
    for (const meta of G.metas) {
      const ps = meta.poly2 || [];
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], q = ps[(i + 1) % ps.length], r = ps[(i + 2) % ps.length];
        if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) < -1e-6) convex = false;
      }
    }
    const a = lens.surfaces.find((f) => /sb2_f0_0_0$/.test(f.id)), z = lens.surfaces.find((f) => /sb2_f0_0_3$/.test(f.id));
    if (a && z) spans = V.dist(a.n, z.n) > 1e-3;
    ok('SB2 within-flute normals vary; variable-width non-square regions allocate area', spans && new Set(lens.cells.map((c) => c.width.toFixed(4))).size > 3 && lens.cells.some((c) => Math.abs(c.width - c.height) > 1), 'sampled curved profile');
    ok('SB2 every lens clip is convex, including connecting faces', convex && lens.risers > 0, 'all compiled polygon edge turns checked');
    const cell = lens.cells.find((c) => c.i === 0 && c.j === 0), lensScene = RF.U.deepCopy(sc); lensScene.groups.A.surfaces = lens.surfaces;
    const LP = RF.Engine.prepare(lensScene, RF.State.allSurfaces(lensScene)), exits = [], paths = [];
    for (let k = 0; k < 4; k++) {
      const origin = [b.layout.xin - 10, cell.yc + ((k + 0.5) / 4 - 0.5) * cell.width, cell.zc + 0.123];
      const ev = RF.Engine.probeRay(LP, origin, [1, 0, 0]).events, lastRefraction = ev.filter((e) => e.type === 'refract').pop();
      if (lastRefraction) exits.push(lastRefraction.dOut); paths.push(ev.map((e) => e.type));
    }
    ok('SB2 parallel rays across one curved flute actually leave in different directions', exits.length === 4 && V.dist(exits[0], exits[3]) > 0.01 && paths.every((p) => p.filter((e) => e === 'refract').length >= 2), JSON.stringify(paths));

    // A line through a closed polyhedron crosses an even number of faces. Oblique lines exercise the step faces too.
    let holes = 0, tested = 0, riserHits = 0;
    for (let k = 0; k < 1000; k++) {
      const y = 75 * Math.sin(k * 2.399963 + 0.13), z = 65 * Math.cos(k * 1.731 + 0.21), o = [b.layout.xin - 30, y, z], d = V.norm([1, 0.25 * Math.sin(k * 1.33), 0.3 * Math.cos(k * 1.71)]), hits = [];
      for (let j = 0; j < G.n; j++) { const t = RF.Geo.intersect(G.D, G.poly, j, ...o, ...d, 1e-7, 1e6); if (t > 0) { hits.push(t); if (/riser|edge/.test(G.metas[j].id)) riserHits++; } }
      hits.sort((a, b) => a - b); const unique = hits.filter((v, i) => !i || v - hits[i - 1] > 1e-6);
      if (unique.length) tested++; if (unique.length % 2) holes++;
    }
    ok('SB2 closed curved lens has even entry/exit crossings along oblique lines that hit risers', holes === 0 && tested > 500 && riserHits > 0, JSON.stringify({ holes, tested, riserHits }));
    const bounded = Object.assign({}, B.paramsOf(s), { hSpread: 10, hBias: 0, hBiasL: 0, vSpread: 3, vCentre: 0, kick: 0, leftDrop: 0, hotR: 0 });
    const boundedLens = B.lensSurfaces(b.layout, s, bounded, 'A'), main = boundedLens.cells.filter((c) => Math.hypot(c.yc - b.layout.F[1], c.zc - b.layout.F[2]) / b.layout.a < bounded.spillR);
    ok('SB2 negative flute indices respect the selected horizontal/vertical spread bounds', main.length > 20 && main.some((c) => c.j < -2) && main.every((c) => Math.abs(c.h) <= 10 && Math.abs(c.v) <= 3));
    const incomplete = B.build(input, Object.assign({}, s, { risers: false }), B.paramsOf(s), 'A');
    ok('SB2 incomplete planar/unconnected approximation stays selectable', incomplete.lens.risers === 0 && B.build(input, Object.assign({}, s, { profile: 'planar', regions: 'uniform', cellHeight: s.cell }), B.paramsOf(s), 'A').lens.strips < lens.strips);
  }
  {
    const { sc, s, input } = setup('sealed'), frozen = { base: [0.2, -0.4], reaim: [0, 0], note: 'test held aim' }, calls = [];
    const trace = (surf, o) => { calls.push(o.frozen || null); return { spec: { frozen, expFails: 20 - calls.length, score: calls.length, n: { pass: 2, fail: 20, unsure: 0 } } }; };
    const set = Object.assign({}, s, { tune: true, tuneAim: 'frozen', tuneEvals: 4, tuneSeconds: 0 });
    const out = RF.Solvers.get(ID).solve(input, set, { trace });
    ok('SB2 every candidate, including winners, uses starting incumbent aim; final verdict alone re-aims', calls.length === 6 && calls[0] === null && calls[5] === null && calls.slice(1, 5).every((f) => f === frozen) && out.notes.some((n) => n.startsWith('final full-aim verdict:')), JSON.stringify(calls));
    calls.length = 0;
    const asyncOut = await RF.Solvers.get(ID).solve(input, Object.assign({}, set, { tuneGpu: true }), { trace, traceAsync: async (surf, o) => trace(surf, o) });
    ok('SB2 traceAsync uses the same frozen-aim rule and awaits its final verdict', calls.length === 6 && calls[5] === null && JSON.stringify(out.surfaces) === JSON.stringify(asyncOut.surfaces) && asyncOut.notes.some((n) => /final full-aim verdict:.*"pass":2/.test(n)));
  }
  {
    const tmp = fs.mkdtempSync(path.join(root, '.sb2-rebuild-')); let same = true; const bad = [];
    try {
      for (const name of fs.readdirSync(path.join(root, 'examples')).filter((n) => n.startsWith('sealed-beam-v2-') && n.endsWith('.json'))) {
        const f = path.join(root, 'examples', name), out = path.join(tmp, name), before = RF.State.deserialize(fs.readFileSync(f, 'utf8'));
        const r = JSON.parse(execFileSync(process.execPath, ['tools/flux.js', 'solve', f, '--out', out], { cwd: root, maxBuffer: 16 << 20 }));
        const after = RF.State.deserialize(fs.readFileSync(out, 'utf8'));
        if (r.errors.length || JSON.stringify(before.groups.A.surfaces) !== JSON.stringify(after.groups.A.surfaces)) { same = false; bad.push(name); }
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    ok('SB2 saved tuned examples rebuild to identical surfaces (including explicit high-beam values)', same, bad.join(', ') || 'all v2 examples');
  }
  {
    const tmp = fs.mkdtempSync(path.join(root, '.sb2-regress-'));
    try {
      const sc = RF.State.deserialize(fs.readFileSync(path.join(root, 'examples/sealed-beam-7in-low.json'), 'utf8')), original = JSON.stringify(sc.groups.A.surfaces), got = {};
      for (const [name, pos] of [['origin', [0, 0, 0]], ['right', [1, -0.5, 0.5]], ['left', [1, 0.5, 0.5]]]) {
        sc.source.pos = pos; sc.source.axis = [1, 0, 0]; sc.source.preset = 'h4-low';
        const f = path.join(tmp, name + '.json'); fs.writeFileSync(f, RF.State.serialize(sc));
        got[name] = JSON.parse(execFileSync(process.execPath, ['tools/flux.js', 'trace', f, '--rays', '2000000', '--spec', 'fmvss-lb2m'], { cwd: root, maxBuffer: 8 << 20 })).spec['fmvss-lb2m'];
      }
      const a = got.origin, r = got.right, l = got.left;
      const remaining = r.rows.filter((p) => p.verdict === 'fail').map((p) => p.name);
      ok('SB2 fixed saved-v1 placement regression: axial origin 14/7/1; right shift 18–19/3/0–1; left control 14/7/1', a.pass === 14 && a.fail === 7 && a.unsure === 1 && r.pass >= 18 && r.pass <= 19 && r.fail === 3 && r.unsure <= 1 && l.pass === 14 && l.fail === 7 && l.unsure === 1 && original === JSON.stringify(sc.groups.A.surfaces) && remaining.includes('4U 8L') && remaining.includes('1.5U 1R to R') && remaining.includes('0.5U 1R–3R'), JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, [v.pass, v.fail, v.unsure]]))));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}
module.exports = checks;
if (require.main === module) { let failed = 0, passed = 0; checks((name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) failed++; else passed++; }).then(() => { console.log('SB2: ' + passed + ' passed, ' + failed + ' failed'); process.exitCode = failed ? 1 : 0; }).catch((e) => { console.error(e); process.exitCode = 1; }); }
