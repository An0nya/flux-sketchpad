// CCT defaults per preset (js/cct.js ASSUMED_CCT): prints the full table for the owner to read, then asserts the owner's values.
// Run: node tests/cct-defaults.js   (exit 1 if any check fails)
const { load } = require('./load');
const RF = load();
const C = RF.CCT, SP = RF.SourcePresets;
let fails = 0, n = 0;
const ok = (name, pass, detail) => { n++; if (!pass) fails++; console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : '')); };
const f = (a) => '[' + a.map((v) => v.toFixed(5)).join(', ') + ']';

// 1. The generated table: every preset id, its label, its cct (or 'unset') and where the value came from.
const rows = Object.entries(SP.PRESETS).map(([id, p]) => ({ id, label: p.label || '', info: C.presetCctInfo(p, id) }));
console.log('\nid | label | cct | source');
for (const r of rows) console.log(r.id + ' | ' + r.label.slice(0, 80) + ' | ' + (r.info.cct === undefined ? 'unset' : r.info.cct + ' K') + ' | ' + r.info.source + (r.info.multiBin ? ' (several bins: edit it)' : ''));
const count = {}; for (const r of rows) count[r.info.source] = (count[r.info.source] || 0) + 1;
console.log('\nHEADLINE (' + rows.length + ' presets): ' + Object.entries(count).map(([k, v]) => k + ' ' + v).join(', '));

// 2. Counts. LV1 split LHP531 into 5 presets (94 -> 98); all 5 are owner-known table values: table 26 = 15 assumed + 11 known.
ok('98 presets in total', rows.length === 98, 'n=' + rows.length);
ok('source counts are label 38, halogen 13, hid 16, table 26 (15 assumed + 11 known), unset 5', count.label === 38 && count.halogen === 13 && count.hid === 16 && count.table === 26 && count.unset === 5, JSON.stringify(count));

// 3. The owner's values (assumptions, flagged as such).
const at6500 = ['osram-cslpm1', 'osram-cslnm1', 'osram-hwqp', 'osram-q8wp', 'osram-oslon-bfx-kw4', 'osram-oslon-bfx-kw3', 'k3-48945',
  'nichia-ncsw170h', 'nichia-ncsw170h-sa', 'nichia-ncsw170h-sb', 'lumileds-altilon-intense-1x1', 'lumileds-altilon-intense-1x2',
  'sft40-cw', 'k3-220770', 'k3-219467'];
const byId = Object.fromEntries(rows.map((r) => [r.id, r.info]));
ok('owner assumed 6500 K list (Osram, Nichia NCSW170HT, Altilon, sft40-cw default, LMP LML2AW.DC, Cree CLP6B): all 15 are 6500 K, table, assumed',
  at6500.every((id) => byId[id] && byId[id].cct === 6500 && byId[id].source === 'table' && byId[id].assumed === true), JSON.stringify(at6500.filter((id) => !(byId[id] && byId[id].cct === 6500))));
// 3b. Owner-supplied known values: table, not assumed, no note.
const known = { sft25r: 5700, 'k3-49788': 6500, 'k3-49731': 4000, 'k3-71898': 6200, 'k3-49237': 4000, 'k3-221071': 5928, 'k3-229647': 5429, 'k3-229647-6500': 6485, 'k3-229647-4000': 4211, 'k3-229647-3000': 3172, 'k3-229647-1800': 1733 };
ok('owner known values (sft25r, SST-40, Luxeon V, XM-L2, XP-L2, YLX, LHP531 x5 measured CCTs): exact cct, table, not assumed',
  Object.entries(known).every(([id, k]) => byId[id].cct === k && byId[id].source === 'table' && byId[id].assumed === false), JSON.stringify(Object.entries(known).filter(([id, k]) => byId[id].cct !== k)));
ok('only Cree CLP6B-WKW carries the several-bins flag', byId['k3-219467'].multiBin === true && Object.keys(known).every((id) => byId[id].multiBin === false) && at6500.filter((id) => byId[id].multiBin).join() === 'k3-219467');
ok('Osram, Nichia, Altilon entries do not carry the several-bins flag', at6500.slice(0, 12).every((id) => byId[id].multiBin === false));

// 4. Stay unset (white): generic / sketch / measured, the coloured part, the Cree CXA1304 colour kit (owner to decide).
const unsetIds = ['sketch', 'generic', 'measured', 'k3-48963', 'k3-71860'];
ok('unset list: sketch, generic, measured, k3-48963, k3-71860 are all unset', unsetIds.every((id) => byId[id].cct === undefined && byId[id].source === 'unset'),
  JSON.stringify(unsetIds.filter((id) => byId[id].cct !== undefined)));
ok('coloured LED label (PC Amber 1500K class) stays unset', C.presetCct({ label: 'Cree XLamp XP-E2 Q4 Y2 PC Amber 1500K class, domed' }, 'k3-71860') === undefined);
ok('coloured label stays unset even when its id is in the table', C.presetCct({ label: 'Osram amber LED' }, 'osram-cslpm1') === undefined);

// 4b. LHP531: five presets (LV1), each with its measured CCT (LV2). Tints printed for the owner; the 1800 K PC amber is an
// owner-approved exception to the coloured rule (MEASURED_OVERRIDE in js/cct.js), so it gets a CCT and a tint.
{ const L = { '5000 K (k3-229647)': 5429, '6500 K': 6485, '4000 K': 4211, '3000 K': 3172, '1800 K PC amber (exception)': 1733 };
  for (const [name, K] of Object.entries(L)) console.log('    LHP531 ' + name + ' cct ' + K + ' rgb ' + f(C.cctToRGB(K)));
  const lhp = ['k3-229647', 'k3-229647-6500', 'k3-229647-4000', 'k3-229647-3000', 'k3-229647-1800'];
  const want = { 'k3-229647': 5429, 'k3-229647-6500': 6485, 'k3-229647-4000': 4211, 'k3-229647-3000': 3172, 'k3-229647-1800': 1733 };
  ok('LHP531: five presets, each with its own measured cct (5429/6485/4211/3172/1733), table, not assumed (the nominal "6500 K" label does not win)',
    lhp.every((id) => SP.PRESETS[id] && C.presetCct(SP.PRESETS[id], id) === want[id] && byId[id].source === 'table' && byId[id].assumed === false), JSON.stringify(lhp.map((id) => [id, C.presetCct(SP.PRESETS[id], id)])));
  ok('LHP531 presets: models koef3, die, pts2 (die = quoted-area model)',
    lhp.every((id) => JSON.stringify(Object.keys(SP.PRESETS[id].drive.models)) === '["koef3","die","pts2"]'), JSON.stringify(lhp.map((id) => Object.keys(SP.PRESETS[id].drive.models))));
  ok('LHP531 1800 K PC amber: tints (exception), real preset label says amber', C.presetCct(SP.PRESETS['k3-229647-1800'], 'k3-229647-1800') === 1733 && /amber/i.test(SP.PRESETS['k3-229647-1800'].label));
  ok('real PRESETS: k3-71860 (PC Amber 1500K class, Cree XP-E2) stays unset', byId['k3-71860'].cct === undefined && byId['k3-71860'].source === 'unset');
}

// 5. A stated K in the label always wins over the table; stated values are not 'assumed'.
ok('label K beats the table: "X 4000K" under an Osram id gives 4000', C.presetCct({ label: 'X 4000K' }, 'osram-cslpm1') === 4000);
ok('a stated label is source label, not assumed', byId['k3-222273'].source === 'label' && byId['k3-222273'].cct === 6500 && byId['k3-222273'].assumed === false);
ok('halogen and HID keep their assumed values (3200 K, 4200 K), and are still assumed', byId['h4-low'].cct === 3200 && byId['h4-low'].assumed === true && byId['d2s'].cct === 4200 && byId['d2s'].assumed === true);

// 6. The one-argument form (no id) gets no table value: unchanged for callers that pass only the preset.
ok('presetCct(p) with no id: table is not consulted', C.presetCct(SP.PRESETS['osram-cslpm1']) === undefined);

// 7. CC2: the SFT-40 bin sets the colour, a typed value is kept across re-applies, and the assumed note shows.
// Driven through the real store, the controller setter ('src.cct') and applySourcePreset, the same calls the UI makes.
{ const Ctl = RF.Controller, st = Ctl.createStore(RF.State.testScene()), src = st.scene.source;
  const apply = (id, opts) => Ctl.actions.applySourcePreset(st, id, opts);
  apply('sft40-cw');
  ok('SFT-40 cool white opens at its default bin n5: 6500 K', src.fluxModel === 'n5' && src.cct === 6500, 'model=' + src.fluxModel + ' cct=' + src.cct);
  apply('sft40-cw', { model: 'n4' }); ok('bin N4 sets 5700 K', src.cct === 5700, 'cct=' + src.cct);
  apply('sft40-cw', { model: 'p3' }); ok('top bin P3 sets 5700 K', src.cct === 5700, 'cct=' + src.cct);
  apply('sft40-cw', { model: 'n5' }); ok('bin N5 sets 6500 K', src.cct === 6500, 'cct=' + src.cct);
  ok('an assumed bin value carries the assumed note', SP.cctNote(src).startsWith('Colour temperature assumed (edit it in Light source)'), SP.cctNote(src));

  Ctl.setControl(st, 'src.cct', 4000); ok('a typed value (4000 K) is kept', src.cct === 4000 && src.cctManual === true, 'cct=' + src.cct);
  ok('a typed value turns the assumed note off', SP.cctNote(src) === '');
  apply('sft40-cw', { model: 'n4' }); ok('a bin change keeps the typed 4000 K', src.cct === 4000 && src.fluxModel === 'n4', 'cct=' + src.cct + ' model=' + src.fluxModel);
  Ctl.actions.setDriveCurrent(st, 4); ok('a drive-current change keeps the typed 4000 K', src.cct === 4000 && src.cctManual === true, 'cct=' + src.cct);

  Ctl.setControl(st, 'src.cct', null); ok('a blank field clears to unset, and stays unset through a bin change', src.cct === undefined && src.cctManual === true);
  apply('sft40-cw', { model: 'n5' }); ok('after a blank, a bin change does not refill the value', src.cct === undefined, 'cct=' + src.cct);

  apply('osram-cslpm1'); ok('a different emitter starts at its own default and clears the typed flag', src.cct === 6500 && src.cctManual === undefined, 'cct=' + src.cct + ' flag=' + src.cctManual);
  ok('Osram preset carries the assumed note', SP.cctNote(src).startsWith('Colour temperature assumed'));
  apply('k3-219467'); ok('an assumed several-bins part says so in its note', SP.cctNote(src).includes('sold in several bins'), SP.cctNote(src));
  apply('k3-49788'); ok('an owner-known value (SST-40) has no assumed note', src.cct === 6500 && SP.cctNote(src) === '', 'cct=' + src.cct);
  apply('sft40-3000k'); ok('a stated 3000 K label gives that value with no note', src.cct === 3000 && SP.cctNote(src) === '', 'cct=' + src.cct);
  apply('h4-low'); ok('halogen keeps 3200 K and shows the assumed note', src.cct === 3200 && SP.cctNote(src).length > 0, 'cct=' + src.cct);
  apply('sketch'); ok('sketch (unset) has no cct and no note', src.cct === undefined && SP.cctNote(src) === '');
}

console.log('\nCCT defaults checks: ' + (n - fails) + ' passed, ' + fails + ' failed, of ' + n);
process.exit(fails ? 1 : 0);
