// CPU-only proxy, not browser fps: node tests/bench/P0-drive-perf-node.js [frames=12]
// Bundled lamp fixture, same renderer; no workers, GL, canvas readback or display pacing.
const fs = require('fs'), path = require('path'), { load } = require('../load.js'), RF = load(), A = RF.DriveAnim;
const { traceScene, lookupOf } = require('../../tools/drive-lib.js');
const scene = RF.State.deserialize(fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
const L = lookupOf(RF, scene, traceScene(RF, scene, 200000), 0.5, 0.15), frames = +(process.argv[2] || 12);
console.log(JSON.stringify({ type: 'environment', runtime: process.version, platform: process.platform, frames, beam: 'MG2-default-lamp fixture; 200000 traced rays', ss: 1, note: 'CPU proxy. Desktop/phone dimensions nominal; wet/tiles both cap at 640. No browser frame-time or fps measurement.' }));
for (const device of ['desktop', 'phone']) for (const condition of ['owner', 'tiles', 'tiles-cache', 'static-road']) {
  const tiles = condition.startsWith('tiles'), baseline = condition === 'static-road', w = baseline ? (device === 'desktop' ? 1600 : 780) : 640;
  const opts = { wild: !baseline, seed: 7, density: 3, trafficDensity: 1, oncoming: !baseline, preceding: !baseline, trafficLogic: !baseline, speed: 50, wet: !baseline, tiles, tileCache: condition === 'tiles-cache', streetLamps: 'sodium', tex: true };
  const src = A.source(baseline ? 'road' : 'city', L.lane, L.us, {}, opts), p = { w, h: Math.round(w * 9 / 16) & ~1, hfov: 60, lamps: L.lamps, lut: L.lut, conv: L.conv, A: null, lane: L.lane, src, look: { wet: !baseline, wetSheen: !baseline, RL: 0.2, ambient: 0, grain: true } };
  const rgba = new Float32Array(4 * p.w * p.h); let camera = { x: tiles ? 495 : 0, v: 50 / 3.6 }, t = 12;
  const setupStart = performance.now(), ground = baseline ? A.ground(p) : null, groundSetupMs = performance.now() - setupStart;
  const rows = [], plain = [], raw = [];
  for (let i = -4; i < frames; i++) {
    const start = performance.now(), ct = performance.now(); camera = A.cameraStep(src, camera, 0.05, t); t += 0.05; const trafficMs = performance.now() - ct;
    rgba.fill(0); const pt = performance.now(), placed = (tiles ? A.tileWorld : A.placedObjects)(p, camera.x, t), placementMs = performance.now() - pt;
    p.profile = {}; A.objects(p, camera.x, rgba, 1, null, null, placed, t); const trace = { ...p.profile }, st = performance.now();
    const sources = RF.Drive.glareSources(tiles ? placed.objects : placed, A.EYE), sourcesMs = performance.now() - st, frameMs = performance.now() - start;
    if (i >= 0) rows.push({ frameMs, mainMs: frameMs, trafficMs, placementMs, sourcesMs, traceCpuMs: trace.traceMs, ...trace });
    // Same pose without instrumentation: reveals profiler overhead rather than calling it application cost.
    p.profile = null; const un = performance.now(); A.objects(p, camera.x, rgba, 1, null, null, placed, t); if (i >= 0) plain.push(performance.now() - un);
    if (i === 0) {
      let nonzero = 0, max = 0; for (let q = 0; q < rgba.length; q++) if (q % 4 !== 3) { if (rgba[q] > 0) nonzero++; max = Math.max(max, rgba[q]); }
      for (const [x, y] of [[0,0], [w>>1,p.h>>1], [w>>1,Math.floor(p.h*0.7)], [Math.floor(w*0.2),p.h-1], [w-1,p.h-1]]) raw.push({ x, y, rgba: Array.from(rgba.subarray(4*(y*w+x),4*(y*w+x)+4)) });
      raw.push({ nonzeroChannels: nonzero, maxChannel: max, sources: sources.length });
    }
  }
  const breakdown = A.breakdown(rows);
  console.log(JSON.stringify({ type: 'measurement', device, condition, sim: [p.w,p.h], ss: 1, glare: baseline ? 'off' : 'rain (GL not measured)', reflections: baseline ? false : 'wetSheen includes reflections; no separate reflection toggle exists', wildEffective: !!src.chunk, groundSetupMs: ground ? groundSetupMs : 0, breakdown, unprofiledTraceMs: plain.reduce((a,b)=>a+b,0)/plain.length, raw }));
}
