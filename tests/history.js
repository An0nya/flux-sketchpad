// Undo/redo regression (headless): node tests/history.js — exits 1 on failure.
// Metamorphic: undo-all returns to the start state, redo-all to the end state (canonical key);
// derived data (re-solve, auto-aimed stamps) and view state (mode tab) never create entries.
const { load } = require('./load.js'); const RF = load(); const C = RF.Controller, H = RF.History;
const st = C.createStore(RF.State.defaultScene()); C.regenerateA(st);
const h = H.create(100); h.reset(H.intent(st.scene));
const K = () => H.key(H.intent(st.scene)), k0 = K();
let t = 0, fails = 0; const cp = () => { t += 2000; return h.checkpoint(H.intent(st.scene), t); };
const ok = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++; };
C.regenerateA(st); ok('re-solve creates no entry', !cp());
st.scene.mode = 'B'; ok('mode switch creates no entry', !cp()); st.scene.mode = 'A';
const edits = [
  () => C.setControl(st, 'A.budget', 120), () => C.setControl(st, 'tgt.dist', 1500), () => C.actions.paintPreset(st, 'ring'),
  () => C.actions.addStamp(st, 50, 20), () => C.setControl(st, 'src.w', 0.8), () => C.setControl(st, 'tgt.res', 80),
  () => C.actions.setProfile(st, [[1, 2], [3, 4], [5, 7]]), () => C.actions.moveSource(st, [1, 2, 3]), () => C.setControl(st, 'sim.res', 400),
];
for (const e of edits) { e(); st.commit({ forceA: true }); cp(); }
ok('one entry per edit (' + h.past.length + '/' + edits.length + ')', h.past.length === edits.length);
const kEnd = K(), restore = (e) => { H.apply(st.scene, e.it); st.invalidate(['A', 'B', 'C', 'L']); st.commit({ forceA: true }); };
while (h.past.length) restore(h.undo(H.intent(st.scene)));
ok('undo all → start state', K() === k0);
ok('rebuild after undo creates no entry', !cp());
while (h.future.length) restore(h.redo(H.intent(st.scene)));
ok('redo all → end state', K() === kEnd);
const n0 = h.past.length; C.setControl(st, 'A.budget', 200); t += 2000; h.checkpoint(H.intent(st.scene), t); C.setControl(st, 'A.budget', 250); t += 300; h.checkpoint(H.intent(st.scene), t);
ok('rapid edits of one control coalesce', h.past.length - n0 === 1 && /→ 250$/.test(h.past[h.past.length - 1].label));
h.undo(H.intent(st.scene)); C.setControl(st, 'A.refl', 0.5); t += 2000; h.checkpoint(H.intent(st.scene), t);
ok('new edit after undo clears redo', h.future.length === 0);
process.exit(fails ? 1 : 0);
