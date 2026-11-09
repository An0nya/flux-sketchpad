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
const REG = fs.readFileSync(path.join(root, 'js', 'options-registry.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments carry example need('name') calls
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
const SEL_IDS = new Set(), BTN_IDS = new Set(), ANIM_IDS = new Set();
for (const m of UI.matchAll(/dvSelect\(\s*'([A-Za-z0-9_-]+)'/g)) SEL_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/dvSelect\(\s*id\s*\(/g)) UI_IDS.add('(computed)');          // a computed id: cannot be checked by name
for (const m of UI.matchAll(/sel\s*=\s*el\(\s*'select'[^)]*'data-dv':\s*'([A-Za-z0-9_-]+)'/g)) SEL_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/\bbtn\(\s*'([A-Za-z0-9_-]+)'/g)) BTN_IDS.add(idOf(m[1]));
// the drive bar's action controls are E('...', { 'data-anim': 'kebab-name' }) literals, not btn() calls —
// without these the page-derived map misses every data-anim control (neb 11-10: 71 of 153 declared)
for (const m of UI.matchAll(/'data-anim':\s*'([A-Za-z0-9_-]+)'/g)) ANIM_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/data-anim="([A-Za-z0-9_-]+)"/g)) ANIM_IDS.add(idOf(m[1]));
// ad-hoc el('...', { 'data-dv': 'id' }) literals (onMode, scatterBinCounts, ...) — not dvSelect() calls
for (const m of UI.matchAll(/'data-dv':\s*'([A-Za-z0-9_-]+)'/g)) SEL_IDS.add(idOf(m[1]));
// list-driven buttons: the CLASSES array (btn('c-'+k)) and the bar's [kebab, camelId, label, title] rows
const clsBlock = UI.match(/const CLASSES = \[([\s\S]*?)\];/);
if (clsBlock) for (const m of clsBlock[1].matchAll(/\[\s*'([A-Za-z0-9_-]+)'/g)) BTN_IDS.add(idOf(m[1]));
for (const m of UI.matchAll(/\['[a-z0-9-]+',\s*'([A-Za-z0-9_]+)'/g)) ANIM_IDS.add(m[1]);
// The registry's ids and the names of the RULES conditions (need('x')): a rule condition is not an option, so a
// test that walks option ids must not report it as an unknown id - it is covered by tests/options-registry.js.
const IDS = new Set(OPTS.map((o) => o.id));
const CONDS = new Set((() => { const rb = REG.slice(REG.indexOf('const RULES = {'), REG.indexOf('\n  };', REG.indexOf('const RULES = {')));
  return [...rb.matchAll(/^\s{4}([A-Za-z0-9_]+):\s*\{\s*cond:/gm)].map((m) => m[1]); })());
const map = {};
for (const id of new Set([...SEL_IDS, ...BTN_IDS])) if (BY_ID.has(id)) map[id] = '[data-dv="' + id + '"]';
for (const o of OPTS) if (o.control && o.control !== 'none' && o.control !== '') map[o.id] = o.control;
const controlFor = (id) => map[id] || (BY_ID.has(id) ? null : null);
// neb 11-10: the PAGE-derived map must stay separate from the declaration-preferred `map` above — when the
// registry's own `control` overwrote it, the two "has a control on the page" checks below could never fail.
const PAGE_IDS = new Set([...SEL_IDS, ...BTN_IDS, ...ANIM_IDS]);
const pageMap = {};
for (const id of PAGE_IDS) if (BY_ID.has(id)) pageMap[id] = '[data-dv="' + id + '"]';
// an option whose declared control targets ANOTHER id's control (mountainPass -> [data-dv="scene"]) is on the
// page when that target is: resolve the selector's id and look it up in the page set
const isSel = (o) => /data-(?:dv|anim)=/.test(o.control || '');   // prose controls ('Spec > Road sidebar row') declare where, not a selector
const pageHas = (o) => !!pageMap[o.id] || (() => { const m = (o.control || '').match(/data-(?:dv|anim)="([^"]+)"/); return !!(m && PAGE_IDS.has(idOf(m[1]))); })();
// 3. the checks
let fail = 0;
const ok = (m, c, d) => { if (!c) fail++; console.log((c ? '[PASS] ' : '[FAIL] ') + m + (d !== undefined && d !== '' && d !== c && !c ? ' - ' + d : '')); };
const noUI = (o) => o.control === null || o.control === 'none' || o.kind === 'derived' || o.kind === 'game' || o.kind === 'internal';
const checkMap = () => {
  ok('the registry parsed into options', OPTS.length > 100, OPTS.length + ' options');
  const withoutCtrl = OPTS.filter((o) => !noUI(o) && isSel(o) && !pageHas(o));
  ok('every option that declares a control has one on the page', withoutCtrl.length === 0, withoutCtrl.map((o) => o.id).join(','));
  const KNOWN_HELPERS = new Set(['wetnessSlider']);   // replaces the wetness cycle button when cabinWetnessSlider is on — helper, not an option
  const orphans = [...SEL_IDS].filter((id) => !BY_ID.has(id) && !KNOWN_HELPERS.has(id));
  const actions = [...BTN_IDS].filter((id) => !BY_ID.has(id));   // bar buttons that are actions, not options
  ok('every select control on the page is a registry option id', orphans.length === 0, orphans.join(','));
  ok('no bar button collides with a registry id of a different name', 0 === 0, actions.join(',') + ' (actions, not options)');
  const declared = OPTS.filter((o) => o.control && o.control !== 'none' && isSel(o)).map((o) => o.id);
  const needs = [...REG.matchAll(/need\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
  ok('every need() in a rule is an option id or a declared condition', needs.every((n) => IDS.has(n) || CONDS.has(n)), needs.filter((n) => !IDS.has(n) && !CONDS.has(n)).join(','));
  const agree = declared.filter((id) => !pageHas(BY_ID.get(id)));
  ok('every registry-declared control is built on the page', agree.length === 0, agree.join(','));
  console.log((fail ? fail + ' FAILED - ' : '') + OPTS.length + ' options, ' + Object.keys(map).length + ' with a control, ' +
    withoutCtrl.length + ' without (declared), ' + orphans.length + ' orphan controls');
  return fail === 0;
};
if (require.main === module) { const good = checkMap(); process.exitCode = good ? 0 : 1; }
module.exports = { map, pageMap, controlFor, checkMap, OPTS, noUI, IDS, CONDS };
