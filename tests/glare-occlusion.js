// Glare occlusion: a headlamp hidden from the driver's eye by an opaque object contributes no glare source.
// Scene: an oncoming car's two lamps at ~60 m, and a preceding car (its own taillamps) at 20 m. Real functions: RF.Drive.glareSources, RF.Drive.occluded.
// Used by regress-node and the standalone runner: node tests/glare-occlusion.js  (exits 1 on failure).
(function (root) {
  function run(RF, ok) {
    const D = RF.Drive, EYE = [-2, 0.37, 1.2];
    // oncoming car: body front face at x = 58.0 (lamps 60 m from the eye), lamps on that face at y = 0.9 and 2.1
    const onBody = { k: 'box', x: 55.8, y: 1.5, z0: 0.25, z1: 1.4, hx: 2.2, hy: 0.9, yaw: 0, traffic: 'onc', mat: 'car-paint' };
    const lamp = (y, traffic, x) => ({ k: 'disc', headlamp: true, traffic, x, y, z: 0.68, nx: -1, ny: 0, nz: 0, r: 0.1, eyeCd: 20000, mat: 'lamp-head' });
    const oncomingLamps = [lamp(0.9, 'onc', 58.01), lamp(2.1, 'onc', 58.01)];
    // preceding car: body centred at x = 18 (rear face 15.8, front 20.2), 20 m ahead; its taillamps sit on the rear face, facing back
    const precBody = (y) => ({ k: 'box', x: 18, y, z0: 0.25, z1: 1.4, hx: 2.2, hy: 0.9, yaw: 0, traffic: 'pre', mat: 'car-paint' });
    const preTail = [0.1, 1.4].map((y) => ({ k: 'disc', taillamp: true, traffic: 'pre', x: 15.79, y: 0.75 + (y - 0.75), z: 0.78, nx: -1, ny: 0, nz: 0, r: 0.1, emit: [1, 0.03, 0.015], mat: 'lamp-head' }));
    const scene = (extra) => [onBody, ...oncomingLamps, ...extra];
    const nSrc = (objs) => D.glareSources(objs, EYE).length;

    const a = nSrc(scene([]));
    ok('occlusion (a): nothing between -> both oncoming lamps are glare sources', a === 2, 'sources ' + a);

    const b = nSrc(scene([precBody(0.75), ...preTail]));
    ok('occlusion (b): preceding car on the line of sight at 20 m -> both lamps removed', b === 0, 'sources ' + b);

    const c = nSrc(scene([precBody(0.75 + 3), ...preTail.map((t) => Object.assign({}, t, { y: t.y + 3 }))]));
    ok('occlusion (c): preceding car offset 3 m sideways -> both lamps back', c === 2, 'sources ' + c);

    // (d) the preceding car's own taillamps are not hidden by their own body. Taillamps are not glare sources (headlamp only),
    // so this checks the occlusion test directly, with a control: the self-hit rule (minT) is what keeps them visible.
    const pre = [precBody(0.75), ...preTail];
    const tailVisible = preTail.every((t) => !D.occluded([t.x, t.y, t.z], EYE, pre));
    ok('occlusion (d): the preceding car\'s own taillamps are not occluded by their own body', tailVisible);
    const lampSelfHit = D.occluded([oncomingLamps[0].x, oncomingLamps[0].y, oncomingLamps[0].z], EYE, scene([]), 0);
    ok('occlusion control: with the 0.3 m self-hit rule off, the lamp is hidden by its own car body (so the rule is needed)', lampSelfHit === true, 'occluded(minT=0) = ' + lampSelfHit);

    // a building (box) and a flat sign (disc) on the line of sight: a building blocks, a sign face does not
    const bld = { k: 'box', x: 30, y: 1.5, z0: 0, z1: 12, hx: 3, hy: 20, yaw: 0, mat: 'brick' };
    const sign = { k: 'disc', x: 30, y: 1.5, z: 1.0, r: 2, nx: -1, ny: 0, nz: 0, mat: 'sign-back' };
    ok('occlusion: a building on the line of sight blocks both lamps', nSrc(scene([bld])) === 0, 'sources ' + nSrc(scene([bld])));
    ok('occlusion: a flat disc (sign face) does not block', nSrc(scene([sign])) === 2, 'sources ' + nSrc(scene([sign])));
  }
  if (typeof module !== 'undefined') module.exports = { run };
  else root.GlareOcclusionChecks = { run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
if (typeof require !== 'undefined' && require.main === module) {
  let fails = 0;
  module.exports.run(require('./load.js').load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all glare-occlusion checks passed');
  process.exitCode = fails ? 1 : 0;
}
