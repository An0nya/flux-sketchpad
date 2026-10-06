/* scenes.js — named Spec-mode scenes for the solver bench, built the way tests/bench-spec.js builds them.
 *   makeScene('box'|'led-back'|'slim'|'module'|'sealed7'|'hb3'|'hb3-rear'|'file:/path.json', { preset:'ece-r112-b', budget:100, led:'generic' }) */
const fs = require('fs');
const { RF, loadScene } = require('./lib.js');
function placeLed(s, where, axis) { const c = s.envelope.center, h = s.envelope.half; s.source.pos = [c[0] + where[0] * h[0], c[1] + where[1] * h[1], c[2] + where[2] * h[2]]; s.source.axis = axis; return s; }
function makeScene(name, o) {
  o = Object.assign({ preset: 'ece-r112-b', budget: 100, led: 'generic', rays: 1e6 }, o || {});
  // 'box@dx,dy,dz[,ax,ay,az]': the named scene with the source moved by (dx, dy, dz) mm (and optionally pointed along a new axis) — off-nominal placements
  let move = null; if (!name.startsWith('file:') && name.includes('@')) { const [b, m] = name.split('@'); name = b; move = m.split(',').map(Number); }
  let sc;
  if (name.startsWith('file:')) { sc = loadScene(name.slice(5)); sc.groups.A.surfaces = []; if (o.preset !== 'keep') { /* keep the file's own spec */ } }
  else {
    sc = RF.State.defaultScene(); sc.mode = 'D';
    RF.Spec.applyPreset(sc.modeD, o.preset);
    if (['box', 'slim', 'module', 'sealed7'].includes(name)) RF.Spec.applyFixture(sc, name);
    else if (name === 'led-back') { RF.Spec.applyFixture(sc, 'box'); placeLed(sc, [0.75, 0, 0], [-1, 0, 0]); }
    else if (name === 'hb3' || name === 'hb3-rear') {         // her filament in her kind of envelope but placed by me: filament near the rear of a Ø165 x 100 bucket / the default box
      RF.Spec.applyFixture(sc, 'sealed7');
    } else throw new Error('unknown scene ' + name);
    for (const g of ['A', 'B', 'C']) sc.groups[g].enabled = g === 'A';
    RF.SourcePresets.apply(sc.source, o.led);
    if (name === 'hb3') { RF.SourcePresets.apply(sc.source, 'hb3'); sc.source.pos = [0, 0, 0]; sc.source.axis = [-1, 0, 0]; }
    sc.target.distance = 25000; sc.target.size = Math.round(RF.Spec.fitTargetSize(sc));
    sc.modeA.paint = RF.Spec.seedPaint(sc);
  }
  if (move) { sc.source.pos = [sc.source.pos[0] + move[0], sc.source.pos[1] + (move[1] || 0), sc.source.pos[2] + (move[2] || 0)]; if (move.length >= 6) { const a = move.slice(3, 6), n = Math.hypot(...a); sc.source.axis = a.map((x) => x / n); } }
  sc.modeA.budget = o.budget;
  if (o.md) Object.assign(sc.modeD, o.md);
  return sc;
}
module.exports = { makeScene, placeLed };
