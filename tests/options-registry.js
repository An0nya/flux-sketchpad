// OPTION-REGISTRY test: node tests/options-registry.js — exits 1 on any failure.
// 1. DV_DEF generated from the registry equals the frozen copy of the old hand-written literal below (main 251f801).
// 2. Every registry entry is well formed, and every citation in it (rule locations, controls, owners, tests) points at something real.
// To change a default on purpose: edit the registry, add a defaultHistory entry (see js/options-registry.js), and update FROZEN_OLD_DV_DEF
// here in the same commit with the reason. Never edit FROZEN_OLD_DV_DEF to make a failing run pass without that.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const Opt = require('../js/options-registry.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The DV_DEF literal as it stood on main 251f801 (js/spec-ui.js:840, 87 keys), one key per line, same order.
const FROZEN_OLD_DV_DEF = {
  trafficShuffle: 'off',
  trafficOutIds: [],
  playing: false,
  driveScrub: false,   // le-chonk (10-30, backlog 6-L): time scrubber, new option default off
  wetVeil: false,      // le-chonk (10-30, backlog 4-N): wet-road mirror sources in the glare veil, new option default off
  scene: 'road',
  wet: false,
  visibility: null,
  scatter: 0,
  trafficHalo: 0,
  haloCars: 4,   // OHC (10-29): new option (cars that scatter), not a default change
  haloRange: 250,   // OHR (10-29): new option (oncoming scatter range), not a default change
  lampCone: 'auto',   // LAMP-CONE-MIST added it (default 'off'); Brief U (D) changed the default to 'auto' on purpose (owner 2026-10-27: cone on whenever street lamps and visibility are on), with a defaultHistory entry and DEFAULTS_VERSION 2
  lampConeGain: 0.5,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 1). Earlier: LAMP-CONE-OBJECTS: a new option (not a default change), added to the frozen copy as lampCone was
  lampClass: 'III',
  lampRoad: 'off',
  haloBins: 12,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 24).
  haloDiv: 2.8,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 0).
  haloPolar: 'off',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'auto'). Earlier: SP: default changed from 'off' on purpose (owner 2026-10-26: auto), with a defaultHistory entry and DEFAULTS_VERSION 3
  haloPolarBand: '128x32',   // SP: new option (not a default change); registry position: after haloPolar
  haloPolarLamps: 2,
  haloGain: 0.25,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 1).
  crestOcclusion: 'off',   // E2: new option (not a default change); registry position: after haloGain
  haloJitter: 'jittered',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'off'). Earlier: IL: new options (not default changes); registry position: after crestOcclusion
  haloJitterAmount: 0.25,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 1).
  haloBlur: 'light',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'auto').
  haloDepthBlur: 'light',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'off').
  haloLampWin: 'off',   // step5-preview (LW): new option (not a default change); registry position: after haloDepthBlur, before haloAutoRange
  haloCrossingRefine: 0,   // minimaxai (P1c): new option (not a default change); registry position: after haloLampWin, before haloAutoRange
  haloRefineNeighbour: 'off',   // qwen3.8max (RN): new option (not a default change); registry position: after haloCrossingRefine, before haloAutoRange
  haloMoment: 'off',   // glm5.2 (P3): new option (not a default change); registry position: after haloRefineNeighbour, before haloAutoRange
  haloAutoRange: '4-8',   // AT: new options (not default changes); registry position: after haloDepthBlur
  haloNearSub: 1,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 4).
  haloConePass: '2',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'off'). Earlier: CP + SM: new options (not default changes); registry position: after haloDepthBlur
  haloConeAngle: 30,
  trafficShadows: 'all',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'off').
  shadowRes: '512x512',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was '1024x512').
  trafficShadowRoad: 'on',
  trafficShadowObjects: 'on',   // SM1b: new option (not a default change)
  trafficShadowSoft: 'off',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was '2x2'). Earlier: SM3 PCF: new option (not a default change)
  scatterCull: 'fast',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'exact'). Earlier: SC: new option (not a default change); default exact on purpose, it draws the identical table
  scatterCullEps: 0.001,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 0.05). Earlier: SC: new option, the fast-mode threshold
  scatterRange: 120,   // SR: new option, the scatter range in m (120 = the old fixed value)
  scatterMode: 'direct',
  scatterRes: 'half',
  scatterBlur: 'off',
  scatterCache: 'off',
  scatterCycle: 0,
  scatterBinCounts: '',
  scatterQuality: 'steps',
  scatterCycleFade: 'off',
  scatterNearFade: 'on',
  scatterNearFadeRange: 'medium',
  scatterNearBias: 0,
  scatterGain: 0.5,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 1).
  wetSheen: false,
  wetModel: 'ggx',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'legacy').
  expMode: 'adapt',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'fixed').
  ev: 1,
  glare: 'off',
  onMode: 'symmetric',
  people: true,
  animals: true,
  signs: true,
  reflectiveClothing: 'mix',
  posts: true,
  powerlines: 'on',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 'off'). Earlier: POWERLINES: new option (default off), not a default change; added to the frozen copy like lampCone
  powerlineReflectance: 0.22,   // POWERLINES: new option (wire albedo), not a default change of an existing key
  veg: true,
  obstacle: false,
  rpm: true,
  tex: true,
  wild: true,
  mt: true,
  largeCard: true,
  animateUI: false,   // 10-29: new key, UI animations (default off)
  panelMode: 'auto',   // UI step C (10-29): new key, the layout shell's push/overlay choice
  canvasShape: 'wide',   // UI step C (10-29): new key, the drive picture shape
  seed: 7,
  density: 1.5,
  trafficDensity: 0.5,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 1).
  trafficLogic: false,
  safeGap: true,
  tiles: true,
  endlessRoad: false,   // le-chonk 10-30 (2-endless prototype): new option (not a default change); registry position: after tiles
  tileCache: true,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was false).
  mountainPass: false,
  elevatedView: false,   // le-chonk 10-30 (elevatedView prototype): new option (not a default change); registry position: after mountainPass
  endlessPreset: 'off',   // le-chonk 10-30 (endless road preset): new option (not a default change)
  endlessPresetCustom: '',   // le-chonk 11-01 (custom endless preset JSON): new option, default empty
  endlessAxes: '',   // harbert 11-10 (endless road axis settings JSON): new option, default empty = all axes auto
  tileTerrain: false,   // le-chonk 10-31 (terrain skirts opt-in): new option, default off
  multilaneRoad: false,   // le-chonk 10-31 (2+2 highway phase 0, drive view only): new option, default off
  endlessTunnel: false,   // le-chonk 10-31 (tunnel tiles, opt-in): new option, default off
  endlessCrossing: false,   // le-chonk 10-31 (level crossings, opt-in): new option, default off
  junctionGantries: false,   // glm5.2 11-01 (junction gantries, opt-in): new option, default off; gated le-chonk's brainstorm gantry behind default-OFF option to restore rule 3 (consent flags default ON)
  cabinView: false,   // le-chonk 10-31 (in-cabin overlay, Anya-approved): new option, default off
  driftMode: false,   // le-chonk 10-31 (drift easter egg, Anya-permitted): new option, default off
  driftDynamics: false,   // step5-preview 11-01 (drift dynamics): new option, default off; host landing reconciled by le-chonk
  driftAfs: false,   // step5-preview 11-01 (drift AFS headlamps): new option, default off; host landing reconciled by le-chonk
  yawSmooth: false,   // le-chonk 10-31 (yaw smoothing, opt-in): new option, default off
  cabinStyle: 'modern',   // le-chonk 10-31 (cabin dashboard styles, wishlist): new option, default 'modern'
  driftCabin: false,   // step5-preview 11-01 (drift cabin lean): new option, default off; host landing reconciled by le-chonk
  cabinLight: false,   // le-chonk 10-31 (cabin light demo, opt-in): new option, default off
  cabinFovFrame: false,   // ayrton 11-04 (cabin frame tracks FOV, Anya): new option, default off
  cabinMirror: false,   // ayrton 11-04 (rear mirrors, Anya): new option, default off
  cabinDigitalRedesign: false,   // ayrton 11-04 (80s digital redesign, Anya): new option, default off
  imperialUnits: false,   // le-chonk 10-31 (imperial units, display-only): new option, default off
  gpuRenderer: true,
  trafficBeams: false,
  surfaceSheen: false,
  lampPitch: false,
  afs: false,
  corneringLamps: false,
  fpsCounter: true,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was false).
  sceneDetails: false,
  debugTimings: false,
  dynamicResolution: false,
  frameTargetMs: 33,
  streetLamps: 'sodium',
  cline: 'solid',
  speed: 50,
  oncoming: false,
  preceding: false,
  trafficMarkers: false,   // le-chonk 10-30 (5-M): new option (not a default change); registry position: after preceding
  onDist: 80,
  preDist: 50,
  onKcd: 30,
  RL: 200,
  ambient: 0,
  smooth: 'smooth',
  res: 640,
  fov: 60,
  leafyFoliage: false,
  detailedModels: false,
  trafficRange: 250,   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was 400).
  trafficLightRange: '250',   // OHQ/UI (10-29): default changed on purpose (owner: oncoming scatter medium + UI pass), defaultHistory entry, DEFAULTS_VERSION 4 (was '150').
  trafficNearest: '8',
  simCeiling: 'high',
  minFps: 30,
  samples: '1',
  haloWidthStep: 'off',   // minimax 10-31: haloWidthStep, new option default off
  trafficSubTick: 'off',   // minimax 10-31: trafficSubTick, new option default off
  qualityGovernor: 'off',   // frenchie (3-P): new option, default off; registry position: at the END of the list
  distanceLod: 'off',   // frenchie (3-LOD): new option, default off; registry position: at the END of the list
  dryStreaks: false,   // frenchie (10-31 dryStreaks): new option, default off; registry position: at the END of the list
  heatShimmer: 'off',   // frenchie (10-31 heatShimmer): new option, default off; registry position: at the END of the list
  signalConesOn: false,   // frenchie (10-31 signalConesOn): new option, default off; registry position: at the END of the list
  trafficLighting: 'off',   // frenchie (10-31 trafficLighting): preset option, default off; registry position: at the END of the list
  roadSurfaces: false,   // frenchie (11-04, Anya item 4): new option default off
  roadSurface: 'stock',   // frenchie (11-04): new option default stock
  wetBouncePlane: false,   // frenchie (11-05 crest Ladder A, Anya ruling 7edc): local-road-plane bounce mirror, new option, default off (registry position: before wetBounce, at the END of the list)
  wetBounce: false,   // frenchie (11-01 wetBounce, 4-O): own-beam road bounce, default off; registry position: at the END of the list
  haloConeEqui: 'off',   // frenchie (11-06 B6): cone-clipped equiangular oncoming halo, default off; registry position: at the END of the list
  endlessDetails: false,   // top 11-10 (endless road details panel, display-only): new option, default off
  cabinGaugeLight: 'off',   // claude (11-08, Anya: photo NA Miata cabin): gauge backlight, new option, default off; registry position: at the END of the list
  cabinZoom: 1,   // claude (11-08, Anya: debug zoom for the photo cabin): multiplies the view-angle zoom, default 1 = neutral; registry position: at the END of the list
  cabinOffsetX: 0,   // claude (11-08, Anya: hand placement of the photo cabin), default 0; registry position: at the END of the list
  cabinOffsetY: 0,   // claude (11-08), default 0; registry position: at the END of the list
};

// ---- 1. DV_DEF equality
const gen = Opt.defaults();
ok('frozen copy key count tracks the live registry profile count (glm5.2 T10-F4: derived, not hand-bumped; fails if a profile option is added without extending FROZEN_OLD_DV_DEF)',
  Object.keys(FROZEN_OLD_DV_DEF).length === Opt.OPTIONS.filter((e) => e.kind === 'profile').length, Object.keys(FROZEN_OLD_DV_DEF).length + ' vs live ' + Opt.OPTIONS.filter((e) => e.kind === 'profile').length);
let equal = true, why = null;
try { assert.deepStrictEqual(gen, FROZEN_OLD_DV_DEF); } catch (e) { equal = false; why = String(e.message).split('\n').slice(0, 12).join(' | '); }
ok('generated defaults deep-equal the old DV_DEF (values and types)', equal, why);
ok('same key order as the old literal (saved JSON keeps its order)', JSON.stringify(Object.keys(gen)) === JSON.stringify(Object.keys(FROZEN_OLD_DV_DEF)));
const typeDiff = Object.keys(FROZEN_OLD_DV_DEF).filter((k) => typeof gen[k] !== typeof FROZEN_OLD_DV_DEF[k] || (gen[k] === null) !== (FROZEN_OLD_DV_DEF[k] === null));
ok('string/number/null types preserved (samples "1", trafficLightRange "250", visibility null)', typeDiff.length === 0 && gen.samples === '1' && gen.trafficLightRange === '250' && gen.trafficNearest === '8' && gen.visibility === null, typeDiff);
const g1 = Opt.defaults(), g2 = Opt.defaults();
ok('each defaults() call returns its own trafficOutIds array', g1.trafficOutIds !== g2.trafficOutIds && Array.isArray(g1.trafficOutIds));
const profileIds = Opt.OPTIONS.filter((e) => e.kind === 'profile').map((e) => e.id);
ok('DV_DEF keys are exactly the kind "profile" entries', JSON.stringify(profileIds) === JSON.stringify(Object.keys(gen)));
const notDV = Opt.OPTIONS.filter((e) => e.kind !== 'profile');
ok('extra, derived, session and game entries are NOT in DV_DEF', notDV.every((e) => !(e.id in gen)) && notDV.length >= 10, notDV.map((e) => e.id + ':' + e.kind));
ok('the shipped spec-ui.js builds DV_DEF from the registry, no literal left', /const DV_DEF = RF\.Options\.defaults\(\);/.test(read('js/spec-ui.js')) && !/const DV_DEF = \{/.test(read('js/spec-ui.js')));
ok('index.html loads the registry before spec-ui.js and drive.js', read('index.html').indexOf('js/options-registry.js') > 0 && read('index.html').indexOf('js/options-registry.js') < read('index.html').indexOf('js/spec-ui.js') && read('index.html').indexOf('js/options-registry.js') < read('index.html').indexOf('js/drive.js'));

// ---- 2. well-formed entries
const KINDS = ['profile', 'extra', 'derived', 'session', 'game'], TYPES = ['bool', 'enum', 'int', 'number', 'text', 'list'];
const COSTS = ['free', 'per-frame-gpu', 'table-rebuild', 'scene-regenerate', 'recompile', 'renderer-swap', 'cpu-still', 'worker'];
const WHERE = ['toolbar', 'more', 'air-advanced', 'halo-advanced', 'sidebar', 'none'], EFFECTS = ['hidden', 'disabled', 'tooltip', 'none'];
const ids = Opt.OPTIONS.map((e) => e.id);
ok('ids are unique', new Set(ids).size === ids.length);
ok('kind, type, cost, where, group are all from the allowed lists', Opt.OPTIONS.every((e) => KINDS.includes(e.kind) && TYPES.includes(e.type) && COSTS.includes(e.cost) && WHERE.includes(e.where) && Opt.GROUPS[e.group]), Opt.OPTIONS.filter((e) => !(KINDS.includes(e.kind) && TYPES.includes(e.type) && COSTS.includes(e.cost) && WHERE.includes(e.where) && Opt.GROUPS[e.group])).map((e) => e.id));
const enumBad = Opt.OPTIONS.filter((e) => e.kind === 'profile' && e.type === 'enum' && !(Array.isArray(e.values) && e.values.some((v) => JSON.stringify(v) === JSON.stringify(e.default)))).map((e) => e.id);
ok('every profile enum lists its own default among the allowed values', enumBad.length === 0, enumBad);
const rangeBad = Opt.OPTIONS.filter((e) => e.kind === 'profile' && (e.type === 'number' || e.type === 'int') && e.values && (e.default < e.values.min || e.default > e.values.max)).map((e) => e.id);
ok('every ranged number default is inside its range', rangeBad.length === 0, rangeBad);
ok('derived/session/game entries have no stored default except session "high"', Opt.OPTIONS.filter((e) => e.kind === 'derived' || e.kind === 'game' || e.kind === 'extra').every((e) => e.default === undefined));
const bundleBad = Opt.OPTIONS.filter((e) => e.bundle && e.bundle.some((b) => !(b in Opt.byId)));
ok('every bundle member is a declared option', bundleBad.length === 0 && Opt.OPTIONS.filter((e) => e.bundle).length === 3, bundleBad.map((e) => e.id));

// ---- rules: shape, referenced options, and the cited code location
const ruleNames = Object.keys(Opt.RULES);
const condOpts = (c) => c.any ? [].concat(...c.any.map(condOpts)) : c.all ? [].concat(...c.all.map(condOpts)) : c.ctx ? [] : [c.opt].concat(c.legacy ? [c.legacy] : []);
const used = new Set();
for (const e of Opt.OPTIONS) for (const k of ['requires', 'ignoredWhen', 'conflicts']) for (const r of e[k] || []) used.add(r.rule);
ok('every rule is used by at least one option', ruleNames.every((r) => used.has(r)), ruleNames.filter((r) => !used.has(r)));
// the reverse (a need() names a rule RULES does not define) once made unmet() throw for 16 options: need('tiles')/'endlessRoad'/'cabinView'
// named rules absent from RULES, so holds(undefined,...) threw TypeError. Every used rule name must resolve.
const missingRule = [];
for (const r of used) if (!(r in Opt.RULES)) missingRule.push(r);
ok('every need()/ignoredWhen()/conflicts rule name is defined in RULES (unmet() must not throw)', missingRule.length === 0, missingRule);
// positive control: the 13 options that used to throw now resolve under the default profile without error
const fixedOpts = ['endlessPreset','endlessPresetCustom','tileTerrain','multilaneRoad','endlessTunnel','endlessCrossing','junctionGantries','driftMode','driftDynamics','driftAfs','yawSmooth','cabinStyle','driftCabin'];
const threw = [];
for (const id of fixedOpts) { try { Opt.unmet(id, Object.assign({}, gen)); } catch (e) { threw.push(id + ': ' + e.message); } }
ok('unmet() resolves every prototype endless/drift/cabin option without throwing (the need(tiles/endlessRoad/cabinView) fix)', threw.length === 0, threw);
// the runtime guard (rule 15): need() itself throws a NAMED error on an unknown rule name, so a future typo fails
// at module load with the bad name in the message, not a misleading TypeError deep in unmet()/holds(). Positive
// control: a registry copy with a bad need('typoRuleXYZ') must throw naming that rule.
const guardProbe = path.join(os.tmpdir(), 'need-guard-probe.js');
fs.writeFileSync(guardProbe, read('js/options-registry.js').replace("requires: [need('symmetricOncoming')]", "requires: [need('typoRuleXYZ')]"));
let guardMsg = null;
try { require(guardProbe); } catch (e) { guardMsg = e.message; }
fs.unlinkSync(guardProbe);
ok('need() throws a named error on an unknown rule (rule 15 loud failure)', /unknown rule .typoRuleXYZ./.test(guardMsg), guardMsg);
const unknownOpt = [];
for (const [name, r] of Object.entries(Opt.RULES)) for (const o of condOpts(r.cond)) if (!(o in Opt.byId)) unknownOpt.push(name + '->' + o);
ok('rule conditions only name declared options', unknownOpt.length === 0, unknownOpt);
ok('every rule has a plain reason and a known UI effect', ruleNames.every((r) => typeof Opt.RULES[r].why === 'string' && Opt.RULES[r].why.length > 8 && EFFECTS.includes(Opt.RULES[r].effect)));
// Rule citations: the snippet must exist in the cited file, and it must resolve to exactly ONE line — the occurrence
// nearest the cited line, by absolute line distance; an equidistant pair is a tie and fails loudly, because a citation
// that cannot resolve to one line is the false-green case. The cited line is DOCUMENTATION: drift is reported, never
// blocking (cyrus 11-11, gate-red triage: the old ±120-line window was a tripwire — 5 of 43 citations sat 3-8 lines
// from its edge, so an unrelated +10-line patch reddened this suite. 12 of the 43 snippets repeat in their own file —
// a common idiom being cited — and every one of them still resolves uniquely.)
const staleCite = [], ambiguousCite = [], citeDrift = [];
for (const [name, r] of Object.entries(Opt.RULES)) {
  const f = path.join(ROOT, r.at.file);
  if (!fs.existsSync(f)) { staleCite.push(name + ': no file ' + r.at.file); continue; }
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(r.at.fn)) hits.push(i + 1);
  if (hits.length === 0) { staleCite.push(name + ': "' + r.at.fn + '" not found in ' + r.at.file); continue; }
  let best = hits[0], bestD = Math.abs(hits[0] - r.at.line), tie = false;
  for (const h of hits.slice(1)) {
    const d = Math.abs(h - r.at.line);
    if (d < bestD) { best = h; bestD = d; tie = false; }
    else if (d === bestD) tie = true;   // equidistant twin: the citation cannot resolve to one line
  }
  if (tie) {
    const twins = hits.filter((h) => Math.abs(h - r.at.line) === bestD);
    ambiguousCite.push(name + ': "' + r.at.fn + '" occurs at ' + twins.join(' and ') + ' in ' + r.at.file + ' — equidistant from the cited line ' + r.at.line);
    continue;
  }
  const drift = best - r.at.line;
  if (drift !== 0) citeDrift.push(name + ': resolved to ' + best + ', cited ' + r.at.line + ', drift ' + (drift > 0 ? '+' : '') + drift + (hits.length > 1 ? ' (' + hits.length + ' occurrences of the snippet in the file)' : ''));
}
ok('every rule citation (file, snippet) points at code that exists', staleCite.length === 0, staleCite);
ok('every rule citation resolves to exactly one line (no equidistant twin)', ambiguousCite.length === 0, ambiguousCite);
if (citeDrift.length) {
  console.log('[INFO] rule citations whose cited line has drifted from the resolved line (' + citeDrift.length + ' of ' + Object.keys(Opt.RULES).length + ') — drift is documentation, not a failure:');
  for (const d of citeDrift) console.log('[INFO]   ' + d);
}
// unmet() under the default profile: a few facts the OPTIONS.md inventory states
const U = (id, o, ctx) => Opt.unmet(id, Object.assign({}, gen, o || {}), ctx || { renderer: 'gpu', preset: 'us' }).map((x) => x.rule);
ok('unmet(): with clear air the beam and halo controls report "air"', U('scatterRes').includes('air') && U('trafficHalo').includes('air') && U('haloGain').includes('air') && !U('visibility').length);
ok('unmet(): table-only options report tableMode until scatterMode is table', U('scatterBlur', { visibility: 200 }).join() === 'tableMode' && U('scatterBlur', { visibility: 200, scatterMode: 'table' }).length === 0);
ok('unmet(): trafficHalo is a silent no-op without traffic beams (H6)', U('trafficHalo', { visibility: 200 }).join() === 'trafficBeamsOn' && U('trafficHalo', { visibility: 200, trafficBeams: true }).length === 0);
ok('unmet(): the pass makes air beam, halo and people options "ignored" (H4)', U('scatter', { visibility: 200, mountainPass: true }).includes('mountainPassAir') && U('people', { mountainPass: true }).includes('mountainPassPeople'));
ok('unmet(): wet options need a wet road (legacy wet flag counts)', U('wetSheen').join() === 'wetOn' && U('wetSheen', { wet: true }).length === 0 && U('wetSheen', { wetness: 0.4 }).length === 0 && U('wetModel', { wetness: 1 }).join() === 'wetSheenOn');
ok('unmet(): safeGap conflicts with traffic logic; cline needs the US preset', U('safeGap', { trafficLogic: true }).join() === 'trafficLogicOn' && U('cline', {}, { renderer: 'gpu', preset: 'ece' }).join() === 'usRoad' && U('cline').length === 0);
ok('unmet(): seed and density follow the scenery rules in drive-anim labels()', U('seed', { wild: false, tiles: false }).join() === 'seedUsed' && U('seed', { wild: true, tiles: false }).length === 0 && U('density', { wild: false, tiles: true }).join() === 'densityUsed');

// ---- controls, owners, tests, query
const animSrc = read('js/drive-anim.js'), specSrc = read('js/spec-ui.js');
const ctlBad = [];
for (const e of Opt.OPTIONS) {
  for (const m of String(e.control).matchAll(/\[data-(dv|anim)="([^"]+)"/g)) {
    const name = m[2], src = m[1] === 'dv' ? specSrc : animSrc;
    if (name.startsWith('c-')) { if (!new RegExp("\\['" + name.slice(2) + "',").test(animSrc)) ctlBad.push(e.id + ' ' + name); }
    else if (!(src.includes("'" + name + "'") || src.includes('"' + name + '"') || src.includes("'" + name.replace(/-./g, (s) => s[1].toUpperCase()) + "'"))) ctlBad.push(e.id + ' ' + name);
  }
  if (e.control === 'none' && e.where !== 'none') ctlBad.push(e.id + ' where without control');
}
ok('every cited control id exists in the source that builds it', ctlBad.length === 0, ctlBad);
const ownBad = Opt.OPTIONS.filter((e) => e.owner.some((f) => !fs.existsSync(path.join(ROOT, f)))).map((e) => e.id);
ok('every owner file exists', ownBad.length === 0, ownBad);
const testBad = [];
for (const e of Opt.OPTIONS) for (const t of e.tests) {
  const f = t.startsWith('node:') ? 'tests/' + t.slice(5) + '.js' : 'tests/regress/' + t + '.js';
  if (!fs.existsSync(path.join(ROOT, f))) testBad.push(e.id + ' ' + t);
}
ok('every named test file exists', testBad.length === 0, testBad);
ok('only haloBins has a URL parameter, and the code reads it', Opt.OPTIONS.filter((e) => e.query).map((e) => e.id).join() === 'haloBins' && /halobins/.test(read('js/drive-three-halo.js')));

// ---- default history
const histBad = [];
for (const e of Opt.OPTIONS) if (e.defaultHistory) {
  const h = e.defaultHistory, last = h[h.length - 1];
  if (e.kind !== 'profile') histBad.push(e.id + ' not a profile option');
  if (JSON.stringify(last.value) !== JSON.stringify(e.default)) histBad.push(e.id + ' last history value is not the default');
  if (h.some((x, i) => i && JSON.stringify(x.value) === JSON.stringify(h[i - 1].value))) histBad.push(e.id + ' repeats a value');
  if (h.some((x, i) => i && x.since < h[i - 1].since) || h.some((x) => x.since > Opt.DEFAULTS_VERSION)) histBad.push(e.id + ' since order/version');
}
ok('default histories end at the current default and are ordered', histBad.length === 0, histBad);
ok('DEFAULTS_VERSION is an integer >= 1', Number.isInteger(Opt.DEFAULTS_VERSION) && Opt.DEFAULTS_VERSION >= 1);

// PIN: the test control behind tests/pinned-defaults.js. A pinned value wins for the options it lists, other options keep their
// live default, an unknown key is ignored, and the pin covers only registry ids (so a typo there cannot pin nothing silently).
{
  const live = Opt.defaults(), file = read('tests/pinned-defaults.js'), m = /SL_PINNED_DEFAULTS = (\{[\s\S]*\});/.exec(file), pinned = m ? JSON.parse(m[1]) : null;
  globalThis.SL_PINNED_DEFAULTS = { haloGain: 4, notAnOption: 1 }; const withPin = Opt.defaults(); delete globalThis.SL_PINNED_DEFAULTS;
  ok('PIN: a pinned value replaces the default; other options keep theirs; unknown keys are ignored', withPin.haloGain === 4 && !('notAnOption' in withPin) && JSON.stringify({ ...withPin, haloGain: live.haloGain }) === JSON.stringify(live), { haloGain: withPin.haloGain });
  ok('PIN: defaults() is unchanged once the pin is removed', JSON.stringify(Opt.defaults()) === JSON.stringify(live));
  const unknown = pinned ? Object.keys(pinned).filter((k) => !Opt.byId[k] || Opt.byId[k].kind !== 'profile') : ['(file did not parse)'];
  ok('PIN: tests/pinned-defaults.js parses and lists only profile options of the registry', !!pinned && unknown.length === 0, unknown);
}

console.log(fails ? fails + ' of ' + n + ' options-registry checks FAILED' : 'all ' + n + ' options-registry checks passed');
process.exit(fails ? 1 : 0);
