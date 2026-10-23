// OPTION-REGISTRY step B test: node tests/options-docs.js — exits 1 on any failure.
// The generated parts of docs/inventory/OPTIONS.md and GROUPS.md match js/options-registry.js, and regenerating is stable.
// Positive control: a temp copy with a corrupted generated cell is reported stale, regenerated, and then equals the committed file.
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'docs/inventory/scripts/gen-options-docs.js');
const Opt = require('../js/options-registry.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const check = run('--check');
ok('the committed OPTIONS.md and GROUPS.md are up to date with the registry (run gen-options-docs.js and commit)', check.status === 0, check.stdout.trim());
const opts = read('docs/inventory/OPTIONS.md');
const tableRows = opts.split('\n').filter((l) => /^\| `[A-Za-z]+` \| (profile|extra|derived|session|game) \|/.test(l));
ok('the option table has one row per registry entry', tableRows.length === Opt.OPTIONS.length, { rows: tableRows.length, entries: Opt.OPTIONS.length });
const rulesBlock = opts.slice(opts.indexOf('<!-- BEGIN GENERATED rules'), opts.indexOf('<!-- END GENERATED rules'));
const ruleRows = rulesBlock.split('\n').filter((l) => /^\| `[A-Za-z0-9]+` \|/.test(l));
ok('the rules table has one row per rule', ruleRows.length === Object.keys(Opt.RULES).length, ruleRows.length);
const groups = read('docs/inventory/GROUPS.md');
ok('GROUPS.md lists every group and every option', Object.keys(Opt.GROUPS).every((g) => groups.includes('(`' + g + '`)')) && Opt.OPTIONS.every((e) => groups.includes('| `' + e.id + '` |')));
ok('hand-written columns survive: readers and tests cells of a known row are intact', /\| `trafficShuffle` \| profile .*BA5-gpu-atlas/.test(opts));

// positive control on a temp copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'optdocs-'));
try {
  fs.mkdirSync(path.join(tmp, 'docs/inventory'), { recursive: true });
  for (const f of ['OPTIONS.md', 'GROUPS.md']) fs.copyFileSync(path.join(ROOT, 'docs/inventory', f), path.join(tmp, 'docs/inventory', f));
  const po = path.join(tmp, 'docs/inventory/OPTIONS.md');
  fs.writeFileSync(po, fs.readFileSync(po, 'utf8').replace('| `ev` | profile | exposure | free | 1 |', '| `ev` | profile | exposure | free | 99 |'));
  ok('control: a corrupted generated cell is reported stale', run('--check', '--root', tmp).status === 1);
  run('--root', tmp);
  ok('control: regenerating repairs it and gives the committed bytes', fs.readFileSync(po, 'utf8') === opts && run('--check', '--root', tmp).status === 0);
  const before = fs.readFileSync(po, 'utf8'); run('--root', tmp);
  ok('regenerating twice gives identical bytes', fs.readFileSync(po, 'utf8') === before);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(fails ? fails + ' of ' + n + ' options-docs checks FAILED' : 'all ' + n + ' options-docs checks passed');
process.exit(fails ? 1 : 0);
