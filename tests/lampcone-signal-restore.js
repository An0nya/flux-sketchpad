// lampcone-signal-restore — the signal cone's second draw must not clobber the shared street cone uniforms.
// The bug (junction village renders black with signalConesOn + a lit signal head in view): the signal draw
// rewrote the shared cone uniforms (nLamp, cLamp, cSt, cScale, cFloor) to the SIGNAL lamp list and only restored
// coneTab4. The object-cone pass runs right after it with the signal list (nLamp = #signals, cFloor = the head's
// own height = an empty ray slab) and silently contributes nothing — the object pixels lose their cone light.
// This test fails before the fix: with the signal draw polluting the uniforms, cLamp[0] is the SIGNAL head at x≈104.5,
// not the street lamp at x=25, and cFloor[0] is 5.59 (the head), not 0 (the road).
// (The pre-fix failure is "the hook line + downstream nulls": the test passes only with the fix's _uniformsForTest() hook —
// and asserts all six shared uniforms the fix restores: nLamp, cLamp, cSt, cScale, cFloor, plus the hook's presence.)
const path = require('path');
const { pathToFileURL } = require('url');
const { load } = require('./load.js');
const ROOT = path.join(__dirname, '..');
const RF = load(ROOT);
globalThis.RF = RF;
const checks = [];
const ok = (name, cond, extra) => { checks.push({ name, pass: !!cond, extra }); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : (extra !== undefined ? '  — ' + JSON.stringify(extra) : ''))); };
(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'drive-three-lampcone.js')).href);
  const calls = [];
  const renderer = {
    getContext: () => {
      const glStub = { getParameter: () => 0, bindFramebuffer: () => {}, READ_FRAMEBUFFER: 0x8CA6, DRAW_FRAMEBUFFER: 0x8CA7, FRAMEBUFFER_BINDING: 0x8CA6, DEPTH_BUFFER_BIT: 0x100, NEAREST: 0x2600, blitFramebuffer: () => {} };
      return glStub;
    },
    setRenderTarget: (t) => { calls.push(['setRenderTarget', !!t]); },
    setClearColor: () => {},
    render: (scene, camera) => { calls.push(['render']); },
    resetState: () => {},
    flush: () => {},
    autoClear: true,
  };
  const target = { width: 320, height: 180, depthTexture: undefined };
  const world = {
    objects: [
      { k: 'ell', mat: 'lamp-head', cls: 'street-lamp', x: 25, y: -1.95, z: 6.9, emit: [9000, 9000, 9000], street: [0, 1] },
      { k: 'disc', mat: 'pole', cls: 'signal', x: 104, y: 0, z: 5.59, emit: [12000, 300, 200], nx: -1, ny: 0 },
    ],
    markings: [], crossings: [], lights: [],
  };
  const p = {
    lampCone: 'on', lampConeGain: 1, lampClass: 'III', lampKind: 'sodium', lampConeReach: 0,
    look: { signalConesOn: true, visibility: 100 },
    w: 320, h: 180, hfov: 60, eye: [-2, 0.37, 1.2],
  };
  const cone = mod.createLampCone(renderer);
  cone.draw(p, world, target, null);
  const u = typeof cone._uniformsForTest === 'function' ? cone._uniformsForTest() : null;
  ok('the module exposes the shared cone uniforms for inspection (test hook)', !!u, 'missing — pre-fix tree: the signal draw leaves the signal lamp list in the shared cone uniforms');
  const street = world.objects[0], signal = world.objects[1];
  ok('the street cone pass and the signal second draw both ran (2 render calls)', calls.filter((c) => c[0] === 'render').length === 2, calls);
  ok('after the draw, the shared uniforms still describe the STREET lamps (nLamp = street count)', u && u.nLamp === 1, u && u.nLamp);
  ok('cLamp[0] is the street lamp, not the signal head', u && Math.abs(u.cLamp[0].x - street.x) < 1e-6 && Math.abs(u.cLamp[0].y - street.y) < 1e-6 && Math.abs(u.cLamp[0].z - street.z) < 1e-6, u && u.cLamp[0]);
  ok('cSt[0] is the street side of the street lamp, not the signal face normal', u && Math.abs(u.cSt[0].x - 0) < 1e-6 && Math.abs(u.cSt[0].y - 1) < 1e-6, u && u.cSt[0]);
  ok('cFloor[0] is the road (0), not the signal head height', u && u.cFloor[0] === 0, u && u.cFloor[0]);
  ok('cScale[0] is the street-lamp cone half-height/emit (sodium, 9), not the signal tint', u && Math.abs(u.cScale[0] - 9) < 1e-6, u && u.cScale[0]);
  ok('cTint[0] is the street-lamp colour (sodium 2000 K), not the signal emit', u && Math.abs(u.cTint[0].x - RF.CCT.cctToRGB(2000, 0)[0]) < 1e-6 && Math.abs(u.cTint[0].y - RF.CCT.cctToRGB(2000, 0)[1]) < 1e-6 && Math.abs(u.cTint[0].z - RF.CCT.cctToRGB(2000, 0)[2]) < 1e-6, u && u.cTint[0]);
  ok('state() reports the street lamp + one lit signal head', cone.state().count === 1 && cone.state().signals.length === 1, cone.state().signals.length);
  const fails = checks.filter((c) => !c.pass).length;
  console.log('\nlampcone-signal-restore: ' + (fails ? fails + ' FAILED' : 'all checks passed'));
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
