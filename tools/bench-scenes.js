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

// Put the LED at a point inside the default envelope, facing `axis`.  The envelope stays where it is.
function placeLed(s, where, axis) {
  const c = s.envelope.center, h = s.envelope.half;
  s.source.pos = [c[0] + where[0] * h[0], c[1] + where[1] * h[1], c[2] + where[2] * h[2]];
  s.source.axis = axis;
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
    'p-hotwash': withPaint((u, v) => (Math.hypot(u / 0.9, v / 0.5) < 1 ? (Math.hypot(u / 0.15, v / 0.1) < 1 ? 1 : 0.12) : 0)),   // a small hotspot 8× the wash
  };
  return S;
}

// Named groups.  'core' is the everyday check; 'all' is everything incl. held-out and Anya's files.
const GROUPS = {
  core: ['default', 'test', 'led-back', 'led-side', 'die-3', 'die-2x0.5', 'p-wash', 'p-halfplane', 'p-text', 'p-hotwash'],
  orient: ['default', 'led-back', 'led-side', 'led-down', 'led-fwd'],
  die: ['default', 'die-0.4', 'die-3', 'die-2x0.5', 'die-disc', 'filament', 'coil-axial', 'coil-transverse'],
  paint: ['default', 'p-wash', 'p-halfplane', 'p-bars', 'p-text', 'p-gradient', 'p-spots', 'p-hotwash'],
  anya: ['anya-lowbeam-212', 'anya-beamshot-400'],
};

// Private scenes: the benchmark's held-out set (agent-qa's scorer) and Anya's saved scene files.
function privateScenes(RF) {
  const out = {}, AQ = path.join(os.homedir(), 'Projects/agent-qa');
  try { const SC = require(path.join(AQ, 'tools/flux-scoring.js')); for (const [k, f] of Object.entries(SC.heldScenes(RF))) out['held-' + k] = f; } catch (e) { /* not on this machine */ }
  const files = { 'anya-lowbeam-212': 'anya-lowbeam-212-2026-09-27.json', 'anya-lowbeam-1001': 'anya-lowbeam-1001-2026-09-29.json', 'anya-beamshot-400': 'anya-beamshot-400-2026-09-29.json' };
  for (const [k, f] of Object.entries(files)) { const p = path.join(AQ, 'scenes', f); if (fs.existsSync(p)) { const txt = fs.readFileSync(p, 'utf8'); out[k] = () => RF.State.deserialize(txt); } }
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
module.exports = { suite, all, resolve, GROUPS, paintFrom, textPaint };
