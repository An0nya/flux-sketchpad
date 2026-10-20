// SH1: scenario harness, Node only. Node tests/scenario-node.js — exits 1 on any failure.
// Checks: the five examples validate; a rerun of the CLI in a new process gives identical frame hashes; invalid scenarios fail with the named message.
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { load } = require('./load.js');
const schema = require('./scenario/schema.js');
const run = require('./scenario/run.js');
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

const dv = schema.readDvDefaults(), keys = schema.readOptionKeys();
const RF = load();

// 1. the examples validate and cover the five situations
const examples = run.loadScenarios(run.EXAMPLE_DIR, dv, keys);
const names = examples.map((s) => s.name).sort().join(' ');
ok('SH examples: five scenarios validate (road-dry, road-wet, forest-fog200-beam, city-night, pass)', names === 'city-night forest-fog200-beam pass road-dry road-wet', names);

// 2. rerun determinism: the CLI in two fresh processes, the same hashes and luminances
const cli = path.join(__dirname, 'scenario', 'run.js');
const readOut = () => Object.fromEntries(examples.map((s) => [s.name, JSON.parse(fs.readFileSync(path.join(run.OUT_DIR, s.name + '.json'), 'utf8')).captures.map((c) => c.hash + ':' + c.luma)]));
const first = spawnSync(process.execPath, [cli, run.EXAMPLE_DIR], { encoding: 'utf8', env: Object.assign({}, process.env, { PATH: '/opt/homebrew/bin:' + process.env.PATH }) });
ok('SH CLI run over the examples exits 0', first.status === 0, (first.stderr || '').split('\n').slice(0, 3).join(' | '));
const a = readOut();
const second = spawnSync(process.execPath, [cli, run.EXAMPLE_DIR], { encoding: 'utf8', env: Object.assign({}, process.env, { PATH: '/opt/homebrew/bin:' + process.env.PATH }) });
const b = readOut();
ok('SH CLI rerun exits 0', second.status === 0);
const same = examples.every((s) => JSON.stringify(a[s.name]) === JSON.stringify(b[s.name]));
ok('SH rerun in a new process gives identical hashes and luminances (5 scenarios)', same && examples.every((s) => a[s.name].length > 0), examples.map((s) => s.name + ' ' + a[s.name][0].slice(0, 12)).join(', '));
const pngOk = examples.every((s) => s.capture.every((c) => {
  const buf = fs.readFileSync(path.join(run.OUT_DIR, s.name + '-' + c.name + '.png'));
  return buf.slice(1, 4).toString() === 'PNG' && crypto.createHash('sha256').update(buf).digest('hex') === JSON.parse(fs.readFileSync(path.join(run.OUT_DIR, s.name + '.json'), 'utf8')).captures.find((x) => x.name === c.name).hash;
}));
ok('SH each capture writes a PNG whose sha256 is the recorded hash', pngOk);

// 3. the frame moves: the start and end captures of a moving drive differ (the car went 30 frames ahead)
ok('SH a moving drive changes the frame (road-dry start and end hashes differ)', a['road-dry'][0] !== a['road-dry'][1]);

// 4. invalid scenarios fail with the named message (parse only, no render)
const base = { name: 'bad', scene: 'road', seed: 7, dist: 0, speed: 50, frames: 10 };
const expectErr = (label, raw, needle) => {
  try { schema.parse(Object.assign({}, base, raw), dv, keys, 'bad.json'); ok(label, false, 'accepted'); }
  catch (e) { ok(label, e instanceof schema.ScenarioError && e.message.includes(needle), e.message.split('\n').slice(0, 2).join(' | ')); }
};
expectErr('SH invalid: an unknown option key is rejected by name', { options: { scater: 16 } }, 'options.scater: unknown option');
expectErr('SH invalid: a wrong value type names the expected type and the default', { options: { wet: 'yes' } }, 'options.wet: expected boolean (default false)');
expectErr('SH invalid: visibility accepts a number or null only', { options: { visibility: 'fog' } }, 'options.visibility: expected a number or null');
expectErr('SH invalid: an enum option lists its allowed values', { options: { scatterMode: 'sparse' } }, 'expected one of direct, table');
expectErr('SH invalid: scene must be one of the drive scenes', { scene: 'motorway' }, 'scene: "motorway" is not one of road, forest, city');
expectErr('SH invalid: a top-level field under options is refused with its place', { options: { scene: 'city' } }, 'set "scene" at top level');
expectErr('SH invalid: capture frame outside the run', { capture: [{ name: 'late', frame: 10 }] }, 'frame 10 is outside 0..9');
expectErr('SH invalid: an unknown top-level field is rejected', { fogLevel: 2 }, 'unknown field "fogLevel"');
expectErr('SH invalid: a region must be ordered fractions', { regions: { x: [0.5, 0, 0.2, 1] } }, 'regions.x: expected [x0, y0, x1, y1]');
expectErr('SH invalid: name must be a safe file name', { name: '../escape' }, 'name: required');
expectErr('SH invalid: dist and pos together are refused', { dist: 5, pos: 6 }, 'give one');
// the beams field is accepted by the schema and refused by Node mode with a clear message
const withBeam = schema.parse(Object.assign({}, base, { beams: ['lib-entry'] }), dv, keys, 'beam.json');
try { run.renderNode(withBeam, RF, dv); ok('SH Node mode refuses beams with a message', false, 'rendered'); }
catch (e) { ok('SH Node mode refuses beams with a message', /beams need the browser/.test(e.message), e.message); }

// 5. the --check mode exits 0 on the examples
const chk = spawnSync(process.execPath, [cli, '--check', run.EXAMPLE_DIR], { encoding: 'utf8' });
ok('SH --check exits 0 on the five examples without rendering', chk.status === 0 && /ok {2}road-dry/.test(chk.stdout), (chk.stdout || chk.stderr).split('\n')[0]);

// 6. compare: a dir against itself is within tolerance; a 10 % luminance change on one capture is flagged, the other capture is not
const cmp = require('./scenario/compare.js');
const self = cmp.compareDirs(run.OUT_DIR, run.OUT_DIR, 0.02);
ok('SH compare: an output dir against itself has no row beyond tolerance', self.length > 0 && self.every((r) => !r.beyond), self.length + ' rows');
const tmp = path.join(run.OUT_DIR, '_compare-test');
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
try {
  const doc = JSON.parse(fs.readFileSync(path.join(run.OUT_DIR, 'road-dry.json'), 'utf8'));
  doc.captures[0].luma *= 1.1; for (const k of Object.keys(doc.captures[0].regions)) doc.captures[0].regions[k] *= 1.1;
  fs.writeFileSync(path.join(tmp, 'road-dry.json'), JSON.stringify(doc));
  const rows = cmp.compareDirs(run.OUT_DIR, tmp, 0.02).filter((r) => r.scenario === 'road-dry' && !r.note);
  const start = rows.find((r) => r.capture === 'start'), end = rows.find((r) => r.capture === 'end');
  ok('SH compare: a 10 % luminance change is BEYOND at 2 %, the unchanged capture is not', rows.length === 2 && start.beyond && !end.beyond && start.hashChanged === false, JSON.stringify({ start: start && start.luma, end: end && end.beyond }));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(fails ? fails + ' FAILED' : 'all scenario-node checks passed');
process.exitCode = fails ? 1 : 0;
