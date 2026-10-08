// concatenate the dev modules into ONE self-contained solver file (private RF: reads fall through to the app's, writes stay inside)
const fs = require('fs'), path = require('path');
const order = ['lens', 'geom', 'fwd', 'optic', 'target', 'plan', 'problem', 'layout', 'cells', 'greedy', 'polish', 'ellipsoid', 'assemble', 'continuous', 'main'];
const parts = order.map((n) => `// ============================================================ ${n}\n` + fs.readFileSync(path.join(__dirname, 'dev', n + '.js'), 'utf8'));
const header = fs.readFileSync(path.join(__dirname, 'dev', 'HEADER.txt'), 'utf8');
const out = header + '\n(function (globalThis) {\n' + parts.join('\n') + `\n})(Object.assign(Object.create(globalThis), { RF: Object.create(globalThis.RF) }));\n`;
try { new (require('vm').Script)(out, { filename: 'projector-liou (built)' }); } catch (e) { console.error('BUILD REFUSED: the output does not compile —', e.stack.split('\n').slice(0, 4).join(' | ')); process.exit(1); }
const dest = path.resolve(__dirname, '..', '..', 'solvers', process.argv[2] || 'projector-liou.js'); fs.writeFileSync(dest, out); console.log('wrote', dest, (out.length / 1024).toFixed(0) + ' KB');
