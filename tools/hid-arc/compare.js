// Fixed classic-projector optics; compare the rated H7/HB4 and D2S sources without redesigning optics.
// node tools/hid-arc/compare.js [rays=2000000]
const fs = require('fs'), path = require('path'), RF = require('../../tests/load').load();
const N = +(process.argv[2] || 2000000), base = RF.State.deserialize(fs.readFileSync(path.join(__dirname, 'projector.json'), 'utf8')), rows = [];
for (const id of ['d2s', 'd2s-transverse', 'h7', 'hb4']) {
  const sc = RF.U.deepCopy(base); RF.SourcePresets.apply(sc.source, id, { volts: 13.2 }); sc.sim.seed = 7;
  sc.modeD.distance = 25000;
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); P.ffStreams = [RF.Spec.gridOpts(sc)]; P.guideLearn = true;
  const c = RF.Compare.traceContext(P, N), G = RF.FarField.build(c, P.ffStreams[0]), M = RF.FarField.map(G, .25), ev = RF.Spec.evaluate(G, sc.modeD), gradient = ev.rows.find((r) => r.kind === 'gradient' || /sharpness/i.test(r.name));
  const row = { id, sourceLm: sc.source.power, volts: sc.source.volts || null, rays: N, seed: 7, distanceMm: 25000, window: [G.h0, G.h1, G.v0, G.v1], lmWindow: G.lmWindow, peakCd: M.cd.reduce((a, b) => Math.max(a, b), 0), gradient: gradient && { value: gradient.value, sd: gradient.sd, minimumVerdict: gradient.verdict, maximumVerdict: ev.rows.find((r) => r.kind === 'gradient' && !r.isMin)?.verdict }, aim: ev.aim, verdict: ev.verdict, counts: Object.fromEntries(['pass', 'fail', 'unsure'].map((v) => [v, ev.rows.filter((r) => r.verdict === v).length])), ledger: c.E };
  // Actual sensor readings across the aimed cut-off: useful for catching misleading summary metrics.
  const [dh, dv] = ev.aim.base;
  row.cutScan = Array.from({ length: 13 }, (_, i) => { const v = -.87 + .05 * i, a = RF.FarField.intensityAt(G, -2.5 + dh, v + dv, .25, .035); return { h: -2.5, v, cd: a.cd, sd: a.sd, neff: a.neff }; });
  rows.push(row); console.log(JSON.stringify(row));
  fs.writeFileSync(path.join(__dirname, id + '.json'), RF.State.serialize(sc));
}
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ fixture: 'Existing projector-v3 continuous ellipsoid + curved ECE shield + 60 mm lens; fixed optics, not a certified headlamp', measure: '25 m screen; same guided recipe and 0.25° peak aperture as flux trace, unrounded Spec gradient; G > 0.4 fails the ECE upper limit', rows }, null, 2) + '\n');
