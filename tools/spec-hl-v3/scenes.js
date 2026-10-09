'use strict';
const { RF } = require('../sqm-hl/lib.js');
const names = ['filament7', 'filamentBox', 'ledUp', 'led519a', 'ledRear7', 'osramSmall'];
function scene(name, preset = 'ece-r112-b', budget = 100) {
  const s = RF.State.defaultScene(); s.mode = 'D';
  RF.Spec.applyPreset(s.modeD, preset);
  for (const g of ['A', 'B', 'C']) { s.groups[g].enabled = g === 'A'; s.groups[g].surfaces = []; }
  RF.Spec.applyFixture(s, /7$/.test(name) ? 'sealed7' : name === 'osramSmall' ? 'module' : 'box');
  const id = name.startsWith('filament') || name === 'projectorLong' ? 'hb3' : name === 'led519a' ? 'nichia519a-domed' : name === 'osramSmall' ? 'osram-cslnm1' : 'generic';
  RF.SourcePresets.apply(s.source, id);
  if (name === 'filament7') { s.source.pos = [-50, 0, 0]; s.source.axis = [1, 0, 0]; s.groups.M.surfaces = []; }
  if (name === 'filamentBox') { Object.assign(s.envelope, { shape: 'box', center: [-80, 0, 0], half: [80, 82.5, 50], keepOut: 5 }); s.source.pos = [-110, 0, 0]; s.source.axis = [1, 0, 0]; }
  if (name === 'projectorLong') { Object.assign(s.envelope, { shape: 'cylinder', axis: 0, center: [-110, 0, 0], half: [110, 45, 45], keepOut: 5 }); s.source.pos = [-195, 0, 0]; s.source.axis = [1, 0, 0]; }
  if (![...names, 'projectorLong'].includes(name)) throw Error('Unknown fixture: ' + name);
  s.modeA.budget = budget; s.sim.seed = 1; s.sim.rays = 2e6;
  s.target.distance = 25000; s.target.size = Math.round(RF.Spec.fitTargetSize(s)); s.modeA.paint = RF.Spec.seedPaint(s);
  return s;
}
module.exports = { scene, names };
