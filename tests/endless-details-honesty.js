// The Details honesty guard — spilett, per neb's slice 6.
// Node-only, no DOM/GL. Registered in all.js and gate.js NODE by barbicane.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + x : '')); } };
const src = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const lines = src.split('\n');

// 1. the readout's option reads: everything endlessDetailState() reads at o.<x>
const readout = src.slice(src.indexOf('function endlessDetailState()'))
  .split('\n').slice(0, 70).join('\n');
const opts = [...new Set((readout.match(/\bo\.([A-Za-z_$][\w$]*)/g) || []).map((s) => s.slice(2)))].sort();
// cyrus BLOCKER 1: a COUNT-based smoke check cannot detect a mangled identifier (my bug #1: slice(3)
// dropped the first letter of every name, so catterGain/wnHigh/ndlessAxes all passed a length check).
// So assert NAMES: every parsed option must exist as `o.<name>` somewhere in the app. A mangled
// name (catterGain) has no `o.catterGain` anywhere, so this fails instead of passing vacuously.
ok('readout options parsed as real option names (name-asserted, not count-asserted)',
  opts.length >= 4 && opts.every((k) => src.includes('o.' + k)),
  opts.length + ' parsed: ' + opts.join(',') + ' — ' +
  (opts.filter((k) => !src.includes('o.' + k)).join(',') || 'all exist as o.<name> in src'));

// 2. the srcArgs opts literal
const srcArgsLine = lines.find((l) => l.includes('V.srcArgs = [o.scene,'));
const srcArgsOpts = srcArgsLine || '';
ok('the srcArgs assignment is present (a one-line tsar)', !!srcArgsLine);

// 3. what source() reads from its opts argument
// cyrus BLOCKER 2: the `function source(` anchor was unasserted — renamed, indexOf gives -1, the
// slice is empty, sourceReads() is false for every key, and the guard passes vacuously. Assert it.
ok('source() anchor found (an empty body slice would make coverage vacuous)',
  src.includes('function source('));
const body = src.slice(src.indexOf('function source('), src.indexOf('function source(') + 6000);
const sourceReads = (k) => new RegExp('\\bo\\.' + k + '\\b').test(body);

// 4. the live paths: named reads outside source() that reach the renderer
const livePaths = (k) => {
  const hits = [];
  if (new RegExp("look:? \\{[^}]*\\b" + k + "\\b").test(src)) hits.push('V.p.look');
  // The beam options derive a cache key FOR the option itself: `ownLowKey = o.ownLow && ...` and
  // `ownHighKey = o.ownHigh && ...` at :1743. The first version was loose enough to miss both, and
  // cyrus's beam-helper tightening is what exposed it — assert the option's own derived key name.
  if (new RegExp("\\b" + k + "Key\\b").test(src)) hits.push('key-derivation');
  // cyrus note 1: the first version was k-independent — ANY ownBeams( occurrence credited EVERY viaB
  // option with 'beam-helper'. It still fails loud when nothing hits at all, so it was not a vacuity
  // bug, but it was imprecise. Tightened: the option name must appear within 400 chars BEFORE the
  // helper call, so a call elsewhere in the file cannot be the reason this option is fine.
  if (new RegExp(".{0,400}\\b" + k + "\\b.{0,400}\\((?:ownBeams|beamOf|lampOf)\\(").test(src)) hits.push('beam-helper');
  return hits;
};

// (A) the rebuild path: source() reads o.<k> and the srcArgs opts must carry <k>.
const viaA = opts.filter((k) => sourceReads(k));
const uncovered = viaA.filter((k) => !new RegExp('\\b' + k + '\\b').test(srcArgsOpts));
ok('every readout option that source() reads is carried in srcArgs (the rebuild path)', uncovered.length === 0,
  uncovered.length ? uncovered.join(',') + ' -> source() reads it but the rebuild opts do not carry it' : '');
// cyrus BLOCKER 3: livePaths() was defined and never called, so case (B) was unenforced while the
// README implied it was. Wire it: every option NOT reaching the renderer through (A) must name at
// least one live path outside the srcArgs rebuild — otherwise "it reaches the renderer somewhere"
// is an assumption, and this guard exists to turn assumptions into checks.
const viaB = opts.filter((k) => !sourceReads(k));
const noPath = viaB.filter((k) => livePaths(k).length === 0);
ok('every readout option that source() does NOT read names a live renderer path', noPath.length === 0,
  noPath.length ? noPath.join(',') + ' -> no V.p.look / key-derivation / beam-helper path found' :
  (viaB.map((k) => k + ' via ' + livePaths(k).join('+')).join('; ') || 'none'));
process.exit(fail ? 1 : 0);
