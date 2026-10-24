/* share-presets.js: named drive-view setups a link can apply, e.g. https://an0nya.github.io/flux-sketchpad/#preset=touge
   What it is: plain data (the presets) plus four small functions. fromHash() reads the link, apply() writes the saved
   drive settings (localStorage 'flux/driveView'). ui.js calls them at boot, next to the UX3 rescue code, before anything reads
   the saved drive settings. #reset and #safe win over #preset. No DOM here, so tests can load it in Node.
   The touge preset: the owner's crest setup (.claude/briefs/state/owner-state-2026-10-23-touge-crest.json, dvOpts) with the
   changes listed in .claude/briefs/SHARE-PRESET.md. Anim (position, paused state) is not in a preset. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});
  const PRESETS = {
    touge: {
      trafficShuffle: "library",
      trafficOutIds: [],
      scene: "road",
      wet: true,
      visibility: 3000,
      scatter: 0,
      trafficHalo: 4,
      lampHalos: "off",
      lampCone: "on",
      lampConeGain: 1,
      lampClass: "II",
      lampRoad: "table",
      haloBins: 16,
      haloDiv: 4,
      haloPolar: "merged",
      haloPolarLamps: 2,
      haloGain: 0.25,
      scatterMode: "table",
      scatterRes: "half",
      scatterBlur: "mid",
      scatterCache: "on",
      scatterCycle: 8,
      scatterBinCounts: "",
      scatterQuality: "medium",
      scatterCycleFade: "on",
      scatterNearFade: "on",
      scatterNearFadeRange: "off",
      scatterNearBias: 0,
      scatterGain: 0.25,
      wetSheen: true,
      wetModel: "ggx",
      expMode: "adapt",
      ev: 1,
      glare: "dry-low",
      onMode: "symmetric",
      people: true,
      animals: true,
      signs: true,
      reflectiveClothing: "mix",
      posts: true,
      powerlines: "on",
      powerlineReflectance: 0.23,
      veg: true,
      obstacle: false,
      rpm: true,
      tex: true,
      wild: true,
      mt: true,
      fitControls: true,
      largeCard: true,
      seed: 7,
      density: 3,
      trafficDensity: 0.5,
      trafficLogic: true,
      safeGap: true,
      tiles: true,
      tileCache: true,
      mountainPass: true,
      gpuRenderer: true,
      trafficBeams: true,
      surfaceSheen: true,
      lampPitch: true,
      afs: false,
      corneringLamps: false,
      fpsCounter: true,
      sceneDetails: false,
      debugTimings: false,
      dynamicResolution: false,
      frameTargetMs: 33.333333333333336,
      streetLamps: "sodium",
      cline: "solid",
      speed: 115,
      oncoming: false,
      preceding: false,
      onDist: 80,
      preDist: 50,
      onKcd: 30,
      RL: 200,
      ambient: 0,
      smooth: "smooth",
      res: 640,
      fov: 60,
      leafyFoliage: true,
      detailedModels: true,
      trafficRange: 230,
      trafficLightRange: "cars",
      trafficNearest: "32",
      simCeiling: "medium",
      minFps: 30,
      samples: "1",
      ownLow: "builtin:sqm-samples.json:4",
      wetness: 0.4,
      deerBehaviour: true,
    },
  };
  // The preset named by a #preset=<name> link, or null. #reset and #safe (anywhere in the hash) win over it.
  function fromHash(hash) {
    const h = String(hash || '');
    if (/(?:^#|[&#])(?:reset|safe)(?:[=&]|$)/.test(h)) return null;
    const m = /(?:^#|[&#])preset=([A-Za-z0-9_-]+)/.exec(h);
    return m ? m[1] : null;
  }
  // A copy of the named preset's options, or null when there is no such preset.
  function get(name) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) return null;
    return Object.assign({}, PRESETS[name]);
  }
  function names() { return Object.keys(PRESETS); }
  // Write the preset as the saved drive settings (the visitor's own saved settings are replaced). Missing keys take the
  // registry defaults, and the write carries the current defaults version, as Options.serialize does everywhere else.
  function apply(name, storage) {
    const p = get(name);
    if (!p) return false;
    storage.setItem('flux/driveView', RF.Options.serialize(Object.assign({}, RF.Options.defaults(), p)));
    return true;
  }
  RF.SharePresets = { get, names, fromHash, apply };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.SharePresets;   // require() in Node tests
})(typeof globalThis !== 'undefined' ? globalThis : this);
