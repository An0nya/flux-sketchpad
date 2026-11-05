// Shared @playwright/test fixtures for the page tests. Native specs import { test, expect } from here.
// What replaces each piece of the old per-file boilerplate:
//   pw.chromium.launch(...)              the built-in worker-scoped `browser` (one per worker, launch args from playwright.config.js)
//   browser.newPage({ viewport })        the built-in `page`, in a fresh context per test; set the size with test.use({ viewport })
//   localStorage.clear() before boot     not needed: every test gets a fresh context, so storage starts empty
//   python3 tests/serve.py <port>        webServer in playwright.config.js; page.goto('/index.html') resolves against baseURL
//   errors = []; page.on('pageerror')    the `pageErrors` / `consoleErrors` fixtures (arrays filled for the whole test)
//   ok(name, cond, detail) + fails++     expect.soft(value, name)...: every check still runs and is reported, the test fails at the end
const base = require('@playwright/test');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const test = base.test.extend({
  gl: ['swiftshader', { option: true }],   // set in playwright.config.js: 'swiftshader' | 'native'
  port: [8744, { option: true }],
  pageErrors: async ({ page }, use) => { const e = []; page.on('pageerror', (x) => e.push(String(x))); await use(e); },
  consoleErrors: async ({ page }, use) => { const e = []; page.on('console', (m) => { if (m.type() === 'error') e.push(m.text().slice(0, 300)); }); await use(e); },
  // The app booted from the test server (pinned defaults), favicon noise suppressed, RF.UI ready to drive.
  app: async ({ page, pageErrors }, use) => {
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await use(page);
  },
  // The in-page Drive display up and settled, via the page helper UX2-drive-ux.js (it is both a page test and that helper).
  drive: async ({ app }, use) => {
    await app.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
    await app.evaluate(() => UX2Page.ready());
    await use(app);
  },
});
// Load a scene fixture from tests/fixtures/ into the running app.
async function loadScene(page, name, label = name) {
  const txt = fs.readFileSync(path.join(root, 'tests', 'fixtures', name), 'utf8');
  await page.evaluate(([s, l]) => RF.UI.loadScene(RF.State.deserialize(s), l), [txt, label]);
}
module.exports = { test, expect: base.expect, loadScene, root };
