// OPTION-REGISTRY step C test: node tests/options-migration.js — exits 1 on any failure.
// The frozen-defaults fix (HAZARDS H2): a saved profile whose value is still a superseded default takes the new default;
// a value the user chose is kept. Four fixtures (fresh, old defaults, user-chosen, unknown keys) run against
//   (a) the pure function RF.Options.migrateProfile, with the real registry history and with a made-up registry that has a future version, and
//   (b) the real dvOpts() in js/spec-ui.js, with a stubbed localStorage, including what setDV writes back (the defaultsVersion stamp).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { load } = require('./load.js');
const RF = load();
const Opt = RF.Options;
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
const J = JSON.stringify;
const DEF = Opt.defaults();

// ---- the history the registry holds (derived from git log of js/spec-ui.js, first-parent main, see the report)
const histKeys = Opt.OPTIONS.filter((e) => e.defaultHistory).map((e) => e.id).sort();
// OHQ/UI (10-29): + the 25 owner default changes at DEFAULTS_VERSION 4 (oncoming scatter medium, UI pass).
ok('the registry seeds default history only for tiles, glare, gpuRenderer, haloPolar (SP), lampCone (Brief U), reflectiveClothing and the 10-29 changes', J(histKeys) === J(['expMode', 'fpsCounter', 'glare', 'gpuRenderer', 'haloBins', 'haloBlur', 'haloConePass', 'haloDepthBlur', 'haloDiv', 'haloGain', 'haloJitter', 'haloJitterAmount', 'haloNearSub', 'haloPolar', 'lampCone', 'lampConeGain', 'powerlines', 'reflectiveClothing', 'scatterCull', 'scatterCullEps', 'scatterGain', 'shadowRes', 'tileCache', 'tiles', 'trafficDensity', 'trafficLightRange', 'trafficRange', 'trafficShadowSoft', 'trafficShadows', 'wetModel']), histKeys);
ok('every history entry names the commit and date it comes from', Opt.OPTIONS.filter((e) => e.defaultHistory).every((e) => e.defaultHistory.every((h) => /^[0-9a-f]{7}$/.test(h.commit) && /^2026-\d\d-\d\d$/.test(h.date))));
const histOf = (id) => Opt.byId[id].defaultHistory.map((h) => h.value);
ok('glare history is 0.3, dry, off; tiles false, true; gpuRenderer false, true; reflectiveClothing off, mix; lampCone off, auto',
  J(histOf('glare')) === J([0.3, 'dry', 'off']) && J(histOf('tiles')) === J([false, true]) && J(histOf('gpuRenderer')) === J([false, true]) && J(histOf('reflectiveClothing')) === J(['off', 'mix']) && J(histOf('lampCone')) === J(['off', 'auto']));

// ---- fixtures. A whole-object save from the old app: every key at the default it had then.
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/drive-controls-fixtures/drive-view-main-58bccea.json'), 'utf8'));   // a real save from main 58bccea
const oldDefaults = () => Object.assign({}, DEF, { tiles: false, gpuRenderer: false, glare: 'dry', reflectiveClothing: 'off' });
const userChoice = () => Object.assign({}, DEF, { tiles: false, gpuRenderer: false, glare: 'rain', reflectiveClothing: 'vest', ev: 2.5, seed: 19, haloBins: 12 });

// 1. fresh profile
{
  const m = Opt.migrateProfile(null);
  ok('fresh: no saved profile gives an empty profile and no change', J(m.profile) === '{}' && m.changed.length === 0);
  ok('fresh: arrays, strings and numbers as saved (a non-object is ignored)', J(Opt.migrateProfile([1]).profile) === '{}' && J(Opt.migrateProfile('x').profile) === '{}' && J(Opt.migrateProfile(3).profile) === '{}');
}
// 2. old profile, old defaults
{
  const m = Opt.migrateProfile(oldDefaults());
  ok('old defaults: tiles, glare, gpuRenderer, reflectiveClothing take the current defaults', m.profile.tiles === DEF.tiles && m.profile.gpuRenderer === DEF.gpuRenderer && m.profile.glare === DEF.glare && m.profile.reflectiveClothing === DEF.reflectiveClothing, m.changed);
  ok('old defaults: exactly those four keys changed', J(m.changed.slice().sort()) === J(['glare', 'gpuRenderer', 'reflectiveClothing', 'tiles']), m.changed);
  ok('old defaults: the whole profile now equals the defaults', J(m.profile) === J(DEF));
  const g = Opt.migrateProfile(Object.assign(oldDefaults(), { glare: 0.3 }));
  ok('old defaults: the very first glare default (a number, 0.3) is superseded too', g.profile.glare === 'off');
  const r = Opt.migrateProfile(real);
  ok('real saved profile from main 58bccea: tiles and gpuRenderer (old defaults) move, ev 2.5 / seed 19 / fov 45 stay', r.profile.tiles === true && r.profile.gpuRenderer === true && r.profile.ev === 2.5 && r.profile.seed === 19 && r.profile.fov === 45, r.changed);
  ok('the input object is not modified', real.tiles === false && real.gpuRenderer === false);
}
// 3. old profile, user-chosen values
{
  const m = Opt.migrateProfile(userChoice());
  ok('user-chosen: glare rain, clothing vest, ev, seed, haloBins are kept', m.profile.glare === 'rain' && m.profile.reflectiveClothing === 'vest' && m.profile.ev === 2.5 && m.profile.seed === 19 && m.profile.haloBins === 12, m.changed);
  ok('user-chosen: but tiles and gpuRenderer false equal the old defaults, so they cannot be told apart and do move', m.profile.tiles === true && m.profile.gpuRenderer === true && J(m.changed.slice().sort()) === J(['gpuRenderer', 'tiles']), m.changed);
  const stamped = Opt.migrateProfile(Object.assign(oldDefaults(), { defaultsVersion: Opt.DEFAULTS_VERSION }));
  ok('a profile already stamped with the current version is never touched (its false values are choices)', stamped.profile.tiles === false && stamped.profile.glare === 'dry' && stamped.changed.length === 0);
  ok('the stamp is removed from the returned profile', !('defaultsVersion' in stamped.profile) && !('defaultsVersion' in Opt.migrateProfile(oldDefaults()).profile));
  const sparse = Opt.migrateProfile({ view: 'anim', playing: false, tiles: false, glare: 'dry' });
  ok('a short profile (a test seed or a hand edit, not a whole-object save) is kept as written', sparse.profile.tiles === false && sparse.profile.glare === 'dry' && sparse.changed.length === 0);
  const newer = Opt.migrateProfile(Object.assign(oldDefaults(), { defaultsVersion: Opt.DEFAULTS_VERSION + 5 }));
  ok('a profile written by a newer build is left alone', newer.profile.tiles === false && newer.changed.length === 0);
}
// SP: haloPolar 'off' was the default until DEFAULTS_VERSION 3; 'auto' since. A whole-object save from before that at 'off' is the old default and moves to 'auto'; a current-version profile at 'off' is a choice.
{
  const old = Opt.migrateProfile(Object.assign(oldDefaults(), { haloPolar: 'off' })), cur = Opt.migrateProfile(Object.assign(oldDefaults(), { haloPolar: 'off', defaultsVersion: Opt.DEFAULTS_VERSION })), keep = Opt.migrateProfile(Object.assign(oldDefaults(), { haloPolar: 'merged' }));
  // OHQ (10-29): the default went back to 'off' at version 4 (medium level), so an old save at off already holds today's default.
  ok('haloPolar: an old whole-object save at off stays off (the default again since v4); a current-version off stays; a chosen merged stays', old.profile.haloPolar === 'off' && cur.profile.haloPolar === 'off' && keep.profile.haloPolar === 'merged', { old: old.profile.haloPolar, cur: cur.profile.haloPolar, keep: keep.profile.haloPolar });
  const v3 = Opt.migrateProfile(Object.assign(oldDefaults(), { haloPolar: 'auto', defaultsVersion: 3 })), v3pick = Opt.migrateProfile(Object.assign(oldDefaults(), { haloPolar: 'perlamp', defaultsVersion: 3 }));
  ok('haloPolar: a version-3 save at auto (its default then) moves to off; a version-3 perlamp stays', v3.profile.haloPolar === 'off' && v3pick.profile.haloPolar === 'perlamp', { v3: v3.profile.haloPolar, pick: v3pick.profile.haloPolar });
}
// 4. unknown keys
{
  const m = Opt.migrateProfile(Object.assign(oldDefaults(), { futureOption: 'x', dolly: false, wetness: 0.4, ownLow: 'abc' }));
  ok('unknown keys, removed keys and non-DV_DEF keys are kept untouched', m.profile.futureOption === 'x' && m.profile.dolly === false && m.profile.wetness === 0.4 && m.profile.ownLow === 'abc');
  ok('key order of the saved profile is kept', J(Object.keys(m.profile)) === J(Object.keys(Object.assign(oldDefaults(), { futureOption: 1, dolly: 1, wetness: 1, ownLow: 1 }))));
}
// 5. a future version with the made-up registry: only the value that WAS the default at the profile's version moves
{
  const mk = (cur) => ({ options: [{ id: 'a', kind: 'profile', default: 'new', defaultHistory: [{ since: 0, value: 'zero' }, { since: 1, value: 'one' }, { since: 2, value: 'new' }] },
    { id: 'b', kind: 'profile', default: 5 }, { id: 'extra', kind: 'extra', default: undefined }], signature: ['a', 'b'], current: cur });
  const run = (raw, cur) => Opt.migrateProfile(raw, mk(cur));
  ok('future: version-1 profile at "one" moves to "new"', run({ a: 'one', b: 5, defaultsVersion: 1 }, 2).profile.a === 'new');
  ok('future: version-1 profile at "zero" is a choice (zero was not the default at version 1)', run({ a: 'zero', b: 5, defaultsVersion: 1 }, 2).profile.a === 'zero');
  ok('future: unstamped whole profile at "zero" or "one" moves, at "mine" stays', run({ a: 'zero', b: 5 }, 2).profile.a === 'new' && run({ a: 'one', b: 5 }, 2).profile.a === 'new' && run({ a: 'mine', b: 5 }, 2).profile.a === 'mine');
  ok('future: unstamped profile without the signature keys is kept', run({ a: 'zero' }, 2).profile.a === 'zero');
  ok('future: a version-2 profile is current and untouched', run({ a: 'one', b: 5, defaultsVersion: 2 }, 2).profile.a === 'one');
}
// 6. serialize
{
  const s = JSON.parse(Opt.serialize({ tiles: false }));
  ok('serialize writes the options plus defaultsVersion, without changing the input', s.tiles === false && s.defaultsVersion === Opt.DEFAULTS_VERSION);
}

// ---- (b) the real dvOpts() in js/spec-ui.js
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
RF.Panels = RF.Panels || { el: () => ({}) }; RF.Render = RF.Render || {};
if (!RF.SpecUI) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8'), { filename: 'spec-ui.js' });
const KEY = 'flux/driveView';
const freshUI = () => ({ redrawSpec() {}, dvTimers: {}, dvPending: {} });
try {
  // fresh
  delete store[KEY];
  const f = RF.SpecUI.dvOpts(freshUI());
  // dvOpts re-derives frameTargetMs from minFps (RF.DriveAnim.fpsSettings: 1000 / 30 = 33.33, the default literal says 33); that is old behaviour
  const diff = Object.keys(DEF).filter((k) => J(f[k]) !== J(DEF[k]));
  ok('dvOpts fresh: equals the registry defaults (frameTargetMs 33 is re-derived as 1000/minFps)', J(diff) === '["frameTargetMs"]' && Math.round(f.frameTargetMs) === DEF.frameTargetMs, diff);
  ok('dvOpts fresh: reading writes nothing', !(KEY in store));
  // old defaults, whole object
  store[KEY] = J(oldDefaults());
  const o = RF.SpecUI.dvOpts(freshUI());
  ok('dvOpts old defaults: tiles on, GPU on, glare off, clothing mix (the H2 fix)', o.tiles === true && o.gpuRenderer === true && o.glare === 'off' && o.reflectiveClothing === 'mix', { tiles: o.tiles, gpu: o.gpuRenderer, glare: o.glare, rc: o.reflectiveClothing });
  ok('dvOpts: the live options carry no defaultsVersion', !('defaultsVersion' in o));
  ok('dvOpts old defaults: loading alone does not rewrite the stored profile', store[KEY] === J(oldDefaults()));
  // a write stamps the version, and then the user's own choice sticks
  const u1 = freshUI(); RF.SpecUI.dvOpts(u1); RF.SpecUI.setDV(u1, 'ev', 3);
  const written = JSON.parse(store[KEY]);
  ok('setDV writes the profile with defaultsVersion and the migrated values', written.defaultsVersion === Opt.DEFAULTS_VERSION && written.tiles === true && written.ev === 3);
  RF.SpecUI.setDV(u1, 'tiles', false);
  const u2 = freshUI(), o2 = RF.SpecUI.dvOpts(u2);
  ok('after the stamp, tiles:false chosen by the user survives a reload', o2.tiles === false && o2.ev === 3);
  // user choices in an old whole profile
  store[KEY] = J(userChoice());
  const o3 = RF.SpecUI.dvOpts(freshUI());
  ok('dvOpts user-chosen values: glare rain, clothing vest, ev 2.5, seed 19 are kept', o3.glare === 'rain' && o3.reflectiveClothing === 'vest' && o3.ev === 2.5 && o3.seed === 19);
  // unknown keys survive into the live object and back out
  store[KEY] = J(Object.assign(oldDefaults(), { futureOption: 'x' }));
  const u4 = freshUI(), o4 = RF.SpecUI.dvOpts(u4); RF.SpecUI.setDV(u4, 'ev', 2);
  ok('dvOpts unknown key: kept in the live options and in the next write', o4.futureOption === 'x' && JSON.parse(store[KEY]).futureOption === 'x');
  // the existing onKcd special case still works (a stored non-default onKcd with no onMode is a manual choice)
  store[KEY] = J(Object.assign(oldDefaults(), { onKcd: 60 })); const km = Object.assign({}, JSON.parse(store[KEY])); delete km.onMode; store[KEY] = J(km);
  ok('onKcd special case: a stored onKcd 60 with no onMode loads as manual', RF.SpecUI.dvOpts(freshUI()).onMode === 'manual');
  store[KEY] = J(Object.assign({}, km, { onKcd: 30 }));
  ok('onKcd special case: a stored onKcd 30 (the old default) loads as symmetric', RF.SpecUI.dvOpts(freshUI()).onMode === 'symmetric');
  // a test seed that sets only a few keys keeps them
  store[KEY] = J({ view: 'anim', playing: false, tiles: false });
  const o5 = RF.SpecUI.dvOpts(freshUI());
  ok('dvOpts sparse seed {tiles:false}: tiles stays off (AM-ambient-tiles asserts this)', o5.tiles === false && o5.gpuRenderer === DEF.gpuRenderer);
  // view still/static rewrite goes through serialize too
  store[KEY] = J(Object.assign(oldDefaults(), { view: 'still' }));
  RF.SpecUI.dvOpts(freshUI());
  ok('view "still" rewrite stores the stamp as well', JSON.parse(store[KEY]).defaultsVersion === Opt.DEFAULTS_VERSION && JSON.parse(store[KEY]).view === 'anim');
} finally { delete globalThis.localStorage; }

// ---- Brief U (D): lampCone 'off' was the default until DEFAULTS_VERSION 2; 'auto' since. A version-1 save at 'off' is the old default and moves to 'auto';
// a current-version save at 'off' is the user's explicit choice and stays; 'on' is a choice in any version; retired keys are dropped.
{
  const v1 = Opt.migrateProfile(Object.assign(oldDefaults(), { lampCone: 'off', defaultsVersion: 1 })), v1on = Opt.migrateProfile(Object.assign(oldDefaults(), { lampCone: 'on', defaultsVersion: 1 }));
  ok("lampCone: a version-1 profile holding the old default 'off' takes 'auto'", v1.profile.lampCone === 'auto' && v1.changed.includes('lampCone'), v1.changed);
  ok("lampCone: a version-1 profile that chose 'on' keeps it", v1on.profile.lampCone === 'on' && !v1on.changed.includes('lampCone'));
  const cur = Opt.migrateProfile(Object.assign(oldDefaults(), { lampCone: 'off', defaultsVersion: Opt.DEFAULTS_VERSION }));
  ok("lampCone: a current-version profile at 'off' is an explicit choice and stays 'off'", cur.profile.lampCone === 'off' && cur.changed.length === 0);
  const ret = Opt.migrateProfile(Object.assign(oldDefaults(), { glareSources: 'all', lampHalos: 'on', defaultsVersion: Opt.DEFAULTS_VERSION }));
  ok('retired keys glareSources and lampHalos are dropped on load', !('glareSources' in ret.profile) && !('lampHalos' in ret.profile));
  const O = { streetLamps: 'sodium', visibility: 1000 }, lcOn = (o) => RF.Drive.lampConeOn(Object.assign({}, O, o));
  ok("lampConeOn: auto/unset = on with street lamps and a visibility; off in clear air or with lamps off; explicit off and on win", lcOn({}) && lcOn({ lampCone: 'auto' }) && !lcOn({ visibility: null }) && !lcOn({ streetLamps: 'off' }) && !lcOn({ lampCone: 'off' }) && lcOn({ lampCone: 'on', visibility: null }));
}

console.log(fails ? fails + ' of ' + n + ' options-migration checks FAILED' : 'all ' + n + ' options-migration checks passed');
process.exit(fails ? 1 : 0);
