// shared harness for editing-area probes (port 8811)
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');  // global npm root has no playwright on this Mac
const DIR = __dirname;
async function open(opts) {
  opts = opts || {};
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1500, height: 950 }, hasTouch: !!opts.touch });
  const page = await ctx.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e) + '\n' + (e.stack || '')));
  await page.goto('http://localhost:8811/index.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  const t = await page.title();
  return { browser, page, errors, title: t };
}
const idle = (page, ms) => page.waitForFunction(() => !RF.UI.solving && !RF.UI.pendingA, null, { timeout: ms || 120000 });
async function rect(page, id) { return page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, id); }
// activate pane holding canvas id (first press on an inactive pane is swallowed for the editor)
async function activate(page, id) {
  await page.evaluate((id) => { const el = document.getElementById(id).closest('.pane'); if (el && !el.classList.contains('active')) { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } }, id);
  await page.waitForTimeout(50);
}
async function drag(page, pts, steps) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1], { steps: steps || 8 });
  await page.mouse.up();
}
async function setMode(page, m) { await page.evaluate((m) => RF.UI.setMode(m), m); await page.waitForTimeout(100); }
async function loadPreset(page, val) {
  await page.evaluate((v) => { const s = document.getElementById('preset-select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, val);
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#preset-confirm button.primary').click());
  await page.waitForTimeout(300);
}
module.exports = { pw, open, idle, rect, activate, drag, setMode, loadPreset, DIR };
