// Plain-animation deer bolt (road scene, seeded drive). node tests/deer-bolt-anim.js — exits 1 on any failure.
// Per deer that bolts while ahead of the car: alerted at/near the carriageway, bolt starts ahead, and it ends >= 2 m past the edge line and stays out.
const { load } = require('./load.js');
const RF = load(), A = RF.DriveAnim, M = RF.Drive.Models;
const Lw = 3.5, edgeR = -Lw / 2, edgeL = 1.5 * Lw, PERIOD = 300, ACT = 110, V = 15;
const excess = (y) => Math.max(y - edgeL, edgeR - y);          // > 0: beyond the edge line on either side
let failed = 0;
const ok = (label, cond, detail) => { if (!cond) failed++; console.log((cond ? '✓ ' : '✗ ') + label + (detail ? '  — ' + detail : '')); };

// Walks the car down a seeded road drive and returns, per deer (keyed by its seeded profile), the frames it was in bolt.
function drive(seed) {
  const src = A.source('road', Lw, false, { animals: true, people: false, veg: false }, { wild: true, seed, tiles: false });
  const act = new Map(), tauFor = (t) => (id) => { const t0 = act.get(id); return t0 === undefined ? (id[0] === '@' ? -1 : 0) : t - t0; };
  const deers = new Map();
  for (let t = 0; t <= 40; t += 0.1) {
    const dist = V * t, k0 = Math.floor((dist - 6) / PERIOD);
    for (let k = k0 - 1; k <= k0 + 1; k++) for (const a of src.chunk(k).actors) {
      const id = k + ':' + a.id;
      if (!act.has(id) && k * PERIOD + a.s0 - dist <= ACT) act.set(id, t);
      if (a.kind === 'deer' && !act.has('@' + id) && k * PERIOD + a.s0 - dist <= M.deerProfile((src.traffic?.seed || 0) + ':' + id).trigger) act.set('@' + id, t);
    }
    for (const o of A.placedObjects({ src, detailedModels: true, deerBehaviour: true, look: {}, A: null, p: {} }, dist, t, tauFor(t))) {
      if (!o.attention) continue;
      const key = [o.attention.profile.trigger, o.attention.profile.turn, o.attention.profile.freeze].map(v => v.toFixed(6)).join(':');
      if (!deers.has(key)) deers.set(key, []);
      deers.get(key).push({ t, state: o.attention.state, elapsed: o.attention.elapsed, rel: o.x, y: o.y, ex: excess(o.y) });
    }
  }
  return deers;
}
// One deer's track (frames from its first attention frame on). Returns null if it never bolts, else
// { nearAhead, cleared, reason } : nearAhead = in or near the carriageway (<= 1 m beyond the edge line) when the bolt starts, ahead of the car;
// cleared = reached >= 2 m past the edge and never came back inside it.
function judge(track) {
  const b = track.findIndex(f => f.state === 'bolt');
  if (b < 0) return null;
  const onset = track[b], after = track.slice(b);
  const nearAhead = onset.rel > 0 && onset.ex <= 1;
  const idx = after.findIndex(f => f.ex >= 2);
  if (idx < 0) return { nearAhead, cleared: false, reason: 'max ' + Math.max(...after.map(f => f.ex)).toFixed(2) + ' m beyond edge at end of track' };
  const back = after.slice(idx).findIndex(f => f.ex < 2);
  return { nearAhead, cleared: back < 0, reason: 'onset rel ' + onset.rel.toFixed(1) + ' m, excess ' + onset.ex.toFixed(2) + ' m' + (back < 0 ? '' : '; back inside 2 m after clearing') };
}
const seeds = [7, 1, 2, 3, 4];
const verdicts = {};
for (const seed of seeds) {
  verdicts[seed] = [];
  for (const [, track] of drive(seed)) { const v = judge(track); if (v) verdicts[seed].push(v); }
}
const all = Object.values(verdicts).flat();
const inLane = all.filter(v => v.nearAhead);
ok('plain animation: deer bolt for seeded drives', all.length > 0, 'bolting deer: ' + all.length + ' across seeds ' + JSON.stringify(seeds));
ok('a deer in or near the carriageway, ahead of the car, bolts and ends >= 2 m past the edge line', inLane.some(v => v.cleared), 'in-lane bolts: ' + inLane.length + ' ' + JSON.stringify(inLane.map(v => v.reason)));
ok('every bolting deer that has cleared the edge never comes back inside it', all.filter(v => v.cleared !== undefined).every(v => !v.reason.includes('back inside')), JSON.stringify(all.map(v => v.reason)));
const fingerprint = () => JSON.stringify([...drive(7)].map(([k, t]) => [k, t.map(f => [f.t, f.state, f.y])]));
ok('determinism: recomputing the same seeded drive gives identical bolt poses', fingerprint() === fingerprint());
console.log(failed ? failed + ' failed' : 'all deer-bolt checks passed');
process.exit(failed ? 1 : 0);
