// Two-curvature facet (headless): node tests/facet2.js — exits 1 on failure.
// Checks the compiled surface through the ENGINE's own ray/surface code (Engine.probeRay: its intersection, its
// normal, its reflection), not through the formula that built it.  A point source, one facet, rays spread over
// the aperture; each reflected ray is carried to a plane square to the chief ray at distance d, and the spot's
// spread is measured along the two focus directions b1 (the facet's `ax`, squared to the beam) and b2.
//   line focus: at d = 1/v1 the spot is thin along b1 and wide along b2; at d = 1/v2 the other way round
//   equal vergences behave like today's exact ellipsoid (a point focus); orientation follows `ax`;
//   a negative vergence diverges at the rate it asks for; the facet survives a JSON round trip.
const { load } = require('./load.js'); const RF = load(); const V = RF.V, E = RF.Engine;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };

const S0 = [0, 0, 0];
function spot(facet, d, n) {
  const sc = RF.State.testScene(); sc.source.kind = 'point'; sc.source.pos = S0.slice();
  const P = E.prepare(sc, [facet]), ah = V.norm(V.sub(facet.Z, facet.P));
  const b1 = V.norm(V.sub(facet.ax || [0, 1, 0], V.mul(ah, V.dot(facet.ax || [0, 1, 0], ah)))), b2 = V.cross(ah, b1);
  const [ex, ey] = V.basis(V.norm(V.sub(facet.P, S0))), R = facet.clip.r * 0.9, out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i / (n - 1) * 2 - 1) * R, y = (j / (n - 1) * 2 - 1) * R; if (x * x + y * y > R * R) continue;
    const aimPt = V.add(facet.P, V.add(V.mul(ex, x), V.mul(ey, y)));           // aim through the aperture
    const ev = E.probeRay(P, S0, V.sub(aimPt, S0)).events.find((e) => e.type === 'reflect'); if (!ev) continue;
    const t = (d - V.dot(V.sub(ev.point, facet.P), ah)) / V.dot(ev.dOut, ah);
    const X = V.add(ev.point, V.mul(ev.dOut, t)), q = V.sub(X, V.add(facet.P, V.mul(ah, d)));
    out.push([V.dot(q, b1), V.dot(q, b2)]);
  }
  const rms = (k) => { const m = out.reduce((s, p) => s + p[k], 0) / out.length; return Math.sqrt(out.reduce((s, p) => s + (p[k] - m) ** 2, 0) / out.length); };
  return { n: out.length, w1: rms(0), w2: rms(1) };
}
// an oblique facet: source below, beam leaving sideways and a little up (≈ 50° incidence)
const base = { type: 'facet', id: 'f', P: [0, 0, 30], S0, Z: [800, 0, 400], flat: false, clip: { kind: 'disc', r: 6 } };

{ // equal vergences ≈ the exact ellipsoid: both focus to (nearly) a point at di
  const di = 600, ell = spot(Object.assign({}, base, { di }), di, 21), two = spot(Object.assign({}, base, { vg: [1 / di, 1 / di], ax: [0, 1, 0] }), di, 21);
  const far = spot(Object.assign({}, base, { di }), 2 * di, 21), ref = Math.max(far.w1, far.w2);
  ok('equal vergences focus like the exact ellipsoid (spot at di ≪ spot at 2·di)', Math.max(two.w1, two.w2) < 0.05 * ref && Math.max(ell.w1, ell.w2) < 0.05 * ref,
    'rms at di: ellipsoid ' + ell.w1.toFixed(3) + '/' + ell.w2.toFixed(3) + ' mm, two-curvature ' + two.w1.toFixed(3) + '/' + two.w2.toFixed(3) + ' mm; at 2·di ' + ref.toFixed(2) + ' mm');
}
{ // line foci: 1/v1 = 300 along ax (world y here), 1/v2 = 900 across
  for (const ax of [[0, 1, 0], V.norm([0.3, 1, -0.8]), [0, 0, 1]]) {
    const f = Object.assign({}, base, { vg: [1 / 300, 1 / 900], ax }), a = spot(f, 300, 21), b = spot(f, 900, 21);
    // the thin axis may keep a little higher-order aberration (the quadric is exact only at the mean vergence); what
    // matters is that it is small next to the LED's own image there: a 1 mm die at r = 30 mm images to d/30 mm
    const led = (d) => d / V.len(V.sub(f.P, S0));
    ok('line focus along ax=' + JSON.stringify(ax.map((x) => +x.toFixed(2))) + ': thin along b1 at 1/v1, thin along b2 at 1/v2', a.w1 < 0.15 * a.w2 && b.w2 < 0.15 * b.w1 && a.w1 < 0.05 * led(300) && b.w2 < 0.05 * led(900),
      'at 300: ' + a.w1.toFixed(3) + ' × ' + a.w2.toFixed(3) + ' mm; at 900: ' + b.w1.toFixed(3) + ' × ' + b.w2.toFixed(3) + ' mm (1 mm die images to ' + led(300).toFixed(0) + ' / ' + led(900).toFixed(0) + ' mm; 6 mm facet at 30 mm, ≈50° incidence: harsher than any real design)');
  }
}
{ // collimated in one axis (v = 0) and diverging in the other (v < 0): widths grow as asked
  const f = Object.assign({}, base, { vg: [0, -1 / 200], ax: [0, 1, 0] }), a = spot(f, 400, 21), b = spot(f, 1200, 21), a0 = spot(f, 1e-6, 21);
  // collimated: w1 stays at its aperture value; diverging from a virtual point 200 behind P: w2 ∝ (d + 200)
  const want = (1200 + 200) / (400 + 200);
  ok('v = 0 stays collimated; v = −1/200 diverges from a point 200 mm behind', Math.abs(b.w1 / a.w1 - 1) < 0.05 && Math.abs((b.w2 / a.w2) / want - 1) < 0.05,
    'w1 ' + a0.w1.toFixed(2) + ' → ' + a.w1.toFixed(2) + ' → ' + b.w1.toFixed(2) + ' mm; w2 ratio 1200/400 = ' + (b.w2 / a.w2).toFixed(3) + ' (want ' + want.toFixed(3) + ')');
}
{ // the aim is the same as today's facet: the chief ray through P lands on Z
  const f = Object.assign({}, base, { vg: [1 / 300, -1 / 900], ax: [0, 1, 0] }), sc = RF.State.testScene(); sc.source.kind = 'point'; sc.source.pos = S0.slice();
  const ev = E.probeRay(E.prepare(sc, [f]), S0, V.sub(f.P, S0)).events.find((e) => e.type === 'reflect');
  const err = V.len(V.sub(V.norm(ev.dOut), V.norm(V.sub(f.Z, f.P))));
  ok('chief ray leaves toward Z (normal at P = the bisector)', err < 1e-9, 'direction error ' + err.toExponential(1));
}
{ // JSON round trip keeps the compiled surface (vergences, not distances: nothing becomes null)
  const f = Object.assign({}, base, { vg: [0, 1 / 500], ax: [0, 1, 0] }), g = JSON.parse(JSON.stringify(f));
  const a = RF.Geo.compile([f]).D, b = RF.Geo.compile([g]).D;
  ok('JSON round trip compiles byte-identically (a collimated axis included)', a.every((x, i) => x === b[i]));
}
process.exit(fails ? 1 : 0);
