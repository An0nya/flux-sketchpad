// vtest.js: bottom half only (no shield, no top half) of G2, variants in curvature ratio g and filament axis; far-field PNGs
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const { renderFF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/ffpng.js');
const base = fs.readFileSync('out/G2-noshield.scene.json', 'utf8');
const run = (name, mod) => { const sc = RF.State.deserialize(base); sc.groups.A.surfaces = sc.groups.A.surfaces.filter((s) => s.id !== 'p3_ellipsoid_top'); mod(sc);
  const { G, ev } = judge(sc, 4e6); const r = renderFF(RF, G, sc.modeD, { ev, label: name }); fs.writeFileSync('out/' + name + '.png', r.png); console.log(name, 'peak', Math.round(r.peak), 'lm', G.lmWindow.toFixed(0)); };
const bot = (sc) => sc.groups.A.surfaces.find((s) => s.id === 'p3_ellipsoid_bottom');
run('V1-bottom-g1.10-axial', () => {});
run('V2-bottom-g1.00-axial', (sc) => { const b = bot(sc); b.curv[0] = b.curv[1]; });
run('V3-bottom-g1.00-filament-along-y', (sc) => { const b = bot(sc); b.curv[0] = b.curv[1]; sc.source.axis = [0, 1, 0]; });
run('V4-bottom-g1.00-filament-along-z', (sc) => { const b = bot(sc); b.curv[0] = b.curv[1]; sc.source.axis = [0, 0, 1]; });
