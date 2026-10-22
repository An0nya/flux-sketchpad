// HDX3 step 2: evaluate lookup rules on exact per-bin integrals. node hdx3_rules_eval.js <rules_exact.json>
const fs = require('fs');
const runs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
// R0 = current shader/JS rule: bin 0 linear in d from 0 to e0; bins k>=1 linear in log d between edges.
// R1 = bin 0 log-linear from 0.5 m (C(0.5)=0), same as bins k>=1 (consistent start at the GPU bin start).
function look(bins, d, edges, rule) {
  if (!(d > 0)) return 0;
  const last = edges[edges.length - 1], dd = Math.min(d, last); let C = 0, prevC = 0, prevE = 0.5;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k]; C += bins[k];
    if (dd <= e) {
      if (k === 0 && (rule === 'R0' || rule === 'R2')) return C * (dd / e);
      if (k === 0 && rule.startsWith('P')) { const pw = +rule.slice(1); return C * Math.pow(Math.max(0, dd - 0.5) / (e - 0.5), pw); }
      if ((rule === 'R2' || rule.startsWith('P')) && prevC > 0 && C > 0) { const f2 = Math.log(dd / prevE) / Math.log(e / prevE); return prevC * Math.pow(C / prevC, f2); }
      const f = Math.log(dd / prevE) / Math.log(e / prevE);
      return prevC + (C - prevC) * f;
    }
    prevC = C; prevE = e;
  }
  return C;
}
const rules = (process.env.RULES || 'R0,R1,R2').split(',');
const results = [];
for (const run of runs) {
  const row = { D: +run.D.toFixed(1) };
  const P = run.pts;
  const cpu95 = q(P.map((p) => p.exactTotal), 0.95);
  const sig = P.filter((p) => p.exactTotal >= 0.01 * cpu95 && p.exactTotal > 0);
  for (const set of Object.keys(run.sets)) for (const rule of rules) {
    const lr = sig.map((p) => { const v = look(p.bins[set], p.sEnd, run.sets[set], rule) / p.exactTotal; return Math.log(v); });
    const rat = lr.map(Math.exp);
    const near = (lo, hi) => { const r = sig.map((p, i) => [p.sEnd, rat[i]]).filter(([s]) => s >= lo && s < hi).map(([, v]) => v); return r.length ? +q(r, 0.5).toFixed(2) : null; };
    row[set + '/' + rule] = { nb: run.sets[set].length, med: +q(rat, 0.5).toFixed(3), p95abslog: +q(lr.map(Math.abs), 0.95).toFixed(3), '0-10': near(0, 10), '10-20': near(10, 20), '20-30': near(20, 30), '30+': near(30, 1e9) };
  }
  results.push(row);
}
for (const r of results) console.log(JSON.stringify(r));
