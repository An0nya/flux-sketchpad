// concatenate the dev modules into ONE self-contained solver file.  Every module sees a private RF (reads fall through to the app's, writes stay inside).
const fs = require('fs'), path = require('path');
const order = ['fwd', 'target', 'plan', 'sqm', 'emit', 'pipeline', 'solver-main'];
const parts = order.map((n) => `// ============================================================ ${n}\n` + fs.readFileSync(path.join(__dirname, 'dev', n + '.js'), 'utf8'));
const header = fs.readFileSync(path.join(__dirname, 'dev', 'HEADER.txt'), 'utf8');
const out = header + '\n(function (globalThis) {\n' + parts.join('\n') + `\n})(Object.assign(Object.create(globalThis), { RF: Object.create(globalThis.RF) }));\n`;
const dest = path.resolve(__dirname, '..', '..', 'solvers', process.argv[2] || 'sqm-hl.js'); fs.writeFileSync(dest, out); const dbg = path.join(__dirname, 'build'); fs.mkdirSync(dbg, { recursive: true }); fs.writeFileSync(path.join(dbg, 'sqm-hl.debug.js'), out.replace('RF.SqmSolver = {', '(0, eval)("this").__sqm = RF; RF.SqmSolver = {')); console.log('built', dest, out.length, 'bytes,', out.split('\n').length, 'lines');
