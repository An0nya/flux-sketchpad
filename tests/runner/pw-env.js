// Which `playwright` module an unmodified page script should require (its PLAYWRIGHT env var), per project and GL mode.
// The real playwright package is resolved LAZILY, when a script actually needs it: this module is also required by the
// config, the tags and the adapter, and they must load even when the page dependencies are not installed yet.
const path = require('path');
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const SHIM = path.join(__dirname, 'pw-shim.js');
const realPath = () => {
  try { return path.dirname(require.resolve('playwright/package.json', { paths: [__dirname] })); }
  catch (e) { throw new Error('the page runner needs the playwright package: npm i -D @playwright/test@1.63.0 (see tests/RUNNER.md)'); }
};
function scriptEnv({ browserName, gl }) {
  if (browserName === 'webkit') return { PLAYWRIGHT: SHIM, PW_BROWSER: 'webkit' };   // the scripts only know pw.chromium
  return gl === 'swiftshader' ? { PLAYWRIGHT: SHIM } : { PLAYWRIGHT: realPath() };
}
module.exports = { SWIFTSHADER, SHIM, realPath, scriptEnv };
