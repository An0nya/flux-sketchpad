// BEN: the drive benchmark (a "timedemo"). Same scenes, same settings changes, same order, one results file at the end, so a phone run
// and a Mac run (or two builds) can be compared row by row. Anya 11-28: forest (foliage), city (traffic headlamps, models), mountain
// (haze, oncoming scatter beams). Scene and spot come from the saves in samples/bench/; every quality setting comes from PROFILE, so a
// file from next month compares with one from today even after defaults or the saves' own settings drift.
// Per scene: load the save + PROFILE, settle, baseline = real played frames + the GST2 stage breakdown + a screenshot, then each variant
// (real frames only). At the end the first scene's baseline runs again: drift = last / first shows heat throttling.
// The user's own state (every option, the pose) is saved first and loaded back afterwards. Results wait in RF.DriveBench.last until the
// "save benchmark" button shares or downloads them (sharing needs a fresh tap: iOS drops the permission during an 85 s run).
(function () {
  const RF = (window.RF = window.RF || {});
  const BENCH_VERSION = 2, DIR = 'samples/bench/';
  // Anya 11-28: her medium look with supersampling off ("should run in the teens on the old phone"), plus haze (the mountain save's
  // 3000 m) in every scene: in clear air the oncoming scatter has nothing to light, so forest and city would not exercise the halo.
  const PROFILE = {
    samples: '1', gpuRenderer: true, debugTimings: true, gpuStages: true, sceneDetails: false, dynamicResolution: false, qualityGovernor: 'off', distanceLod: 'off',
    simCeiling: 'high', res: 640, fov: 60, cabinView: false, playing: false,
    trafficBeams: true, surfaceSheen: true, lampPitch: true, trafficLogic: true, trafficSubTick: 'on', trafficRange: 400, trafficLightRange: '400', trafficNearest: '8',
    trafficHalo: 16, haloCars: 8, haloRange: 400, lampCone: 'auto', lampConeGain: 0.5, lampClass: 'IV', lampRoad: 'table', haloBins: 16, haloDiv: 2.8,
    haloPolar: 'off', haloPolarBand: '64x64', haloPolarLamps: 2, crestOcclusion: 'off', haloJitter: 'jittered', haloJitterAmount: 0.25, haloBlur: 'light',
    haloDepthBlur: 'off', haloLampWin: 'off', haloCrossingRefine: 32, haloRefineNeighbour: 'on', haloMoment: 'on', haloAutoRange: '4-8', haloNearSub: 1,
    haloConePass: '2', haloConeAngle: 30, haloConeEqui: 'on', haloWidthStep: 'off',
    trafficShadows: 'all', shadowRes: '512x512', trafficShadowRoad: 'on', trafficShadowObjects: 'on', trafficShadowSoft: '2x2',
    visibility: 3000, scatter: 0, scatterCull: 'fast', glare: 'dry-low', expMode: 'adapt', ev: 1, wet: false, wetSheen: false, wetness: 0, wetVeil: false, wetBounce: false, wetBouncePlane: false, wetModel: 'ggx',
  };
  // wet road (Anya 11-28: "wet road with the streaks and even bounce beam"): its own step, so one heavy row doesn't slow every baseline
  // wetVeil stays off: with wetBouncePlane on a tiles road it crashes the GPU renderer (drive.js glareSources calls A.surface, which tiles
  // roads don't have; found by this benchmark 11-28, not fixed here).
  const WET = { wetness: 0.6, wet: true, wetSheen: true, wetModel: 'ggx', wetBounce: true, wetBouncePlane: true };
  const SCENES = [
    { name: 'forest', file: 'forest.json', variants: [['trees off', { veg: false }], ['leafy off', { leafyFoliage: false }], ['density 1', { density: 1 }]] },
    { name: 'city', file: 'city.json', variants: [['headlamps off', { trafficBeams: false }], ['models off', { detailedModels: false }], ['wet road', WET]] },
    { name: 'mountain', file: 'mountain.json', variants: [['haze off', { visibility: null }], ['scatter beams off', { trafficHalo: 0 }], ['wet road', WET]] },
  ];
  const FULL = { real: 48, realWarm: 12, stages: 40, stageWarm: 8, settleLoad: 2500, settleToggle: 1500 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r2 = (v) => (v === null || v === undefined ? v : Math.round(v * 100) / 100);

  async function fetchSave(file) { const r = await fetch(DIR + file, { cache: 'no-cache' }); if (!r.ok) throw new Error(DIR + file + ' ' + r.status); return r.json(); }
  // the canvas as a small JPEG, read in the same task as a render (WebGL keeps the buffer until it is composited)
  function shot(A, w = 480) {
    A.frame();
    const c = A.V.canvas, h = Math.round(w * c.height / c.width), o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, 0, 0, w, h); return o.toDataURL('image/jpeg', 0.7);
  }
  function stageMeans(ring) {
    if (!ring || !ring.length) return null;
    const names = []; for (const q of ring) for (const n of q.order) if (!names.includes(n)) names.push(n);
    return Object.fromEntries(names.map((n) => [n, r2(mean(ring.map((q) => q.ms[n] || 0)))]));
  }
  // cfg: { scenes, real, realWarm, stages, stageWarm, settleLoad, settleToggle, drift } (tests shorten it)
  async function run(cfg = {}) {
    const A = RF.DriveAnim && RF.DriveAnim._, V = A && A.V, ui = V && V.ui;
    if (!V || !V.three || !V.three.setProbe) return { error: 'Benchmark needs the GPU renderer running.' };
    if (V.benchRun && V.benchRun.running) return { error: 'A benchmark is already running.' };
    const c = Object.assign({}, FULL, cfg), scenes = c.scenes || SCENES, set = (k, v) => V.setOwn(k, v);
    const total = scenes.reduce((n, s) => n + 1 + s.variants.length, 0) + (c.drift === false ? 0 : 1);
    const B = (V.benchRun = { running: true, step: 0, total, phase: 'starting', t0: performance.now() });
    const say = (phase) => { B.phase = phase; if (A.perfLabel) A.perfLabel(); };
    const mine = RF.DriveAnim.stateDump(ui), out = { kind: 'flux-bench', version: BENCH_VERSION, started: new Date().toISOString(), url: location.href, profile: PROFILE, cfg: { real: c.real, stages: c.stages }, rows: [], shots: {} };
    const load = async (sc) => {
      const d = await fetchSave(sc.file); d.options = Object.assign({}, d.options, PROFILE);
      const msg = RF.DriveAnim.loadState(ui, d, (u, k, v) => set(k, v)); if (!/^Loaded/.test(msg)) throw new Error(sc.name + ': ' + msg);
      await sleep(c.settleLoad); return msg;
    };
    const timed = async (sc, name, ch, stages) => {
      B.step++; say(sc.name + ' · ' + name);
      const ring = await A.timeFrame(stages ? c.stages + c.stageWarm : 0, stages ? c.stageWarm : 0, { real: c.real, realWarm: c.realWarm });
      const T = V.timeRun || {}, real = T.real ? { n: T.real.n, ms: r2(T.real.ms), p95: r2(T.real.p95), min: r2(T.real.min), max: r2(T.real.max) } : null;
      const st = stageMeans(ring), row = { scene: sc.name, variant: name, ch, real, stages: st, probe: st ? r2(mean(ring.map((q) => q.total))) : null, at: r2((performance.now() - B.t0) / 1000) };
      out.rows.push(row);
      if (V.glFailed) throw new Error('the GPU renderer failed at ' + sc.name + ' · ' + name + ' (the drive fell back to the CPU picture; reload the page)');
      return row;
    };
    try {
      for (const sc of scenes) {
        say(sc.name + ' · loading'); const msg = await load(sc);
        const base = await timed(sc, 'baseline', {}, true); base.load = msg;
        try { out.shots[sc.name] = shot(A); } catch (e) { out.shots[sc.name] = 'error: ' + e.message; }
        for (const [name, ch] of sc.variants) {
          const undo = Object.fromEntries(Object.keys(ch).map((k) => [k, ui.dvOpts[k]]));
          for (const [k, v] of Object.entries(ch)) set(k, v); await sleep(c.settleToggle);
          await timed(sc, name, ch, false);
          for (const [k, v] of Object.entries(undo)) set(k, v);
        }
      }
      if (c.drift !== false) {
        const sc = scenes[0]; say('heat check · ' + sc.name + ' again'); await load(sc);
        const again = await timed(sc, 'baseline again', {}, false), first = out.rows.find((r) => r.scene === sc.name && r.variant === 'baseline');
        out.drift = first && first.real && again.real ? { first: first.real.ms, last: again.real.ms, ratio: r2(again.real.ms / first.real.ms) } : null;
      }
      out.env = RF.DriveAnim.stateDump(ui).env;
    } catch (e) { out.error = String(e && e.message || e); }
    finally {
      out.finished = new Date().toISOString(); out.seconds = r2((performance.now() - B.t0) / 1000);
      try { RF.DriveAnim.loadState(ui, mine, (u, k, v) => set(k, v)); } catch (e) { out.restoreError = String(e); }
      B.running = false; B.phase = out.error ? 'failed: ' + out.error : 'done in ' + Math.round(out.seconds) + ' s, tap "save benchmark"';
      RF.DriveBench.last = out; if (A.perfLabel) A.perfLabel();
      const bs = ui.driveBar && ui.driveBar.querySelector('[data-anim="bench-save"]'); if (bs) bs.hidden = false;
    }
    return out;
  }
  function fileName(o) { return 'flux-bench-' + String(o.started || '').replace(/[:.]/g, '-').slice(0, 19) + '.json'; }
  // share sheet where the browser can share files (iOS: AirDrop to the Mac), else a download. Needs a fresh tap.
  async function save(o = RF.DriveBench.last) {
    if (!o) return 'No benchmark yet.';
    const name = fileName(o), blob = new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' });
    try {
      const f = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return 'Shared ' + name; }
    } catch (e) { if (e && e.name === 'AbortError') return 'Share cancelled.'; }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'Downloaded ' + name;
  }
  function text() {
    const B = RF.DriveAnim && RF.DriveAnim._.V.benchRun; if (!B) return '';
    return 'Benchmark: ' + (B.running ? 'step ' + B.step + '/' + B.total + ' · ' + B.phase + ' (' + Math.round((performance.now() - B.t0) / 1000) + ' s)' : B.phase);
  }
  RF.DriveBench = { BENCH_VERSION, PROFILE, SCENES, WET, FULL, run, save, text, fileName, last: null };
})();
