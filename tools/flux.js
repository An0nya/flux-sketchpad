#!/usr/bin/env node
// flux.js: one command-line front door to the app's internals for agents and scripts (Layer 1: Node only, no browser).
// Loads the SAME js/ files the page loads (tests/load.js) and prints JSON on stdout; errors go to stderr with exit 1.
//   node tools/flux.js list solvers|spec-presets|sources
//   node tools/flux.js scene <scene.json>
//   node tools/flux.js trace <scene.json> [--rays 2e6] [--spec fmvss-lb2m,ece-r112-b]
//   node tools/flux.js solve <scene.json> [--solver id] [--set key=value ...] [--out solved.json] [--rays 2e6]
//   node tools/flux.js heatmap <scene.json> --out farfield.png [--rays 2e6] [--scale 4]
// Spec-mode scenes (mode D), or any scene given --spec, are judged in the far field the way the Spec panel does
// (a pilot quarter of the rays, then guided rounds); other modes report the target-plane stats and paint fidelity.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const { load, ROOT } = require('../tests/load.js');
const RF = load();

const argv = process.argv.slice(2), cmd = argv[0];
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flags = (k) => argv.flatMap((a, i) => (a === '--' + k ? [argv[i + 1]] : []));
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
const out = (o) => process.stdout.write(JSON.stringify(o, (k, v) => (v === Infinity ? 'Infinity' : v), 2) + '\n');
const die = (msg) => { process.stderr.write('flux: ' + msg + '\n'); process.exit(1); };

// the bundled model solvers (the page fetches solvers/index.json at boot; here we read the same files)
let bundled = null;
function loadBundled() {
  if (bundled) return bundled;
  bundled = [];
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'solvers', 'index.json'), 'utf8'));
  for (const m of list) {
    const before = new Set(RF.Solvers.list().map((d) => d.id)), p = path.join(ROOT, 'solvers', m.file);
    try { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
    catch (e) { bundled.push({ file: m.file, error: String(e.message || e) }); continue; }
    for (const d of RF.Solvers.list()) if (!before.has(d.id)) bundled.push({ file: m.file, id: d.id, group: (m.groups && m.groups[d.id]) || m.group || null, note: m.note || '', model: m.model });
  }
  return bundled;
}

function readScene(file) {
  if (!file) die('missing <scene.json>');
  try { return RF.State.deserialize(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { die('cannot load ' + file + ': ' + e.message); }
}
const rays = () => Math.round(+flag('rays', 2e6));

// far-field trace, as the Spec panel judges it: pilot then guided rounds (same recipe as tools/sealed-beam/lab.js judge)
function farTrace(sc, N) {
  const s2 = RF.U.deepCopy(sc); if (s2.sim.bounces < 3) s2.sim.bounces = 3;
  const P = RF.Engine.prepare(s2, RF.State.allSurfaces(s2)); P.ffStreams = [RF.Spec.gridOpts(s2)]; P.guideLearn = true;
  const N0 = Math.min(N, Math.max(100000, N / 4));
  let c = RF.Engine.newCtx(P, N0, 0); RF.Engine.traceRange(c, 0, N0); c.next = N0; c.done = true;
  while (c.N < N) { const n1 = c.N, g = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), g); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
  return { c, G: RF.FarField.build(c, P.ffStreams[0]) };
}
function judgeSpec(sc, G, names) {
  const evals = {};
  for (const name of names) {
    const md = RF.U.deepCopy(sc.modeD); if (!name.startsWith('scene:')) RF.Spec.applyPreset(md, name);   // 'scene:<preset>' = the Spec settings saved in the scene; a bare preset id = that preset fresh
    const ev = RF.Spec.evaluate(G, md), count = (v) => ev.rows.filter((r) => r.verdict === v).length;
    evals[name] = { verdict: ev.verdict, pass: count('pass'), fail: count('fail'), unsure: count('unsure'), score: +ev.score.toFixed(3), aim: ev.aim.note,
      rows: ev.rows.map((r) => ({ name: r.name, value: Math.round(r.value), sd: Math.round(r.sd), bound: r.bound, isMin: r.isMin, verdict: r.verdict })) };
  }
  return evals;
}
function peakOf(G) {
  const M = RF.FarField.map(G, 0.25); let pk = 0, pi = 0;
  for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > pk) { pk = M.cd[q]; pi = q; }
  return { M, peakCd: Math.round(pk), peakAt: [+(G.h0 + ((pi % G.nh) + 0.5) * G.step).toFixed(3), +(G.v0 + (Math.floor(pi / G.nh) + 0.5) * G.step).toFixed(3)] };
}

// ---- PNG (8-bit RGB, Node's zlib; same encoder as tools/heatmap-png.js) + cividis (no red/green reliance)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CIV = [[0, 32, 77], [49, 68, 107], [102, 105, 112], [149, 143, 120], [203, 186, 105], [255, 234, 70]];
const cividis = (t) => { t = Math.max(0, Math.min(1, t)); const x = t * (CIV.length - 1), i = Math.min(CIV.length - 2, Math.floor(x)), f = x - i; return [0, 1, 2].map((k) => Math.round(CIV[i][k] + (CIV[i + 1][k] - CIV[i][k]) * f)); };

const sceneSummary = (sc, file) => ({
  file, mode: sc.mode, solver: sc.solve && sc.solve.id || null,
  source: { kind: sc.source.kind, shape: sc.source.shape, w: sc.source.w, h: sc.source.h, power: sc.source.power, pos: sc.source.pos, axis: sc.source.axis, preset: sc.source.preset || null },
  envelope: sc.envelope && { shape: sc.envelope.shape, center: sc.envelope.center, half: sc.envelope.half },
  surfaces: Object.fromEntries(Object.entries(sc.groups || {}).map(([g, v]) => [g, { enabled: v.enabled !== false, count: (v.surfaces || []).length }])),
  spec: sc.mode === 'D' && sc.modeD ? { preset: sc.modeD.preset || null } : undefined,
  sim: sc.sim, target: { distance: sc.target.distance, size: sc.target.size, res: sc.target.res },
});

(async () => {
  if (cmd === 'list') {
    const what = positional[0];
    if (what === 'solvers') return out(loadBundled());
    if (what === 'spec-presets') return out(Object.entries(RF.Spec.PRESETS).map(([id, p]) => ({ id, label: p.label, verified: !!p.verified })));
    if (what === 'sources') return out(Object.entries(RF.SourcePresets.PRESETS).map(([id, p]) => ({ id, label: p.label, group: p.group || null })));
    return die('list what? solvers | spec-presets | sources');
  }
  if (cmd === 'scene') return out(sceneSummary(readScene(positional[0]), positional[0]));
  if (cmd === 'trace' || cmd === 'heatmap') {
    const sc = readScene(positional[0]), N = rays(), t0 = Date.now(), specs = (flag('spec', '') || '').split(',').filter(Boolean);
    const far = cmd === 'heatmap' || sc.mode === 'D' || specs.length;
    if (!far) {   // target-plane stats + paint fidelity, as tools/run-solver.js scores a design
      const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.recordHits = true; const c = RF.Engine.runSync(P, N);
      const s = RF.Engine.stats(c, { paint: sc.modeA.paint, paintRes: sc.target.res }), fd = RF.Photometry.fidelity(sc, P, c), em = c.E.emitted;
      return out({ rays: N, ms: Date.now() - t0, mode: sc.mode, delivered: (c.E.direct + c.E.reflected) / em, fidelity: fd.fidelity, paintedWithin: fd.within, spill: fd.spill, coverage: s.coverage, uniformityU0: s.uniformity });
    }
    if (!sc.modeD) die('scene has no Spec settings (modeD); open it in Spec mode once, or pass a Spec-mode scene');
    const { c, G } = farTrace(sc, N), pk = peakOf(G);
    if (cmd === 'heatmap') {
      const file = flag('out'); if (!file) die('heatmap needs --out file.png');
      const k = Math.max(1, +flag('scale', 1) | 0), nh = G.nh, nv = pk.M.cd.length / nh, W = nh * k, H = nv * k, rgb = new Uint8Array(W * H * 3), top = pk.peakCd || 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {   // row 0 = top = most upward bin
        const v = pk.M.cd[(nv - 1 - Math.floor(y / k)) * nh + Math.floor(x / k)], [r, g, b] = cividis(Math.sqrt(Math.max(0, v) / top)), o = (y * W + x) * 3;
        rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
      }
      const hx = Math.round((0 - G.h0) / G.step * k), vy = Math.round((nv * G.step + G.v0 - 0) / G.step * k);   // H-V crosshair (0°, 0°), mid grey
      for (let x = 0; x < W; x++) if (vy >= 0 && vy < H) rgb.fill(128, (vy * W + x) * 3, (vy * W + x) * 3 + 3);
      for (let y = 0; y < H; y++) if (hx >= 0 && hx < W) rgb.fill(128, (y * W + hx) * 3, (y * W + hx) * 3 + 3);
      fs.writeFileSync(path.resolve(file), png(W, H, rgb));
      return out({ file: path.resolve(file), width: W, height: H, degPerPixel: G.step / k, h: [G.h0, G.h0 + nh * G.step], v: [G.v0, G.v0 + nv * G.step], peakCd: pk.peakCd, peakAt: pk.peakAt, scale: 'sqrt(cd / peak), cividis', rays: N, ms: Date.now() - t0 });
    }
    const names = sc.mode === 'D' ? ['scene:' + (sc.modeD.preset || 'custom')].concat(specs) : specs;
    return out({ rays: N, ms: Date.now() - t0, peakCd: pk.peakCd, peakAt: pk.peakAt, lmWindow: Math.round(G.lmWindow), emitted: Math.round(c.E.emitted), spec: judgeSpec(sc, G, names) });
  }
  if (cmd === 'solve') {
    loadBundled();
    const sc = readScene(positional[0]), id = flag('solver', (sc.solve && sc.solve.id) || RF.Solvers.PREFERRED_ID || RF.Solvers.DEFAULT_ID), def = id && RF.Solvers.get(id);
    if (!def) die('unknown solver ' + id + ' (see: flux.js list solvers)');
    const sets = Object.fromEntries(flags('set').map((kv) => { const i = kv.indexOf('='); const v = kv.slice(i + 1); return [kv.slice(0, i), v !== '' && !isNaN(+v) ? +v : v === 'true' ? true : v === 'false' ? false : v]; }));
    const input = RF.Solvers.inputOf(sc);
    const problem = Object.assign(RF.U.deepCopy({ source: sc.source, envelope: sc.envelope, sim: sc.sim, modeD: sc.modeD, mode: sc.mode }), { target: input.target, modeA: { paint: input.paint && input.paint.cells } });
    const settings = RF.Solvers.sanitize(def, Object.assign(RF.Solvers.settingsOf(sc, id), sets));
    for (const [k, v] of Object.entries(sets)) if (settings[k] !== v) die('setting ' + k + ' = ' + JSON.stringify(v) + ' was replaced by ' + JSON.stringify(settings[k]) + ' (unknown key, out of range, or not one of its options)');
    const tools = { progress() {}, preview() {}, budget: { rays: Infinity, ms: Infinity }, scene: problem, trace: (s, o) => RF.Solvers.trace(problem, s, o) };
    const t0 = Date.now(), res = await def.solve(input, settings, tools), ms = Date.now() - t0, facts = RF.Solvers.verify(sc, res || {});
    const report = { solver: id, version: def.version, settings, solveMs: ms, errors: facts.errors, placed: facts.placed, notes: (res && res.notes) || [] };
    if (!facts.errors.length) {
      sc.groups.A.surfaces = res.surfaces; sc.solve = { id }; sc.solverSettings = Object.assign({}, sc.solverSettings, { [id]: settings });
      if (facts.needsBounces > sc.sim.bounces) sc.sim.bounces = facts.needsBounces;
      const file = flag('out'); if (file) { fs.writeFileSync(path.resolve(file), RF.State.serialize(sc)); report.out = path.resolve(file); }
    }
    return out(report);
  }
  die('commands: list | scene | trace | solve | heatmap   (see the header of tools/flux.js)');
})().catch((e) => die(e.stack || String(e)));
