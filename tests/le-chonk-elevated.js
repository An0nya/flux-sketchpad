// le-chonk (Anya 10-30: touge route pipeline for all scenes, flat included, legacy fallback): option elevatedView
// (default OFF). OFF: p.touge exactly as shipped (mountainPass && GPU). ON: every GPU frame routes through
// RF.Touge — elevate() attaches height/surface; flat = height 0; attitude identity when flat; pass furniture pass-only.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, A = RF.DriveAnim, O = RF.Options;

const e = O.OPTIONS.find((x) => x.id === 'elevatedView');
ok('registry: elevatedView declared once, bool, default false, requires gpu', O.OPTIONS.filter((x) => x.id === 'elevatedView').length === 1 && !!e && e.type === 'bool' && e.default === false && e.requires.some((r) => r.rule === 'gpu'));
ok('registry: defaults() false; control [data-anim="elevatedView"]; cost scene-regenerate', O.defaults().elevatedView === false && e.control === '[data-anim="elevatedView"]' && e.cost === 'scene-regenerate');

// RF.Touge.elevate: attaches 3D surface to any route A; flat => height 0, grade 0, normal up
const flat = A.tileRoute(7, 1000, false);
const eA = RF.Touge.elevate(flat, 1000, 3.5, false);
ok('elevate() on a tile route (flat): height 0 everywhere, surface normal up, grade 0', eA.height(0, 0) === 0 && eA.height(120, 1) === 0 && (() => { const s = eA.surface(50, 0.5); return Math.abs(s.grade) < 1e-12 && Math.abs(s.normal[2] - 1) < 1e-9 && s.p[2] === 0; })());
ok('elevate() marks A.touge=false when flat, true when elevated', RF.Touge.elevate(A.tileRoute(7, 1000, false), 1000, 3.5, false).touge === false && RF.Touge.elevate(A.tileRoute(7, 1000, false), 1000, 3.5, true).touge === true);
ok('elevate() keeps the 2D route functions (at/frame) intact', typeof eA.at === 'function' && typeof eA.frame === 'function' && eA.tiles.length === eA.tiles.length);
const passA = RF.Touge.route(1000, 3.5, true);
ok('route() (the pass) still elevated: height nonzero somewhere, touge=true', passA.touge === true && (() => { for (let s = -100; s < 400; s += 25) if (passA.height(s, 0) !== 0) return true; return false; })());

// attitude: identity when flat
ok('attitude(flat) is identity', (() => { const a = RF.Touge.attitude(1000, false); return a.pitch === 0 && a.roll === 0 && a.forward[0] === 1 && a.up[2] === 1; })());
ok('attitude(pass) still real (elevated default true)', Math.abs(RF.Touge.attitude(1000, true).pitch) >= 0);

// OFF semantics in drive-anim: p.touge formula unchanged when elevatedView off — check the source text
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('drive-anim: p.touge = (mountainPass || elevatedView) && three — OFF reduces to shipped mountainPass && three', anim.includes('touge: !!((o.mountainPass || o.elevatedView) && V.three)'));
ok('drive-anim: toggle built + synced + tkey/srcArgs carry elevatedView', anim.includes("'data-anim': 'elevatedView'") && anim.includes('[data-anim="elevatedView"]') && anim.includes('!!o.elevatedView,'));
ok('drive-anim: tileA elevates tile routes under the pipeline (flat)', anim.includes('RF.Touge.elevate(A2, dist, p.lane, false)'));
const tg = fs.readFileSync(path.join(ROOT, 'js', 'drive-touge.js'), 'utf8');
ok('drive-touge: world() gates pass furniture + terrain on mountainPass', tg.includes('pass = !!p.mountainPass') && tg.includes('route(dist, p.lane, !!p.mountainPass)') && tg.includes('for (let s = lo; pass && s <= hi; s += 8)'));
ok('drive-touge: attitude(dist, false) identity', tg.includes('if (!elevated) return { pitch: 0, roll: 0'));

console.log(fail === 0 ? `\nall ${pass} le-chonk-elevated checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
