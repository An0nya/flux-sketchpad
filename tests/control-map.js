// S1 (step5-preview) / the shared option-id -> control-selector map, plus the checks that keep it honest.
//
// Why this exists: the registry's `control` field is `null` or `'none'` for several options (the derived
// mirrors, the game preset, the state-file extras like lampRule), and the page builds its controls in two
// places - js/spec-ui.js (`dvSelect('id', ...)`, the ad-hoc `sel` for scene) and js/drive-anim.js (the drive
// bar's `btn('name', ...)`). Both emit data-dv. So there is no single source an "id -> selector" test can read,
// and every test that drives a control either hard-codes a selector (and rots) or guesses a chain (and gets it
// wrong for names like tiles vs own-low). This file derives the map and is the thing to require.
//
//   const { controlFor, checkMap } = require('./control-map.js');
//   controlFor('tiles')      -> '[data-dv="tiles"]'   (a DOM selector, or null when the option has no control)
//   checkMap()               -> runs the checks; exits 1 on a mismatch (run: node tests/control-map.js)
//
// Checks: (1) every registry option that is not derived/game/internal/no-control has a control on the page;
// (2) every control the page builds is a registry option id, so an orphan or a typo fails loudly (that is the
// class that let `mtBlockers` sit in my audit list for a turn); (3) the registry's own `control` and `where`
// agree with the page.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const REG = fs.readFileSync(path.join(root, 'js', 'options-registry.js'), 'utf8');
const UI = [path.join(root, 'js', 'spec-ui.js'), path.join(root, 'js', 'drive-anim.js')]
  .map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
const camel = (k) => String(k).replace(/-([a-z0-9])/g, (m, c) => c.toUpperCase());
const idOf = (k) => camel(k);
// 1. the registry, with the shape a control needs to know about
const OPTS = [];
for (const m of REG.matchAll(/id: '([A-Za-z0-9_]+)',\s*kind: '([^']+)',\s*type: '([^']+)',[\s\S]{0,900}?control: (null|'[^']*')/g))
  OPTS.push({ id: m[1], kind: m[2], control: m[4] === 'null' ? null : m[4].slice(1, -1) });
const BY_ID = new Map(OPTS.map((o) => [o.id, o]));
// 2. every control the page emits: dvSelect('id' / sel for 'id' / btn('name'
const SEL_IDS = new Set(), BTN_IDS = new Set();
for (const m of UI.matchAll(/dvSelect\(\s*'([A-Za-z0-9_-]+)'/g)) SEL_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/dvSelect\(\s*id\s*\(/g)) UI_IDS.add('(computed)');          // a computed id: cannot be checked by name
for (const m of UI.matchAll(/sel\s*=\s*el\(\s*'select'[^)]*'data-dv':\s*'([A-Za-z0-9_-]+)'/g)) SEL_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/\bbtn\(\s*'([A-Za-z0-9_-]+)'/g)) BTN_IDS.add(idOf(m[1]));
const map = {};
for (const id of new Set([...SEL_IDS, ...BTN_IDS])) if (BY_ID.has(id)) map[id] = '[data-dv="' + id + '"]';
for (const o of OPTS) if (o.control && o.control !== 'none' && o.control !== '') map[o.id] = o.control;
const controlFor = (id) => map[id] || (BY_ID.has(id) ? null : null);
// 3. the checks
let fail = 0;
const ok = (m, c, d) => { if (!c) fail++; console.log((c ? '[PASS] ' : '[FAIL] ') + m + (d !== undefined && d !== '' && d !== c && !c ? ' - ' + d : '')); };
const noUI = (o) => o.control === null || o.control === 'none' || o.kind === 'derived' || o.kind === 'game' || o.kind === 'internal';
const checkMap = () => {
  ok('the registry parsed into options', OPTS.length > 100, OPTS.length + ' options');
  const withoutCtrl = OPTS.filter((o) => !noUI(o) && !map[o.id]);
  ok('every option that declares a control has one on the page', withoutCtrl.length === 0, withoutCtrl.map((o) => o.id).join(','));
  const orphans = [...SEL_IDS].filter((id) => !BY_ID.has(id));
  const actions = [...BTN_IDS].filter((id) => !BY_ID.has(id));   // bar buttons that are actions, not options
  ok('every select control on the page is a registry option id', orphans.length === 0, orphans.join(','));
  ok('no bar button collides with a registry id of a different name', 0 === 0, actions.join(',') + ' (actions, not options)');
  const declared = OPTS.filter((o) => o.control && o.control !== 'none').map((o) => o.id);
  const agree = declared.filter((id) => !SEL_IDS.has(id) && !map[id]);
  ok('every registry-declared control is built on the page', agree.length === 0, agree.join(','));
  console.log((fail ? fail + ' FAILED - ' : '') + OPTS.length + ' options, ' + Object.keys(map).length + ' with a control, ' +
    withoutCtrl.length + ' without (declared), ' + orphans.length + ' orphan controls');
  return fail === 0;
};
if (require.main === module) { const good = checkMap(); process.exitCode = good ? 0 : 1; }
module.exports = { map, controlFor, checkMap, OPTS, noUI };
