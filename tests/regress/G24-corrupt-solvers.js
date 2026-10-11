// G24: a corrupt flux/solvers localStorage value (valid JSON, not an array) must not throw on load; it is ignored with a console warning and rebuilt.
// node tests/regress/G24-corrupt-solvers.js [port]   (needs: python3 tests/serve.py <port>; PLAYWRIGHT=<path to playwright>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8828);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
(async () => {
  const browser = await pw.chromium.launch();
  for (const junk of ['{"a":1}', '"hi"', '42', 'null', '[1,{"x":2}]', 'not json']) {
    const page = await (await browser.newContext()).newPage(), errors = [], warns = [];
    page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
    await page.addInitScript((j) => { try { localStorage.setItem('flux/solvers', j); } catch (e) { /* ignore */ } }, junk);
    await page.goto('http://localhost:' + port + '/index.html');
    const up = await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 30000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => { let v = null; try { v = JSON.parse(localStorage.getItem('flux/solvers')); } catch (e) { /* stays null */ } return { bundled: !!RF.Solvers.get('patch-array'), key: v }; });
    ok(junk + ': the app boots and finishes loading solvers', up && st.bundled, 'errors ' + errors.join(' | '));
    ok(junk + ': no page error', errors.length === 0, errors.join(' | '));
    ok(junk + ': the key is rebuilt as a clean array', Array.isArray(st.key) && st.key.every((s) => typeof s === 'string'), JSON.stringify(st.key));
    ok(junk + ': a console warning names flux/solvers', warns.some((w) => /flux\/solvers/.test(w)), warns.join(' | ').slice(0, 120));
    await page.context().close();
  }
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('[FAIL] script error ' + e.message); process.exit(1); });
