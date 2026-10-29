// STATE DUMP (owner 10-29), headless: node tests/state-dump.js — exits 1 on failure.
// Save writes every option, the pose and readable context; load sets the exact saved values (no default swap), drops keys this
// build does not know, gives keys the file lacks the current default, and pauses at the saved spot (RF.DriveAnim.readState/loadState).
const { load } = require('./load.js'); const RF = load(); const A = RF.DriveAnim, O = RF.Options;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); if (!cond) fails++; };
const d = O.defaults(), keys = Object.keys(d), pick = keys.find((k) => typeof d[k] === 'boolean' && k !== 'playing' && k !== 'mountainPass');
const ui = { dvOpts: Object.assign({}, d, { [pick]: !d[pick], mountainPass: true, scene: 'road' }), dvAnim: { view: 'anim', playing: true, dist: 395, t: 12.5, total: 395 } };
const dump = JSON.parse(JSON.stringify(A.stateDump(ui)));
ok('SD dump is a flux-state with every option', dump.kind === A.STATE_KIND && keys.every((k) => k in dump.options));
ok('SD changed lists what differs from the defaults', pick in dump.changed && 'mountainPass' in dump.changed || d.mountainPass === true, Object.keys(dump.changed));
ok('SD pose saved', dump.pose.dist === 395 && dump.pose.t === 12.5 && dump.pose.playing === true, dump.pose);
ok('SD where: mountain pass tile and grade at 395 m', dump.where.road === 'mountain pass' && dump.where.tileIndex === Math.floor(395 / A.TILE_LEN) && Math.abs(dump.where.gradePct + 8) < 0.5, dump.where);
ok('SD headless context fails soft (readouts/env carry an error, the dump still saves)', !!dump.readouts && !!dump.env);
// a value that would be a superseded default under migrateProfile must survive a load as saved
const stale = O.OPTIONS.find((e) => e.kind === 'profile' && e.defaultHistory && e.defaultHistory.length);
const file = JSON.parse(JSON.stringify(dump)); file.options.notARealKey = 1; delete file.options[keys[keys.length - 1]];
if (stale) file.options[stale.id] = JSON.parse(JSON.stringify(stale.defaultHistory[0].value));
const r = A.readState(file);
ok('SD unknown key dropped and listed', r.ignored.includes('notARealKey') && !('notARealKey' in r.opts), r.ignored);
ok('SD missing key takes the default and is listed', r.missing.includes(keys[keys.length - 1]) && JSON.stringify(r.opts[keys[keys.length - 1]]) === JSON.stringify(d[keys[keys.length - 1]]), r.missing);
if (stale) ok('SD exact values: an old default is NOT swapped for the new one (' + stale.id + ')', JSON.stringify(r.opts[stale.id]) === JSON.stringify(stale.defaultHistory[0].value), r.opts[stale.id]);
ok('SD wrong kind is refused', !!A.readState({ kind: 'beam' }).error && !!A.readState(null).error);
ok('SD newer version is refused', !!A.readState({ kind: A.STATE_KIND, version: 99 }).error);
// load: options replaced, pose restored, paused, one setDV call
const ui2 = { dvOpts: Object.assign({}, d), dvAnim: { view: 'anim', playing: true, dist: 0, t: 0, total: 0 } }; let calls = [];
const msg = A.loadState(ui2, dump, (u, k, v) => { calls.push([k, v]); u.dvOpts[k] = v; u.dvAnim.playing = v; });
ok('SD load sets the saved options', ui2.dvOpts[pick] === !d[pick] && ui2.dvOpts.mountainPass === true);
ok('SD load restores the pose, paused', ui2.dvAnim.dist === 395 && ui2.dvAnim.t === 12.5 && calls.length === 1 && calls[0][0] === 'playing' && calls[0][1] === false, { st: ui2.dvAnim, calls });
ok('SD load message names the spot', /395 m/.test(msg) && /Paused/.test(msg), msg);
ok('SD load refused during a game', /game/.test(A.loadState({ dvOpts: {}, dvBase: {}, dvAnim: {} }, dump, () => {})));
console.log(fails ? fails + ' FAILED' : 'all state-dump checks passed'); process.exit(fails ? 1 : 0);
