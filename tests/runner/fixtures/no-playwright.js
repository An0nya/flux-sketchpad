// Preload for the runner's own check (tests/runner-selftest.js): makes 'playwright/package.json' unresolvable in this
// process, so the lazy resolution in tests/runner/pw-env.js can be exercised on a machine where the page deps ARE
// installed (and on one where they are not).
//   node --require ./tests/runner/fixtures/no-playwright.js -e "require('./tests/runner/pw-env.js')"
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'playwright/package.json') {
    const e = new Error("Cannot find module 'playwright/package.json'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  return resolve.call(this, request, ...rest);
};
