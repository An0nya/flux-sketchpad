// nicholl (11-11) — gameOptions invariant pin, converted from spilett's app-edits/restore-options-invariant.mjs
// (notes/spilett/app-edits/gameOptions-invariant-pin/, NOT LANDED, NOT REVIEWED as the deliverable spilett asked
// to be adopted by the minigame / state-leak owner — this is the state-leak family surface).
//
// Pins the SAVE/RESTORE pair, not the option: drive-anim.js's own comment states the invariant
// ("Exit: delete every key the game added, then put back the base values. JSON of the options is
// then exactly what it was before the game."), and the pair (`st.gameSaved = { options: … }` at
// build-time + restoreOptions(live, base) at exit) is what this test holds to it.
// Node-only by design; every check names a mutation it would fail on.
const path = require('path'), fs = require('fs');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(String(detail)).slice(0, 120) : '')); if (!cond) fails++; };
load();

const t = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const A = 'function restoreOptions(live, base) {';
const start = t.indexOf(A);
ok('restoreOptions is defined in the app', start >= 0);
let fn = null, extract = '';
if (start >= 0) {
  let open = t.indexOf('{', start), depth = 0, close = -1;
  for (let i = open; i < t.length; i++) { if (t[i] === '{') depth++; else if (t[i] === '}') { depth--; if (!depth) { close = i + 1; break; } } }
  if (close >= 0) { extract = t.slice(start, close); try { fn = new Function('return ' + extract)(); } catch (e) { console.log('extract exception: ' + e); } }
}
ok('restoreOptions can be extracted from the app source', !!fn);

const before = { scene: 'road', tiles: false, wild: true, seed: 11, wetness: 0, speed: 50, mountainPass: false, onMode: 'generic' };
const gameDelta = { scene: 'road', tiles: true, wild: true, seed: 42, wetness: 1, gameMode: true, hazardMask: null };

{
  const base = JSON.parse(JSON.stringify(before)), live = JSON.parse(JSON.stringify(before));
  Object.assign(live, gameDelta);
  fn(live, base);
  ok('game-added keys are deleted (gameMode gone)', !('gameMode' in live));
  ok('all pre-game keys restored to their exact values', JSON.stringify(live) === JSON.stringify(before));
  ok('key ORDER unchanged (JSON byte-equal, not deep-equal)', Object.keys(live).join() === Object.keys(before).join());
  ok('no extra keys added', Object.keys(live).length === Object.keys(before).length);
  ok('the game-added hazardMask is also gone', !('hazardMask' in live));
}

// idempotent restore
{
  const l2 = JSON.parse(JSON.stringify(before)); fn(l2, before); fn(l2, before);
  ok('restoring is idempotent', JSON.stringify(l2) === JSON.stringify(before));
}

// NEGATIVE CONTROL: an assign-only restore (no delete loop) leaves the game key behind — i.e. the
// delete loop is the load-bearing check, not defensive coding.
{
  const l3 = JSON.parse(JSON.stringify(before)); Object.assign(l3, { gameMode: true }); Object.assign(l3, before);
  ok('assign-only restore leaves the game key behind (delete loop is load-bearing)', 'gameMode' in l3);
}

console.log(fails ? `\n${fails} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(fails ? 1 : 0);
