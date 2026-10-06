#!/usr/bin/env node
/* sweep.js --tag t --scenes a,b,c --variants '{"v0":{...},"v1":{...}}' [--rays 8e6] [--preset ece-r112-b] [--par 3] [--budget 100]
 * Runs bench.js once per variant (sequentially), prints one aggregate line per variant: Σ strict fail/unsure/pass, Σ loose pass/near/off, mean reach right/left. Writes out/sweep-<tag>.txt. */
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
const variants = JSON.parse(args.variants), scenes = args.scenes || 'box,led-back,slim,module,sealed7,file:/Users/anya/Downloads/reflector-scene-2.json', tag = args.tag || 'sw', lines = [];
for (const [name, set] of Object.entries(variants)) {
  const a = ['bench.js', '--solvers', 'sqm-hl', '--scenes', scenes, '--load', args.load || '../../solvers/sqm-hl.js', '--rays', args.rays || '8e6', '--par', args.par || '3', '--tag', `${tag}-${name}`, '--budget', args.budget || '100', '--settings', JSON.stringify(set)];
  if (args.preset) a.push('--preset', args.preset);
  const r = spawnSync('node', a, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 }), rows = r.stdout.split('\n').filter((l) => /sqm-hl/.test(l));
  let f = 0, u = 0, p = 0, lp = 0, ln = 0, lo = 0, rr = 0, rl = 0, n = 0, t = 0, per = [];
  for (const l of rows) { const m = l.match(/\{"pass":(\d+),"fail":(\d+),"unsure":(\d+)\} loose (\d+)\/(\d+)\/(\d+) reach (\d+)\/(\d+) solve ([\d.]+)s/); if (!m) continue; p += +m[1]; f += +m[2]; u += +m[3]; lp += +m[4]; ln += +m[5]; lo += +m[6]; rr += +m[7]; rl += +m[8]; t += +m[9]; n++; per.push(`${l.slice(0, 9).trim()}:${m[2]}f/${m[3]}u`); }
  const line = `${name.padEnd(14)} scenes ${n}  strict fail ${f} unsure ${u} pass ${p} | loose ${lp}/${ln}/${lo} | reach R ${(rr / n).toFixed(0)} L ${(rl / n).toFixed(0)} | solve ${(t / n).toFixed(0)}s | ${per.join(' ')}`;
  console.log(line); lines.push(line); fs.writeFileSync(path.join(__dirname, 'out', `sweep-${tag}.txt`), lines.join('\n') + '\n');
}
