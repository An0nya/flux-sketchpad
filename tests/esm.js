// tests/esm.js — load one of the ES-module shader/scene files as plain CommonJS and return named exports.
//
// Why this exists: `js/drive-three-shaders.js`, `js/drive-touge-three.js` and friends are ES modules, so a node test
// cannot `require` them. Every suite that needed one re-invented the same three-line trick — `tests/beam-atlas.js:16`
// has the original, and `tests/frenchie-touge-anchors.js` was about to become a second copy. qwen3.8max lifted it here
// verbatim so the copies stop multiplying. Additive: nothing that exists today has to change to use it.
// STATUS 11-01: this is currently the THIRD copy — tests/beam-atlas.js:16 and tests/frenchie-touge-anchors.js:9 each
// have their own. It only earns its place once one of those two requires it instead; until then it is the duplication
// it was written to end, which is worth saying out loud rather than leaving a tidy-looking file behind.
//
//   const { esm } = require('./esm.js');
//   const S     = esm('drive-three-shaders.js', null, ['withLighting', 'ground']);
//   const TOUGE = esm('drive-touge-three.js', { ground: S.ground }, ['passShader', 'rep', 'repHits']);
//
// `extra` supplies the module's own imports as locals (the shader modules take `ground` as a parameter, they do not
// import it), and `names` lists what to hand back. Strip only `import`/`export` keywords — the body is evaluated as
// written, so what you get back is the SHIPPED function, not a copy of it. That distinction is the whole point:
// a test that evals a pasted snippet of the function under test proves nothing about the code. (That rule is
// qwen3.8max's PROPOSED AGENTS.md point 24, not yet ratified by Anya — do not cite it as existing law.)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

const esm = (file, extra, names) => new Function(...Object.keys(extra || {}),
  fs.readFileSync(path.join(ROOT, 'js', file), 'utf8').replace(/^import .*$/mg, '').replace(/^export /gm, '')
  + '\nreturn { ' + (names || []).join(', ') + ' };')(...Object.values(extra || {}));

module.exports = { esm, ROOT };
