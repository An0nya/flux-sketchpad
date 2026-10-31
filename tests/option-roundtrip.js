// glm5.2 — whole-class round-trip test: every profile option survives save → load.
// step5-preview's open item #1: "every profile option round-trips through a saved state and the
// defaults profile." state-dump.js tests this for ONE option; this test does it for ALL 121.
// The class it catches: an option that is declared but doesn't survive the dump/read cycle
// (e.g. ownLow was kind:'extra' and was silently dropped by readState — the beam-preset drop bug).
const { load } = require('./load.js');
const RF = load(); const A = RF.DriveAnim, O = RF.Options;
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };

const d = O.defaults();
const profile = O.OPTIONS.filter((e) => e.kind === 'profile');
ok('the profile set is non-trivial', profile.length >= 100, profile.length);

// 1. every profile option is in defaults() (DV_DEF is auto-generated from kind:'profile')
const inDefaults = profile.filter((e) => !(e.id in d));
ok('every profile option has a default in defaults()', inDefaults.length === 0, inDefaults.map((e) => e.id));

// 2. every profile option survives a dump → read round-trip with a non-default value
//    For each option, pick a non-default value, build a state with it, dump, read back, verify.
const nonDefault = (e) => {
  const def = d[e.id];
  if (typeof def === 'boolean') return !def;
  if (typeof def === 'number') return def + 1;
  if (typeof def === 'string') {
    // try the enum values if available
    if (e.values && e.values.length > 1) {
      const alt = e.values.find((v) => v !== def);
      if (alt !== undefined) return alt;
    }
    return def + '-test';
  }
  if (Array.isArray(def)) return def.concat([0]);
  return def; // can't perturb unknown types
};

let dropped = [], changed = [];
for (const e of profile) {
  const val = nonDefault(e);
  if (JSON.stringify(val) === JSON.stringify(d[e.id])) continue; // can't perturb, skip
  const ui = { dvOpts: Object.assign({}, d, { [e.id]: val }), dvAnim: { view: 'anim', playing: false, dist: 100, t: 5, total: 100 } };
  const dump = A.stateDump(ui);
  const r = A.readState(dump);
  if (r.ignored.includes(e.id)) dropped.push(e.id);
  if (!(e.id in r.opts)) { dropped.push(e.id + ' (missing)'); continue; }
  if (JSON.stringify(r.opts[e.id]) !== JSON.stringify(val)) changed.push({ id: e.id, saved: val, got: r.opts[e.id] });
}
ok('no profile option is dropped by readState', dropped.length === 0, dropped);
ok('no profile option value is changed by the round-trip', changed.length === 0, changed);

// 3. every 'extra' option (not in defaults but saved) survives a round-trip when present
//    (the ownLow drop bug was here: kind:'extra' was silently ignored by readState)
const extras = O.OPTIONS.filter((e) => e.kind === 'extra');
ok('there are extra options to test (ownLow etc.)', extras.length >= 2, extras.map((e) => e.id));
let extraDropped = [];
const ui0 = { dvOpts: Object.assign({}, d), dvAnim: { view: 'anim', playing: false, dist: 100, t: 5, total: 100 } };
const dump0 = A.stateDump(ui0);
for (const e of extras) {
  // give it a plausible non-default value
  let val;
  if (e.id === 'ownLow' || e.id === 'ownHigh') val = 'builtin:sqm-samples.json:4';
  else if (typeof d[e.id] === 'boolean') val = true;
  else val = 'test';
  const file = JSON.parse(JSON.stringify(dump0));
  file.options[e.id] = val;
  const r = A.readState(file);
  if (r.ignored.includes(e.id) || !(e.id in r.opts) || JSON.stringify(r.opts[e.id]) !== JSON.stringify(val))
    extraDropped.push({ id: e.id, val, got: r.opts[e.id], ignored: r.ignored.includes(e.id) });
}
ok('every extra option survives readState when present in the file', extraDropped.length === 0, extraDropped);

// 4. loadState actually writes every profile option back to the UI
const ui2 = { dvOpts: Object.assign({}, d), dvAnim: { view: 'anim', playing: true, dist: 0, t: 0, total: 0 } };
const perturbed = {};
for (const e of profile.slice(0, 10)) { if (e.id === 'playing') continue; perturbed[e.id] = nonDefault(e); } // sample 10; skip 'playing' — loadState intentionally pauses (sets playing=false), matching state-dump.js
const uiPert = { dvOpts: Object.assign({}, d, perturbed), dvAnim: { view: 'anim', playing: false, dist: 200, t: 10, total: 200 } };
const dumpPert = A.stateDump(uiPert);
const calls = [];
A.loadState(ui2, dumpPert, (u, k, v) => { calls.push([k, v]); u.dvOpts[k] = v; });
let notWritten = [];
for (const id of Object.keys(perturbed)) {
  if (JSON.stringify(ui2.dvOpts[id]) !== JSON.stringify(perturbed[id])) notWritten.push({ id, expected: perturbed[id], got: ui2.dvOpts[id] });
}
ok('loadState writes the perturbed profile values back (sample of 10)', notWritten.length === 0, notWritten);

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
