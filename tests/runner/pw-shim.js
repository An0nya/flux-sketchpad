// A drop-in for the `playwright` module, for machines without a GPU (CI on ubuntu, cloud containers).
// The page tests do `require(process.env.PLAYWRIGHT || ...)` and launch Chromium with whatever GL flags they were written for
// (--use-angle=metal, --use-gl=angle, nothing). Point PLAYWRIGHT at this file and every chromium launch is rewritten to
// SwiftShader instead: the --use-gl / --use-angle flags are dropped and the SwiftShader set is added. Nothing else changes.
//   PW_REAL=<path>      the real playwright module (default: the one @playwright/test installed, from package.json)
//   PW_BROWSER=webkit   chromium.* launches run WebKit instead (chromium-only args and channel dropped): a Safari approximation
//                       for the unmodified scripts. On Linux WebKit renders GL in software too.
const real = require(process.env.PW_REAL || require.resolve('playwright', { paths: [__dirname] }));
const STRIP = /^--(use-gl|use-angle)(=|$)/;
const { SWIFTSHADER } = require('./pw-env.js');
const target = process.env.PW_BROWSER === 'webkit' ? 'webkit' : 'chromium';
function rewrite(opts) {
  const o = Object.assign({}, opts || {});
  if (target === 'webkit') { delete o.args; delete o.channel; delete o.chromiumSandbox; delete o.executablePath; return o; }
  o.args = (o.args || []).filter((a) => !STRIP.test(a)).concat(SWIFTSHADER);
  return o;
}
const LAUNCHERS = { launch: 0, launchServer: 0, launchPersistentContext: 1 };   // index of the options argument
const chromium = new Proxy(real[target], {
  get(t, k) {
    if (!(k in LAUNCHERS)) { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
    return (...a) => { const i = LAUNCHERS[k]; a[i] = rewrite(a[i]); return t[k](...a); };
  },
});
module.exports = new Proxy(real, { get: (t, k) => (k === 'chromium' ? chromium : t[k]) });
