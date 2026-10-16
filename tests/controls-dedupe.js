// CD: legacy state migration and the newly reachable fixed intersection's actual render path.
function run(RF, ok) {
  const A = RF.DriveAnim, D = RF.Drive, state = A._.S;
  for (const view of ['still', 'static']) {
    const u = { dvAnim: { view, playing: true, dist: 17, t: 3, total: 40 } }, before = u.dvAnim;
    const s = state(u);
    ok('CD legacy runtime ' + view + ' becomes paused animate in place', s === before && s.view === 'anim' && s.playing === false && s.dist === 17 && s.t === 3 && s.total === 40);
    const pref = state({ dvOpts: { view, playing: true } });
    ok('CD legacy preference ' + view + ' cannot auto-start playback', pref.view === 'anim' && pref.playing === false);
  }
  ok('CD new Drive sessions start paused', state({}).view === 'anim' && !state({}).playing);
  ok('CD additive playback preference resumes animate', state({ dvOpts: { playing: true } }).playing);
  // Reference independently built from the original static intersection, rather than
  // using the helper being checked to build its own expected output.
  const w = 160, h = 90, lane = 3.5, scene = D.buildScene('intersection', { Lw: lane, us: false, seed: 7 }, {});
  const p = { w, h, hfov: 60, lamps: [[0, -.7, .65], [0, .7, .65]], lut: D.lutFrom(() => 30000), conv: 'A', lane, look: { RL: .2, ambient: .05 }, A: null, src: A.source('intersection', lane, false, {}, {}) };
  // As with city crossings, single-occurrence marks recur every PERIOD in Drive.
  // Ground only isolates cross-street placement from actor animation and visibility culling.
  p.src.objects = [];
  for (const dist of [0, 20, 33, 300, 320]) {
    const local = dist % A.PERIOD;
    const markings = scene.markings.map(m => ({ ...m,
      ...(m.skip ? { skip: m.skip.map(([a, b]) => [a - local, b - local]) } : {}),
      ...(m.pat ? { pat: { ...m.pat, period: m.pat.period >= 1e5 ? A.PERIOD : m.pat.period, s0: m.pat.s0 - local, s1: m.pat.s1 - local } } : {})
    }));
    const cross = { s0: scene.cross.s0 - local, s1: scene.cross.s1 - local };
    const rgba = new Float32Array(w * h * 4), rows = A.objects(p, dist, rgba, 1, null, null, []);
    // Use the renderer's existing cross-road footprint treatment, shared with route tiles/GPU.
    const ref = D.render({ w, h, hfov: p.hfov, eye: A.EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, lane, look: p.look, ss: 1,
      crossings: [{ ...cross, o0: -1e5, o1: 1e5 }], scene: { objects: [], markings, verge: scene.verge } });
    let worst = 0, lit = 0, opaque = true;
    for (let q = 0; q < w * h; q++) {
      opaque &&= rgba[q * 4 + 3] === 1;
      if (rgba[q * 4] > .01) lit++;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgba[q * 4 + c] - ref.rgb[q * 3 + c]));
    }
    ok('CD fixed intersection ground matches independent displaced scene at ' + dist + ' m', rows[0] === 0 && rows[1] === h && opaque && lit > 100 && worst < 1e-6, JSON.stringify({ worst, lit, opaque }));
  }
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!pass) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all CD Node checks passed'); process.exitCode = fails ? 1 : 0;
}
