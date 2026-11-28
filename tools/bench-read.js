// Read a flux-bench results file (the drive's Benchmark button, or tools/bench-run.js): print a table, write the screenshots.
// node tools/bench-read.js <flux-bench-*.json> [more files: compared side by side on real ms]
const fs = require('fs'), path = require('path');
const files = process.argv.slice(2); if (!files.length) { console.log('usage: node tools/bench-read.js <flux-bench.json> [...]'); process.exit(1); }
const docs = files.map((f) => ({ f, d: JSON.parse(fs.readFileSync(f, 'utf8')) }));
const f1 = (v) => (v === null || v === undefined ? '-' : (+v).toFixed(1));
for (const { f, d } of docs) {
  const e = d.env || {};
  console.log('\n## ' + path.basename(f) + ' · ' + (d.started || '') + ' · ' + f1(d.seconds) + ' s · sim ' + (e.sim || []).join('x') + ' · dpr ' + e.dpr + (d.error ? ' · ERROR ' + d.error : ''));
  const dv = d.device || {}; console.log('   device: ' + (dv.name || '(no name)') + (dv.screen ? ' · screen ' + dv.screen.join('x') + ' @' + dv.dpr : '') + (dv.cores ? ' · ' + dv.cores + ' cores' : '') + (dv.gpu ? ' · ' + dv.gpu : ''));
  console.log('   ' + (e.userAgent || '') + '\n   ' + (d.url || ''));
  const keys = []; for (const r of d.rows) for (const k of Object.keys(r.stages || {})) if (!keys.includes(k)) keys.push(k);
  const halo = (s) => Object.entries(s).filter(([k]) => k.startsWith('halo ')).reduce((a, [, v]) => a + v, 0), top = keys.filter((k) => !k.startsWith('halo '));
  console.log('scene     variant             real ms   p95   fps  │ stages (synced, read as shares): ' + top.join(' · ') + ' · halo total');
  for (const r of d.rows) {
    const re = r.real || {}, base = d.rows.find((q) => q.scene === r.scene && q.variant === 'baseline'), delta = base && base !== r && base.real && re.ms ? ' (' + ((re.ms / base.real.ms - 1) * 100).toFixed(0) + '%)' : '';
    const st = r.stages ? top.map((k) => f1(r.stages[k])).join(' · ') + ' · ' + f1(halo(r.stages)) : '';
    console.log(r.scene.padEnd(10) + r.variant.padEnd(19) + (f1(re.ms) + delta).padStart(12) + f1(re.p95).padStart(6) + (re.ms ? (1000 / re.ms).toFixed(0) : '-').padStart(6) + '  │ ' + st);
  }
  if (d.drift) console.log('heat drift: first ' + f1(d.drift.first) + ' ms → last ' + f1(d.drift.last) + ' ms (x' + d.drift.ratio + ')');
  for (const [name, url] of Object.entries(d.shots || {})) if (/^data:image\/jpeg;base64,/.test(url)) { const out = f.replace(/\.json$/, '') + '-' + name + '.jpg'; fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64')); console.log('shot: ' + out); }
}
if (docs.length > 1) {
  console.log('\n## real ms side by side'); const rows = docs[0].d.rows;
  for (const r of rows) console.log((r.scene + ' · ' + r.variant).padEnd(30) + docs.map(({ d }) => { const q = d.rows.find((x) => x.scene === r.scene && x.variant === r.variant); return f1(q && q.real && q.real.ms).padStart(9); }).join(''));
}
