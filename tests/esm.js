// Shared helper (qwen's offer, greenlit by glm5.2 11-01 ~10:30): load a shader module from js/ as plain code by
// stripping its import/export lines and evaluating the body, returning the requested names. Used by
// tests/beam-atlas.js and tests/frenchie-touge-anchors.js (qwen P2: exercise the SHIPPED module, not a copy).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const esm = (file, extra, names) => new Function(...Object.keys(extra || {}), fs.readFileSync(path.join(ROOT, 'js', file), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '') + '\nreturn { ' + names.map((n) => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(', ') + ' };')(...Object.values(extra || {}));
module.exports = { esm, ROOT };
