// Compare two scenario output dirs (two builds, or before and after a change):
//   node tests/scenario/compare.js <dirA> <dirB> [--tol 0.02]
// For each scenario and capture present in both: did the hash change, and how far did the mean luminance and each region move (relative to A, floored at 1).
// A row is BEYOND when the luminance or any region moved by more than --tol (default 0.02 = 2 %), or when the capture is missing on one side.
// Exit 0 when nothing is beyond tolerance, 1 when something is. A hash change alone is not a failure (the file says so in its row).
const fs = require('fs'), path = require('path');

function readDir(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (doc && doc.name && Array.isArray(doc.captures)) out[doc.name] = doc;
  }
  return out;
}
const rel = (a, b) => Math.abs(b - a) / Math.max(Math.abs(a), 1);

// Returns rows: { scenario, capture, hashChanged, luma: [a, b, rel], regions: { name: rel }, beyond, note }
function compareDirs(dirA, dirB, tol = 0.02) {
  const A = readDir(dirA), B = readDir(dirB), rows = [];
  const names = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  for (const n of names) {
    if (!A[n] || !B[n]) { rows.push({ scenario: n, capture: '-', beyond: true, note: A[n] ? 'only in A' : 'only in B' }); continue; }
    const capsB = new Map(B[n].captures.map((c) => [c.name, c]));
    for (const ca of A[n].captures) {
      const cb = capsB.get(ca.name);
      if (!cb) { rows.push({ scenario: n, capture: ca.name, beyond: true, note: 'capture only in A' }); continue; }
      const lumaRel = rel(ca.luma, cb.luma);
      const regions = {};
      let worst = lumaRel;
      for (const r of Object.keys(ca.regions || {})) { regions[r] = rel(ca.regions[r], (cb.regions || {})[r] ?? 0); worst = Math.max(worst, regions[r]); }
      rows.push({ scenario: n, capture: ca.name, hashChanged: ca.hash !== cb.hash, luma: [ca.luma, cb.luma, lumaRel], regions, beyond: worst > tol, note: '' });
    }
  }
  return rows;
}

function report(rows, tol) {
  const pct = (x) => (100 * x).toFixed(2) + '%';
  for (const r of rows) {
    if (r.note) { console.log(`${r.beyond ? 'BEYOND' : 'ok    '} ${r.scenario} ${r.capture}: ${r.note}`); continue; }
    const reg = Object.entries(r.regions).map(([k, v]) => k + ' ' + pct(v)).join(', ');
    console.log(`${r.beyond ? 'BEYOND' : 'ok    '} ${r.scenario} ${r.capture}: hash ${r.hashChanged ? 'CHANGED' : 'same   '}  luma ${r.luma[0].toFixed(3)} -> ${r.luma[1].toFixed(3)} (${pct(r.luma[2])})  regions ${reg}`);
  }
  const beyond = rows.filter((r) => r.beyond).length;
  console.log(beyond ? `${beyond} of ${rows.length} rows beyond tolerance ${pct(tol)}` : `all ${rows.length} rows within tolerance ${pct(tol)}`);
  return beyond;
}

module.exports = { compareDirs, readDir };

if (require.main === module) {
  const args = process.argv.slice(2); const i = args.indexOf('--tol');
  const tol = i >= 0 ? +args[i + 1] : 0.02; if (i >= 0) args.splice(i, 2);
  if (args.length !== 2 || !(tol >= 0)) { console.error('usage: node tests/scenario/compare.js <dirA> <dirB> [--tol 0.02]'); process.exit(2); }
  const beyond = report(compareDirs(args[0], args[1], tol), tol);
  process.exitCode = beyond ? 1 : 0;
}
