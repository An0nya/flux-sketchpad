// Run every gate: node tests/all.js — exits 1 if any fails.
// 1. syntax of every browser script (the headless suite never loads ui.js / panels.js / render*.js)
// 2. the 24-check suite  3. undo/redo  4. evaluation metrics  5. layout  6. per-hit facet attribution
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); let failed = 0;
// Each test gets HANG_MS. Node 25.8 sometimes never finishes exiting (stuck in process.exit → platform shutdown →
// pthread_join, seen on facet2.js after its checks had passed), and an unbounded wait stalled the whole suite. A hang is
// killed and retried once; it is always reported, and two in a row count as a failure.
const HANG_MS = 240000;
const hung = (e) => e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL');
const run = (label, args) => {
  const once = () => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: HANG_MS, killSignal: 'SIGKILL' });
  let note = '';
  try {
    let out;
    try { out = once(); }
    catch (e) { if (!hung(e)) throw e; note = '  (hung once: killed after ' + HANG_MS / 1000 + ' s, passed on retry)'; out = once(); }
    console.log('✓ ' + label + (out.trim() ? '  — ' + out.trim().split('\n').pop() : '') + note);
  } catch (e) {
    failed++;
    console.log('✗ ' + label + (hung(e) ? '  — HUNG twice (no exit within ' + HANG_MS / 1000 + ' s), killed' : '') + '\n' + String(e.stdout || '') + String(e.stderr || ''));
  }
};
for (const d of ['js', 'tests']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) run('syntax ' + d + '/' + f, ['--check', path.join(d, f)]);
run('checks (tests/headless.js)', ['tests/headless.js']);
run('undo/redo (tests/history.js)', ['tests/history.js']);
run('metrics (tests/metrics.js)', ['tests/metrics.js']);
run('layout (tests/layout.js)', ['tests/layout.js']);
run('attribution (tests/attribution.js)', ['tests/attribution.js']);
run('photometry (tests/photometry.js)', ['tests/photometry.js']);
run('CCT defaults per preset (tests/cct-defaults.js)', ['tests/cct-defaults.js']);
run('duv: manual green/magenta tint, byte-identical at 0 (tests/duv.js)', ['tests/duv.js']);
run('auto-high (tests/auto-high.js)', ['tests/auto-high.js']);
run('eye adaptation: smoothing step response (tests/eye-adapt.js)', ['tests/eye-adapt.js']);
run('drive controls: view angle, traffic range, fixed eye (tests/drive-controls2.js)', ['tests/drive-controls2.js']);
run('two-curvature facet (tests/facet2.js)', ['tests/facet2.js']);
run('solvers (tests/solvers.js)', ['tests/solvers.js']);
run('modes + auto (tests/modes.js)', ['tests/modes.js']);
run('spec mode + far field (tests/spec.js)', ['tests/spec.js']);
run('multi-part optics + multi-emitter (tests/optics-parts.js)', ['tests/optics-parts.js']);
run('watching a solve: worker previews (tests/preview.js)', ['tests/preview.js']);
run('road model + IIHS metrics (tests/road.js)', ['tests/road.js']);
run('beam quality report (tests/beam-quality.js)', ['tests/beam-quality.js']);
run('ideal-beam goals (tests/ideal-beam.js)', ['tests/ideal-beam.js']);
run('driver\'s-eye view (tests/drive.js)', ['tests/drive.js']);
run('detailed models prototype (tests/models-proto.js)', ['tests/models-proto.js']);
run('leafy foliage prototype (tests/foliage.js)', ['tests/foliage.js']);
run('detailed models final geometry (tests/models-m2.js)', ['tests/models-m2.js']);
run('optional GPU Drive wiring + vendor pins (tests/drive-three.js)', ['tests/drive-three.js']);
run('P2 Drive lighting extras (tests/p2-drive-lighting.js)', ['tests/p2-drive-lighting.js']);
run('TL1/TL2 traffic road light taper and options (tests/tl-traffic-taper.js)', ['tests/tl-traffic-taper.js']);
run('eurobeat pattern data (tests/eurobeat.js)', ['tests/eurobeat.js']);
run('Mountain pass speeds and adaptive lighting (tests/touge-r2.js)', ['tests/touge-r2.js']);
run('Mountain pass parity: lamps, deer bolt, detail, edge lines (tests/pass-parity.js)', ['tests/pass-parity.js']);
run('wet road sheen: GGX BRDF + legacy frames unchanged (tests/wet-ggx.js)', ['tests/wet-ggx.js']);
run('road wetness 0..1: dry and wet frames unchanged, damp in between (tests/wetness.js)', ['tests/wetness.js']);
run('fog: off frames unchanged, Koschmieder attenuation, monotone, presets (tests/fog.js)', ['tests/fog.js']);
run('visible beam in fog: in-scatter off = pinned frames, cone, density peak, convergence, determinism (tests/scatter.js)', ['tests/scatter.js']);
run('SD air-beam scatter table: CPU twin within 10 percent of direct at 15-30 m, finite, monotone, zero without fog (tests/scatter-table.js)', ['tests/scatter-table.js']);
run('SE table pacing helpers and near-eye fade on the CPU twin (tests/scatter-table-pace.js)', ['tests/scatter-table-pace.js']);
run('SF2 near-fade range and scatter gain, CPU twin and helpers (tests/scatter-fade-gain.js)', ['tests/scatter-fade-gain.js']);
run('scene snapshot: studs, posts, signs, lamps, deer, people, trees, markings per scene (tests/scene-snapshot.js)', ['tests/scene-snapshot.js']);
run('scene digest: where every scenery object sits, 2 seeds, tiles on and off (tests/scene-digest.js)', ['tests/scene-digest.js']);
run('scenery parameters: the forest and city generator equals the old builders (240 cases), rates keep the other classes in place, backdrop, options (tests/scenery-params.js)', ['tests/scenery-params.js']);
run('tile options: roadTile weights (byte-identical with none or all 1, side and phase fixed), lamp rule off / urban-only / sparse / all (tests/tile-options.js)', ['tests/tile-options.js']);
run('SB2 wet sheen from studs and paint: source admission, caps, paint gloss, GPU ids (tests/sb2-sheen.js)', ['tests/sb2-sheen.js']);
run('saveable beams: format, checksum, grid, bundle, synthetic (tests/beams.js)', ['tests/beams.js']);
run('scene details: registry and metric maths (tests/scene-details.js)', ['tests/scene-details.js']);
console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
