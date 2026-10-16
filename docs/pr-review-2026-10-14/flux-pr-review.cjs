const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = '/private/tmp/flux-pr-readiness-20261014';
const out = '/Users/anya/Projects/flux-sketchpad/docs/pr-review-2026-10-14';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, PLAYWRIGHT: '/Users/anya/Projects/agent-qa/node_modules/playwright', F2_REAL_GPU: '1' };
const resuming = process.argv.includes('--parallel-resume');
const summary = resuming ? JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')) : [];
async function run(file) {
  const log = path.join(out, file.replaceAll('/', '_') + '.log');
  const stream = fs.createWriteStream(log);
  const args = [file];
  if (file.startsWith('tests/regress/')) args.push('8836');
  const code = await new Promise(resolve => {
    const p = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(stream, { end: false }); p.stderr.pipe(stream, { end: false });
    const timer = setTimeout(() => p.kill('SIGTERM'), 240000);
    p.on('close', code => { clearTimeout(timer); stream.end(() => resolve(code)); });
  });
  const raw = fs.readFileSync(log, 'utf8');
  const row = { file, code, pass: (raw.match(/\[PASS\]/g) || []).length, fail: (raw.match(/\[FAIL\]/g) || []).length, log };
  summary.push(row); fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(row));
}
(async () => {
  if (process.argv.includes('--screenshots')) { await require('/private/tmp/flux-pr-screenshots.cjs')(); return; }
  if (resuming) {
    const oldPid = +process.argv[process.argv.indexOf('--stop-pid') + 1];
    const { execFileSync } = require('child_process');
    const rows = execFileSync('ps', ['-ax', '-o', 'pid,ppid,command'], { encoding: 'utf8' }).split('\n').map(line => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], cmd: m[3] };
    }).filter(Boolean);
    const old = rows.find(x => x.pid === oldPid);
    if (!old || oldPid === process.pid || old.cmd !== 'node /private/tmp/flux-pr-review.cjs') throw new Error('Refusing to stop a process that is not the previous review runner');
    const owned = new Set([oldPid]); let more = true;
    while (more) { more = false; for (const r of rows) if (owned.has(r.ppid) && !owned.has(r.pid)) { owned.add(r.pid); more = true; } }
    process.kill(oldPid, 'SIGTERM');
    for (const pid of [...owned].slice(1).reverse()) { try { process.kill(pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    fs.writeFileSync(path.join(out, 'runner-resume.json'), JSON.stringify({ stoppedRunner: oldPid, stoppedOwnedProcesses: [...owned], completedChecksRetained: summary.length, concurrency: 3 }, null, 2));
    await new Promise(r => setTimeout(r, 500));
    const done = new Set(summary.filter(x => x.code === 0 && !x.fail).map(x => x.file));
    const pending = fs.readdirSync(path.join(root, 'tests/regress')).filter(x => x.endsWith('.js')).sort().map(x => 'tests/regress/' + x).filter(x => !done.has(x));
    console.log('[RESUME] retained ' + summary.length + ' checks; ' + pending.length + ' browser scripts remain, concurrency 3');
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (next < pending.length) { const file = pending[next++]; await run(file); } }));
    process.exitCode = summary.some(x => x.code !== 0 || x.fail) ? 1 : 0;
    return;
  }
  await run('tests/all.js');
  await run('tests/regress-node.js');
  const files = fs.readdirSync(path.join(root, 'tests/regress')).filter(x => x.endsWith('.js')).sort();
  for (const f of files) await run('tests/regress/' + f);
  process.exitCode = summary.some(x => x.code !== 0 || x.fail) ? 1 : 0;
})();
