/* Saved starter optics, traced without running a solver or replacing the player's design. */
(function (root) {
  'use strict';
  const RF = root.RF, files = { 'starter-low': 'examples/starter-low.json', 'starter-high': 'examples/sealed-beam-v2-5.75in-high-sealed.json' }, cache = new Map();
  async function load(name) {
    if (!files[name]) throw new Error('Unknown starter lamp');
    const r = await fetch(files[name]); if (!r.ok) throw new Error('Starter lamp could not load (' + r.status + ')');
    const scene = RF.State.deserialize(await r.text()); scene.name = name === 'starter-low' ? 'Starter low beam' : 'Starter high beam';
    scene.sim.rays = 150000;
    return { scene, notes: ['saved starter optics; Trace keeps the design, Rebuild designs it again'] };
  }
  async function photometry(name) {
    if (cache.has(name)) return cache.get(name);
    const { scene } = await load(name), P = RF.Engine.prepare(scene, RF.State.allSurfaces(scene));
    P.ffStreams = [RF.Spec.gridOpts(scene), RF.Spec.wideOpts(scene)];
    const ctx = RF.Engine.newCtx(P, scene.sim.rays, 0);
    while (!ctx.done) { RF.Engine.step(ctx, 12); await new Promise(requestAnimationFrame); }
    const G = RF.FarField.build(ctx, P.ffStreams[0]), W = RF.FarField.build(ctx, P.ffStreams[1]), ev = RF.Spec.evaluate(G, scene.modeD), road = RF.Road.resolve(scene.modeD.road, scene.modeD.preset);
    const a = RF.Road.analyse({ G, W, ev }, scene.modeD, road, { quality: false, ideal: false });
    const rd = { mdl: a.mdl, sh: a.sh, mir: a.mir, mkI: a.mkI, laneDrive: RF.Road.laneWidth(road, scene.modeD.preset, true) };
    const lamp = { scene, ctx, G, ev, rd }; cache.set(name, lamp); return lamp;
  }
  RF.StarterLamps = { load, photometry };
})(globalThis);
