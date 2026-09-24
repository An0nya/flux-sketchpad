#!/usr/bin/env node
// Headless verification runner: loads the same classic scripts the page loads and runs every
// check in RF.Checks.list.  Usage: node tests/headless.js [--only 1,2,14] [--json out.json]
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
const RF = load();
RF.nodeEnv = { fs, path, root: ROOT };
const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1] : null;
const only = onlyArg ? onlyArg.split(',').map(Number) : null;
const jsonOut = argv.indexOf('--json') >= 0 ? argv[argv.indexOf('--json') + 1] : null;
const list = RF.Checks.list.slice().sort((a, b) => a.id - b.id).filter((c) => !only || only.includes(c.id));
let fails = 0, skipped = 0;
const out = [];
const t00 = Date.now();
for (const c of list) {
  const t0 = Date.now();
  let r;
  try { r = c.fn(); } catch (e) { r = { pass: false, detail: 'THREW: ' + (e && e.stack || e) }; }
  const ms = Date.now() - t0;
  const tag = r.pass === null ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
  if (r.pass === false) fails++; if (r.pass === null) skipped++;
  console.log(`[${tag}] #${c.id} ${c.name}  (${ms} ms)\n       ${r.detail}`);
  out.push({ id: c.id, name: c.name, status: tag, ms, detail: r.detail });
}
console.log(`\n${list.length - fails - skipped} passed, ${fails} failed, ${skipped} skipped — ${((Date.now() - t00) / 1000).toFixed(1)} s total, node ${process.version}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ when: new Date().toISOString(), node: process.version, results: out }, null, 1));
process.exit(fails ? 1 : 0);
