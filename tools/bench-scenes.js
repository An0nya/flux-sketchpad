// Scene suite for tools/bench.js — solver development, not the benchmark.  Every variant changes ONE thing
// from the app's default scene (so a failure points at one cause), plus a few paintings that stress specific
// skills.  The benchmark's held-out scenes are NOT defined here: bench.js reads them from ~/Projects/agent-qa
// when that private repo exists, so they never land in this public repo.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function paintFrom(res, f) { const p = new Array(res * res).fill(0); for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const u = (i + 0.5) / res * 2 - 1, v = (j + 0.5) / res * 2 - 1; p[j * res + i] = Math.max(0, f(u, v)); } return p; }

// 5×7 bitmap letters for a text painting (rows top → bottom)
const FONT = { F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'] };
function textPaint(res, word, height) {       // letters `height` of the target tall, centred; v is up, so row 0 of a glyph is the top
  const p = new Array(res * res).fill(0), cell = Math.max(1, Math.floor(res * height / 7)), w = word.length * 6 * cell - cell;
  const x0 = Math.floor((res - w) / 2), y0 = Math.floor((res + 7 * cell) / 2) - 1;
  [...word].forEach((ch, n) => FONT[ch].forEach((row, r) => [...row].forEach((b, c) => {
    if (b !== '1') return;
    for (let a = 0; a < cell; a++) for (let d = 0; d < cell; d++) { const i = x0 + n * 6 * cell + c * cell + a, j = y0 - r * cell - d; if (i >= 0 && j >= 0 && i < res && j < res) p[j * res + i] = 1; }
  })));
  return p;
}

// Cursive "hello": one stroke through hand-placed points (Catmull-Rom), rasterised `thick` cells wide.  Span 0..6.8 × 0..4.
const HELLO = [[0, 1], [0.3, 1.3], [0.8, 3.5], [0.6, 4], [0.35, 3.5], [0.45, 1.5], [0.45, 0], [0.6, 0.8], [1.05, 1.35], [1.45, 0.95], [1.5, 0.1],
  [1.8, 0.3], [2.25, 0.75], [2.55, 1.2], [2.25, 1.45], [1.95, 1.05], [2.1, 0.2], [2.7, 0.15], [3.15, 1.0], [3.6, 3.4], [3.45, 4], [3.15, 3.5], [3.25, 1.0],
  [3.55, 0.1], [4.05, 0.4], [4.55, 1.2], [4.95, 3.4], [4.8, 4], [4.5, 3.5], [4.6, 1.0], [4.9, 0.1], [5.4, 0.45], [5.75, 1.05], [5.45, 1.25], [5.3, 0.55],
  [5.7, 0.0], [6.15, 0.5], [5.95, 1.2], [5.6, 1.1], [6.35, 1.2], [6.8, 1.35]];
function cursivePaint(res, width, thick) {
  const p = new Array(res * res).fill(0), sc = res * width / 6.8, x0 = (res - 6.8 * sc) / 2, y0 = (res - 4 * sc) / 2, pts = [];
  const P = HELLO.map(([x, y]) => [x0 + x * sc, y0 + y * sc]);
  for (let i = 0; i + 1 < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(P.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 0.02) { const t2 = t * t, t3 = t2 * t, f = (k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3); pts.push([f(0), f(1)]); } }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const x = i + 0.5, y = j + 0.5; for (const q of pts) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 <= (thick / 2) ** 2) { p[j * res + i] = 1; break; } }
  return p;
}

// Put the LED at a point inside the default envelope, facing `axis`.  The envelope stays where it is.
function placeLed(s, where, axis) {
  const c = s.envelope.center, h = s.envelope.half;
  s.source.pos = [c[0] + where[0] * h[0], c[1] + where[1] * h[1], c[2] + where[2] * h[2]];
  s.source.axis = axis;
  return s;
}

function sparse(s, budget, f) {
  s.modeA.budget = budget; s.modeA.paint = paintFrom(s.target.res, f);
  s.source.pos = [s.source.pos[0] + 6, s.source.pos[1] + 9, s.source.pos[2]]; s.source.axis = [0.34, -0.42, 0.84]; s.source.roll = 20;   // tilted, off-centre
  return s;
}
function suite(RF) {
  const D = () => RF.State.defaultScene();
  const withPaint = (f) => () => { const s = D(); s.modeA.paint = paintFrom(s.target.res, f); return s; };
  const S = {
    // the two public scenes
    'default': D,
    'test': () => RF.State.testScene(),
    // LED orientation (default LED faces up, the target is along +x)
    'led-back': () => placeLed(D(), [0.75, 0, 0], [-1, 0, 0]),        // faces away from the target, into the reflector (headlamp layout)
    'led-side': () => placeLed(D(), [0, -0.8, 0], [0, 1, 0]),         // faces sideways
    'led-down': () => placeLed(D(), [0, 0, 0.8], [0, 0, -1]),         // hangs from the top wall
    'led-fwd': () => placeLed(D(), [-0.8, 0, 0], [1, 0, 0]),          // faces the target: direct light floods everything
    // die size and shape
    'die-0.4': () => { const s = D(); s.source.w = s.source.h = 0.4; return s; },
    'die-3': () => { const s = D(); s.source.w = s.source.h = 3; return s; },
    'die-2x0.5': () => { const s = D(); s.source.w = 2; s.source.h = 0.5; return s; },
    'die-disc': () => { const s = D(); s.source.shape = 'disc'; s.source.radius = 0.6; return s; },
    'filament': () => { const s = D(); Object.assign(s.source, { kind: 'volume', shape: 'cylinder', radius: 0.2, length: 1.5, dist: 'isotropic', axis: [0, 1, 0] }); return s; },
    'coil-axial': () => { const s = D(); Object.assign(s.source, { kind: 'volume', shape: 'cylinder', emission: 'surface', radius: 0.4, length: 2, axis: [1, 0, 0] }); return s; },        // opaque coil along the beam (H1/H7-style)
    'coil-transverse': () => { const s = D(); Object.assign(s.source, { kind: 'volume', shape: 'cylinder', emission: 'surface', radius: 0.4, length: 2, axis: [0, 1, 0] }); return s; },  // across the beam
    // throw
    'throw-0.5m': () => { const s = D(); s.target.distance = 500; s.target.size = 125; return s; },
    'throw-20m': () => { const s = D(); s.target.distance = 20000; s.target.size = 5000; return s; },
    // envelope
    'env-small': () => { const s = D(); s.envelope.half = s.envelope.half.map((x) => x * 0.6); s.envelope.center = [s.source.pos[0] + s.envelope.half[0] * 0.8, s.source.pos[1], s.source.pos[2] + s.envelope.half[2] * 0.8]; return s; },
    // paintings (default optics)
    'p-wash': withPaint(() => 1),                                                     // the whole target, evenly
    'p-halfplane': withPaint((u, v) => (v < 0 ? 1 : 0)),                              // a cutoff across the full width
    'p-bars': withPaint((u, v) => (Math.abs(u) < 0.8 && Math.abs(v) < 0.5 && (Math.floor((u + 1) * 10) % 2 === 0) ? 1 : 0)),   // 5-cell bars, 5-cell gaps
    'p-text': () => { const s = D(); s.modeA.paint = textPaint(s.target.res, 'FLUX', 0.35); return s; },
    'p-gradient': withPaint((u, v) => (Math.abs(u) < 0.8 && Math.abs(v) < 0.4 ? 0.15 + 0.85 * (u + 0.8) / 1.6 : 0)),
    'p-spots': withPaint((u, v) => [[-0.5, 0.4], [0.5, 0.4], [-0.5, -0.4], [0.5, -0.4]].some(([a, b]) => Math.hypot(u - a, v - b) < 0.12) ? 1 : 0),
    'p-hello': () => { const s = D(); s.modeA.paint = cursivePaint(s.target.res, 0.8, 3); return s; },          // cursive, 3-cell strokes
    // sparse: easy paintings, very few facets, an asymmetric setup (LED tilted and off-centre) — can a solver do the basics?
    'sparse-spot-8': () => sparse(D(), 8, (u, v) => (Math.hypot(u + 0.2, v - 0.1) < 0.3 ? 1 : 0)),
    'sparse-spot-16': () => sparse(D(), 16, (u, v) => (Math.hypot(u + 0.2, v - 0.1) < 0.3 ? 1 : 0)),
    'sparse-ring-24': () => sparse(D(), 24, (u, v) => { const r = Math.hypot(u, v); return r > 0.45 && r < 0.6 ? 1 : 0; }),
    'sparse-bar-16': () => sparse(D(), 16, (u, v) => (Math.abs(u) < 0.7 && Math.abs(v + 0.2) < 0.12 ? 1 : 0)),
    'sparse-hot-16': () => sparse(D(), 16, (u, v) => (Math.hypot(u / 0.8, v / 0.4) < 1 ? (Math.hypot(u / 0.2, v / 0.12) < 1 ? 1 : 0.2) : 0)),
    // added for the autotune-mode study (2026-09-29): a flat disc (a wash that has an edge) and a synthetic lithophane-like picture
    // (smooth tones between 0.08 and 1 inside a dark frame: a lit oval "face" with two dark eyes, a nose highlight, a dark mouth band, light from the left).  Not a real photo.
    'p-disc': withPaint((u, v) => (Math.hypot(u, v) < 0.6 ? 1 : 0)),
    'p-photo': withPaint((u, v) => {
      if (Math.abs(u) > 0.9 || Math.abs(v) > 0.9) return 0;
      const g = (a, b, sa, sb) => Math.exp(-(((u - a) / sa) ** 2 + ((v - b) / sb) ** 2));
      const face = Math.exp(-Math.pow((u / 0.6) ** 2 + (v / 0.8) ** 2, 1.5));
      return Math.min(1, Math.max(0.08, 0.12 + 0.6 * face + 0.15 * (0.9 - u) / 1.8 - 0.4 * (g(-0.25, 0.2, 0.09, 0.06) + g(0.25, 0.2, 0.09, 0.06)) + 0.25 * g(0, -0.05, 0.07, 0.18) - 0.35 * g(0, -0.42, 0.25, 0.05)));
    }),
    // cursive "hello" in easier optics (2026-09-30, Anya: "more space or a smaller LED to make it doable"): one change each
    'hello-die0.4': () => { const s = D(); s.modeA.paint = cursivePaint(s.target.res, 0.8, 3); s.source.w = s.source.h = 0.4; return s; },
    'hello-bigenv': () => { const s = D(); s.modeA.paint = cursivePaint(s.target.res, 0.8, 3); s.envelope.half = s.envelope.half.map((x) => x * 1.5); return s; },
    'p-hotwash': withPaint((u, v) => (Math.hypot(u / 0.9, v / 0.5) < 1 ? (Math.hypot(u / 0.15, v / 0.1) < 1 ? 1 : 0.12) : 0)),   // a small hotspot 8× the wash
  };
  return S;
}

// Named groups.  'core' is the everyday check; 'all' is everything incl. held-out and Anya's files.
const GROUPS = {
  core: ['default', 'test', 'led-back', 'led-side', 'die-2x0.5', 'coil-axial', 'p-wash', 'p-halfplane', 'p-hello', 'p-hotwash', 'sparse-spot-16', 'sparse-hot-16'],
  orient: ['default', 'led-back', 'led-side', 'led-down', 'led-fwd'],
  die: ['default', 'die-0.4', 'die-3', 'die-2x0.5', 'die-disc', 'filament', 'coil-axial', 'coil-transverse'],
  paint: ['default', 'p-wash', 'p-halfplane', 'p-bars', 'p-text', 'p-hello', 'p-gradient', 'p-spots', 'p-hotwash'],
  anya: ['anya-lowbeam-212', 'anya-beamshot-400'],
  sparse: ['sparse-spot-8', 'sparse-spot-16', 'sparse-ring-24', 'sparse-bar-16', 'sparse-hot-16'],
};

// Private scenes: the benchmark's held-out set (agent-qa's scorer) and Anya's saved scene files.
function privateScenes(RF) {
  const out = {}, AQ = path.join(os.homedir(), 'Projects/agent-qa');
  try { const SC = require(path.join(AQ, 'tools/flux-scoring.js')); for (const [k, f] of Object.entries(SC.heldScenes(RF))) out['held-' + k] = f; } catch (e) { /* not on this machine */ }
  const files = { 'anya-shot-245': 'anya-screenshot-245-2026-09-29.json', 'anya-lowbeam-212': 'anya-lowbeam-212-2026-09-27.json', 'anya-lowbeam-1001': 'anya-lowbeam-1001-2026-09-29.json', 'anya-beamshot-400': 'anya-beamshot-400-2026-09-29.json' };
  for (const [k, f] of Object.entries(files)) { const p = path.join(AQ, 'scenes', f); if (fs.existsSync(p)) { const txt = fs.readFileSync(p, 'utf8'); out[k] = () => RF.State.deserialize(txt); } }
  // Anya's photos, made into paint maps by tools/photo-paint.js (bench-out/ is gitignored): photo-<name> on the default optics
  const PH = path.join(__dirname, '..', 'bench-out', 'photos');
  if (fs.existsSync(PH)) for (const f of fs.readdirSync(PH).filter((x) => /-\d+\.json$/.test(x))) {
    const d = JSON.parse(fs.readFileSync(path.join(PH, f), 'utf8'));
    out['photo-' + d.name] = () => { const s = RF.State.defaultScene(); if (s.target.res !== d.res) throw new Error('photo ' + d.name + ' is ' + d.res + '², target is ' + s.target.res + '²'); s.modeA.paint = d.paint.slice(); return s; };
  }
  return out;
}

function all(RF) { return Object.assign(suite(RF), privateScenes(RF)); }
function resolve(RF, spec) {
  const A = all(RF), names = [];
  for (const part of spec.split(',')) {
    if (part === 'all') names.push(...Object.keys(A));
    else if (part === 'held') names.push(...Object.keys(A).filter((k) => k.startsWith('held-')));
    else if (GROUPS[part]) names.push(...GROUPS[part]);
    else names.push(part);
  }
  const uniq = [...new Set(names)], bad = uniq.filter((n) => !A[n]);
  if (bad.length) throw new Error('unknown scene(s): ' + bad.join(', ') + '\nhave: ' + Object.keys(A).join(' ') + '\ngroups: ' + Object.keys(GROUPS).join(' ') + ' held all');
  return uniq;
}
module.exports = { suite, all, resolve, GROUPS, paintFrom, textPaint, cursivePaint };
