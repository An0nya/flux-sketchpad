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
  // G09: hb4 -> measured (no rows yet) must give a coherent planar emitter, not the bulb's shape / volts / lumens
  {
    const st = C.createStore(RF.State.testScene()), src = st.scene.source;
    C.actions.applySourcePreset(st, 'hb4'); const bulbPower = src.power;
    C.actions.applySourcePreset(st, 'measured');
    ok('G09 planar source has a planar shape (got ' + src.shape + ')', ['rect', 'disc'].includes(src.shape));
    ok('G09 bulb voltage is dropped (volts ' + src.volts + ')', src.volts === undefined);
    ok('G09 bulb lumens are not inherited (power ' + src.power + ' vs bulb ' + bulbPower + ')', src.power !== bulbPower);
    ok('G09 filament emission mode is dropped (' + src.emission + ')', src.emission === undefined);
  }
  // G04 (state.js half): a scene that fails the schema must throw in deserialize (so loadLocal falls back to defaults and
  // an upload never reaches loadScene); a good scene, and the app's own scenes, must still round-trip untouched
  {
    const S = RF.State, throws = (v) => { try { S.deserialize(typeof v === 'string' ? v : JSON.stringify(v)); return false; } catch (e) { return true; } };
    const bads = [['mode Z', { mode: 'Z' }], ['stamps null', { modeB: { stamps: null } }], ['lenses obj', { lenses: {} }], ['envelope.half null', { envelope: { half: null } }],
      ['res string', { target: { res: 'abc' } }], ['source.pos short', { source: { pos: [1] } }], ['rays string', { sim: { rays: 'lots' } }], ['array', [1, 2]], ['null', 'null'], ['garbage', 'not json'], ['surfaces not a list', { groups: { A: { surfaces: {} } } }]];
    for (const [n, v] of bads) ok('G04 rejects ' + n, throws(v));
    ok('G04 target.res 0 is clamped to 10, not rejected', S.deserialize({ target: { res: 0 } }).target.res === 10);
    const j = S.deserialize({ groups: { A: { surfaces: [{ type: 'facet' }] } } });
    ok('G04 malformed surface is dropped', j.groups.A.surfaces.length === 0);
    for (const [n, mk] of [['defaultScene', S.defaultScene], ['testScene', S.testScene]]) {
      const sc = mk(), st = C.createStore(sc); C.regenerateA(st);
      const once = S.serialize(S.deserialize(S.serialize(sc)));   // idempotent, and nothing the scene had is dropped or clamped
      ok('G04 round-trips ' + n + ' (incl. solved surfaces)', S.serialize(S.deserialize(once)) === once && S.deserialize(once).groups.A.surfaces.length === sc.groups.A.surfaces.length && S.deserialize(once).sim.rays === sc.sim.rays);
    }
    for (const id of Object.keys(RF.SourcePresets.PRESETS)) { const sc = S.testScene(); RF.SourcePresets.apply(sc.source, id, id === 'measured' ? undefined : undefined); try { S.deserialize(S.serialize(sc)); } catch (e) { ok('G04 round-trips preset ' + id + ' (' + e.message + ')', false); } }
  }
  process.exitCode = fails ? 1 : 0;
})();
