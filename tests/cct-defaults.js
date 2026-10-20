// CCT defaults per preset (js/cct.js ASSUMED_CCT): prints the full table for the owner to read, then asserts the owner's values.
// Run: node tests/cct-defaults.js   (exit 1 if any check fails)
const { load } = require('./load');
const RF = load();
const C = RF.CCT, SP = RF.SourcePresets;
let fails = 0, n = 0;
const ok = (name, pass, detail) => { n++; if (!pass) fails++; console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : '')); };

// 1. The generated table: every preset id, its label, its cct (or 'unset') and where the value came from.
const rows = Object.entries(SP.PRESETS).map(([id, p]) => ({ id, label: p.label || '', info: C.presetCctInfo(p, id) }));
console.log('\nid | label | cct | source');
for (const r of rows) console.log(r.id + ' | ' + r.label.slice(0, 80) + ' | ' + (r.info.cct === undefined ? 'unset' : r.info.cct + ' K') + ' | ' + r.info.source + (r.info.multiBin ? ' (several bins: edit it)' : ''));
const count = {}; for (const r of rows) count[r.info.source] = (count[r.info.source] || 0) + 1;
console.log('\nHEADLINE (' + rows.length + ' presets): ' + Object.entries(count).map(([k, v]) => k + ' ' + v).join(', '));

// 2. Counts. Derived from the pre-change baseline (27 unset of 94 is the brief's number): 38 label, 13 halogen, 16 hid, 19 table, 8 unset.
ok('94 presets in total', rows.length === 94, 'n=' + rows.length);
ok('source counts are label 38, halogen 13, hid 16, table 19, unset 8', count.label === 38 && count.halogen === 13 && count.hid === 16 && count.table === 19 && count.unset === 8, JSON.stringify(count));

// 3. The owner's values (assumptions, flagged as such).
const at6500 = ['osram-cslpm1', 'osram-cslnm1', 'osram-hwqp', 'osram-q8wp', 'osram-oslon-bfx-kw4', 'osram-oslon-bfx-kw3', 'k3-48945',
  'nichia-ncsw170h', 'nichia-ncsw170h-sa', 'nichia-ncsw170h-sb', 'lumileds-altilon-intense-1x1', 'lumileds-altilon-intense-1x2',
  'sft40-cw', 'k3-220770', 'k3-221071', 'k3-219467', 'k3-49237', 'k3-49788', 'k3-49731'];
const byId = Object.fromEntries(rows.map((r) => [r.id, r.info]));
ok('owner 6500 K list (Osram, Nichia NCSW170HT, Altilon, sft40-cw default, koef3 generic): all 19 are 6500 K, source table, assumed',
  at6500.every((id) => byId[id] && byId[id].cct === 6500 && byId[id].source === 'table' && byId[id].assumed === true), JSON.stringify(at6500.filter((id) => !(byId[id] && byId[id].cct === 6500))));
ok('Cree and Luminus SST-40 / Lumileds Luxeon V koef3 entries carry the several-bins flag', ['k3-219467', 'k3-49237', 'k3-49788', 'k3-49731'].every((id) => byId[id].multiBin === true));
ok('Osram, Nichia, Altilon entries do not carry the several-bins flag', at6500.slice(0, 12).every((id) => byId[id].multiBin === false));

// 4. Stay unset (white), and say so: generic / sketch / measured, the coloured part, high-CRI and colour-kit parts, the LHP531 range.
const unsetIds = ['sketch', 'generic', 'measured', 'sft25r', 'k3-48963', 'k3-71898', 'k3-229647', 'k3-71860'];
ok('unset list: sketch, generic, measured, sft25r, k3-48963, k3-71898, k3-229647, k3-71860 are all unset', unsetIds.every((id) => byId[id].cct === undefined && byId[id].source === 'unset'),
  JSON.stringify(unsetIds.filter((id) => byId[id].cct !== undefined)));
ok('coloured LED label (PC Amber 1500K class) stays unset', C.presetCct({ label: 'Cree XLamp XP-E2 Q4 Y2 PC Amber 1500K class, domed' }, 'k3-71860') === undefined);
ok('coloured label stays unset even when its id is in the table', C.presetCct({ label: 'Osram amber LED' }, 'osram-cslpm1') === undefined);

// 5. A stated K in the label always wins over the table; stated values are not 'assumed'.
ok('label K beats the table: "X 4000K" under an Osram id gives 4000', C.presetCct({ label: 'X 4000K' }, 'osram-cslpm1') === 4000);
ok('a stated label is source label, not assumed', byId['k3-222273'].source === 'label' && byId['k3-222273'].cct === 6500 && byId['k3-222273'].assumed === false);
ok('halogen and HID keep their assumed values (3200 K, 4200 K), and are still assumed', byId['h4-low'].cct === 3200 && byId['h4-low'].assumed === true && byId['d2s'].cct === 4200 && byId['d2s'].assumed === true);

// 6. The one-argument form (no id) gets no table value: unchanged for callers that pass only the preset.
ok('presetCct(p) with no id: table is not consulted', C.presetCct(SP.PRESETS['osram-cslpm1']) === undefined);

console.log('\nCCT defaults checks: ' + (n - fails) + ' passed, ' + fails + ' failed, of ' + n);
process.exit(fails ? 1 : 0);
