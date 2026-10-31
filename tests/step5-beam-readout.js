// step5-preview (Anya's wishlist §6): the drive bar's beam label is a live readout of the beam in use, not the
// static word "beam". Node test on the source (the label is written by labels(), which runs per frame).
const fs = require('fs'), path = require('path');
const { load } = require('./load.js');
load();
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const anim = read('js/drive-anim.js');

ok('labels() rewrites the beam label every frame (a live readout, not a static string)', /for \(const l of q\('\[data-dl="beam-label"\]'\)\) l\.textContent = 'beam: ' \+ ownBeamReadout\(o\);/.test(anim));
ok('the readout is derived from the options, not the DOM select (it cannot go stale with the load)', /const ownBeamReadout = \(o\) => \{[\s\S]*?ownBeams\(o\)/.test(anim));
ok('a resolved library beam keeps its name', /if \(e && e\.name\) return e\.name;/.test(anim));
ok("the low beam's own defaults read as 'our design' / 'generic' for high", /if \(!id \|\| id === 'design' \|\| id === 'generic'\) return hi \? 'generic' : 'our design';/.test(anim));
ok('an unresolved built-in id still gives a short label rather than the raw key', /if \(String\(id\)\.startsWith\('builtin:'\)\)[\s\S]*?\.replace\(/.test(anim));
ok('the label follows the high switch (hi ? o.ownHigh : o.ownLow)', /const own = ownBeams\(o\), hi = !!V\.high, id = hi \? o\.ownHigh : o\.ownLow/.test(anim));
ok('the static span is still in the bar (only its text becomes live)', /E\('span', \{ class: 'anim-speed', 'data-dl': 'beam-label' \}, 'beam'\)/.test(anim));
console.log((fails ? fails + ' of ' + n + ' step5-beam-readout checks FAILED' : 'all ' + n + ' step5-beam-readout checks passed'));
process.exit(fails ? 1 : 0);
