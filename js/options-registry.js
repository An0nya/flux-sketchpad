/* options-registry.js: the one declared list of the drive view's options.

   What it is: plain data (one entry per option) plus a few pure functions. It has no dependencies and touches no DOM, so it
   loads first in index.html, in the Node test loader (tests/load.js), and through require().

   What it replaces: the hand-written DV_DEF literal in spec-ui.js. DV_DEF is now RF.Options.defaults(), and a test
   (tests/options-registry.js) holds a frozen copy of the old literal and checks the two are identical.

   Adding an option: add one entry below (id, type, values, default, label, control, group, cost, owner, tests), plus
   `requires` / `ignoredWhen` / `conflicts` if it depends on another option. Then run
   `node docs/inventory/scripts/gen-options-docs.js` to refresh docs/inventory/OPTIONS.md and GROUPS.md.
   If you change a default, add a defaultHistory entry and bump DEFAULTS_VERSION (see "Changing a default" below).

   Entry fields
     id, kind        kind: profile (saved, in DV_DEF) | extra (saved, absent from DV_DEF until first written) |
                     derived (never stored; computed from other options) | session (not saved) | game (overlay, never saved)
     type, values    bool | enum | int | number | text | list. values: the allowed list for enums, {min, max, step} for numbers.
     default         the value in DV_DEF (undefined for extra, derived and game entries)
     label           the words on the control, for people and docs
     control, where  the existing selector (tracing only; nothing reads it at run time) and where it sits today:
                     toolbar | more | air-advanced | halo-advanced | sidebar | none
     query           a URL parameter that sets it (only ?halobins today; the app has no generic ?option=value)
     group           the proposed group (docs/inventory/GROUPS.md); today's UI does not use it
     cost            what changing it costs: free | per-frame-gpu | table-rebuild | scene-regenerate | recompile | renderer-swap |
                     cpu-still | worker
     owner           the files that implement it (seeded from tools: docs/inventory/scripts/options-scan.js; approximate)
     requires        what must hold for the option to do anything. ignoredWhen: situations where the stored value is ignored.
                     conflicts: situations where the control is disabled. Each is a need('name') from RULES below, which carries
                     the condition, the plain reason, how the UI shows it today (effect) and where the code enforces it (at).
     defaultHistory  the defaults this option has had, oldest first (see below)
     tests           the curated-gate tests that set it (names as in tests/gate.js; node: prefix = a Node test)

   Changing a default (the frozen-defaults fix, HAZARDS H2)
     setDV saves the whole options object, so every key is frozen into a saved profile at its first save. To let a changed
     default reach those profiles: add { since: N, value } to the entry's defaultHistory, set DEFAULTS_VERSION to N, and
     set `default` to the new value. On load, a profile saved before version N takes the new default for each key whose saved
     value equals the superseded default. A value that matches no earlier default is the user's choice and is kept. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // Options removed from the build. A saved profile may still hold them; load drops the key so a stale value can never matter (Brief U:
  // glareSources = every source now glares; lampHalos = the lamp-halo sprite is gone, the lamp cone is the only street-lamp haze).
  const RETIRED_KEYS = ['glareSources', 'lampHalos'];
  const DEFAULTS_VERSION = 3;   // the defaults generation this build writes into a saved profile (profile.defaultsVersion)

  // A profile saved before versioning holds every key that existed when it was saved, because setDV wrote the whole object.
  // These are the 18 keys of the first release (commit e323553); a profile that has them all is such a whole-object save.
  // A short profile (a hand-written or test seed) is not a snapshot of old defaults, so its values are always kept.
  const LEGACY_SIGNATURE = ['scene', 'wet', 'expMode', 'ev', 'glare', 'people', 'animals', 'signs', 'oncoming', 'preceding',
    'onDist', 'preDist', 'onKcd', 'RL', 'ambient', 'smooth', 'res', 'fov'];

  // ---- where the code enforces a rule (file, a snippet to search for, approximate line at main 251f801)
  const SPEC = 'js/spec-ui.js', ANIM = 'js/drive-anim.js', DRIVE = 'js/drive.js', THREE = 'js/drive-three.js', TOUGE = 'js/drive-touge.js';

  // ---- the shared rules. A condition is { opt, eq | ne | gt | in } on an option value, { ctx, eq } on the render context
  // (renderer: 'gpu' | 'cpu', preset: 'us' | 'ece'), or { any: [...] } / { all: [...] }. Missing eq/ne/gt/in means "truthy".
  // effect = what the UI does today when the rule is not met: hidden | disabled | tooltip | none (silent no-op).
  const RULES = {
    air: { cond: { opt: 'visibility', ne: null }, why: 'needs air: visibility must not be clear', effect: 'hidden',
      at: { file: SPEC, fn: 'visIndex(o.visibility) === 0', line: 1030 } },
    tableMode: { cond: { opt: 'scatterMode', eq: 'table' }, why: 'table mode only (air beam method = table)', effect: 'disabled',
      at: { file: SPEC, fn: "o.scatterMode !== 'table'", line: 1038 } },
    tableModeHidden: { cond: { opt: 'scatterMode', eq: 'table' }, why: 'table mode only (air beam method = table)', effect: 'hidden',
      at: { file: SPEC, fn: "o.scatterMode !== 'table'", line: 1047 } },
    tableModeTip: { cond: { opt: 'scatterMode', eq: 'table' }, why: 'multiplies the table lookup, which only exists in table mode', effect: 'none',
      at: { file: ANIM, fn: 'Air beam gain (table mode)', line: 1657 } },
    cacheOn: { cond: { opt: 'scatterCache', eq: 'on' }, why: 'needs the beam cache on', effect: 'disabled',
      at: { file: SPEC, fn: "o.scatterCache !== 'on'", line: 1049 } },
    cycle8: { cond: { opt: 'scatterCycle', eq: 8 }, why: 'shown with the beam cycle at 8', effect: 'hidden',
      at: { file: SPEC, fn: "k === 'scatterCycleFade'", line: 1050 } },
    trafficBeamsOn: { cond: { opt: 'trafficBeams', eq: true }, why: 'the halo is lit by traffic beams; with them off it is a silent no-op', effect: 'none',
      at: { file: DRIVE, fn: 'function haloN', line: 819 } },
    haloOn: { cond: { opt: 'trafficHalo', gt: 0 }, why: 'there is no halo to modify while traffic halo is off', effect: 'none',
      at: { file: DRIVE, fn: 'function haloN', line: 819 } },
    coneOn: { cond: { any: [{ opt: 'lampCone', eq: 'on' }, { all: [{ opt: 'lampCone', ne: 'off' }, { opt: 'streetLamps', ne: 'off' }, { opt: 'visibility', ne: null }] }] }, why: 'the cone gain only scales the lamp cone (lampCone on, or auto with street lamps on and a visibility set)', effect: 'hidden',
      at: { file: SPEC, fn: 'RF.Drive.lampConeOn(o)', line: 1033 } },
    powerlinesOn: { cond: { opt: 'powerlines', eq: 'on' }, why: 'the wire reflectance only changes the power wires (powerlines on; the open-road wild chunk and the pass build them only then)', effect: 'hidden',
      at: { file: TOUGE, fn: "flags.powerlines === 'on'", line: 119 } },
    trafficBeamsLight: { cond: { opt: 'trafficBeams', eq: true }, why: 'road light from other cars only exists with traffic beams on', effect: 'none',
      at: { file: ANIM, fn: 'const lightRangeOf', line: 23 } },
    symmetricOncoming: { cond: { all: [{ opt: 'onMode', in: ['symmetric', 'high-dip'] }, { opt: 'oncoming', eq: true }] }, why: 'symmetric or high-then-dip oncoming traffic only', effect: 'tooltip',
      at: { file: ANIM, fn: 'Symmetric and high-then-dip traffic', line: 1536 } },
    shuffleLibrary: { cond: { opt: 'trafficShuffle', eq: 'library' }, why: 'only read when traffic beams come from the library', effect: 'none',
      at: { file: ANIM, fn: "o.trafficShuffle !== 'library'", line: 1541 } },
    manualMode: { cond: { opt: 'onMode', eq: 'manual' }, why: 'manual oncoming mode only', effect: 'none',
      at: { file: SPEC, fn: 'Manual mode only', line: 601 } },
    wetOn: { cond: { opt: 'wetness', gt: 0, legacy: 'wet' }, why: 'needs a damp or wet road', effect: 'disabled',
      at: { file: SPEC, fn: 'wetnessOf(o) > 0', line: 1025 } },
    wetSheenOn: { cond: { opt: 'wetSheen', eq: true }, why: 'needs wet sheen on', effect: 'disabled',
      at: { file: SPEC, fn: 'o.wetSheen)', line: 1026 } },
    gpu: { cond: { ctx: 'renderer', eq: 'gpu' }, why: 'GPU drive view only; the CPU renderer ignores it', effect: 'tooltip',
      at: { file: SPEC, fn: 'GPU drive view only', line: 938 } },
    cpuRenderer: { cond: { ctx: 'renderer', eq: 'cpu' }, why: 'the worker threads render the CPU view; the GPU view ignores them', effect: 'none',
      at: { file: ANIM, fn: 'const want = !V.three', line: 1264 } },
    tilesOn: { cond: { opt: 'tiles', eq: true }, why: 'needs route tiles on (the pass does not allow it)', effect: 'disabled',
      at: { file: ANIM, fn: '"tile-cache"]\').disabled = !o.tiles', line: 1880 } },
    tilesOrPass: { cond: { any: [{ opt: 'tiles', eq: true }, { opt: 'mountainPass', eq: true }] }, why: 'needs route tiles or the mountain pass', effect: 'disabled',
      at: { file: ANIM, fn: '"street-lamps"]\').disabled', line: 1881 } },
    lampsPresent: { cond: { all: [{ opt: 'streetLamps', ne: 'off' }, { any: [{ opt: 'tiles', eq: true }, { opt: 'mountainPass', eq: true }] }] }, why: 'needs street lamps in the scene (tiles or pass, lamps not off)', effect: 'none',
      at: { file: ANIM, fn: 'lamps: o.streetLamps', line: 57 } },
    lampDistUsed: { cond: { opt: 'streetLamps', ne: 'off' }, why: 'the table sizes the street lamps\' glare, the lamp cone and the road lamp light, so it matters only with street lamps on', effect: 'none',
      at: { file: THREE, fn: 'lampRoadOn.value', line: 275 } },
    usRoad: { cond: { ctx: 'preset', eq: 'us' }, why: 'US road preset only (the centre line differs)', effect: 'disabled',
      at: { file: ANIM, fn: 'cl.disabled = !I.us', line: 1888 } },
    seedUsed: { cond: { any: [{ all: [{ opt: 'wild', eq: true }, { opt: 'scene', eq: 'road' }] }, { opt: 'oncoming', eq: true }, { opt: 'preceding', eq: true }, { opt: 'tiles', eq: true },
      { all: [{ opt: 'leafyFoliage', eq: true }, { opt: 'scene', in: ['road', 'forest'] }] }] }, why: 'random scenery, traffic, tiles or leafy foliage must be present', effect: 'disabled',
      at: { file: ANIM, fn: '"seed"]\').disabled', line: 1886 } },
    densityUsed: { cond: { any: [{ all: [{ opt: 'wild', eq: true }, { opt: 'scene', eq: 'road' }] }, { all: [{ opt: 'leafyFoliage', eq: true }, { opt: 'scene', in: ['road', 'forest'] }] }] }, why: 'random road scenery or leafy foliage must be present', effect: 'disabled',
      at: { file: ANIM, fn: '"density"]\').disabled', line: 1887 } },
    peoplePresent: { cond: { opt: 'people', eq: true }, why: 'clothing only applies to pedestrians', effect: 'none',
      at: { file: 'js/drive-scenes.js', fn: 'ctx.reflectiveClothing', line: 102 } },
    dynResOn: { cond: { opt: 'dynamicResolution', eq: true }, why: 'used only while dynamic resolution is on', effect: 'none',
      at: { file: ANIM, fn: 'if (!o.dynamicResolution', line: 1011 } },
    trafficLogicOn: { cond: { opt: 'trafficLogic', eq: true }, why: 'the gap guard is part of the original traffic; traffic logic has its own spacing', effect: 'disabled',
      at: { file: ANIM, fn: '"gap"]\').disabled', line: 1879 } },
    mtBlockers: { cond: { any: [{ opt: 'mountainPass', eq: true }, { opt: 'trafficBeams', eq: true }, { opt: 'trafficShuffle', eq: 'library' }, { opt: 'surfaceSheen', eq: true },
      { opt: 'lampPitch', eq: true }, { opt: 'afs', eq: true }, { opt: 'corneringLamps', eq: true }] }, why: 'these options force a single thread (no error shown)', effect: 'none',
      at: { file: ANIM, fn: 'const want = !V.three', line: 1264 } },
    mountainPassScene: { cond: { opt: 'mountainPass', eq: true }, why: 'the pass overrides scene to road and wild to off', effect: 'none',
      at: { file: ANIM, fn: 'opts.mountainPass', line: 33 } },
    mountainPassAir: { cond: { opt: 'mountainPass', eq: true }, why: 'the pass air beam table still uses the flat basis (HAZARDS H4); the traffic halo now renders on the pass (TOUGE-ELEV B, per-car tilt)', effect: 'none',
      at: { file: THREE, fn: '!p.airHold', line: 297 } },
    polarAuto: { cond: { opt: 'haloPolar', eq: 'auto' }, why: 'only read when the lamp-centred table is on auto', effect: 'none',
      at: { file: 'js/drive-three-halo.js', fn: "pmode === 'auto'", line: 335 } },
    cullFast: { cond: { opt: 'scatterCull', eq: 'fast' }, why: 'only read when oncoming in-scatter culling is fast (exact never uses a threshold)', effect: 'none',
      at: { file: 'js/drive-three-halo.js', fn: "cullMode === 'fast'", line: 492 } },
    passHalo: { cond: { opt: 'mountainPass', eq: true }, why: 'mountain pass only: the occluder is the pass ribbon; on the flat road the option does nothing', effect: 'none',
      at: { file: THREE, fn: "p.look.crestOcclusion === 'on'", line: 378 } },
    mountainPassPeople: { cond: { opt: 'mountainPass', eq: true }, why: 'the pass builds no people', effect: 'none',
      at: { file: 'js/drive-scenes.js', fn: 'FEATURE_PRESETS', line: 172 } },
    cityScene: { cond: { opt: 'scene', eq: 'city' }, why: 'leafy foliage is ignored in the city', effect: 'none',
      at: { file: ANIM, fn: "name === 'road' || name === 'forest'", line: 35 } },
  };
  // need('air', { effect: 'tooltip' }) returns a copy of a rule, optionally with the UI effect overridden.
  const need = (name, over) => Object.assign({ rule: name }, RULES[name], over || {});

  // ---- the proposed groups (docs/inventory/GROUPS.md explains them)
  const GROUPS = {
    view: 'Camera and playback',
    road: 'Road and route',
    surface: 'Road surface',
    air: 'Fog and air beam',
    halo: 'Traffic halo',
    'street-lamps': 'Street lamps',
    traffic: 'Traffic',
    scenery: 'Scenery and objects',
    'own-lamp': 'Our lamp',
    exposure: 'Exposure and eye',
    performance: 'Speed and quality',
    diagnostics: 'Panels and layout',
    internal: 'Internal (no control)',
  };

  // ---- the options, in the order of the old DV_DEF literal (so a saved profile keeps the same key order)
  const OPTIONS = [
    // ---- profile options (in DV_DEF)
    {
      id: 'trafficShuffle', kind: 'profile', type: 'enum', values: ['off', 'library'],
      default: 'off', label: 'traffic beams source',
      control: '[data-anim="traffic-shuffle"]', where: 'more', query: null,
      group: 'traffic', cost: 'table-rebuild',
      owner: ['js/drive-anim.js'],
      requires: [need('symmetricOncoming')],
      tests: ['BA5-gpu-atlas', 'BT-traffic-beams', 'node:traffic-beams'],
      note: 'Falls back to the built-in beam when the pool is empty or longer than 16 on the GPU. In high-then-dip the pool is each car\'s low beam, and the atlas also holds the built-in low and high, so a pool over 14 falls back to the built-in low there.',
    },
    {
      id: 'trafficOutIds', kind: 'profile', type: 'list', values: null,
      default: [], label: 'beams left out of traffic',
      control: '[data-anim="traffic-beam-list"]', where: 'more', query: null,
      group: 'traffic', cost: 'table-rebuild',
      owner: ['js/drive-anim.js'],
      requires: [need('shuffleLibrary')],
      tests: ['node:traffic-beams'],
      note: 'List of saved-beam ids. The default [] is shared: defaults() returns a fresh copy.',
    },
    {
      id: 'playing', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'drive / pause',
      control: '[data-anim="play"]', where: 'toolbar', query: null,
      group: 'view', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['CD-controls-dedupe'],
      note: 'Mirrors S(ui).playing; read once when the animation state is created. A minigame pauses on entry and restores on exit.',
    },
    {
      id: 'scene', kind: 'profile', type: 'enum', values: ['road', 'forest', 'city', 'targets'],
      default: 'road', label: 'scene',
      control: '[data-dv="scene"]', where: 'toolbar', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      ignoredWhen: [need('mountainPassScene')],
      tests: ['CD-controls-dedupe', 'OV-scene-details', 'SB1-studs-everywhere'],
      note: '\'targets\' is a hidden scene. The select also offers \'__pass\', a UI-only value that sets mountainPass instead.',
    },
    {
      id: 'wet', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'wet (legacy mirror of wetness)',
      control: 'none', where: 'none', query: null,
      group: 'surface', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['CD-controls-dedupe', 'FG-fog', 'WT-wetness'],
      note: 'Legacy boolean kept for older readers; wetness wins when defined (RF.Drive.wetnessOf). drive-anim.js reads it raw for texture amplitude.',
    },
    {
      id: 'visibility', kind: 'profile', type: 'enum', values: [null, 3000, 1000, 200, 60],
      default: null, label: 'air visibility',
      control: '[data-dv="visibility"]', where: 'more', query: null,
      group: 'air', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive.js'],
      tests: [
        'FG-fog', 'SC-beam-scatter', 'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'node:fog', 'node:scatter', 'node:scatter-fade-gain', 'node:scatter-table', 'node:scatter-table-pace',
      ],
      note: 'null = clear. 3000 haze, 1000 mist, 200 fog, 60 dense. Everything in the air and halo families needs it.',
    },
    {
      id: 'scatter', kind: 'profile', type: 'enum', values: [0, 4, 8, 16, 32, 64],
      default: 0, label: 'air beam steps',
      control: '[data-dv="scatter"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive.js', 'js/drive-three.js'],
      requires: [need('air')],
      ignoredWhen: [need('mountainPassAir')],
      tests: ['SC-beam-scatter', 'SF-silhouette-fade', 'SF1-car-silhouette'],
      note: 'Direct mode 0/4/8/16, table mode 0/16/32/64.',
    },
    {
      id: 'trafficHalo', kind: 'profile', type: 'enum', values: [0, 4, 8, 16],
      default: 0, label: 'traffic halo',
      control: '[data-dv="trafficHalo"]', where: 'more', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/drive.js', 'js/spec-ui.js', 'js/drive-anim.js'],
      requires: [need('air'), need('trafficBeamsOn')],
      tests: [],
      note: 'haloN() is 0 unless trafficBeams, air and trafficHalo > 0 (silent no-op otherwise). GPU only.',
    },
    {
      id: 'lampCone', kind: 'profile', type: 'enum', values: ['auto', 'off', 'on'],
      default: 'auto', label: 'lamp cone (mist)',
      defaultHistory: [
        { since: 0, value: 'off', date: '2026-10-22', commit: '303d9be' },
        { since: 2, value: 'auto', date: '2026-10-27', commit: '00e6c83' },   // Brief U; 00e6c83 = the commit this change sits on (a commit cannot name itself)
      ],
      control: '[data-dv="lampCone"]', where: 'more', query: null,
      group: 'street-lamps', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js', 'js/drive-three-lampcone.js', 'js/drive-three.js'],
      requires: [need('gpu'), need('lampsPresent'), need('air')],
      tests: [],
      note: "GPU only; the CPU renderer ignores it. 'auto' (default, Brief U) = on whenever street lamps are on and visibility is set (RF.Drive.lampConeOn); 'off' and 'on' are the user's explicit choice. The cone is the only way street lamps light the haze (the lamp-halo sprite is gone). Clear air draws no cone. Single scattering off each street lamp, g 0.6 (assumption); no scene occlusion.",
    },
    {
      id: 'lampConeGain', kind: 'profile', type: 'enum', values: [0.25, 0.5, 1, 1.5, 2],
      default: 1, label: 'cone gain',
      control: '[data-dv="lampConeGain"]', where: 'more', query: null,
      group: 'street-lamps', cost: 'free',
      owner: ['js/spec-ui.js', 'js/drive-three-lampcone.js'],
      requires: [need('coneOn')],
      tests: ['LCM1-lamp-cone'],
      note: 'Brightness only: multiplies the cone scattered radiance (ground and object pass). Extinction and density are unchanged, so the haze stays the same thickness.',
    },
    {
      id: 'lampClass', kind: 'profile', type: 'enum', values: ['II', 'III', 'IV', 'V'],
      default: 'III', label: 'lamp class',
      control: '[data-dv="lampClass"]', where: 'more', query: null,
      group: 'street-lamps', cost: 'free',
      owner: ['js/drive-anim.js'],
      requires: [need('lampDistUsed')],
      tests: [],
      note: 'Sizes the street lamps\' glare (D.glareSources via lampEyeCd), the lamp cone and the road lamp light.',
    },
    {
      id: 'lampRoad', kind: 'profile', type: 'enum', values: ['off', 'table'],
      default: 'off', label: 'road lamp light',
      control: '[data-dv="lampRoad"]', where: 'more', query: null,
      group: 'street-lamps', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      requires: [need('lampsPresent')],
      tests: [],
      note: 'Uniform plus a 480-float table upload when on. CPU and GPU.',
    },
    {
      id: 'haloBins', kind: 'profile', type: 'enum', values: [4, 6, 8, 12, 16, 24, 32],
      default: 24, label: 'halo bins',
      control: '[data-dv="haloBins"]', where: 'halo-advanced', query: 'halobins',
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('haloOn')],
      tests: [],
      note: '?halobins=N seeds a module value that this stored key overrides at the first halo build.',
    },
    {
      id: 'haloDiv', kind: 'profile', type: 'enum', values: [0, 4, 2, 1.4],
      default: 0, label: 'halo table divisor',
      control: '[data-dv="haloDiv"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'table-rebuild',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('haloOn')],
      tests: [],
      note: '0 = auto.',
    },
    {
      id: 'haloPolar', kind: 'profile', type: 'enum', values: ['auto', 'off', 'merged', 'perlamp'],
      default: 'auto', label: 'halo polar',
      defaultHistory: [
        { since: 0, value: 'off', date: '2026-10-22', commit: '303d9be' },
        { since: 3, value: 'auto', date: '2026-10-26', commit: '0ccd43f' },   // SP; 0ccd43f = the commit this change sits on (a commit cannot name itself)
      ],
      control: '[data-dv="haloPolar"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('haloOn')],
      tests: ['node:scatter-cull', 'SP-polar-auto'],
      note: "auto (default since SP): the merged table while the nearest oncoming lamp is more than 12 m from the eye, faded out between 12 and 8 m (share = smoothstep(8, 12, d)), none inside 8 m; the table covers only an angle band about the beam's top edge, at the size set by haloPolarBand, and the screen volume carries every other angle. off / merged / perlamp are unchanged (whole circle, 512 x 64).",
    },
    {
      id: 'haloPolarBand', kind: 'profile', type: 'enum', values: ['64x16', '128x32', '512x64'],
      default: '128x32', label: 'auto polar table size',
      control: '[data-dv="haloPolarBand"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'table-rebuild',
      owner: ['js/spec-ui.js', 'js/drive-anim.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn'), need('polarAuto')],
      tests: ['SP-polar-auto'],
      note: 'Angles x radii of the lamp-centred table in haloPolar auto (the band, not the whole circle). 512x64 is the size of the whole-circle tables; the smaller sizes are the proposal. The owner picks by eye. Changing it rebuilds the polar targets.',
    },
    {
      id: 'haloPolarLamps', kind: 'profile', type: 'enum', values: [1, 2],
      default: 2, label: 'halo polar lamps',
      control: '[data-dv="haloPolarLamps"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('haloOn')],
      tests: [],
    },
    {
      id: 'haloGain', kind: 'profile', type: 'enum', values: [0.25, 0.5, 1, 2, 4],
      default: 1, label: 'halo gain',
      control: '[data-dv="haloGain"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'free',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('haloOn')],
      tests: [],
    },
    {
      id: 'crestOcclusion', kind: 'profile', type: 'enum', values: ['off', 'on'],
      default: 'off', label: 'crest occlusion',
      control: '[data-dv="crestOcclusion"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three.js', 'js/drive-three-halo.js', 'js/drive-touge-three.js'],
      requires: [need('gpu'), need('air'), need('haloOn'), need('passHalo')],
      tests: ['E2-crest-occlusion'],
      note: "GPU only, mountain pass only. A crest or cliff between an oncoming car and the air in front of us hides that car's in-scatter: the traffic-halo table pass (drive-three-halo.js) tests 3 points along each lamp-to-sample line against a top-down height map of the pass ribbon (drive-touge-three.js heightMap, one 1024 x 1024 float depth target, redrawn when the ribbon moves). One sampler more in the table pass only; the off frame is byte-identical. Known limit: the map keeps one height per texel (the highest), so where a hairpin's bands overlap in xy the upper leg can wrongly shadow the lower one. Not applied to the air-beam table or the lamp cone.",
    },
    {
      id: 'haloJitter', kind: 'profile', type: 'enum', values: ['off', 'interleaved', 'jittered'],
      default: 'off', label: 'halo sampling',
      control: '[data-dv="haloJitter"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['IL-halo-interleave'],
      note: "GPU only. 'interleaved': the traffic-halo table pass samples each step at one of four offsets by the cell's place in a 2 x 2 block, and the prefix pass merges them with a 3 x 3 tent (equal weight per phase). 'jittered': the same phase plus a fixed per-cell random fraction (jittered stratified sampling). Off compiles the old texts.",
    },
    {
      id: 'haloJitterAmount', kind: 'profile', type: 'number', values: { min: 0, max: 1, step: 0.05 },
      default: 1, label: 'halo jitter amount',
      control: '[data-anim="halo-jitter-amount"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'free',
      owner: ['js/drive-anim.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['IL-halo-interleave'],
      note: "Scales the per-cell noise of halo sampling 'jittered' (0 = the plain interleaved offsets, 1 = the whole quarter-step). A uniform: no recompile.",
    },
    {
      id: 'haloBlur', kind: 'profile', type: 'enum', values: ['auto', 'off', 'light', 'heavy'],
      default: 'auto', label: 'halo blur',
      control: '[data-dv="haloBlur"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['IL-halo-interleave'],
      note: 'Separable tent blur of the traffic-halo bin table before the prefix pass (rows inside each tile, then columns). auto = light when haloJitter is on, else off (off = the old frame). heavy also switches the sampling pattern to 4 x 4.',
    },
    {
      id: 'haloDepthBlur', kind: 'profile', type: 'enum', values: ['off', 'light', 'heavy'],
      default: 'off', label: 'halo depth blur',
      control: '[data-dv="haloDepthBlur"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['IL-halo-interleave'],
      note: 'Tent blur of each table cell over neighbouring depth slices (3 or 5), in the same bin blur pass as haloBlur, before the prefix pass. Never mixes rays; leaks a little light in depth.',
    },
    {
      id: 'haloAutoRange', kind: 'profile', type: 'enum', values: ['4-8', '2-4', '2-8', '1.4-2'],
      default: '4-8', label: 'halo table auto range',
      control: '[data-dv="haloAutoRange"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: [],
      note: "With haloDiv auto: the divisors the lamp-count rule picks between (<= 4 lamps in the table: the first; >= 6: the second; 5 keeps the last). The count includes lamps handed to the cone pass. '4-8' is the old rule.",
    },
    {
      id: 'haloNearSub', kind: 'profile', type: 'enum', values: [4, 2, 1],
      default: 4, label: 'halo near quality',
      control: '[data-dv="haloNearSub"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: [],
      note: 'Sub-passes per table draw for the nearest 4 oncoming lamps within 45 m (finer steps against shimmer). 4 = as before; each step down halves that cost.',
    },
    {
      id: 'haloConePass', kind: 'profile', type: 'enum', values: ['off', '1', '2'],
      default: 'off', label: 'cone pass',
      control: '[data-dv="haloConePass"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-halo.js', 'js/drive-three-beamcone.js', 'js/drive-three.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['CPSM-cone-shadow'],
      note: "GPU only. The nearest 1 or 2 oncoming lamps seen side-on leave the traffic-halo table and are marched per pixel along the part of each eye ray inside their beam's cone (drive-three-beamcone.js), ground and object layers. Hand-over by angle (haloConeAngle) with a 15 deg fade; the table keeps W * (1 - share). Off: no pass, the table is the old one.",
    },
    {
      id: 'haloConeAngle', kind: 'profile', type: 'number', values: { min: 0, max: 90, step: 1 },
      default: 30, label: 'cone pass angle',
      control: '[data-anim="halo-cone-angle"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'free',
      owner: ['js/drive-anim.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['CPSM-cone-shadow'],
      note: 'Degrees between an oncoming beam axis and the line to our eye above which the cone pass takes the lamp (full share 15 deg higher). 0 = the nearest lamps always go to the cone pass. No recompile.',
    },
    {
      id: 'trafficShadows', kind: 'profile', type: 'enum', values: ['off', '1', '2', '3', 'all'],
      default: 'off', label: 'traffic shadows',
      control: '[data-dv="trafficShadows"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-shadowmaps.js', 'js/drive-three-halo.js', 'js/drive-three.js', 'js/drive-touge-three.js'],
      requires: [need('gpu'), need('air'), need('haloOn'), need('passHalo')],
      tests: ['CPSM-cone-shadow'],
      note: "GPU only, mountain pass only. One depth map per oncoming car (nearest first, up to 8 for 'all'), rendered from the midpoint of its lamps along its beam, ribbon only (objects do not cast yet). The traffic-halo table and the cone pass skip air the map hides; with trafficShadowRoad on the ribbon's traffic lighting does too. One float target, maps stacked, distance / 5000.",
    },
    {
      id: 'shadowRes', kind: 'profile', type: 'enum', values: ['512x256', '1024x512', '2048x1024'],
      default: '1024x512', label: 'traffic shadow map size',
      control: '[data-dv="shadowRes"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-three-shadowmaps.js'],
      requires: [need('gpu'), need('air'), need('haloOn'), need('passHalo')],
      tests: ['CPSM-cone-shadow'],
      note: 'Texels per traffic shadow map. Only read with trafficShadows on.',
    },
    {
      id: 'trafficShadowRoad', kind: 'profile', type: 'enum', values: ['on', 'off'],
      default: 'on', label: 'traffic shadows on the road',
      control: '[data-dv="trafficShadowRoad"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'recompile',
      owner: ['js/spec-ui.js', 'js/drive-three.js', 'js/drive-three-shadowmaps.js'],
      requires: [need('gpu'), need('passHalo')],
      tests: ['CPSM-cone-shadow'],
      note: "With trafficShadows on: the ribbon's oncoming-lamp lighting reads the same maps (texel-centre ray against the fragment's plane, no acne). Ribbon only: the pass object program is at the 13-sampler cap. Off or maps off: the ribbon text is the old one.",
    },
    {
      id: 'scatterCull', kind: 'profile', type: 'enum', values: ['off', 'exact', 'fast'],
      default: 'exact', label: 'oncoming in-scatter culling',
      control: '[data-dv="scatterCull"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-anim.js', 'js/drive-three-halo.js', 'js/drive-three-halo-cull.js'],
      requires: [need('gpu'), need('air'), need('haloOn')],
      tests: ['node:scatter-cull', 'SCULL-scatter-cull'],
      note: "GPU only. Each oncoming lamp draws only the depth slices and table cells its beam can light, not the whole table. exact: the region where the shader's integrand can be non-zero (in front of the lamp, inside the beam's non-zero angles); the table is byte for byte what off makes, so it is the default. fast: exact, also dropping the air beyond a radius where the lamp's best-case contribution is under the threshold (scatterCullEps); changes the picture a little and costs less. The bound is one function (drive-three-halo-cull.js litBound) over a list of clips, so the shadow-map work adds a terrain clip as one entry.",
    },
    {
      id: 'scatterCullEps', kind: 'profile', type: 'number', values: { min: 1e-4, max: 100, step: 'log10 0.25' },
      default: 0.05, label: 'culling threshold (fast)',
      control: '[data-anim="scatter-cull-eps"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'free',
      owner: ['js/drive-anim.js', 'js/drive-three-halo.js'],
      requires: [need('gpu'), need('air'), need('haloOn'), need('cullFast')],
      tests: [],
      note: 'Log scale slider, 1e-4 to 100. In fast mode a lamp stops being drawn where its best case in-scatter per metre of ray (sigma x the largest phase value x the beam\'s peak candela / r^2 x exp(-sigma r)) is below this. Higher = a smaller drawn region, a bigger change to the picture. The starting value is a first guess from shots (reports/SC.md), for the owner to set by eye.',
    },
    {
      id: 'scatterRange', kind: 'profile', type: 'number', values: { min: 50, max: 400, step: 5 },
      default: 120, label: 'scatter range (m)',
      control: '[data-anim="scatter-range"]', where: 'halo-advanced', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: ['js/drive.js', 'js/drive-anim.js', 'js/drive-three-halo.js', 'js/drive-three-shaders.js', 'js/spec-ui.js'],
      requires: [need('air')],
      tests: ['node:scatter-range', 'SR-scatter-range'],
      note: 'Far limit, in metres, of every air-scatter integral and table lookup: the in-scatter sums (CPU drive.js inScatter, trafficHalo, the 12-bin table), the traffic halo table (its last edge and log step follow the range; the slice count stays haloBins), the flat and touge sky, and the shader lookups (a uniform, so the slider never recompiles). 120 is the old fixed value and is byte-identical to it. Above 120 the air past 120 m now carries light: a car 250 m out on a straight shows its beam in the haze. Costs table-pass time with the distance (see reports/SR.md).'
    },
    {
      id: 'scatterMode', kind: 'profile', type: 'enum', values: ['direct', 'table'],
      default: 'direct', label: 'air beam method',
      control: '[data-dv="scatterMode"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'recompile',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      requires: [need('air')],
      ignoredWhen: [need('mountainPassAir')],
      tests: [
        'SD-scatter-table', 'SE-table-pacing', 'SF-silhouette-fade', 'SF1-car-silhouette',
      ],
      note: 'Switching is a shader variant (program recompile).',
    },
    {
      id: 'scatterRes', kind: 'profile', type: 'enum', values: ['half', 'full', 'quarter'],
      default: 'half', label: 'beam res',
      control: '[data-dv="scatterRes"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('tableMode')],
      tests: ['SD-scatter-table', 'SE-table-pacing'],
    },
    {
      id: 'scatterBlur', kind: 'profile', type: 'enum', values: ['off', 'mid', 'strong'],
      default: 'off', label: 'beam blur',
      control: '[data-dv="scatterBlur"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('tableMode')],
      tests: ['SD-scatter-table'],
    },
    {
      id: 'scatterCache', kind: 'profile', type: 'enum', values: ['off', 'on'],
      default: 'off', label: 'beam cache',
      control: '[data-dv="scatterCache"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('tableMode')],
      tests: ['SD-scatter-table', 'SE-table-pacing', 'SF1-car-silhouette'],
    },
    {
      id: 'scatterCycle', kind: 'profile', type: 'enum', values: [0, 8],
      default: 0, label: 'beam cycle',
      control: '[data-dv="scatterCycle"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('tableMode'), need('cacheOn')],
      tests: ['SD-scatter-table', 'SE-table-pacing'],
      note: 'Debounced (cycleDebounced). Effective cycle = cache on and value 8.',
    },
    {
      id: 'scatterBinCounts', kind: 'profile', type: 'text', values: null,
      default: '', label: 'slice samples (debug)',
      control: '[data-dv="scatterBinCounts"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/drive-three.js', 'js/spec-ui.js'],
      requires: [need('air'), need('tableModeHidden')],
      tests: [],
      note: '12 comma-separated counts, or empty. A valid entry overrides the air beam level.',
    },
    {
      id: 'scatterQuality', kind: 'profile', type: 'enum', values: ['steps', 'baseline', 'low', 'medium', 'high', 'max'],
      default: 'steps', label: 'air beam quality (written by the air level)',
      control: 'none', where: 'none', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/drive-three.js', 'js/spec-ui.js'],
      requires: [need('air'), need('tableModeHidden')],
      tests: [],
      note: 'No control of its own; the air beam dropdown writes it (NE5).',
    },
    {
      id: 'scatterCycleFade', kind: 'profile', type: 'enum', values: ['off', 'on'],
      default: 'off', label: 'cycle blend',
      control: '[data-dv="scatterCycleFade"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'recompile',
      owner: ['js/drive-anim.js'],
      requires: [need('air'), need('tableMode'), need('cacheOn'), need('cycle8')],
      tests: ['TOUGE-AIR'],
      note: 'The second-bank samplers are declared in every flat table-mode program, even with the fade off. Since B10 (sampler packing, 2026-10-26) the pass programs declare them too and blend like the flat road.',
    },
    {
      id: 'scatterNearFade', kind: 'profile', type: 'enum', values: ['on', 'off'],
      default: 'on', label: 'near fade (legacy)',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'free',
      owner: ['js/spec-ui.js'],
      tests: [
        'SF-silhouette-fade', 'node:scatter-fade-gain', 'node:scatter-table', 'node:scatter-table-pace',
      ],
      note: 'Replaced by scatterNearFadeRange; a stored on/off is migrated to medium/off at load (SF2).',
    },
    {
      id: 'scatterNearFadeRange', kind: 'profile', type: 'enum', values: ['off', 'short', 'medium', 'long'],
      default: 'medium', label: 'beam near fade',
      control: '[data-dv="scatterNearFadeRange"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/spec-ui.js'],
      requires: [need('air'), need('tableMode')],
      tests: ['SE-table-pacing', 'SF-silhouette-fade', 'node:scatter-fade-gain'],
    },
    {
      id: 'scatterNearBias', kind: 'profile', type: 'enum', values: [0, 1],
      default: 0, label: 'near-eye sampling',
      control: '[data-dv="scatterNearBias"]', where: 'air-advanced', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: ['js/spec-ui.js', 'js/drive-three.js'],
      requires: [need('air'), need('tableModeHidden')],
      tests: [],
    },
    {
      id: 'scatterGain', kind: 'profile', type: 'number', values: { min: 0.25, max: 4, step: 'log2 0.25' },
      default: 1, label: 'air beam gain',
      control: '[data-anim="scatter-gain"]', where: 'halo-advanced', query: null,
      group: 'air', cost: 'free',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      requires: [need('tableModeTip')],
      tests: ['SF-silhouette-fade', 'node:scatter-fade-gain'],
      note: 'Log scale slider. Multiplies the table lookup only; sits in the advanced halo group though it belongs to the air beam.',
    },
    {
      id: 'wetSheen', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'wet sheen',
      control: '[data-dv="wetSheen"]', where: 'more', query: null,
      group: 'surface', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      requires: [need('wetOn')],
      tests: [
        'CD-controls-dedupe', 'FG-fog', 'WT-wetness', 'node:fog', 'node:regress-node', 'node:scatter', 'node:wet-ggx', 'node:wetness',
      ],
      note: 'Forces the non-CPU-ground path and zeroes tex.',
    },
    {
      id: 'wetModel', kind: 'profile', type: 'enum', values: ['legacy', 'ggx'],
      default: 'legacy', label: 'streak model',
      control: '[data-dv="wetModel"]', where: 'more', query: null,
      group: 'surface', cost: 'per-frame-gpu',
      owner: ['js/spec-ui.js'],
      requires: [need('wetOn'), need('wetSheenOn')],
      tests: [
        'WG-wet-ggx', 'node:fog', 'node:scatter', 'node:wetness',
      ],
    },
    {
      id: 'expMode', kind: 'profile', type: 'enum', values: ['fixed', 'auto', 'adapt'],
      default: 'fixed', label: 'exposure mode',
      control: '[data-dv="expMode"]', where: 'more', query: null,
      group: 'exposure', cost: 'cpu-still',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      tests: ['CD-controls-dedupe'],
      note: 'auto and adapt force the slow CPU still on every redraw.',
    },
    {
      id: 'ev', kind: 'profile', type: 'number', values: { min: -8, max: 10, step: 0.5 },
      default: 1, label: 'exposure value',
      control: '[data-dv="ev"], [data-dv="evm"], [data-dv="evp"]', where: 'more', query: null,
      group: 'exposure', cost: 'free',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      tests: ['CD-controls-dedupe'],
    },
    {
      id: 'glare', kind: 'profile', type: 'enum', values: ['off', 'dry-low', 'dry', 'rain'],
      default: 'off', label: 'glare',
      control: '[data-dv="glare"]', where: 'toolbar', query: null,
      group: 'exposure', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      defaultHistory: [
        { since: 0, value: 0.3, date: '2026-10-07', commit: 'e323553' },
        { since: 0, value: 'dry', date: '2026-10-15', commit: '3916cb9' },
        { since: 0, value: 'off', date: '2026-10-16', commit: 'adee7c0' },
      ],
      tests: ['CD-controls-dedupe'],
      note: 'Old numeric or boolean values are normalised by RF.Drive.glareLevel at load. Reduced-motion caps it.',
    },
    {
      id: 'onMode', kind: 'profile', type: 'enum', values: ['symmetric', 'generic', 'high', 'high-dip', 'manual'],
      default: 'symmetric', label: 'oncoming headlamps',
      control: '[data-dv="onMode"]', where: 'more', query: null,
      group: 'traffic', cost: 'free',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      tests: [
        'CD-controls-dedupe', 'node:beam-atlas', 'node:regress-node', 'node:tl-traffic-taper', 'node:traffic-beams',
      ],
      note: 'A stored profile with a non-default onKcd and no onMode loads as manual (D5 migration in dvOpts).',
    },
    {
      id: 'people', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'people',
      control: '[data-anim="c-people"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-scenes.js'],
      ignoredWhen: [need('mountainPassPeople')],
      tests: [
        'CD-controls-dedupe', 'FG-fog', 'WT-wetness', 'node:foliage', 'node:regress-node', 'node:scenery-params',
      ],
    },
    {
      id: 'animals', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'deer',
      control: '[data-anim="c-animals"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-scenes.js'],
      tests: ['CD-controls-dedupe', 'node:scenery-params'],
    },
    {
      id: 'signs', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'signs',
      control: '[data-anim="c-signs"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-scenes.js'],
      tests: ['CD-controls-dedupe', 'node:scenery-params'],
    },
    {
      id: 'reflectiveClothing', kind: 'profile', type: 'enum', values: ['none', 'mix', 'small', 'vest'],
      default: 'mix', label: 'reflective clothing',
      control: '[data-anim="reflective-clothing"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      requires: [need('peoplePresent')],
      defaultHistory: [
        { since: 0, value: 'off', date: '2026-10-22', commit: 'b38c628' },
        { since: 0, value: 'mix', date: '2026-10-22', commit: 'f52ed8a' },
      ],
      tests: [],
      note: 'Applied once in RF.Drive.kit person(); the junction crosser still ignores it (H8).',
    },
    {
      id: 'posts', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'posts',
      control: '[data-anim="c-posts"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: [],
    },
    {
      // POWERLINES (opt-in): wires between roadside poles on the open road. Off = no powerline objects, no random draws; scene byte-identical.
      id: 'powerlines', kind: 'profile', type: 'enum', values: ['off', 'on'],
      default: 'off', label: 'power lines',
      control: '[data-anim="powerlines"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-scenes.js', 'js/drive-anim.js', 'js/drive-touge.js'],
      tests: ['PL1-powerlines', 'PL2-powerlines-pass'],
    },
    {
      // POWERLINES: wire albedo (diffuse reflectance, tuning, not measured). materials(look) in js/drive.js reads it, so the CPU table and the GPU table both change at runtime.
      id: 'powerlineReflectance', kind: 'profile', type: 'number', values: { min: 0.02, max: 0.60, step: 0.01 },
      default: 0.22, label: 'wire reflectance',
      control: '[data-anim="powerline-reflectance"]', where: 'more', query: null,
      group: 'scenery', cost: 'free',
      owner: ['js/drive.js', 'js/drive-anim.js', 'js/spec-ui.js'],
      requires: [need('powerlinesOn')],
      tests: ['PL3-powerlines-reflectance'],
      note: 'Tuning value, not measured. Changes the wire material only: poles, road and the rest of the scene are unchanged.',
    },
    {
      id: 'veg', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'trees',
      control: '[data-anim="c-veg"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-scenes.js'],
      tests: ['node:foliage'],
    },
    {
      id: 'obstacle', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'crates',
      control: '[data-anim="c-obstacle"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-scenes.js', 'js/drive-anim.js'],
      tests: ['node:regress-node'],
    },
    {
      id: 'rpm', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'road studs',
      control: '[data-anim="c-rpm"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-scenes.js'],
      tests: ['SB1-studs-everywhere'],
      note: 'Studs on every scene, the pass included (SB1).',
    },
    {
      id: 'tex', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'road texture',
      control: 'none', where: 'none', query: null,
      group: 'surface', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'No control found. Read by drive-anim.js compose; zeroed by wetSheen.',
    },
    {
      id: 'wild', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'random scenery',
      control: 'none', where: 'none', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      ignoredWhen: [need('mountainPassScene')],
      tests: [],
      note: 'No control found. Read by the scene builder; forced off on the pass.',
    },
    {
      id: 'mt', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'threads',
      control: '[data-anim="c-mt"]', where: 'more', query: null,
      group: 'performance', cost: 'worker',
      owner: ['js/drive-anim.js'],
      requires: [need('cpuRenderer')],
      conflicts: [need('mtBlockers')],
      tests: [],
      note: 'Silently single thread when blocked (drive-anim.js want gate).',
    },
    {
      id: 'fitControls', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'fit controls',
      control: '[data-anim="fit-controls"]', where: 'more', query: null,
      group: 'diagnostics', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['CD-controls-dedupe', 'UX2-drive-ux'],
    },
    {
      id: 'largeCard', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'large scorecard',
      control: '[data-anim="large-card"]', where: 'more', query: null,
      group: 'diagnostics', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['UX2-drive-ux'],
    },
    {
      id: 'seed', kind: 'profile', type: 'int', values: { min: 0, max: 99999, step: 1 },
      default: 7, label: 'scenery seed',
      control: '[data-anim="seed"], [data-anim="dice"]', where: 'more', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      requires: [need('seedUsed')],
      tests: [],
    },
    {
      id: 'density', kind: 'profile', type: 'number', values: { min: 0.5, max: 3, step: 0.5 },
      default: 1.5, label: 'scenery density',
      control: '[data-anim="density"]', where: 'more', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      requires: [need('densityUsed')],
      tests: [],
      note: 'The pass still uses it for tree spacing even when the control is disabled.',
    },
    {
      id: 'trafficDensity', kind: 'profile', type: 'number', values: { min: 0, max: 3, step: 0.5 },
      default: 1, label: 'traffic density',
      control: '[data-anim="traffic-density"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['DC-drive-controls', 'node:regress-node'],
    },
    {
      id: 'trafficLogic', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'traffic logic',
      control: '[data-anim="traffic-logic"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'Rebuilds traffic state and changes the camera speed model.',
    },
    {
      id: 'safeGap', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'gap guard',
      control: '[data-anim="gap"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      conflicts: [need('trafficLogicOn')],
      tests: ['node:regress-node'],
      note: 'Disabled while traffic logic is on.',
    },
    {
      id: 'tiles', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'route tiles',
      control: '[data-anim="tiles"]', where: 'more', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-game.js', 'js/drive-touge.js'],
      defaultHistory: [
        { since: 0, value: false, date: '2026-10-15', commit: 'f628861' },
        { since: 0, value: true, date: '2026-10-18', commit: '0f9b62c' },
      ],
      tests: [],
      note: 'Animation only. Off is the original constant road.',
    },
    {
      id: 'tileCache', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'cache ground',
      control: '[data-anim="tile-cache"]', where: 'more', query: null,
      group: 'road', cost: 'free',
      owner: ['js/drive-anim.js'],
      requires: [need('tilesOn')],
      tests: [
        'node:fog', 'node:scatter', 'node:wet-ggx', 'node:wetness',
      ],
      note: 'Reuses ground samples across route tiles.',
    },
    {
      id: 'mountainPass', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'mountain pass (scene select)',
      control: '[data-dv="scene"] value __pass', where: 'toolbar', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['CD-controls-dedupe', 'SB1-studs-everywhere'],
      note: 'Prototype road. Elevation needs the GPU renderer; the CPU fallback is the flat road.',
    },
    {
      id: 'gpuRenderer', kind: 'profile', type: 'bool', values: null,
      default: true, label: 'GPU drive renderer',
      control: '[data-anim="gpu-renderer"]', where: 'more', query: null,
      group: 'performance', cost: 'renderer-swap',
      owner: ['js/drive-anim.js'],
      defaultHistory: [
        { since: 0, value: false, date: '2026-10-15', commit: '3425a24' },
        { since: 0, value: true, date: '2026-10-18', commit: '21695f3' },
      ],
      tests: ['BA5-gpu-atlas', 'BT-traffic-beams', 'TL2-traffic-light-range'],
      note: 'Off disables every GPU-only option at once.',
    },
    {
      id: 'trafficBeams', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'traffic beams',
      control: '[data-anim="traffic-beams"]', where: 'more', query: null,
      group: 'traffic', cost: 'recompile',
      owner: ['js/drive-anim.js', 'js/drive.js'],
      tests: [
        'BA5-gpu-atlas', 'BT-traffic-beams', 'node:tl-traffic-taper', 'node:traffic-beams',
      ],
      note: 'Per-frame GPU and a shader variant.',
    },
    {
      id: 'surfaceSheen', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'lit surface sheen',
      control: '[data-anim="surface-sheen"]', where: 'more', query: null,
      group: 'surface', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      tests: [],
    },
    {
      id: 'lampPitch', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'lamp pitch',
      control: '[data-anim="lamp-pitch"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      tests: ['SD-scatter-table'],
    },
    {
      id: 'afs', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'AFS',
      control: '[data-anim="afs"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      tests: ['SD-scatter-table'],
    },
    {
      id: 'corneringLamps', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'cornering lamps',
      control: '[data-anim="cornering-lamps"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      tests: [],
    },
    {
      id: 'fpsCounter', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'FPS badge',
      control: '[data-anim="fps-counter"]', where: 'more', query: null,
      group: 'diagnostics', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['FG-fog', 'UX2-drive-ux', 'node:regress-node'],
    },
    {
      id: 'sceneDetails', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'scene details panel',
      control: '[data-anim="scene-details"]', where: 'more', query: null,
      group: 'diagnostics', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['OV-scene-details'],
    },
    {
      id: 'debugTimings', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'debug timings',
      control: '[data-anim="debug-timings"]', where: 'more', query: null,
      group: 'diagnostics', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: ['UX2-drive-ux'],
    },
    {
      id: 'dynamicResolution', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'dynamic resolution',
      control: '[data-anim="dynamic-resolution"]', where: 'more', query: null,
      group: 'performance', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: [],
    },
    {
      id: 'frameTargetMs', kind: 'profile', type: 'int', values: null,
      default: 33, label: 'frame target (ms)',
      control: 'none', where: 'none', query: null,
      group: 'performance', cost: 'free',
      owner: ['js/drive-anim.js'],
      requires: [need('dynResOn')],
      tests: [],
      note: 'Derived from minFps (RF.DriveAnim.fpsSettings); the old stored ms is mapped to the nearest minFps at load.',
    },
    {
      id: 'streetLamps', kind: 'profile', type: 'enum', values: ['off', 'sodium', 'led'],
      default: 'sodium', label: 'street lamps',
      control: '[data-anim="street-lamps"]', where: 'more', query: null,
      group: 'street-lamps', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      requires: [need('tilesOrPass')],
      tests: ['PP-pass-parity', 'node:regress-node'],
    },
    {
      id: 'cline', kind: 'profile', type: 'enum', values: ['solid', 'broken'],
      default: 'solid', label: 'centre line',
      control: '[data-anim="cline"]', where: 'more', query: null,
      group: 'road', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      requires: [need('usRoad')],
      tests: [],
    },
    {
      id: 'speed', kind: 'profile', type: 'int', values: { min: 5, max: 130, step: 5 },
      default: 50, label: 'speed (km/h)',
      control: '[data-anim="speed"]', where: 'toolbar', query: null,
      group: 'view', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'Quiet writes (no redraw) from the slider.',
    },
    {
      id: 'oncoming', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'oncoming traffic',
      control: '[data-dv="oncoming"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      tests: [
        'BA5-gpu-atlas', 'BT-traffic-beams', 'CD-controls-dedupe', 'OV-scene-details', 'PM-pass-mesh', 'SF1-car-silhouette', 'node:beam-atlas', 'node:regress-node', 'node:traffic-beams',
      ],
    },
    {
      id: 'preceding', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'preceding traffic',
      control: '[data-dv="preceding"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      tests: [
        'BA5-gpu-atlas', 'BT-traffic-beams', 'CD-controls-dedupe', 'SF1-car-silhouette', 'node:regress-node',
      ],
    },
    {
      id: 'onDist', kind: 'profile', type: 'number', values: null,
      default: 80, label: 'oncoming distance (CPU still)',
      control: 'none', where: 'none', query: null,
      group: 'traffic', cost: 'cpu-still',
      owner: ['js/spec-ui.js'],
      tests: [],
      note: 'No control and no test found. Read only by the CPU still scene (spec-ui.js).',
    },
    {
      id: 'preDist', kind: 'profile', type: 'number', values: null,
      default: 50, label: 'preceding distance (CPU still)',
      control: 'none', where: 'none', query: null,
      group: 'traffic', cost: 'cpu-still',
      owner: ['js/spec-ui.js'],
      tests: [],
      note: 'No control and no test found. Read only by the CPU still scene (spec-ui.js).',
    },
    {
      id: 'onKcd', kind: 'profile', type: 'number', values: { min: 1, max: 500, step: 5 },
      default: 30, label: 'oncoming intensity (kcd)',
      control: 'Spec > Road sidebar row', where: 'sidebar', query: null,
      group: 'traffic', cost: 'free',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      requires: [need('manualMode')],
      tests: [],
      note: 'Still used to build the template car lamps when not manual.',
    },
    {
      id: 'RL', kind: 'profile', type: 'number', values: { min: 0, max: 1000, step: 10 },
      default: 200, label: 'marking reflectivity RL',
      control: 'Spec > Road sidebar row', where: 'sidebar', query: null,
      group: 'surface', cost: 'free',
      owner: ['js/spec-ui.js'],
      tests: [
        'node:fog', 'node:pass-parity', 'node:regress-node', 'node:scatter', 'node:traffic-beams', 'node:wetness',
      ],
    },
    {
      id: 'ambient', kind: 'profile', type: 'enum', values: [0, 0.2, 5],
      default: 0, label: 'ambient light (lx)',
      control: '[data-anim="ambient"]', where: 'more', query: null,
      group: 'exposure', cost: 'free',
      owner: ['js/drive-anim.js', 'js/spec-ui.js'],
      tests: [],
    },
    {
      id: 'smooth', kind: 'profile', type: 'enum', values: ['sharp', 'smooth', 'soft'],
      default: 'smooth', label: 'beam smoothing',
      control: 'Spec > Road sidebar row', where: 'sidebar', query: null,
      group: 'own-lamp', cost: 'cpu-still',
      owner: ['js/spec-ui.js'],
      tests: [],
      note: 'No test found.',
    },
    {
      id: 'res', kind: 'profile', type: 'int', values: null,
      default: 640, label: 'still picture width',
      control: 'none', where: 'none', query: null,
      group: 'road', cost: 'cpu-still',
      owner: ['js/spec-ui.js'],
      tests: [],
      note: 'Width of the CPU still picture (spec-ui.js drawDrive). No control found.',
    },
    {
      id: 'fov', kind: 'profile', type: 'enum', values: [30, 45, 60, 75, 90],
      default: 60, label: 'view angle',
      control: '[data-dv="fov"]', where: 'more', query: null,
      group: 'view', cost: 'free',
      owner: ['js/spec-ui.js', 'js/drive-anim.js'],
      tests: ['DC-drive-controls'],
    },
    {
      id: 'leafyFoliage', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'leafy foliage',
      control: '[data-anim="leafy-foliage"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      ignoredWhen: [need('mountainPassScene'), need('cityScene')],
      tests: ['node:foliage'],
      note: 'Ignored on the pass and in the city.',
    },
    {
      id: 'detailedModels', kind: 'profile', type: 'bool', values: null,
      default: false, label: 'detailed models',
      control: '[data-anim="detailed-models"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js', 'js/drive-three-objects.js'],
      tests: [
        'PM-pass-mesh', 'PP-pass-parity', 'node:pass-parity', 'node:traffic-beams',
      ],
      note: 'Mesh cars, far tree cards and facade styles are GPU-only.',
    },
    {
      id: 'trafficRange', kind: 'profile', type: 'enum', values: [230, 400, 600, 800],
      default: 400, label: 'traffic range',
      control: '[data-anim="traffic-range"]', where: 'more', query: null,
      group: 'traffic', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['DC-drive-controls'],
    },
    {
      id: 'trafficLightRange', kind: 'profile', type: 'enum', values: ['150', '250', '400', 'cars'],
      default: '150', label: 'traffic light range',
      control: '[data-anim="traffic-light-range"]', where: 'more', query: null,
      group: 'traffic', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      requires: [need('trafficBeamsLight')],
      tests: ['TL2-traffic-light-range'],
      note: 'Normalised at load: unknown stored values become 150 (TL2).',
    },
    {
      id: 'trafficNearest', kind: 'profile', type: 'enum', values: ['8', '16', '32'],
      default: '8', label: 'nearest cars with traffic light',
      control: '[data-anim="traffic-nearest"]', where: 'more', query: null,
      group: 'traffic', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      requires: [need('trafficBeamsLight')],
      tests: ['TL2-traffic-light-range'],
      note: 'Normalised at load: unknown stored values become 8 (TL2).',
    },
    {
      id: 'simCeiling', kind: 'profile', type: 'enum', values: ['low', 'medium', 'high', 'ultra', 'native'],
      default: 'high', label: 'resolution ceiling',
      control: '[data-anim="resolution"]', where: 'more', query: null,
      group: 'performance', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'low 640, medium 960, high 1600, ultra 2560, native up to 3840.',
    },
    {
      id: 'minFps', kind: 'profile', type: 'enum', values: [20, 30, 45, 60],
      default: 30, label: 'minimum frame rate',
      control: '[data-anim="min-fps"]', where: 'more', query: null,
      group: 'performance', cost: 'free',
      owner: ['js/drive-anim.js'],
      requires: [need('dynResOn')],
      tests: [],
      note: 'Written together with frameTargetMs.',
    },
    {
      id: 'samples', kind: 'profile', type: 'enum', values: ['1', '2', 'auto'],
      default: '1', label: 'supersampling',
      control: '[data-dv="samples"]', where: 'more', query: null,
      group: 'performance', cost: 'per-frame-gpu',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'Objects trace cost x4 at 2.',
    },
    // ---- saved options that DV_DEF does not declare, derived dropdowns, session and game state (never added to DV_DEF)
    {
      id: 'wetness', kind: 'extra', type: 'number', values: { min: 0, max: 1, step: 'cycles 0 / 0.4 / 1' },
      default: undefined, label: 'road: dry / damp / wet',
      control: '[data-dv="wetness"]', where: 'more', query: null,
      group: 'surface', cost: 'per-frame-gpu',
      owner: ['js/drive.js'],
      tests: [
        'CD-controls-dedupe', 'FG-fog', 'WT-wetness', 'node:wetness',
      ],
      note: 'Absent until the first click; clamped to 0..1 at load; readers use RF.Drive.wetnessOf and tolerate undefined. The minigame leaves it behind (H1, fixed on this base by the overlay).',
    },
    {
      id: 'deerBehaviour', kind: 'extra', type: 'bool', values: null,
      default: undefined, label: 'deer behaviour',
      control: '[data-anim="deer-behaviour"]', where: 'more', query: null,
      group: 'scenery', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['node:pass-parity', 'node:traffic-beams'],
      note: 'Undefined means "on when detailed models are on" (RF.Drive.Models.deerEnabled).',
    },
    {
      id: 'ownLow', kind: 'extra', type: 'text', values: null,
      default: undefined, label: 'own low beam',
      control: '[data-anim="own-low"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'table-rebuild',
      owner: ['js/drive-anim.js'],
      tests: ['BA-beam-library-gpu'],
      note: '\'design\', or a library beam id; undefined = \'design\'.',
    },
    {
      id: 'ownHigh', kind: 'extra', type: 'text', values: null,
      default: undefined, label: 'own high beam',
      control: '[data-anim="own-high"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'table-rebuild',
      owner: ['js/drive-anim.js'],
      tests: ['SF1-car-silhouette'],
      note: '\'generic\', or a library beam id; undefined = \'generic\'.',
    },
    {
      id: 'scatterTableSteps', kind: 'extra', type: 'number', values: null,
      default: undefined, label: 'table steps override (tests only)',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'table-rebuild',
      owner: ['js/drive-anim.js'],
      tests: ['SD-scatter-table', 'SF1-car-silhouette'],
      note: 'No writer in js/; set only by tests (NE-state-leak, SD-scatter-table).',
    },
    {
      id: 'view', kind: 'extra', type: 'enum', values: ['anim', 'still'],
      default: undefined, label: 'drive view mode',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'free',
      owner: ['js/spec-ui.js'],
      tests: [],
      note: 'Stored \'still\' or \'static\' is rewritten to \'anim\' (and playing false) at load.',
    },
    {
      id: 'pedStop', kind: 'extra', type: 'bool', values: null,
      default: undefined, label: 'pedestrians stop traffic (test control)',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'free',
      owner: ['js/drive-anim.js'],
      tests: [],
      note: 'Undefined = true; set only by tests.',
    },
    {
      id: 'lampRule', kind: 'extra', type: 'enum', values: ['urban-only', 'all', 'sparse', 'off'],
      default: undefined, label: 'where street lamps stand (test control)',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'scene-regenerate',
      owner: ['js/drive-anim.js'],
      tests: ['node:tile-options'],
      note: 'Undefined = \'urban-only\'; set only by tests (tile-options).',
    },
    {
      id: 'airLevel', kind: 'derived', type: 'enum', values: ['off', 'baseline', 'low', 'medium', 'high', 'max', 'custom'],
      default: undefined, label: 'air beam level',
      control: '[data-dv="airLevel"]', where: 'more', query: null,
      group: 'air', cost: 'table-rebuild',
      owner: [],
      bundle: ['scatter', 'scatterMode', 'scatterQuality', 'scatterRes', 'scatterBlur', 'scatterCache', 'scatterCycle', 'scatterNearFadeRange', 'scatterNearBias', 'visibility'],
      tests: [],
      note: 'Never stored. Picking a level writes the bundle (RF.Drive.airLevelBundle); the shown value is RF.Drive.airLevelOf(o), custom when hand-edited.',
    },
    {
      id: 'haloQuality', kind: 'derived', type: 'enum', values: ['off', 'low', 'medium', 'ultra', 'custom'],
      default: undefined, label: 'halo quality',
      control: '[data-dv="haloQuality"]', where: 'more', query: null,
      group: 'halo', cost: 'per-frame-gpu',
      owner: [],
      bundle: ['trafficHalo', 'haloBins', 'haloDiv', 'haloPolar', 'haloPolarLamps', 'haloGain'],
      tests: [],
      note: 'Never stored. Picking a level writes the bundle (RF.Drive.haloLevelBundle); it sets trafficHalo but not trafficBeams (H6).',
    },
    {
      id: 'high', kind: 'session', type: 'enum', values: ['off', 'on', 'auto'],
      default: 'off', label: 'high beam (H key)',
      control: '[data-anim="high-beam"]', where: 'more', query: null,
      group: 'own-lamp', cost: 'table-rebuild',
      owner: [],
      tests: [],
      note: 'V.high / V.highMode in drive-anim.js: session only, not saved, reset on every reload. Changes the beam table, so it is part of the prepare key.',
    },
    {
      id: 'gameOptions', kind: 'game', type: 'list', values: null,
      default: undefined, label: 'minigame overlay',
      control: 'none', where: 'none', query: null,
      group: 'internal', cost: 'scene-regenerate',
      owner: [],
      tests: [],
      note: 'st.gameOptions in drive-anim.js: the minigame overlay (mountainPass, scene, tiles, wild, seed, speed, wetness, people, animals, ...). Never saved; dropped on exit (game-options-leak fix).',
    },
  ];

  // ---- functions (pure)
  const byId = {};
  for (const e of OPTIONS) byId[e.id] = e;

  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

  // The defaults object (what DV_DEF used to be): every kind 'profile' entry, in registry order. Arrays are copied.
  function defaults() {
    const o = {};
    for (const e of OPTIONS) if (e.kind === 'profile') o[e.id] = clone(e.default);
    return o;
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Is value v a superseded default of entry e, for a profile saved at defaults version `version` (0 = before versioning)?
  // Before versioning we cannot know which earlier default was in force, so any earlier value counts. From version 1 on,
  // only the value that was the default at that version counts.
  function isStaleDefault(e, v, version) {
    const h = e.defaultHistory;
    if (!h || !h.length || same(v, e.default)) return false;
    if (version <= 0) return h.some((x) => same(x.value, v));
    let inForce = null;
    for (const x of h) if (x.since <= version) inForce = x;
    return !!inForce && same(inForce.value, v);
  }

  const hasAll = (o, keys) => keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));

  // Load-time repair of frozen defaults. Input: the parsed saved profile. Output: { profile, changed, fromVersion }.
  //   - the defaultsVersion stamp is removed from the returned profile (the live options object never carries it);
  //   - a profile without a stamp is migrated only if it is a whole-object save (it holds the LEGACY_SIGNATURE keys);
  //   - a key whose saved value equals a superseded default takes the current default; any other value is kept;
  //   - RETIRED_KEYS (options removed from the build) are dropped;
  //   - other keys the registry does not know are kept untouched.
  // `cfg` ({ options, signature, current }) exists so tests can run the logic against a made-up registry.
  function migrateProfile(raw, cfg) {
    const c = cfg || {};
    const options = c.options || OPTIONS, signature = c.signature || LEGACY_SIGNATURE, current = c.current === undefined ? DEFAULTS_VERSION : c.current;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { profile: {}, changed: [], fromVersion: null };
    const profile = Object.assign({}, raw);
    const stamped = typeof raw.defaultsVersion === 'number' && isFinite(raw.defaultsVersion);
    delete profile.defaultsVersion;
    for (const k of RETIRED_KEYS) delete profile[k];
    const fromVersion = stamped ? raw.defaultsVersion : 0;
    const changed = [];
    if (fromVersion >= current || (!stamped && !hasAll(raw, signature))) return { profile, changed, fromVersion };
    for (const e of options) {
      if (e.kind !== 'profile' || !Object.prototype.hasOwnProperty.call(profile, e.id)) continue;
      if (isStaleDefault(e, profile[e.id], fromVersion)) { profile[e.id] = clone(e.default); changed.push(e.id); }
    }
    return { profile, changed, fromVersion };
  }

  // The text written to localStorage: the options plus the defaults version this build wrote them under.
  function serialize(opts) { return JSON.stringify(Object.assign({}, opts, { defaultsVersion: DEFAULTS_VERSION })); }

  // ---- conditions. ctx = { renderer: 'gpu' | 'cpu', preset: 'us' | 'ece' }. Not used by the UI yet; tests and docs use it.
  function holds(cond, opts, ctx) {
    if (cond.any) return cond.any.some((c) => holds(c, opts, ctx));
    if (cond.all) return cond.all.every((c) => holds(c, opts, ctx));
    let v;
    if (cond.ctx) v = (ctx || {})[cond.ctx];
    else {
      v = opts[cond.opt];
      if (v === undefined && cond.legacy) v = opts[cond.legacy] ? 1 : 0;
    }
    if ('eq' in cond) return same(v, cond.eq);
    if ('ne' in cond) return !same(v, cond.ne);
    if ('gt' in cond) return +v > cond.gt;
    if ('in' in cond) return cond.in.some((x) => same(x, v));
    return !!v;
  }

  // The rules of option `id` that are not satisfied: requires that do not hold, ignoredWhen and conflicts that do.
  function unmet(id, opts, ctx) {
    const e = byId[id], out = [];
    if (!e) return out;
    for (const r of e.requires || []) if (!holds(r.cond, opts, ctx)) out.push({ kind: 'requires', rule: r.rule, why: r.why, effect: r.effect });
    for (const r of e.ignoredWhen || []) if (holds(r.cond, opts, ctx)) out.push({ kind: 'ignoredWhen', rule: r.rule, why: r.why, effect: r.effect });
    for (const r of e.conflicts || []) if (holds(r.cond, opts, ctx)) out.push({ kind: 'conflicts', rule: r.rule, why: r.why, effect: r.effect });
    return out;
  }

  RF.Options = { DEFAULTS_VERSION, RETIRED_KEYS, LEGACY_SIGNATURE, GROUPS, RULES, OPTIONS, byId, defaults, migrateProfile, serialize, holds, unmet };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.Options;   // require() in Node tests
})(typeof globalThis !== 'undefined' ? globalThis : this);
