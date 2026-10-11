// Regression checks for fixed QA groups (headless): node tests/regress-node.js — exits 1 on failure.
const { load } = require('./load.js'); const RF = load(); const C = RF.Controller;
let fails = 0; const ok = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++; };

(async () => {
  // G06: a solve whose scene changed while it ran must be dropped, and the design stays marked out of date
  {
    const st = C.createStore(RF.State.testScene()); C.regenerateA(st);
    const real = RF.Solvers.runAsync; let release; const sync = RF.Solvers.runSync(st.scene);
    RF.Solvers.runAsync = () => new Promise((res) => { release = () => res(sync); });
    try {
      const p1 = C.regenerateAAsync(st); st.dirty.add('A'); C.setControl(st, 'A.budget', 123); release();
      ok('G06 solve finished after an edit is dropped', (await p1) === null);
      ok('G06 design stays marked out of date after the dropped result', st.dirty.has('A'));
      st.dirty.add('A'); const p2 = C.regenerateAAsync(st); release();
      ok('G06 solve with no edit meanwhile is applied', (await p2) !== null && !st.dirty.has('A'));
    } finally { RF.Solvers.runAsync = real; }
  }
  process.exitCode = fails ? 1 : 0;
})();
