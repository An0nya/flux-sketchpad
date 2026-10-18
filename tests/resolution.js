// RS: resolution ceiling, min-fps settings and dynamic stepping. Pure, no browser.
function run(RF, ok) {
  const D = RF.DriveAnim, V = D._.V, saved = { canvas: V.canvas, info: V.info, resolution: V.resolution, pinSS: V.pinSS };
  const LEVELS = { low: 640, medium: 960, high: 1600, ultra: 2560, native: 3840 };
  // the sim size the real size() gives for a canvas bw x bh css px (node has no devicePixelRatio, so dpr = 1)
  const sizeOf = (o, bw, bh, res) => { V.canvas = { parentElement: { clientWidth: bw, clientHeight: bh } }; V.info = { o }; V.resolution = res || null; V.pinSS = 0; return D._.size(); };
  const SCENES = [
    { scene: 'road' }, { scene: 'forest' }, { scene: 'city' }, { scene: 'city', wet: true, wetSheen: true },
    { scene: 'road', tiles: true }, { scene: 'road', tiles: true, wet: true, wetSheen: true }, { scene: 'road', mountainPass: true },
  ];
  try {
    // 1. the ceiling is the width for every scene and mode, when the canvas is wide enough
    for (const [name, w] of Object.entries(LEVELS)) {
      const widths = SCENES.map((s) => sizeOf(Object.assign({ simCeiling: name }, s), 4000, 2250).W);
      ok('RS ' + name + ' ceiling ' + w + ' gives that sim width for all 7 scene/mode combinations', widths.every((x) => x === w), JSON.stringify(widths));
    }
    // 2. below the ceiling the canvas backing width wins, so a phone-sized canvas is not upscaled
    const phone = sizeOf({ simCeiling: 'high', scene: 'city', wet: true, wetSheen: true }, 693, 390);
    ok('RS a 693 css px phone landscape at dpr 1 gives backing width 692 (even) under High (no ceiling effect)', phone.W === 692 && phone.baseW === 692, JSON.stringify(phone));
    // 3. unknown or missing selection is High
    ok('RS missing or unknown simCeiling is High', sizeOf({ scene: 'road' }, 4000, 2250).W === 1600 && sizeOf({ simCeiling: 'bogus' }, 4000, 2250).W === 1600);
    // 4. dynamic scale multiplies the ceiling (manual + dynamic combination), and the floor is 160 px
    const combo = sizeOf({ simCeiling: 'high', scene: 'road', dynamicResolution: true }, 4000, 2250, { scale: 0.3 });
    ok('RS High ceiling x dynamic scale 0.3 gives sim 480x270', combo.W === 480 && combo.H === 270 && combo.baseW === 1600, JSON.stringify(combo));
    ok('RS Low ceiling x dynamic scale 0.3 gives sim 192x108 (floor 160 only below that)', sizeOf({ simCeiling: 'low', dynamicResolution: true }, 4000, 2250, { scale: 0.3 }).W === 192);
    // 5. Native at 3840 css-backed 4K-class canvas: Float32 ground is 3840*2160*3*4 bytes
    ok('RS native 3840 gives sim 3840x2160', (() => { const n = sizeOf({ simCeiling: 'native' }, 4000, 2250); return n.W === 3840 && n.H === 2160; })());
    // 6. old stored settings: frameTargetMs (ms) becomes the nearest min fps; a stored minFps wins
    const f = (o) => D.fpsSettings(o);
    ok('RS old stored frameTargetMs 33 loads as min 30 fps', f({ frameTargetMs: 33 }).minFps === 30);
    ok('RS old stored frameTargetMs 50 loads as min 20 fps', f({ frameTargetMs: 50 }).minFps === 20);
    ok('RS old stored frameTargetMs 16 loads as min 60 fps', f({ frameTargetMs: 16 }).minFps === 60);
    ok('RS nothing stored loads as min 30 fps, target 1000/30 ms', f({}).minFps === 30 && Math.abs(f({}).frameTargetMs - 1000 / 30) < 1e-9);
    ok('RS a stored minFps wins over a stale frameTargetMs', f({ minFps: 45, frameTargetMs: 33 }).minFps === 45 && Math.abs(f({ minFps: 45 }).frameTargetMs - 1000 / 45) < 1e-9);
    ok('RS an invalid stored minFps falls back to the old target, then 30', f({ minFps: 7, frameTargetMs: 33 }).minFps === 30 && f({ minFps: 7 }).minFps === 30);
    ok('RS every min fps choice maps to 1000/fps ms', [20, 30, 45, 60].every((fps) => Math.abs(f({ minFps: fps }).frameTargetMs - 1000 / fps) < 1e-9));
    // 7. dynamic stepping: a slow series steps down to the 0.3 floor, a fast series steps back to 1
    const target = f({ minFps: 30 }).frameTargetMs;
    let s = D.resolutionState(); for (let i = 0; i < 200; i++) s = D.resolutionStep(s, 50, { enabled: true, target });
    ok('RS 20 fps under a 30 fps min steps the scale down to the 0.3 floor', s.scale === 0.3, s.scale);
    for (let i = 0; i < 600; i++) s = D.resolutionStep(s, 10, { enabled: true, target });
    ok('RS 100 fps headroom steps the scale back up to 1', s.scale === 1, s.scale);
    // positive control: a flat 60 fps series never leaves the ceiling; neither does one exactly on the target
    let flat = D.resolutionState(); for (let i = 0; i < 500; i++) flat = D.resolutionStep(flat, 1000 / 60, { enabled: true, target });
    ok('RS positive control: flat 60 fps never steps below the ceiling', flat.scale === 1 && flat.index === 0, flat.scale);
    let on = D.resolutionState(); for (let i = 0; i < 500; i++) on = D.resolutionStep(on, 1000 / 30, { enabled: true, target });
    ok('RS a series on the 30 fps target does not step', on.scale === 1 && on.index === 0, on.scale);
    // 8. dynamic off: the scale stays at 1 whatever the frames do
    let off = D.resolutionState(); for (let i = 0; i < 100; i++) off = D.resolutionStep(off, 200, { enabled: false, target });
    ok('RS dynamic resolution off ignores slow frames', off.scale === 1);
  } finally { Object.assign(V, saved); }
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0); }
