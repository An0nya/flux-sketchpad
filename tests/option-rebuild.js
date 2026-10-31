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
// The cost LABEL of a per-frame governor: only dynamicResolution is still provably per-frame in the code
// (drive-anim.js reads o.dynamicResolution several times inside frame()), so that is the single label this test
// pins. simCeiling and the mirror/game labels (haloRangeRow, gameOptions) were dropped on 10-31: their readers
// moved and the group keeps re-deciding them, so a shared test pinning them fails on someone else's edit
// forever. Owner's call - see the BACKLOG. The teeth below (a scene-regenerate option must be carried by a
// rebuild key; no dead option) are the checks that have caught real bugs.
ok('dynamicResolution is read per-frame, so it is free, not scene-regen',
  (Opt.OPTIONS.find((o) => o.id === 'dynamicResolution') || {}).cost === 'free' && /o\.dynamicResolution/.test(anim));

// B) no option is dead: each is read somewhere in js/ outside the registry and docs machinery
const docsOnly = new Set(['options-registry.js', 'options-migration.js', 'options-docs-data.js', 'checks3.js', 'compare-ui.js']);
const readIn = new Map();
for (const o of Opt.OPTIONS) {
  const hits = jsFiles.filter((f) => !docsOnly.has(f) && new RegExp('\\b' + o.id + '\\b').test(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')));
  if (!hits.length) readIn.set(o.id, hits.join(','));
}
ok('every option is read in js/ outside the registry and docs (no dead knob)', readIn.size === 0, [...readIn.keys()]);

// A mirror labelled scene-regenerate is still exempt from the key check above (it is not a knob of its own),
// so that label alone cannot hide a bug; only the scene-regen SET SIZE is policed below.
// a free cost on a real knob must not hide one that needs a rebuild: the count of scene-regen options stays high
const regen = Opt.OPTIONS.filter((o) => o.cost === 'scene-regenerate').length;
ok('the scene-regenerate set is not being quietly emptied', regen >= 30, regen);

// A third sweep: no non-free option may be named nowhere. A bundle mirror (kind 'derived': airLevel, haloQuality)
// is exempt - it is never stored and only ever *writes* a bundle - but every member of that bundle must itself be
// plumbed, which is the check that actually matters for them.
const RENDER = ['drive.js', 'drive-three.js', 'drive-three-shaders.js', 'drive-three-halo.js', 'drive-three-objects.js',
  'drive-three-beamcone.js', 'drive-three-shadowmaps.js', 'drive-three-halo-cull.js', 'drive-scenes.js', 'drive-models.js',
  'drive-anim.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')]);
const helperRe = /airLevel|haloLevel|qualityCounts|scatLevels|lightRangeOf|lightCarsOf|wetnessOf|capGlare|glareOpts/;
const keyLineOf = (id) => jsFiles.some((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').split('\n')
  .some((l) => /\w*[Kk]ey\w*\s*[=:]|gkey|tkey|skey/.test(l) && l.indexOf(id) >= 0));
const plumbed = (id) => RENDER.some(([f, s]) => s.indexOf(id) >= 0) || helperRe.test(RENDER.map((r) => r[1]).join('')) && RENDER.some(([f, s]) => s.indexOf(id) >= 0) || keyLineOf(id);
const mirrorKind = (o) => o.kind === 'derived' || o.kind === 'game';
const silent = Opt.OPTIONS.filter((o) => o.cost !== 'free' && !mirrorKind(o) && !plumbed(o.id)).map((o) => o.id + ' (' + o.cost + ')');
ok('no non-free option is named nowhere (render code, a derived helper, or a cache key)', silent.length === 0, silent);
const bundleOpts = Opt.OPTIONS.filter((o) => Array.isArray(o.bundle) && o.bundle.length);
const deadMembers = [];
for (const o of bundleOpts) for (const m of o.bundle) {
  if (!Opt.OPTIONS.some((x) => x.id === m)) { deadMembers.push(o.id + ' -> unknown member ' + m); continue; }
  if (mirrorKind(Opt.OPTIONS.find((x) => x.id === m))) continue;
  if (!plumbed(m)) deadMembers.push(o.id + ' -> ' + m + ' is not plumbed');
}
ok('every bundle member of a derived option is itself plumbed', deadMembers.length === 0, deadMembers);
ok('the bundle mirrors are the known set (airLevel, haloQuality, haloRangeRow)', bundleOpts.map((o) => o.id).sort().join(',') === 'airLevel,haloQuality,haloRangeRow', bundleOpts.map((o) => o.id));
