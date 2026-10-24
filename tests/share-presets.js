// SHARE-PRESET test: node tests/share-presets.js — exits 1 on any failure.
// (a) every key of every preset is a registry option, and every value is legal for that option (enum member, number in range, boolean).
// (b) apply() writes the saved drive settings under flux/driveView, with the defaults filled in and the defaults version stamped.
// (c) an unknown name applies nothing and leaves storage alone.
// (d) #reset and #safe beat #preset in fromHash(). (The boot code in js/ui.js is DOM code: only the Playwright check covers it.)
const path = require('path');
const Opt = require(path.join(__dirname, '..', 'js', 'options-registry.js'));
const SP = require(path.join(__dirname, '..', 'js', 'share-presets.js'));
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };

// (a) legal keys and values
for (const name of SP.names()) {
  const p = SP.get(name);
  for (const [k, v] of Object.entries(p)) {
    const e = Opt.byId[k];
    if (!e) { ok(name + '.' + k + ' is a registry option', false); continue; }
    let legal = true;
    if (e.type === 'bool') legal = typeof v === 'boolean';
    else if (e.type === 'enum' && Array.isArray(e.values)) legal = e.values.includes(v);
    else if (e.values && typeof e.values === 'object' && 'min' in e.values) legal = typeof v === 'number' && v >= e.values.min && v <= e.values.max;
    ok(name + '.' + k + ' = ' + JSON.stringify(v) + ' is legal for ' + e.type, legal, e.values);
  }
  ok(name + ' has no anim key', !('anim' in p));
}

// fake localStorage
const store = new Map();
const fake = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

// (b) apply writes flux/driveView
store.clear();
const applied = SP.apply('touge', fake);
ok('apply(touge) returns true', applied === true);
const saved = store.has('flux/driveView') ? JSON.parse(store.get('flux/driveView')) : null;
ok('apply writes flux/driveView', !!saved);
if (saved) {
  const want = SP.get('touge');
  for (const [k, v] of Object.entries(want)) ok('saved ' + k + ' = preset value', JSON.stringify(saved[k]) === JSON.stringify(v), { saved: saved[k], want: v });
  ok('saved carries defaultsVersion', saved.defaultsVersion === Opt.DEFAULTS_VERSION, saved.defaultsVersion);
  ok('saved takes the registry default for keys the preset leaves out (playing: the normal start)', !("playing" in want) && saved.playing === Opt.defaults().playing, { saved: saved.playing, default: Opt.defaults().playing });
  ok('saved does not carry anim', !('anim' in saved));
}
ok('preset is copied, not shared (get() returns a fresh object)', SP.get('touge') !== SP.get('touge'));

// (c) unknown name
store.clear();
ok('unknown name: get() is null', SP.get('nope') === null);
ok('unknown name: apply() is false', SP.apply('nope', fake) === false);
ok('unknown name: storage untouched', store.size === 0, [...store.keys()]);

// (d) rescue wins over preset, and the preset name is read from any position in the hash
ok('#preset=touge read', SP.fromHash('#preset=touge') === 'touge');
ok('#reset beats #preset', SP.fromHash('#reset&preset=touge') === null, SP.fromHash('#reset&preset=touge'));
ok('#preset=touge&safe: safe beats preset', SP.fromHash('#preset=touge&safe') === null);
ok('#safe alone: null', SP.fromHash('#safe') === null);
ok('no hash: null', SP.fromHash('') === null && SP.fromHash(undefined) === null);
ok('#other=1&preset=touge: read among other params', SP.fromHash('#other=1&preset=touge') === 'touge');

console.log(`\n${n - fails}/${n} passed`);
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
