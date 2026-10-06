#!/usr/bin/env node
/* mbench.js --scenes a,b (or a;b;c when a name holds commas, e.g. box@25,0,0) --variants '{"v":{...}}' [--preset p] [--par 5] [--debug build/x.js] — noise-free comparison: one mrun.js per (scene, variant); aggregate per variant. */
const { spawn } = require('child_process'); const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
const scenes = (args.scenes || 'box,led-back,slim,module,sealed7,file:/Users/anya/Downloads/reflector-scene-2.json').split(String(args.scenes || '').includes(';') ? ';' : ','), variants = JSON.parse(args.variants || '{"base":{}}'), par = +(args.par || 5), jobs = [];
for (const [vn, set] of Object.entries(variants)) for (const sc of scenes) jobs.push({ vn, sc, set });
const res = {}; let idx = 0;
function run(j) { return new Promise((ok) => { const p = spawn('node', ['mrun.js', j.sc, JSON.stringify(j.set), args.preset || 'ece-r112-b'], { cwd: __dirname, env: Object.assign({}, process.env, args.debug ? { SQM_DEBUG: args.debug } : {}) }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('close', () => { let r; try { r = JSON.parse(o.trim().split('\n').pop()); } catch (e) { r = { scene: j.sc, err: o.slice(-300) }; } (res[j.vn] = res[j.vn] || []).push(r); ok(); }); }); }
(async () => { await Promise.all(Array.from({ length: par }, async () => { while (idx < jobs.length) await run(jobs[idx++]); }));
  for (const vn of Object.keys(variants)) { const R = res[vn].sort((a, b) => String(a.scene).localeCompare(String(b.scene))); let f = 0, u = 0, p = 0, w = 0, t = 0, n = 0, wb = 0;
    for (const r of R) { if (r.err) { console.log(`  ${vn} ${r.scene} ERROR ${r.err}`); continue; } f += r.n.fail; u += r.n.unsure; p += r.n.pass; w += r.worst; t += r.ms; n++; if (r.worst < 0) wb++; }
    console.log(`${vn.padEnd(18)} Σ fail ${f} unsure ${u} pass ${p} | mean worst margin ${(w / n).toFixed(3)} | scenes with a negative margin ${wb}/${n} | solve ${(t / n / 1000).toFixed(0)}s`);
    for (const r of R) if (!r.err) console.log(`    ${String(r.scene).slice(0, 10).padEnd(10)} f${r.n.fail} u${r.n.unsure} worst ${String(r.worst).padStart(6)} lm ${r.lm} ${r.chosen || ''} | ${r.bad.join('; ')}`); } })();
