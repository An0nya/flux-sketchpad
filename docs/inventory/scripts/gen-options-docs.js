#!/usr/bin/env node
// Regenerates the registry-owned parts of docs/inventory/OPTIONS.md and docs/inventory/GROUPS.md from js/options-registry.js.
//
//   node docs/inventory/scripts/gen-options-docs.js            rewrite the files
//   node docs/inventory/scripts/gen-options-docs.js --check    change nothing; exit 1 if a file is out of date
//   --root DIR   read and write DIR/docs/inventory/ instead of the repo's (the test uses a temp copy)
//
// What is generated (between <!-- BEGIN GENERATED ... --> and <!-- END GENERATED --> markers):
//   OPTIONS.md  the option table columns id, kind, group, cost class, default, requires / ignored when / conflicts, owner,
//               and the table of rules those columns refer to.
//   GROUPS.md   the table of proposed groups and their members.
// What is NOT touched: every other column of the option table (type, control, gating notes, cost notes, migration, readers, tests) is
// hand-written; this script carries those cells over by option id and header name. Text outside the markers is hand-written.
// Running the script twice gives the same bytes.
'use strict';
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..', '..');
const argv = process.argv.slice(2), CHECK = argv.includes('--check');
const ROOT = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1]) : REPO;   // where docs/inventory/ is read and written (tests use a temp copy)
const Opt = require(path.join(REPO, 'js', 'options-registry.js'));

const GEN_HEAD = ['id', 'kind', 'group', 'cost class', 'default', 'requires / ignored when / conflicts', 'owner'];
const HAND_HEAD = ['type / allowed values', 'control (file:line)', 'gated by / gates / silent clamps', 'cost (as the code says)', 'migration / normalisation', 'readers (js/)', 'tests (G = in gate)'];

const split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((s) => s.trim());
const esc = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => '`' + s + '`';

// ---- text for the registry values
const defaultText = (e) => {
  if (e.kind === 'derived') return '(derived)';
  if (e.kind === 'session') return JSON.stringify(e.default) + ' (session)';
  if (e.kind === 'game') return '(overlay)';
  if (e.kind === 'extra' || e.default === undefined) return '(unset)';
  return JSON.stringify(e.default);
};
const condText = (c) => {
  if (c.any) return '(' + c.any.map(condText).join(' or ') + ')';
  if (c.all) return '(' + c.all.map(condText).join(' and ') + ')';
  const who = c.ctx ? 'context ' + c.ctx : c.opt;
  if ('eq' in c) return who + ' = ' + JSON.stringify(c.eq);
  if ('ne' in c) return who + ' is not ' + JSON.stringify(c.ne);
  if ('gt' in c) return who + ' > ' + c.gt + (c.legacy ? ' (or legacy ' + c.legacy + ')' : '');
  if ('in' in c) return who + ' in ' + JSON.stringify(c.in);
  return who + ' is on';
};
const rulesText = (e) => {
  const parts = [];
  const list = (label, rs) => { if (rs && rs.length) parts.push(label + ' ' + rs.map((r) => code(r.rule) + ' [' + r.effect + ']').join(', ')); };
  list('needs', e.requires); list('ignored when', e.ignoredWhen); list('conflicts', e.conflicts);
  return parts.join('; ') || '-';
};
const ownerText = (e) => (e.owner.length ? e.owner.map((f) => f.replace(/^js\//, '')).join(', ') : '-');

// ---- OPTIONS.md
function readHandCells(lines, headerIdx) {
  const head = split(lines[headerIdx]), byId = {};
  for (let i = headerIdx + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = split(lines[i]);
    const row = {};
    head.forEach((h, j) => { row[h] = cells[j]; });
    byId[(row.id || '').replace(/`/g, '')] = row;
  }
  return byId;
}

function optionTable() {
  const file = path.join(ROOT, 'docs/inventory/OPTIONS.md');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const BEGIN = '<!-- BEGIN GENERATED option-table (docs/inventory/scripts/gen-options-docs.js) -->', END = '<!-- END GENERATED option-table -->';
  let headerIdx = lines.findIndex((l) => /^\| id \| /.test(l));
  if (headerIdx < 0) throw new Error('OPTIONS.md: option table header not found');
  const hand = readHandCells(lines, headerIdx);
  let last = headerIdx + 1;
  while (last + 1 < lines.length && lines[last + 1].startsWith('|')) last++;
  const head = ['id', 'kind', 'group', 'cost class', 'default', 'requires / ignored when / conflicts', 'owner'].concat(HAND_HEAD);
  const out = [BEGIN, '| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'];
  for (const e of Opt.OPTIONS) {
    const h = hand[e.id] || {};
    const cells = [code(e.id), e.kind, e.group, e.cost, esc(defaultText(e)), esc(rulesText(e)), esc(ownerText(e))]
      .concat(HAND_HEAD.map((k) => {
        if (k.startsWith('tests') && Array.isArray(e.tests) && e.tests.length && (h[k] === undefined || h[k] === '' || h[k] === '-')) return e.tests.map((t) => (t.startsWith('node:') ? '`tests/' + t.slice(5) + '.js`' : '`' + t + '`')).join(', ');   // empty hand cell: derive from the registry's tests: field (qwen 20.1)
        if (h[k] !== undefined && h[k] !== '') return h[k];
        return '-';
      }));
    out.push('| ' + cells.join(' | ') + ' |');
  }
  out.push(END);
  // replace the existing block: the marker block if present, else the bare table
  let from = lines.indexOf(BEGIN), to = lines.indexOf(END);
  if (from >= 0 && to > from) { from = from; to = to; } else { from = headerIdx; to = last; }
  const next = lines.slice(0, from).concat(out, lines.slice(to + 1));
  return { file, text, next: next.join('\n') };
}

function rulesSection(text) {
  const BEGIN = '<!-- BEGIN GENERATED rules (docs/inventory/scripts/gen-options-docs.js) -->', END = '<!-- END GENERATED rules -->';
  const usedBy = {};
  for (const e of Opt.OPTIONS) for (const k of ['requires', 'ignoredWhen', 'conflicts']) for (const r of e[k] || []) (usedBy[r.rule] = usedBy[r.rule] || []).push(e.id);
  const block = [BEGIN,
    'Each rule is one condition on other options (or on the render context), with the plain reason, how the UI shows it today, and where the code enforces it (file, a snippet to search for, approximate line at the time of writing; `tests/options-registry.js` fails when the snippet is no longer near that line).',
    '',
    '| rule | holds when | why | UI effect today | enforced at | used by |', '|---|---|---|---|---|---|'];
  for (const [name, r] of Object.entries(Opt.RULES)) {
    block.push('| ' + [code(name), esc(condText(r.cond)), esc(r.why), r.effect, esc(code(r.at.file.replace(/^js\//, '') + ' ' + r.at.fn.replace(/`/g, '') + ' ~L' + r.at.line)), esc((usedBy[name] || []).join(', '))].join(' | ') + ' |');
  }
  block.push(END);
  const lines = text.split('\n');
  let from = lines.indexOf(BEGIN), to = lines.indexOf(END);
  if (from >= 0 && to > from) return lines.slice(0, from).concat(block, lines.slice(to + 1)).join('\n');
  const anchor = lines.findIndex((l) => l.startsWith('## Options locked behind other options'));
  if (anchor < 0) throw new Error('OPTIONS.md: anchor "## Options locked behind other options" not found');
  const section = ['## Rules the registry declares (generated)', '', ...block, ''];
  return lines.slice(0, anchor).concat(section, lines.slice(anchor)).join('\n');
}

// ---- GROUPS.md
function groupsSection(text) {
  const BEGIN = '<!-- BEGIN GENERATED groups (docs/inventory/scripts/gen-options-docs.js) -->', END = '<!-- END GENERATED groups -->';
  const WHERE_NAME = { toolbar: 'toolbar', more: 'More', 'air-advanced': 'advanced air beam', 'halo-advanced': 'advanced halo', sidebar: 'Spec > Road sidebar', none: 'no control' };
  const block = [BEGIN, 'Generated from the `group` and `where` fields of `js/options-registry.js`. `where` is where the control sits today; nothing has been moved.', '',
    '| group | label | options | toolbar | More | advanced air | advanced halo | sidebar | no control |', '|---|---|---|---|---|---|---|---|---|'];
  const members = (g) => Opt.OPTIONS.filter((e) => e.group === g);
  for (const g of Object.keys(Opt.GROUPS)) {
    const m = members(g), c = (w) => m.filter((e) => e.where === w).length;
    block.push('| ' + [code(g), Opt.GROUPS[g], m.length, c('toolbar'), c('more'), c('air-advanced'), c('halo-advanced'), c('sidebar'), c('none')].join(' | ') + ' |');
  }
  for (const g of Object.keys(Opt.GROUPS)) {
    block.push('', '#### ' + Opt.GROUPS[g] + ' (' + code(g) + ')', '', '| option | label | kind | sits in | default | needs / ignored / conflicts |', '|---|---|---|---|---|---|');
    for (const e of members(g)) block.push('| ' + [code(e.id), esc(e.label), e.kind, WHERE_NAME[e.where], esc(defaultText(e)), esc(rulesText(e))].join(' | ') + ' |');
  }
  block.push(END);
  const lines = text.split('\n');
  const from = lines.indexOf(BEGIN), to = lines.indexOf(END);
  if (from >= 0 && to > from) return lines.slice(0, from).concat(block, lines.slice(to + 1)).join('\n');
  return text.replace(/\n*$/, '\n') + '\n## Registry listing (generated)\n\n' + block.join('\n') + '\n';
}

// ---- run
const results = [];
{
  const o = optionTable();
  results.push({ file: o.file, before: o.text, after: rulesSection(o.next) });
}
{
  const file = path.join(ROOT, 'docs/inventory/GROUPS.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# GROUPS: proposed groups for the drive controls\n';
  results.push({ file, before, after: groupsSection(before) });
}
let stale = 0;
for (const r of results) {
  if (r.before === r.after) { console.log('up to date: ' + path.relative(ROOT, r.file)); continue; }
  stale++;
  if (CHECK) console.log('OUT OF DATE: ' + path.relative(ROOT, r.file));
  else { fs.writeFileSync(r.file, r.after); console.log('wrote ' + path.relative(ROOT, r.file)); }
}
process.exit(CHECK && stale ? 1 : 0);
