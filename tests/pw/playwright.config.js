// @playwright/test config for the page tests. See tests/RUNNER.md.
// It lives under tests/ (not at the repo root) because only js/, tests/, css/, index.html and *.md can land through the
// queue; everything here is resolved relative to THIS file's directory (tests/pw), so the repo root is '..'.
//   npx playwright test --config tests/pw/playwright.config.js                       every gate page test (adapter) + the native specs, chromium
//   npx playwright test --config tests/pw/playwright.config.js --project=webkit      the same under WebKit (Safari approximation)
//   npx playwright test --config tests/pw/playwright.config.js --grep-invert @solo --shard=1/4  the parallel pool, shard 1 of 4
//   npx playwright test --config tests/pw/playwright.config.js --grep @solo --workers=1         the solo tests, alone
//   GATE_TOUCHED=main npx playwright test --config tests/pw/playwright.config.js    the gate's --touched selection (MAP), see tests/runner/select.js
// Environment: PW_PORT (server, default 8744), PW_WORKERS (default 3), PW_RETRIES (default 1 on CI, else 0),
//   PW_GL=swiftshader|native (default: native on macOS, swiftshader elsewhere).
const { defineConfig } = require('@playwright/test');
const { SWIFTSHADER } = require('../runner/pw-env.js');
const PORT = +(process.env.PW_PORT || 8744), CI = !!process.env.CI;
// GATE_ONLY / GATE_TOUCHED narrow the native specs too (tests/pw/native/<name>.spec.js is test <name>); the adapter filters itself.
const { selected, pageTests } = require('../runner/select.js');
const narrowed = !!(process.env.GATE_ONLY || process.env.GATE_TOUCHED);
const testMatch = narrowed ? ['gate-adapter.spec.js', ...pageTests(selected()).map((n) => `native/${n}.spec.js`)] : ['**/*.spec.js'];
const GL = process.env.PW_GL || (process.platform === 'darwin' ? 'native' : 'swiftshader');
module.exports = defineConfig({
  testDir: '.',                                // this directory: the adapter + the native specs
  testMatch,
  fullyParallel: true,                         // shard and spread per test, not per file (the adapter is one file)
  workers: +(process.env.PW_WORKERS || 3),     // gate.js --jobs
  retries: +(process.env.PW_RETRIES || (CI ? 1 : 0)),   // a pass on retry is reported as "flaky", never as clean
  timeout: 660000,                             // gate.js --wall is 600 s; the adapter kills the script itself at timeout - 60 s
  expect: { timeout: 30000 },
  outputDir: '../../test-results',             // the repo root, not tests/pw/
  reporter: CI ? [['list'], ['blob'], ['junit', { outputFile: '../../test-reports/page-junit.xml' }]]
    : [['list'], ['html', { outputFolder: '../../test-reports/page-html', open: 'never' }], ['junit', { outputFile: '../../test-reports/page-junit.xml' }]],
  webServer: { command: `python3 ../serve.py ${PORT}`, url: `http://127.0.0.1:${PORT}/index.html`, reuseExistingServer: !CI, timeout: 30000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', gl: GL, port: PORT },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: GL === 'swiftshader' ? SWIFTSHADER : [] } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
