// CD: legacy state migration (the fixed intersection scene it once also covered was removed in GI2).
function run(RF, ok) {
  const A = RF.DriveAnim, state = A._.S;
  for (const view of ['still', 'static']) {
    const u = { dvAnim: { view, playing: true, dist: 17, t: 3, total: 40 } }, before = u.dvAnim;
    const s = state(u);
    ok('CD legacy runtime ' + view + ' becomes paused animate in place', s === before && s.view === 'anim' && s.playing === false && s.dist === 17 && s.t === 3 && s.total === 40);
    const pref = state({ dvOpts: { view, playing: true } });
    ok('CD legacy preference ' + view + ' cannot auto-start playback', pref.view === 'anim' && pref.playing === false);
  }
  ok('CD new Drive sessions start paused', state({}).view === 'anim' && !state({}).playing);
  ok('CD additive playback preference resumes animate', state({ dvOpts: { playing: true } }).playing);
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!pass) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all CD Node checks passed'); process.exitCode = fails ? 1 : 0;
}
