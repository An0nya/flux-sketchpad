// Pedestrian kinds (SEEDED-KINDS, Brief S): the scene lists ask for kind 'seeded', and the mode's pool decides. Headless: node tests/ped-kinds.js — exits 1 on failure.
// (1) default (no PED_FIXED_KINDS flag): the road scene's walkers in mix have no vest, because hi-vis is only drawn when asked for by name.
// (2) PED_FIXED_KINDS = true restores the old fixed kinds: mix has the scene's one vest at 95 m.
// (3) none: no walker has a vest or strips, whatever the kinds; every torso is a dark (cp-0..3) or bright (cp-4..7) palette colour.
// (4) the palette follows the user seed (ctx.foliageSeed): a seed that is absent or equal to the scene seed builds the same clothing; across seeds 1..20 the palette varies.
// (5) the same inputs build the same objects twice (a pure hash, nothing from the scenery stream).
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

const isVest = (o) => typeof o.mat === 'function' && String(o.mat).includes('hivis');
const build = (mode, extra) => D.buildScene('road', Object.assign({ Lw: 3.5, A: null, us: true, seed: 7, reflectiveClothing: mode }, extra || {}), { people: true, animals: false, signs: false, posts: false, veg: false }).objects;
const torsos = (objs) => objs.filter((o) => o.cls === 'person' && o.k === 'cyl' && o.r === 0.2).map((o) => (typeof o.mat === 'function' ? 'vest' : o.mat));
const fingerprint = (objs) => objs.map((o) => (typeof o.mat === 'function' ? String(o.mat) : o.mat)).join('|');

{
  globalThis.PED_FIXED_KINDS = false;
  const mix = build('mix');
  ok('default mix: no walker is a vest (hi-vis is not drawn from the pool)', mix.filter(isVest).length === 0, 'vests ' + mix.filter(isVest).length);
  ok('default mix: the walkers are dark or light', torsos(mix).length === 3 && torsos(mix).every((m) => /^cp-[0-7]$/.test(m)), JSON.stringify(torsos(mix)));
}
{
  globalThis.PED_FIXED_KINDS = true;
  const mix = build('mix');
  ok('PED_FIXED_KINDS: mix has the one fixed vest (the old road list)', mix.filter(isVest).length === 1, 'vests ' + mix.filter(isVest).length);
  globalThis.PED_FIXED_KINDS = false;
}
{
  const none = build('none');
  ok('none: no vest and no strip, and every torso is a palette colour', none.filter(isVest).length === 0 && none.filter((o) => o.mat === 'hivis-tape').length === 0 && torsos(none).every((m) => /^cp-[0-7]$/.test(m)), JSON.stringify(torsos(none)));
}
{
  const a = build('mix', { foliageSeed: 7 }), b = build('mix');
  ok('palette: foliageSeed equal to the scene seed builds the same clothing as no foliageSeed', fingerprint(a) === fingerprint(b));
  const seen = new Set();
  for (let s = 1; s <= 20; s++) seen.add(fingerprint(build('mix', { foliageSeed: s })));
  ok('palette: the user seed changes the clothing (seeds 1..20 give at least two different builds)', seen.size >= 2, 'distinct ' + seen.size);
  ok('same inputs, same objects twice', fingerprint(build('mix')) === fingerprint(build('mix')));
}
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all ped-kinds checks passed');
