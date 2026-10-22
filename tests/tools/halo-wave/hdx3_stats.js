// HDX3 step 1 stats. node hdx3_stats.js <diag.json>
const fs = require('fs');
const J = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const q = (a, p) => { if (!a.length) return NaN; a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const f = (x) => (isFinite(x) ? x.toFixed(2) : 'na');
for (const run of J.runs) {
  const P = run.pts, cpu95 = q(P.map((p) => p.cpuPixNew), 0.95);
  const sig = P.filter((p) => p.cpuPixNew >= 0.01 * cpu95 && p.exactCellTotal > 0 && p.gpuRaw > 0);
  const lr = (a, b) => sig.map((p) => Math.log(a(p) / b(p)));
  const rOld = P.filter((p) => p.cpuPixNew > 0).map((p) => p.cpuPixOld / p.cpuPixNew);
  const rawNew = sig.map((p) => p.gpuRaw / p.cpuPixNew), rawOld = sig.map((p) => p.gpuRaw / p.cpuPixOld);
  const lookII = sig.map((p) => p.lookExact / p.exactCellTotal), gpuCell = sig.map((p) => p.gpuRaw / p.exactCellTotal);
  const binI = [0, 1, 2, 3, 4, 5].map((k) => { const v = P.filter((p) => p.exactBins[k] > 0.01 * Math.max(...P.map((x) => x.exactBins[k])) && p.gpuBins[k] > 0).map((p) => p.gpuBins[k] / p.exactBins[k]); return f(q(v, 0.5)) + '(n' + v.length + ')'; });
  const near = (lo, hi, arr) => f(q(sig.filter((p) => p.sEnd >= lo && p.sEnd < hi).map(arr), 0.5));
  console.log(JSON.stringify({ D: +run.D.toFixed(1), edges: run.edges.map((x) => +x.toFixed(1)), n_sig: sig.length,
    oldRef_over_newRef_median: f(q(rOld, 0.5)),
    GPU_over_newRef: { median: f(q(rawNew, 0.5)), p95abslog: f(q(rawNew.map((r) => Math.abs(Math.log(r))), 0.95)) },
    GPU_over_oldRef_median: f(q(rawOld, 0.5)),
    lookup_test_exactBins_over_exactTotal: { median: f(q(lookII, 0.5)), p95abslog: f(q(lookII.map((r) => Math.abs(Math.log(r))), 0.95)) },
    GPU_over_exactCellTotal_median: f(q(gpuCell, 0.5)),
    build_test_perBin_median_GPUbin_over_exactBin: binI,
    GPU_over_newRef_by_sEnd: { '0-10': near(0, 10, (p) => p.gpuRaw / p.cpuPixNew), '10-20': near(10, 20, (p) => p.gpuRaw / p.cpuPixNew), '20-30': near(20, 30, (p) => p.gpuRaw / p.cpuPixNew), '30+': near(30, 1e9, (p) => p.gpuRaw / p.cpuPixNew) },
    lookup_by_sEnd: { '0-10': near(0, 10, (p) => p.lookExact / p.exactCellTotal), '10-20': near(10, 20, (p) => p.lookExact / p.exactCellTotal), '20-30': near(20, 30, (p) => p.lookExact / p.exactCellTotal), '30+': near(30, 1e9, (p) => p.lookExact / p.exactCellTotal) } }));
}
