// BOTTOM SHEET (owner 10-29), headless: node tests/drive-sheet.js — exits 1 on failure.
// Detents are named by the canvas shape whose bottom edge the sheet top meets (RF.DriveLayout.detentsFor); a shape that would leave the
// sheet under SHEET_MIN px is skipped; closed is always there; auto stacks as push (sheetModeOf). The drag itself is checked in the page.
const { load } = require('./load.js'); const RF = load(); const DL = RF.DriveLayout;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); if (!cond) fails++; };
const names = (d) => d.map((x) => x[0]);
// a 375 x 812 phone measured in the page 10-29: host 692, width 342, top bar 45, closed at 634
const ph = DL.detentsFor(692, 342, 45, 634);
ok('SH phone: all four detents, biggest sheet first', JSON.stringify(names(ph)) === JSON.stringify(['wide', 'square', '3:4', 'closed']), ph);
ok('SH phone: detent y is the top bar plus that shape\'s canvas height', ph[0][1] === Math.round(45 + 342 * 9 / 16) && ph[1][1] === 45 + 342 && ph[2][1] === Math.round(45 + 342 * 4 / 3), ph);
ok('SH detents strictly ordered top to bottom', ph.every((x, i) => i === 0 || x[1] > ph[i - 1][1]));
const short = DL.detentsFor(560, 342, 45, 500);
ok('SH short host: 3:4 skipped (sheet would be under SHEET_MIN), closed kept', !names(short).includes('3:4') && names(short).includes('closed'), short);
ok('SH tiny host: closed only', JSON.stringify(names(DL.detentsFor(300, 342, 45, 260))) === '["closed"]');
ok('SH sheet mode: overlay only when chosen; auto and push stack as push', DL.sheetModeOf('overlay') === 'overlay' && DL.sheetModeOf('auto') === 'push' && DL.sheetModeOf('push') === 'push' && DL.sheetModeOf(undefined) === 'push');
ok('SH detent names are canvas shapes (plus closed)', DL.DETENTS.every((n) => n === 'closed' || n in DL.SHAPES));
console.log(fails ? fails + ' FAILED' : 'all drive-sheet checks passed'); process.exit(fails ? 1 : 0);
