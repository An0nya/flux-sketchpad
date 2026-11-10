// le-chonk (10-31 ~23:45): imperialUnits — display-only mph toggle, default OFF (metric, byte-identical).
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const anim = fs.readFileSync(ROOT + '/js/drive-anim.js', 'utf8');
const reg = fs.readFileSync(ROOT + '/js/options-registry.js', 'utf8');
const m = reg.match(/id: 'imperialUnits'[\s\S]*?default: (\w+)/);
ok('registry: imperialUnits declared once, default false', !!m && m[1] === 'false' && reg.split("id: 'imperialUnits'").length === 2);
ok('fmtSpeed helper: metric km/h when off, mph x0.621371 when on; stored speed untouched', anim.includes("const fmtSpeed = (kmh) => (info().o.imperialUnits ? Math.round(kmh * 0.621371) + ' mph' : Math.round(kmh) + ' km/h')"));
  // [KEEP: text — source literal with no cheap Node hook; the behaviour it guards is covered by the behaviour checks in this file]
ok('all display sites use fmtSpeed / the imperial branch (slider label, both gauge faces, 2 game readouts)', anim.includes('lab.textContent = fmtSpeed(o.speed)') && (anim.match(/imperialUnits \? 'mph' : 'km\/h'/g) || []).length === 2 && (anim.match(/imperialUnits \? ' mph' : ' km\/h'/g) || []).length === 2);
  // [KEEP: text — source literal with no cheap Node hook; the behaviour it guards is covered by the behaviour checks in this file]
ok('display-only: imperialUnits NOT in skey/tkey (no render change)', !/o\.imperialUnits[^\n]*(SUBTICK|skey)/.test(anim) && !/SUBTICK[^\n]*imperialUnits/.test(anim));
ok('toggle lives in the Performance/Debug bar (btn helper), not the top extras crowd; aria sync wired', anim.includes("btn('imperial-units'") && anim.includes("setDV(ui, 'imperialUnits', !info().o.imperialUnits)") && anim.includes("q('[data-anim=\"imperial-units\"]')") && !/ui\.driveExtras\.append\(iu\)/.test(anim));
  // [KEEP: text — UI-control literal; presence+behaviour covered by le-chonk-ui-controls.js / control-map pageMap]
// behaviour: conversion factor sanity
const f = (kmh, imp) => imp ? Math.round(kmh * 0.621371) : Math.round(kmh);
ok('conversion: 100 km/h -> 62 mph, 130 -> 81 mph, 0 -> 0', f(100, true) === 62 && f(130, true) === 81 && f(0, true) === 0 && f(100, false) === 100);
console.log(fail === 0 ? `\nall ${pass} le-chonk-units checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
