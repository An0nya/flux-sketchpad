// Node regression checks for fixed bugs — node tests/regress-node.js — exits 1 on failure.
const { load } = require('./load.js'); const RF = load();
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

// G21: RF.Modes.geometry's cache must stay bounded over many distinct paintings (each entry is ~48 KB of typed arrays at res 100)
{ const R = 100, mb = () => { if (global.gc) global.gc(); return process.memoryUsage().arrayBuffers / 1048576; };
  const paint = (q) => { const p = new Array(R * R).fill(0); let s = q * 2654435761 + 1; for (let k = 0; k < p.length; k++) { s = (s * 1664525 + 1013904223) >>> 0; if (s / 4294967296 < 0.3) p[k] = 1; } return p; };
  for (let q = 0; q < 20; q++) RF.Modes.geometry(paint(q), R, 3);
  const a = mb(); for (let q = 20; q < 220; q++) RF.Modes.geometry(paint(q), R, 3); const b = mb();
  ok('G21 geometry cache stays flat over 200 more distinct paintings', b - a < 3, 'arrayBuffers ' + a.toFixed(1) + ' MB → ' + b.toFixed(1) + ' MB (unbounded would add ~9.6 MB)');
  const p0 = paint(1000), g1 = RF.Modes.geometry(p0, R, 3); ok('G21 the latest painting is still served from the cache', RF.Modes.geometry(p0, R, 3) === g1); }
process.exit(fails ? 1 : 0);
