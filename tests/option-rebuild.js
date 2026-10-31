// step5-preview (open sweep 10-30): an option must either be carried by the gate that pays its cost, or be read live.
// The class this was written for: `lampRule` was written into src.tiles at scene build and read from it every
// frame, but was in neither tkey nor skey, so toggling the lamp rule mid-run kept drawing the old rule until
// something else rebuilt the scene — the same shape as haloMoment's cache-key gap and wetVeil's look gap.
// Two sound assertions:
//   A) cost 'scene-regenerate' (the option must rebuild the scene) => the option is carried by a rebuild key.
//   B) every option is read somewhere outside the registry/docs, because 'free' only means "no gate to update"
//      (a per-frame option is read live by D.* functions or the look literal, which gate A does not cover).
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
load();
let ok = (n, c, d) => console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : '  - ' + JSON.stringify(d)));
const Opt = globalThis.RF.Options;
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));

// every JSON.stringify key literal in drive-anim.js with three or more option refs (tkey/skey/srcArgs/the
// ground key/the halo key), balanced by paren counting so a nested literal is not cut short
const gates = [];
{
  const re = /JSON\.stringify\(/g; let m;
  while ((m = re.exec(anim))) {
    const i = anim.indexOf('(', m.index); let d = 0, k = i;
    for (; k < anim.length; k++) { if (anim[k] === '(') d++; else if (anim[k] === ')') { d--; if (!d) break; } }
    const body = anim.slice(i, k);
    if ((body.match(/o\.[A-Za-z_$][\w$]*/g) || []).length >= 3) gates.push(body);
  }
}
const srcArgs = (anim.match(/V\.srcArgs = (\[[\s\S]*?\]);/) || [])[1];
const look = (anim.match(/look: \{([\s\S]*?)\};/) || [])[1];
if (srcArgs) gates.push(srcArgs);
if (look) gates.push(look);
ok('the rebuild gate audit has its literals (tkey/skey/srcArgs/look and the ground key)', gates.length >= 4, gates.length);
const carried = (id) => gates.some((g) => new RegExp('o\\.' + id + '\\b').test(g) || new RegExp('\\b' + id + '\\b').test(g));

// A) a scene-regenerate option must be in a rebuild key, or be a mirror rather than a knob
const mirror = (o) => o.kind === 'derived' || o.kind === 'game';   // a mirror of another option, not a knob of its own
const missing = Opt.OPTIONS.filter((o) => o.cost === 'scene-regenerate' && !mirror(o) && !carried(o.id)).map((o) => o.id);
ok("every 'scene-regenerate' option is carried by a rebuild key", missing.length === 0, missing);
ok('lampRule is in a rebuild key (the fixed bug)', carried('lampRule'));
ok('the cost labels follow the code: per-frame governors are free, not scene-regen',
  ['dynamicResolution', 'simCeiling'].every((id) => (Opt.OPTIONS.find((o) => o.id === id) || {}).cost === 'free'));
ok('a derived mirror (haloRangeRow) and the game preset (gameOptions) are not scene-regen',
  ['haloRangeRow', 'gameOptions'].every((id) => (Opt.OPTIONS.find((o) => o.id === id) || {}).cost === 'free'));

// B) no option is dead: each is read somewhere in js/ outside the registry and docs machinery
const docsOnly = new Set(['options-registry.js', 'options-migration.js', 'options-docs-data.js', 'checks3.js', 'compare-ui.js']);
const readIn = new Map();
for (const o of Opt.OPTIONS) {
  const hits = jsFiles.filter((f) => !docsOnly.has(f) && new RegExp('\\b' + o.id + '\\b').test(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')));
  if (!hits.length) readIn.set(o.id, hits.join(','));
}
ok('every option is read in js/ outside the registry and docs (no dead knob)', readIn.size === 0, [...readIn.keys()]);

// the exemptions must stay small, so a new silent one fails here rather than hiding
const mirrorCount = Opt.OPTIONS.filter((o) => o.cost === 'scene-regenerate' && mirror(o)).length;
ok('the mirror exemptions on scene-regen are the known set (2: haloRangeRow, gameOptions are now free)', mirrorCount === 0, mirrorCount);
// a free cost on a real knob must not hide one that needs a rebuild: the count of scene-regen options stays high
const regen = Opt.OPTIONS.filter((o) => o.cost === 'scene-regenerate').length;
ok('the scene-regenerate set is not being quietly emptied', regen >= 30, regen);
