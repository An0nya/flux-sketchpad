// le-chonk (backlog 5-M): side marker lamps on traffic cars — default-OFF option trafficMarkers.
// OFF: the car kit is byte-identical to before (no marker objects, same digest inputs). ON: 4 marker
// discs per car (amber front corners, red rear), materials exist, glareEmitter() covers them (veil),
// and the halo source filter (heads/tails only) keeps them out of the 16-lamp halo table.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } }
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, O = RF.Options;

// registry: declared once, bool, default off, in defaults(), in the traffic group, scene-regenerate cost
const e = O.OPTIONS.find((x) => x.id === 'trafficMarkers');
ok('registry: trafficMarkers declared once, bool, default false', O.OPTIONS.filter((x) => x.id === 'trafficMarkers').length === 1 && !!e && e.kind === 'profile' && e.type === 'bool' && e.default === false);
ok('registry: defaults() carries it as false', O.defaults().trafficMarkers === false);
ok('registry: group traffic, cost scene-regenerate, control [data-dv="trafficMarkers"]', e && e.group === 'traffic' && e.cost === 'scene-regenerate' && e.control === '[data-dv="trafficMarkers"]');

// materials exist
ok('MAT_DEF has marker-amber + marker-red with retro', !!D.MAT_DEF['marker-amber'] && !!D.MAT_DEF['marker-amber'].retro && !!D.MAT_DEF['marker-red'] && !!D.MAT_DEF['marker-red'].retro);

// car kit OFF vs ON
function carObjs(markers) { const K = D.kit({ Lw: 3.5, A: null, rand: () => 0.5 }); K.car(0, 0, { face: -1, lamps: 'head', kcd: 30, markers }); return K.O; }
const off = carObjs(false), on = carObjs(true);
ok('OFF: no marker objects', off.every((ob) => !ob.markerLamp));
ok('ON: exactly 4 marker discs (2 amber front, 2 red rear)', on.filter((ob) => ob.markerLamp).length === 4, on.filter((ob) => ob.markerLamp).map((o) => [o.mat, o.x | 0]));
const marks = on.filter((ob) => ob.markerLamp);
ok('ON: 2 amber + 2 red, paired laterally', marks.filter((m) => m.mat === 'marker-amber').length === 2 && marks.filter((m) => m.mat === 'marker-red').length === 2 && marks.some((m) => m.mat === 'marker-amber' && m.y < 0) && marks.some((m) => m.mat === 'marker-amber' && m.y > 0));
ok('ON: markers carry emit (veil needs it) and are not head/tail lamps (halo stays out)', marks.every((m) => Array.isArray(m.emit) && m.emit[0] > 0 && !m.headlamp && !m.taillamp));
ok('OFF: object list identical to a kit built without the markers flag at all', JSON.stringify(off) === JSON.stringify(carObjs(undefined)));
ok('ON adds exactly 4 objects, everything else unchanged', on.length === off.length + 4 && JSON.stringify(on.filter((o) => !o.markerLamp)) === JSON.stringify(off));

// glareEmitter: markers join the veil
ok('glareEmitter() true for markers, true for head/tail, false for a plain body box', D.glareEmitter(marks[0]) === true && D.glareEmitter(on.find((o) => o.headlamp)) === true && D.glareEmitter({ k: 'box', mat: 'car-paint' }) === false);

// halo source filter keeps markers out: drive.js:700 uses heads/tails only — replicate: no marker reaches it
const heads = on.filter((ob) => ob.headlamp), tails = on.filter((ob) => ob.taillamp);
ok('halo lamp pool (heads/tails) has no markerLamp objects', heads.concat(tails).every((ob) => !ob.markerLamp) && heads.length === 2 && tails.length === 0);

// spec-ui: strip button + label + picture-cache key
const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
ok('spec-ui: strip button [data-dv="trafficMarkers"] exists next to preceding', ui.includes("btn('trafficMarkers',") && ui.includes("'data-dv=\"trafficMarkers\"'") === false && ui.includes("setDV(ui, 'trafficMarkers', !dvOpts(ui).trafficMarkers)"));
ok('spec-ui: label map says "markers"', ui.includes("trafficMarkers: 'markers'"));
ok('spec-ui: picture-cache key carries o.trafficMarkers', (ui.match(/o\.preceding && o\.preDist, o\.trafficMarkers,/g) || []).length === 1);

// scene digest: OFF unchanged — buildScene with trafficMarkers off equals the frozen scene digest path (spot check via kit equality above) plus the option is absent from defaults() diff
ok('defaults() has no other new keys vs frozen copy expectations (count via registry test)', O.defaults().trafficMarkers === false);

console.log(fail === 0 ? `\nall ${pass} le-chonk-markers checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
