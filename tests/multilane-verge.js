// Multilane (multilaneRoad, or the highway-loop / toll-loop presets that imply it): verge content (posts, signs, deer,
// bushes/trees, parked cars, creek, bus stops, lamp poles) must stand OFF the 2+2 carriageway, i.e. right of
// mlLanes().outerR or left of mlLanes().outerL. Executed: the lateral offset of every such object, measured on the arc.
// Scope: the content tileWorld places from its own verge edges; the base road scene's objects (place(): delineator posts,
// scene deer) use the two-lane scene geometry and are excluded here.
const { load } = require('./load.js');
const RF = load(), A = RF.DriveAnim, D = RF.Drive;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const ml = A.mlLanes(3.7, 3), VERGE = new Set(['post', 'sign', 'deer', 'veg', 'car', 'creek', 'bus-stop', 'street-lamp']);
const lateral = (Arc, x, y) => {   // nearest arc station, then the signed left offset
  let best = null;
  for (let s = -60; s <= 300; s += 1) { const q = Arc.at(s, 0), d2 = (q.p[0] - x) ** 2 + (q.p[1] - y) ** 2; if (!best || d2 < best.d2) best = { s, d2 }; }
  for (let h = 0.5; h > 0.01; h /= 2) for (const s of [best.s - h, best.s + h]) { const q = Arc.at(s, 0), d2 = (q.p[0] - x) ** 2 + (q.p[1] - y) ** 2; if (d2 < best.d2) best = { s, d2 }; }
  if (best.s < -59 || best.s > 299) return null;   // beyond the searched stretch: nearest point not found
  const q = Arc.at(best.s, 0), t = q.t, n = Math.hypot(t[0], t[1]);
  return (t[0] * (y - q.p[1]) - t[1] * (x - q.p[0])) / n;
};
for (const opts of [{ endlessPreset: 'highway-loop' }, { endlessPreset: 'toll-loop' }, { multilaneRoad: true }]) {
  const src = A.source('road', 3.5, false, { wild: true, signs: true, animals: true, veg: true, posts: true }, Object.assign({ seed: 7, tiles: true, endlessRoad: true, oncoming: false, preceding: false }, opts));
  const p = { w: 96, h: 54, hfov: 60, lamps: [], lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src };
  const bad = []; let n = 0;
  for (let dist = 200; dist < 4200; dist += 200) {
    const w = A.tileWorld(p, dist, 0), key = (o) => [o.cls, o.k, Math.round(o.x * 100), Math.round(o.y * 100)].join();
    const base = new Set(A.place(src, dist, w.A, null, null, false).map(key));
    for (const o of w.objects) {
      if (base.has(key(o))) continue;
      if (!VERGE.has(o.cls) || !Number.isFinite(o.x) || (o.cls === 'street-lamp' && o.k !== 'cyl') || (o.cls === 'creek' && o.hx >= 50)) continue;   // lamp heads overhang the road on their arm; the creek channel is one straight 200 m box (its centre is off the arc on bends)
      const off = lateral(w.A, o.x, o.y); if (off === null) continue; n++;
      if (off > ml.outerR + 0.05 && off < ml.outerL - 0.05) bad.push({ cls: o.cls, k: o.k, mat: typeof o.mat === "string" ? o.mat : "fn", off: +off.toFixed(2), dist, z: [o.z0, o.z1], tile: (w.A.tiles || []).map((t) => t.kind + (t.biome ? ":" + t.biome : "")).join(" ") });
    }
  }
  ok(JSON.stringify(opts) + ': no verge object on the carriageway (' + n + ' checked)', n > 100 && bad.length === 0, { bad: bad.length, sample: bad.slice(0, 4) });
}
console.log(`\n${pass + fail} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
