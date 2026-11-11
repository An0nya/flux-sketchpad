// BEHAVIOUR prototype of tests/restore-callsite.js (neb, 11-11) — handed to nicholl, who owns the file.
// Same four claims as the text version, but each one is observed by CALLING the app's own toggleGame()
// in Node instead of scanning js/drive-anim.js.
//
// How it reaches the app: RF.DriveAnim._.toggleGame is exported by js/drive-anim.js. The exit path needs
// a few module-internal values, which the stubs below provide:
//   V.info.o  — the LIVE options object (info() returns V.info; sync() sets V.info = I)
//   V.p       — the picture state (the exit path writes V.p.hazardMask)
//   V.src.traffic.state, V.act — the traffic state and the action map (the exit path restores them)
//   ui        — a stub: dvOpts/dvAnim (S(ui) keeps its state on ui.dvAnim), redrawSpec(), driveExtras
//
// Node-only; no DOM, no GL, no browser.
//   node notes/neb/app-edits/restore-callsite-behaviour/prototype.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { load } = require(path.join(ROOT, 'tests', 'load.js'));

let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(String(detail)).slice(0, 140))); if (!cond) fails++; };

load();
const A = globalThis.RF.DriveAnim;
const V = A._.V;

// ---- the app's own option set, as the live options object
const base = globalThis.RF.Options.defaults();
const live = Object.assign({}, base);

function stubUi(gameMode, saved) {
  return {
    dvOpts: live,
    dvAnim: {
      view: 'anim', playing: false, popout: false, dist: 0, total: 0, t: 0,
      gameMode: gameMode,
      game: gameMode ? { done: false } : null,
      gameSaved: saved || null,
    },
    dvBase: 'SOMETHING-ELSE',
    redrawSpec: () => {},
    driveExtras: { appendChild() {} },
  };
}
function arm(liveOptions) {
  V.info = { o: liveOptions, rd: {}, A: null, mirrored: false, us: false, conv: {}, lut: () => null, tm: null, groundKey: '', setDV: () => {}, toolbar: null };
  V.p = V.p || {};
  V.src = V.src || { traffic: { state: null } };
  V.act = V.act || new Map();
}

// ============ CLAIM 1 + 2 + 3: the EXIT path (we are in a game; toggling must restore the base) ============
{
  const before = Object.assign({}, base);                 // the profile as it was before the game
  const gameDelta = { tiles: true, seed: 42, wetness: 1 }; // what the game added/overwrote
  const liveExit = Object.assign({}, base, gameDelta, { gameMode: true, hazardMask: null });
  arm(liveExit);
  const saved = {
    options: Object.assign({}, before),
    state: { view: 'anim', playing: false, dist: 0, total: 0, t: 0, camera: null },
    flash: null, traffic: null, act: null,
  };
  const ui = stubUi(true, saved);
  A._.toggleGame(ui);
  ok('exit: the game-added option is gone', !('gameMode' in liveExit) && !('hazardMask' in liveExit), Object.keys(liveExit).filter((k) => !(k in base)));
  ok('exit: the pre-game values are restored exactly', JSON.stringify(liveExit) === JSON.stringify(before));
  ok('exit: the profile base is cleared (ui.dvBase === null)', ui.dvBase === null, ui.dvBase);
  ok('exit: the game is over (st.gameMode false)', ui.dvAnim.gameMode === false);
  ok('exit: the drive state came back from the saved state', ui.dvAnim.dist === 0 && ui.dvAnim.view === 'anim');
}

// ============ CLAIM 4: the ENTRY path (not in a game; toggling must snapshot the options) ============
{
  const liveEntry = Object.assign({}, base);
  arm(liveEntry);
  const ui = stubUi(false, null);
  A._.toggleGame(ui);
  const st = ui.dvAnim;
  ok('entry: the game starts (st.gameMode true)', st.gameMode === true);
  ok('entry: the options are snapshotted', !!st.gameSaved && !!st.gameSaved.options);
  ok('entry: the snapshot is a COPY, not the live object', st.gameSaved.options !== liveEntry);
  ok('entry: the snapshot holds the same values as the live options', JSON.stringify(st.gameSaved.options) === JSON.stringify(liveEntry));
  ok('entry: the profile base points at the snapshot', ui.dvBase === st.gameSaved.options);
  ok('entry: the live options were not changed by entering', JSON.stringify(liveEntry) === JSON.stringify(base));
  // the snapshot must be independent: changing the live options afterwards must not change the snapshot
  liveEntry.seed = 999;
  ok('entry: the snapshot does not follow later changes (it is a copy)', st.gameSaved.options.seed !== 999, st.gameSaved.options.seed);
}

// [KEEP: text — the "restoreOptions is called exactly once" claim is inherently source-level; behaviour cannot see a second harmless call]
// [KEEP: text — same check in one file, one reason: the count pin]
const __rPath = require('path'), __rFs = require('fs');
const __srcTxt = __rFs.readFileSync(__rPath.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const __needle = 'restoreOptions(info().o, st.gameSaved.options)';
{ let __count = 0; for (let __i = __srcTxt.indexOf(__needle); __i !== -1; __i = __srcTxt.indexOf(__needle, __i + 1)) __count++; ok('source: the exit call site occurs exactly once', __count === 1, __count); }

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
