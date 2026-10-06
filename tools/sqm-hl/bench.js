#!/usr/bin/env node
/* bench.js --solvers a,b --scenes s1,s2 [--preset ece-r112-b] [--budget 100] [--rays 8e6] [--load f.js] [--par 3] [--tag name] [--settings '{"a":1}']
 * Runs run-on-scene.js as child processes (parallel), writes out/<tag>-<scene>-<solver>.{log,png,scene.json}, prints a table. */
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const solvers = String(args.solvers).split(','), scenes = String(args.scenes || 'box').split(','), par = +(args.par || 3), tag = args.tag || 'b';
require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true });
const jobs = []; for (const sc of scenes) for (const sv of solvers) jobs.push({ sc, sv });
const results = [];
function run(job) {
  return new Promise((res) => {
    const base = `${tag}-${job.sc.replace(/[^\w.-]/g, '_')}-${job.sv}`, log = path.join(__dirname, 'out', base + '.log');
    const a = ['run-on-scene.js', job.sv, '--scene', job.sc, '--preset', args.preset || 'ece-r112-b', '--budget', String(args.budget || 100), '--rays', String(args.rays || 8e6), '--out', base, '--dir', path.join(__dirname, 'out')];
    if (args.load) a.push('--load', args.load); if (args.settings) a.push('--settings', args.settings);
    const p = spawn('node', a, { cwd: __dirname }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', () => { fs.writeFileSync(log, out); const g = (re) => { const m = out.match(re); return m ? m[1] : null; };
      const lo = (out.match(/loose (\d+) pass \/ (\d+) near \/ (\d+) off/) || []).slice(1).join('/'), verdict = g(/verdict (\w+) n/), n = (out.match(/n (\{[^}]*\})/) || [])[1], solve = g(/solve ([\d.]+) s/), facets = g(/, (\d+) surfaces/), lm = g(/lm-in-window (\d+)/);
      const fails = [...out.matchAll(/^fail\s+(.+?)\s{2,}/gm)].map((m) => m[1]).join(', '), uns = [...out.matchAll(/^unsure\s+(.+?)\s{2,}/gm)].map((m) => m[1]);
      const err = /SOLVE ERROR/.test(out) ? (out.match(/SOLVE ERROR ([^\n]*)/) || [])[1] : null;
      results.push({ ...job, verdict, n, solve, facets, lm, fails, unsure: [...new Set(uns)].join(', '), err, base }); console.log(`${job.sc.padEnd(9)} ${job.sv.padEnd(14)} ${err ? 'ERROR ' + err : `${verdict} ${n} loose ${lo} solve ${solve}s facets ${facets} lm ${lm} | FAIL: ${fails || '-'} | unsure: ${[...new Set(uns)].join(', ') || '-'}`}`); res(); }); });
}
(async () => { const q = jobs.slice(); await Promise.all(Array.from({ length: par }, async () => { while (q.length) await run(q.shift()); })); })();
