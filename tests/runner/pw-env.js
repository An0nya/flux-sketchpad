// Which `playwright` module an unmodified page script should require (its PLAYWRIGHT env var), per project and GL mode.
const path = require('path');
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const SHIM = path.join(__dirname, 'pw-shim.js');
const REAL = path.dirname(require.resolve('playwright/package.json', { paths: [__dirname] }));
function scriptEnv({ browserName, gl }) {
  if (browserName === 'webkit') return { PLAYWRIGHT: SHIM, PW_BROWSER: 'webkit' };   // the scripts only know pw.chromium
  return gl === 'swiftshader' ? { PLAYWRIGHT: SHIM } : { PLAYWRIGHT: REAL };
}
module.exports = { SWIFTSHADER, SHIM, REAL, scriptEnv };
