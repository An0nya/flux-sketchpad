// Node photometry audit, no browser: node tests/bench/UX1-glare.js [rays=2000000]
// Same fine/wide grids, smoothing, lookup and lamp-to-eye geometry as the Drive view.
const fs = require('fs'), path = require('path'), { load } = require('../load.js'), RF = load(), lib = require('../../tools/drive-lib.js');
const rays = +(process.argv[2] || 2000000), D = RF.Drive, A = RF.DriveAnim, round = (v) => +v.toFixed(6);
const scenes = [['7in-low', 'examples/sealed-beam-7in-low.json'], ['default (MG2 solved snapshot)', 'tests/fixtures/MG2-default-lamp.json']];
for (const [name, file] of scenes) {
  const sc = RF.State.deserialize(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8')), tr = lib.traceScene(RF, sc, rays), L = lib.lookupOf(RF, sc, tr, .5, .15), sh = RF.Road.aimShift(L.road, tr.ev), mir = sc.modeD.traffic === 'LHT' ? -1 : 1;
  const make = (shift) => D.lutFrom(RF.Road.beamOf(tr.G, tr.Gw, shift, mir, .5, .15, 2));
  const luts = { aimed: make(sh), unaimed: make([0, 0]) };
  console.log(JSON.stringify({ scene: name, file, rays, facets: RF.State.allSurfaces(sc).length, preset: sc.modeD.preset, aim: tr.ev.aim, reaim: tr.ev.reaim, roadAim: L.road.aim, shift: sh, lane: L.lane, lamps: L.lamps, smoothing: [.5, .15, 2] }));
  for (const dir of ['left', 'right']) for (const range of [25, 50, 80, 120]) {
    const arc = RF.Road.arc(250, dir), K = D.kit({ Lw: L.lane, A: arc, rand: () => .5 }); K.car(range, L.lane, { face: -1, lamps: 'head', kcd: 30 });
    const incoming = K.O.filter((o) => o.headlamp), q = arc.at(range, L.lane), own = L.lamps.map((lamp) => { const v = [q.p[0] - lamp[0], q.p[1] - lamp[1], 1.1 - lamp[2]]; return RF.FarField.hvOf(v, L.conv); });
    const incomingHV = incoming.map((o) => { const dx = A.EYE[0] - o.x, dy = A.EYE[1] - o.y; return RF.FarField.hvOf([dx * o.nx + dy * o.ny, -dx * o.ny + dy * o.nx, A.EYE[2] - o.z], L.conv); });
    const row = { scene: name, curve: dir + ' 250R', range, ownHV: own.map((p) => p.map(round)), oncomingHV: incomingHV.map((p) => p.map(round)), genericOncomingCd: incoming.map((o) => round(D.Headlamp.cd(o, { mode: 'generic' }))) };
    for (const [aim, lut] of Object.entries(luts)) row[aim] = { ownCd: own.map(([h, v]) => round(D.lutAt(lut, h, v))), oncomingCd: incoming.map((o) => round(D.Headlamp.cd(o, { mode: 'symmetric', lut, conv: L.conv }))), ownEyeLux: round(A.eyeLux({ ...L, lut, A: arc }, { rel: range, off: L.lane })) };
    console.log(JSON.stringify(row));
  }
  for (const h of [1, 3, 5]) console.log(JSON.stringify({ scene: name, direction: '0.5U ' + h + 'R', H: h, V: .5, aimedCd: round(D.lutAt(luts.aimed, h, .5)), unaimedCd: round(D.lutAt(luts.unaimed, h, .5)), genericCd: round(D.Headlamp.generic(h, .5)) }));
}
