// minimaxai/minimax-m3.1-flash / TSUB (option trafficSubTick): interpolate the drawn traffic pose between the 20 Hz steps.
// The traffic is stepped at IDM.dt = 0.05 s, so the drawn cars - and the oncoming scatter table built from their lamp positions -
// jump every 0.05 s. With the option on, the drawn pose is interpolated; the simulation stays on the 20 Hz tick.
// Node: node tests/traffic-subtick.js — exits 1 on any failure.
const fs = require('fs'), path = require('path');
const { ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const reg = read('js/options-registry.js'), ui = read('js/spec-ui.js'), anim = read('js/drive-anim.js');

// 1. the option is declared once, in the registry, default off
const decl = (reg.match(/id: 'trafficSubTick'/g) || []).length;
ok('the option is declared exactly once in js/options-registry.js', decl === 1, decl);
const block = (reg.match(/\{[^{}]*id: 'trafficSubTick'[^{}]*\}/) || [''])[0];
ok('the option defaults to off', /default: 'off'/.test(block), block.match(/default: '[^']+'/));
ok('the option is an off/on enum', /values: \['off', 'on'\]/.test(block));
ok('the option names its control', /control: '\[data-dv="trafficSubTick"\]'/.test(block));
ok('the option names a node test', /tests: \['node:traffic-subtick'\]/.test(block));

// 2. the UI has the control and syncs it
ok('js/spec-ui.js has the control', /dvSelect\('trafficSubTick'/.test(ui));
ok('js/spec-ui.js syncs the control', /k === 'trafficSubTick'/.test(ui));

// 3. the app reads the option and uses it only for the drawn pose
ok('js/drive-anim.js reads the option', /SUBTICK = o\.trafficSubTick === 'on';/.test(anim));
ok('the step snapshot is taken only when the option is on', /if \(SUBTICK\) st\.prevX = new Map/.test(anim));
ok('the interpolation is applied only when the option is on', /if \(SUBTICK && frac > 0 && !c\.turn && st\.prevX && st\.prevX\.has\(c\.id\)\)/.test(anim));
ok('the drawn position starts from the tick position', /let cx = c\.x;/.test(anim));
ok('the physics still steps at 20 Hz', /IDM = \{[^}]*dt: 0\.05 \}/.test(anim) && /advanceTraffic\(src, st, own, time\)/.test(anim));
ok('turning cars keep their turn pose', /!c\.turn && st\.prevX/.test(anim));

// 4. OFF is exactly the old picture: with the option off the interpolation never runs, so the drawn pose is the tick pose
const interp = (prev, x, frac) => prev + (x - prev) * frac;
ok('interpolation at frac 0 is the previous tick position (the one-tick render lag)', interp(100, 102, 0) === 100);
ok('interpolation at frac 1 is the tick position', interp(100, 102, 1) === 102);
ok('interpolation at frac 0.5 is the midpoint', Math.abs(interp(100, 102, 0.5) - 101) < 1e-12);
ok('the fraction is clamped to [0,1]', /Math\.max\(0, Math\.min\(1, \(t - \(st\.epoch \+ st\.tick \* IDM\.dt\)\) \/ IDM\.dt\)\)/.test(anim));

console.log(fails ? `\n${fails} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(fails ? 1 : 0);
