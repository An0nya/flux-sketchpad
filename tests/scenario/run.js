// Scenario runner: node tests/scenario/run.js <scenario.json | dir> [port]
// No port: CPU render in Node (the tile pipeline, generic headlamp, no browser). With a port: the page on tests/serve.py at that port (SH2, browser.js).
// Writes tests/scenario/out/<name>.json and one PNG per capture: tests/scenario/out/<name>-<capture>.png. Exits 1 on any error.
// Hashes are sha256 of the PNG bytes. Luminance is the mean of (R+G+B)/3 over the 8-bit PNG, the same metric the page tests use.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const schema = require('./schema.js');
const OUT_DIR = path.join(__dirname, 'out');
const EXAMPLE_DIR = path.join(__dirname, 'examples');
const NODE_W = 256, NODE_H = 144, FPS = 30;   // Node frames: a fixed 256x144 raster, time advances 1/30 s per frame

// ---- PNG (8-bit RGB, filter 0, zlib). Written by hand so Node needs no image package.
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Frame stats, shared by both modes. rgb: Uint8Array/Buffer of w*h*3.
function frameStats(rgb, w, h, regions) {
  let s = 0; for (let i = 0; i < w * h; i++) s += (rgb[3 * i] + rgb[3 * i + 1] + rgb[3 * i + 2]) / 3;
  const out = { luma: +(s / (w * h)).toFixed(4), regions: {} };
  for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
    const X0 = Math.floor(x0 * w), X1 = Math.max(X0 + 1, Math.ceil(x1 * w)), Y0 = Math.floor(y0 * h), Y1 = Math.max(Y0 + 1, Math.ceil(y1 * h));
    let rs = 0, n = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const i = y * w + x; rs += (rgb[3 * i] + rgb[3 * i + 1] + rgb[3 * i + 2]) / 3; n++; }
    out.regions[name] = +(rs / n).toFixed(4);
  }
  return out;
}

// Frame clock: frame f is at distance pos + speed * f / FPS and time f / FPS. Same for both modes; no wall clock.
const frameClock = (s, f) => ({ dist: s.dist + (s.speed / 3.6) * (f / FPS), t: f / FPS });

// ---- Node CPU mode. Builds the look the same way js/drive-anim.js prepare() does (look.* from the option keys).
function lookOf(o, RF) {
  const w = RF.Drive.wetnessOf(o);
  return { wet: w > 0, wetness: w, wetSheen: !!o.wetSheen, wetModel: o.wetModel, visibility: o.visibility, scatter: o.scatter, scatterMode: o.scatterMode, scatterRes: o.scatterRes,
    scatterBlur: o.scatterBlur, scatterCache: o.scatterCache, scatterCycle: o.scatterCycle, grain: o.tex !== false, RL: o.RL / 1000, ambient: o.ambient };
}
function renderNode(s, RF, dv) {
  if (s.beams.length) throw new Error(s.name + ': beams need the browser (run with a port); Node mode has no beam library');
  if (s.options.tiles === false) throw new Error(s.name + ': options.tiles false is browser-only; Node mode always uses the tile pipeline');
  const A = RF.DriveAnim, D = RF.Drive;
  const o = Object.assign({}, dv, s.options, { scene: s.scene, seed: s.seed, speed: s.speed });
  const flags = { people: o.people, animals: o.animals, signs: o.signs, posts: o.posts, veg: o.veg, obstacle: o.obstacle, rpm: o.rpm };
  const src = A.source(s.scene, 3.5, false, flags, { leafyFoliage: !!o.leafyFoliage, wild: !!o.wild, seed: o.seed, density: o.density, cline: o.cline, oncoming: o.oncoming, preceding: o.preceding, onKcd: o.onKcd, onMode: o.onMode,
    trafficDensity: o.trafficDensity, trafficRange: o.trafficRange, safeGap: o.safeGap, trafficLogic: !!o.trafficLogic, speed: o.speed, mountainPass: !!o.mountainPass, tiles: true, tileCache: !!o.tileCache, streetLamps: o.streetLamps, tex: o.tex, wet: D.wetnessOf(o) > 0 });
  const p = { w: NODE_W, h: NODE_H, hfov: o.fov, eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lane: 3.5, look: lookOf(o, RF), src };
  return s.capture.map((c) => {
    const { dist, t } = frameClock(s, c.frame), world = A.tileWorld(p, dist, t), rgba = new Float32Array(NODE_W * NODE_H * 4);
    A.tileFrame(p, dist, t, rgba, 1, null, null, world);
    // Tone map for the preview PNG only: x / (1 + x), then gamma 2.2. The app's own display path is not used here.
    const rgb = Buffer.alloc(NODE_W * NODE_H * 3);
    for (let i = 0; i < NODE_W * NODE_H; i++) for (let k = 0; k < 3; k++) { const v = Math.max(0, rgba[4 * i + k]); rgb[3 * i + k] = Math.round(255 * Math.pow(v / (1 + v), 1 / 2.2)); }
    const png = encodePNG(NODE_W, NODE_H, rgb);
    return Object.assign({ name: c.name, frame: c.frame, dist: +dist.toFixed(3), t: +t.toFixed(4), hash: crypto.createHash('sha256').update(png).digest('hex'), png }, frameStats(rgb, NODE_W, NODE_H, s.regions));
  });
}

// ---- Output: JSON per scenario plus one PNG per capture.
function writeOut(s, mode, captures, extra) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows = captures.map((c) => {
    const file = s.name + '-' + c.name + '.png';
    fs.writeFileSync(path.join(OUT_DIR, file), c.png);
    const { png, ...rest } = c; return Object.assign({ png: 'out/' + file }, rest);
  });
  const doc = { name: s.name, mode, scene: s.scene, seed: s.seed, dist: s.dist, speed: s.speed, frames: s.frames, options: s.options, regions: s.regions, captures: rows, counters: extra || null };
  const jsonPath = path.join(OUT_DIR, s.name + '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n');
  return jsonPath;
}

// A scenario path or a directory of them. Every file is validated before anything renders.
function loadScenarios(arg, dv, keys) {
  const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(arg, f)) : [arg];
  if (!files.length) throw new Error('no scenario .json files in ' + arg);
  return files.map((f) => {
    let raw; try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new schema.ScenarioError(f + ': not valid JSON (' + e.message + ')'); }
    return schema.parse(raw, dv, keys, path.relative(process.cwd(), f));
  });
}

module.exports = { renderNode, writeOut, loadScenarios, encodePNG, frameStats, frameClock, OUT_DIR, EXAMPLE_DIR, NODE_W, NODE_H };

if (require.main === module) {
  (async () => {
    const [arg, portArg] = process.argv.slice(2);
    if (!arg) { console.error('usage: node tests/scenario/run.js <scenario.json | dir> [port]'); process.exit(2); }
    const dv = schema.readDvDefaults(), keys = schema.readOptionKeys();
    const list = loadScenarios(arg, dv, keys);
    if (portArg) {
      const { runBrowserAll } = require('./browser.js');
      const outs = await runBrowserAll(list, +portArg, dv);
      outs.forEach((p, i) => console.log('[browser] ' + list[i].name + ' -> ' + path.relative(process.cwd(), p)));
      return;
    }
    const { load } = require('../load.js'); const RF = load();
    for (const s of list) {
      const captures = renderNode(s, RF, Object.assign({}, dv));
      const outPath = writeOut(s, 'node', captures, null);
      console.log('[node] ' + s.name + ': ' + captures.map((c) => c.name + ' ' + c.hash.slice(0, 12) + ' luma ' + c.luma).join(' | ') + ' -> ' + path.relative(process.cwd(), outPath));
    }
  })().catch((e) => { console.error(e instanceof schema.ScenarioError ? e.message : (e && e.stack) || e); process.exitCode = 1; });
}
