// The unmodified page scripts (tests/regress/*.js) as @playwright/test tests: one generated test per script, which spawns
// `node tests/regress/<name>.js <port>` against the config's webServer and fails on a non-zero exit or any [FAIL] line,
// the same verdict tests/gate.js reaches. Selection = gate.js plan() (GATE_ONLY / GATE_TOUCHED, see tests/runner/select.js).
// A script with a native replacement in tests/pw/native/<name>.spec.js is skipped here, so nothing runs twice.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const { test, expect } = require('./fixtures.js');
const { selected, pageTests, pageFile, root } = require('../runner/select.js');
const { FAIL_RE } = require('../runner/fail-lines.js');
const { tagsFor, ENV } = require('../runner/tags.js');
const { scriptEnv } = require('../runner/pw-env.js');
const native = (n) => fs.existsSync(path.join(__dirname, 'native', n + '.spec.js'));
const KILL_MARGIN_MS = 60000;   // kill the script's process group this long before Playwright's own timeout, so the log is kept

function runScript(name, port, env, wallMs) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.relative(root, pageFile(name)), String(port)], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    const killGroup = () => { try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ } };   // the browsers it launched too
    const to = setTimeout(() => { timedOut = true; killGroup(); }, wallMs);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code, signal) => { clearTimeout(to); killGroup(); resolve({ code, signal, timedOut, out }); });
  });
}

for (const name of pageTests(selected())) {
  if (native(name)) continue;
  test(name, { tag: ['@adapter', ...tagsFor(name)] }, async ({ port, gl, browserName }, testInfo) => {
    const env = Object.assign({}, process.env, scriptEnv({ browserName, gl }), ENV[name] || {});
    const r = await runScript(name, port, env, Math.max(30000, testInfo.timeout - KILL_MARGIN_MS));
    await testInfo.attach(name + '.log', { body: r.out, contentType: 'text/plain' });
    const failLines = r.out.split('\n').filter((l) => { FAIL_RE.lastIndex = 0; return FAIL_RE.test(l); });
    expect.soft(r.timedOut, 'wall timeout (process group killed)').toBe(false);
    expect.soft(failLines, '[FAIL] lines').toEqual([]);
    expect(r.code, 'exit code' + (r.signal ? ' (signal ' + r.signal + ')' : '')).toBe(0);
  });
}
