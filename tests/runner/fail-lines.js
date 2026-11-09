// Preload for `node --test --require tests/runner/fail-lines.js tests/<suite>.js`.
// The Node suites are plain scripts: some exit 0 after printing [FAIL] lines, and tests/gate.js counts those lines as failures.
// node --test only looks at the exit code, so this preload counts the same lines (gate.js's regex) on this process's own
// stdout/stderr and forces a non-zero exit when any were printed. A grandchild started with stdio 'inherit' writes to the fd
// directly and is not counted here; such suites (regress-node.js re-spawning itself with --expose-gc) pass its exit status up.
const FAIL_RE = /^\s*\[?(FAIL|✗|not ok)/gm;
let fails = 0;
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => { fails += (String(chunk).match(FAIL_RE) || []).length; return write(chunk, ...rest); };
}
process.on('exit', (code) => { if (fails && !code) process.exitCode = 1; });
module.exports = { FAIL_RE };
