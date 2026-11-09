// A tiny probe for the runner's own check (tests/runner-selftest.js): it loads the page env and asks it for the real
// playwright package, printing what happened, so the lazy resolution can be exercised with the package unavailable.
//   node --require ./tests/runner/fixtures/no-playwright.js tests/runner/fixtures/pw-env-lazy.js
const env = require('../pw-env.js');
console.log('LOADED ' + Object.keys(env).sort().join(','));
try { console.log('REAL ' + env.realPath()); }
catch (e) { console.log('ERROR ' + e.message); }
