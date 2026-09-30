// Compare bench tags from bench-out/bench.jsonl:  node tools/dev/tagsummary.js tagA tagB [scene,scene,...]
// One row per scene (fidelity % / light on paint % / solve ms per tag), then the mean over the scenes present in every tag.
const fs = require('fs'), path = require('path');
const rows = fs.readFileSync(path.join(__dirname, '../../bench-out/bench.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tags = process.argv[2].split(','), only = process.argv[3] ? process.argv[3].split(',') : null;
const last = {}; for (const r of rows) last[r.tag + '|' + r.scene] = r;                  // the latest row per (tag, scene)
const scenes = [...new Set(rows.filter((r) => tags.includes(r.tag)).map((r) => r.scene))].filter((s) => !only || only.includes(s));
const f = (r) => r ? (100 * r.fidelity).toFixed(1).padStart(5) + ' / ' + (100 * r.onPaint).toFixed(1).padStart(5) + ' / ' + String(r.solveMs).padStart(6) + ' ms  ' + r.placed + '/' + r.budget : '  (not run)';
console.log('scene'.padEnd(20) + tags.map((t) => t.padEnd(44)).join(''));
const acc = tags.map(() => ({ n: 0, fid: 0, on: 0 }));
for (const sc of scenes) { console.log(sc.padEnd(20) + tags.map((t) => f(last[t + '|' + sc]).padEnd(44)).join('')); }
const common = scenes.filter((sc) => tags.every((t) => last[t + '|' + sc]));
tags.forEach((t, i) => { for (const sc of common) { acc[i].n++; acc[i].fid += 100 * last[t + '|' + sc].fidelity; acc[i].on += 100 * last[t + '|' + sc].onPaint; } });
console.log('MEAN over ' + common.length + ' common scenes'.padEnd(6) + acc.map((a) => ('fid ' + (a.fid / a.n).toFixed(1) + ' / onPaint ' + (a.on / a.n).toFixed(1)).padEnd(44)).join(''));
