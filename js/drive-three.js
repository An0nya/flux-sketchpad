/* Opt-in Drive ground renderer. CPU objects and the established display passes share its WebGL context. */
import * as T from '../vendor/three/three.module.min.js';
import { vertex, ground, withLighting, tableSource, tablePassSource, tableBlurSource } from './drive-three-shaders.js';
import { passShader, surface } from './drive-touge-three.js';
import { objects } from './drive-three-objects.js';
import { haloPass, haloLookup, HALO_EDGES } from './drive-three-halo.js';
import { createLampHalo } from './drive-three-lamphalo.js';
import { TABLE_BUDGET_MS, bandRows, smoothMsPerRow, tableStatus, fillFraction, tableBadge, fadeRangeName, fadeRangeOf, scatterGainOf, cyclePhase } from './table-pace.js';
const D = globalThis.RF.Drive;
const texture = (data, w, h, format = T.RGBAFormat) => { const t = new T.DataTexture(data, w, h, format, T.FloatType); t.needsUpdate = true; return t; };
const array = (n, type) => Array.from({ length: n }, () => new type());
// One three renderer per GL context: renderer.dispose() leaves its 1x1 placeholder textures and blit framebuffers
// behind (4 + 3 per renderer), so toggling would leak them. Reusing it keeps the count flat; a lost context drops it.
const renderers = new WeakMap();
function shared(canvas, gl) {
  let renderer = renderers.get(gl);
  if (renderer && gl.isContextLost()) { renderers.delete(gl); renderer.dispose(); renderer = null; }
  if (renderer) return renderer;
  renderer = new T.WebGLRenderer({ canvas, context: gl, antialias: false }); renderers.set(gl, renderer);
  canvas.addEventListener('webglcontextlost', () => { if (renderers.get(gl) === renderer) renderers.delete(gl); renderer.dispose(); });   // the old GL objects died with the context; the restored one gets a fresh renderer
  return renderer;
}
export function create(canvas, gl, onModelsReady) {
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('WebGL2 float targets unavailable');
  const renderer = shared(canvas, gl);
  renderer.setClearColor(0x000000, 1); renderer.setRenderTarget(null); renderer.resetState();
  renderer.outputColorSpace = T.LinearSRGBColorSpace; renderer.toneMapping = T.NoToneMapping;
  let failure = '', target, objectTarget, beamRef, beamTexture, otherRef, otherTexture;
  // BA5: the per-car beam atlas. atlasOn picks the shader variant (shading and tableShading read it); the atlas is repacked only when the pool changes.
  let atlasOn = false, atlasTexture = null, atlasPacked = null, atlasKey = null, atlasLuts = null;
  const litCars = [];   // BA5 test hook: the car id behind each traffic source this frame
  renderer.debug.onShaderError = (g, program, vs, fs) => { failure = [g.getProgramInfoLog(program), g.getShaderInfoLog(vs), g.getShaderInfoLog(fs)].filter(Boolean).join(' '); console.error('GPU drive shader: ' + failure); };
  const u = {}, set = (k, v) => { if (u[k]) u[k].value = v; else u[k] = { value: v }; };
  for (const [k, v] of Object.entries({ otherBeam: null, beamMeta: array(16, T.Vector4), beamGrid: array(16, T.Vector4), beamTint: array(16, T.Vector4), trafficBeamIdx: array(16, T.Vector4), otherLutInfo: new T.Vector4(), otherLutSize: new T.Vector2(), trafficDir: array(64, T.Vector2), trafficLamp: array(64, T.Vector4), nTraffic: 0, otherConvention: 0, pitch: 0, yaw: 0, sigma: 0, scatterSteps: 0, scatMode: 0, scatUV: new T.Vector2(1, 1), haloOn: 0, haloE: [8, 14, 22, 34, 60, 120], haloNu: 24, haloH: 0.22836, haloGain: 1, haloPolarOn2: 0, haloPolarTex2: null, haloPolarF2: new T.Vector2(), haloPolarRange2: new T.Vector2(), haloTex: null, haloPolarOn: 0, haloPolarTex: null, haloPolarC: new T.Vector2(), haloPolarF: new T.Vector2(), haloPolarSz: new T.Vector2(1, 1), haloPolarRange: new T.Vector2(), haloPolarN: new T.Vector2(1, 1), haloUV: new T.Vector2(1, 1), haloTab: new T.Vector2(48, 27), scatBank0: null, scatBank1: null, scatBank2: null, tableBank: 0, tableSteps: 48, tableH: 1, tableSeed: 0, tableFade: 1, tableFadeS0: 1, tableFadeS1: 10, tableBias: 0, tableBinN: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],scatGain: 1, scatGFwd: 0, scatGBack: 0, scatWFwd: 0, scatRMin: 0, scatSMax: 0, cornering: new T.Vector2(), beam: null, materials: null, marks: null, lutInfo: new T.Vector4(), lutSize: new T.Vector2(), size: new T.Vector2(), eye: new T.Vector3(-2, 0.37, 1.2), lamp: array(2, T.Vector3), lampRGB: new T.Vector3(1, 1, 1), nLamp: 0, convention: 0, nMark: 0, nPart: 0, nLight: 0, nReflection: 0, nSkip: 0, nCross: 0, part: array(16, T.Vector4), partShape: array(16, T.Vector4), light: array(64, T.Vector4), reflection: array(64, T.Vector4), lightRGB: array(64, T.Vector3), reflectionRGB: array(64, T.Vector3), skip: array(16, T.Vector2), crossing: array(16, T.Vector4), tanH: 1, lane: 3.5, vergeWidth: 1.5, ambient: 0, sheen: 0, wetModel: 0, grain: 0, wetness: 0, distance: 0, verge: new T.Vector2(), arc: new T.Vector2() })) set(k, v);
  set('worldFromCar', new T.Matrix3()); set('carFromWorld', new T.Matrix3()); set('passDepth', null); set('passShadow0',null); set('passShadow1',null); set('trafficPitch',new Float32Array(64));
  const materialData = new Float32Array(D.MAT_KEYS.length * 4 * 4), markData = new Float32Array(128 * 4 * 2);
  const materialTexture = texture(materialData, D.MAT_KEYS.length, 4), markTexture = texture(markData, 128, 2);
  set('materials', materialTexture); set('marks', markTexture);
  const mat = new T.ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: ground, depthTest: false, depthWrite: false });
  const scene = new T.Scene(), mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false; scene.add(mesh);
  const pass = surface(u);
  const camera = new T.Camera(), objectView = objects(renderer, u, onModelsReady);
  const halo = haloPass(renderer, u);   // SL: the traffic scatter table (built only when look.trafficHalo is on)
  const lampHalo = createLampHalo(renderer, u);   // LAMP-HALO-SPRITES: glare veil on lit lamps (option lampHalos; off = no change)
  function shading(material, enabled, mountain = false, table = false) {
    if (!material.userData.baseFragment) material.userData.baseFragment = material.fragmentShader;
    const atlas = atlasOn && enabled;
    if (material.userData.p2 === enabled && material.userData.tg === mountain && material.userData.tbl === table && material.userData.at === atlas) return;
    let source = enabled ? withLighting(material.userData.baseFragment, atlas) : material.userData.baseFragment;
    if (table) source = tableSource(source);
    material.fragmentShader = mountain ? passShader(source) : source; material.userData.tg = mountain; material.userData.tbl = table;
    material.userData.p2 = enabled; material.userData.at = atlas; material.needsUpdate = true;
  }
  // SD1 table pre-pass (look.scatterMode 'table'): three banks of four bins at the table's resolution, optional separable blur, then the lit passes read them.
  const tabMesh = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: tablePassSource(ground), depthTest: false, depthWrite: false }));
  const tabScene = new T.Scene(); tabMesh.frustumCulled = false; tabScene.add(tabMesh);
  const blurU = { src: { value: null }, texel: { value: new T.Vector2(1, 1) }, dirTexel: { value: new T.Vector2(1, 0) }, sig: { value: 0 } };
  const blurMesh = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: blurU, vertexShader: vertex, fragmentShader: tableBlurSource, depthTest: false, depthWrite: false }));
  const blurScene = new T.Scene(); blurMesh.frustumCulled = false; blurScene.add(blurMesh);
  function tableShading(extras) {
    const key = (extras ? 'lit' : 'plain') + (extras && atlasOn ? '-atlas' : '');
    if (tabMesh.material.userData.lit === key) return false;
    tabMesh.material.fragmentShader = tablePassSource(extras ? withLighting(ground, atlasOn) : ground); tabMesh.material.userData.lit = key; tabMesh.material.needsUpdate = true; return true;
  }
  // SD2 cache (look.scatterCache 'on'): the table is redrawn only when its key changes (the lamp pose quantised to 0.05 degrees and
  // 1e-4 m, the beam LUT identity, lamp colour, visibility, fov, size, eye, steps, res, blur, lit, near fade). Cycle 8 keeps eight versions
  // with jitter seeds 0..7 (tableSeed) and shows the valid ones in rotation. Counters: globalThis.SD_SCATTER.
  // SE2 pacing and swap: with the cache on, a version is filled in horizontal bands (scissor rows) into one SPARE bank over frames, paced by
  // TABLE_BUDGET_MS. When the spare is complete (blur applied) it swaps into its slot. The slot's previous contents stay shown until then
  // (the previous valid version). A slot never filled shows nothing: scatter term 0 (no stall). A key change restarts the fill at slot 0 and
  // keeps the old slots shown; a size change drops everything.
  const TAB_VERSIONS = 8, tabStats = globalThis.SD_SCATTER = { recomputes: 0, skips: 0, valid: 0, cycle: 0, cache: false, shown: 0, fills: 0, pending: 0, wanted: 1, rowsDone: 0, rowsTotal: 0, lastMs: NaN, meanMs: NaN, msPerRow: 0, budgetMs: TABLE_BUDGET_MS, compileMs: NaN, compiles: 0, frames: 0, showingZero: true };
  let slots = [], slotValid = [], spare = null, tabTmp = null, tabSize = '', tabKey = null, fillIdx = 0, tabFrame = 0, fill = null, compilePending = false;
  // SM: the cycle phase in [0, 8) advances with the distance travelled (cyclePhase), once per displayed frame; t and dist are the last frame's.
  const cyc = { phase: 0, t: NaN, dist: NaN };
  const advanceCycle = (dist) => {
    const now = performance.now();
    const dtS = Number.isFinite(cyc.t) ? Math.min(0.1, Math.max(0, (now - cyc.t) / 1000)) : 0;
    const dM = Number.isFinite(cyc.dist) && Number.isFinite(dist) ? dist - cyc.dist : 0;
    cyc.phase = cyclePhase(cyc.phase, dM, dtS, TAB_VERSIONS); cyc.t = now; cyc.dist = dist;
    return cyc.phase;
  };
  // SM: the version at slot k, or the nearest valid one (k first, then k +/- 1, ...); -1 when no version is valid.
  const nearestValid = (k) => {
    for (let d = 0; d < TAB_VERSIONS; d++) for (const i of [(k + d) % TAB_VERSIONS, (k - d + TAB_VERSIONS) % TAB_VERSIONS]) if (slotValid[i] && slots[i]) return i;
    return -1;
  };
  const probePx = new Uint16Array(4);
  const zeroTex = new T.DataTexture(new Float32Array(4), 1, 1, T.RGBAFormat, T.FloatType); zeroTex.magFilter = zeroTex.minFilter = T.NearestFilter; zeroTex.needsUpdate = true;
  // Test hooks (tests/regress/SE-table-pacing.js): texels of a slot bank (half-float Uint16 words, GL row order, bottom row first), and a
  // scissor check on the spare: rows below the fill's row must hold texels, rows at or above it must be empty.
  tabStats.readVersion = (v, b) => { const t = slots[v][b], out = new Uint16Array(t.width * t.height * 4); renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, out); return out; };
  tabStats.readSpare = (b) => { if (!spare) return null; const t = spare[b], out = new Uint16Array(t.width * t.height * 4); renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, out); return { data: out, width: t.width, height: t.height, rowsDone: fill ? fill.row : 0 }; };
  tabStats.scissorCheck = () => {
    if (!spare) return null;
    const t = spare[0], W = t.width, H = t.height, out = new Uint16Array(W * H * 4); renderer.readRenderTargetPixels(t, 0, 0, W, H, out);
    const rd = fill ? fill.row : 0; let below = 0, above = 0;
    for (let y = 0; y < H; y++) { let nz = false; for (let x = 0; x < W * 4 && !nz; x++) if (out[y * W * 4 + x] !== 0) nz = true; if (y < rd) { if (!nz) below++; } else if (nz) above++; }
    return { rowsDone: rd, rowsTotal: H, emptyBelow: below, filledAbove: above };
  };
  const lutIds = new WeakMap(); let lutSeq = 0;
  const lutId = (l) => { if (!l) return 0; if (!lutIds.has(l)) lutIds.set(l, ++lutSeq); return lutIds.get(l); };
  const quant = (x, step) => Math.round((x || 0) / step), DEG05 = 0.05 * Math.PI / 180;
  function tableKey(p, extras, look, tw, th, sig) {
    return JSON.stringify([(p.lamps || []).map((l) => l.map((v) => quant(v, 1e-4))), quant(p.yaw, DEG05), quant(p.pitch, DEG05), quant(p.cornerLeft, DEG05), quant(p.cornerRight, DEG05),
      !!p.afs, !!p.lampPitch, !!p.corneringLamps, lutId(p.lut), (p.lampRGB || [1, 1, 1]).map((v) => quant(v, 1e-4)), look.visibility, quant(p.hfov, DEG05), p.w, p.h,
      (p.eye || []).map((v) => quant(v, 1e-4)), p.conv, look.scatter, look.scatterTableSteps, look.scatterRes, look.scatterBlur, !!extras, tw, th, sig, fadeRangeName(look), +look.scatterNearBias > 0 ? 1 : 0, look.scatterBinCounts || '', look.scatterQuality || 'steps']);
  }
  const newBank = () => [0, 1, 2].map(() => new T.WebGLRenderTarget(tabSize.w, tabSize.h, { type: T.HalfFloatType, depthBuffer: false }));
  function dropAll() {
    const dispose = (b) => b && b.forEach((t) => t.dispose());
    slots.forEach(dispose); dispose(spare); if (tabTmp) tabTmp.dispose();
    slots = []; slotValid = []; spare = null; tabTmp = null; tabKey = null; fillIdx = 0; fill = null;
  }
  // Rows [y0, y0 + rows) of the three banks for one seed (whole = the full target, no scissor, as before SE2).
  function drawRows(bank, seed, y0, rows, tw, whole) {
    set('tableSeed', seed);
    for (let b = 0; b < 3; b++) {
      set('tableBank', b); renderer.setRenderTarget(bank[b]);
      if (whole) renderer.setScissorTest(false); else { renderer.setScissorTest(true); renderer.setScissor(0, y0, tw, rows); }
      renderer.render(tabScene, camera);
    }
    renderer.setScissorTest(false);
  }
  function blurBank(bank, tw, th, sig) {
    if (!(sig > 0)) return;
    for (let b = 0; b < 3; b++) {
      blurU.texel.value.set(1 / tw, 1 / th); blurU.sig.value = sig;
      blurU.src.value = bank[b].texture; blurU.dirTexel.value.set(1, 0); renderer.setRenderTarget(tabTmp); renderer.render(blurScene, camera);
      blurU.src.value = tabTmp.texture; blurU.dirTexel.value.set(0, 1); renderer.setRenderTarget(bank[b]); renderer.render(blurScene, camera);
    }
  }
  function runTable(p, extras, dist) {
    const look = p.look, f = look.scatterRes === 'full' ? 1 : look.scatterRes === 'quarter' ? 0.25 : 0.5, tw = Math.max(1, Math.round(p.w * f)), th = Math.max(1, Math.round(p.h * f));
    const sig = look.scatterBlur === 'mid' ? 1.5 : look.scatterBlur === 'strong' ? 3 : 0;
    const cache = look.scatterCache === 'on', cycle = cache && look.scatterCycle === 8 ? TAB_VERSIONS : 1, wanted = cycle;
    if (tabSize === '' || tabSize.key !== tw + 'x' + th) {
      dropAll(); tabSize = { w: tw, h: th, key: tw + 'x' + th }; tabTmp = new T.WebGLRenderTarget(tw, th, { type: T.HalfFloatType, depthBuffer: false });
    }
    if (tableShading(extras)) compilePending = true;
    const compiling = compilePending; compilePending = false;
    const key = tableKey(p, extras, look, tw, th, sig);
    const tblSteps = Math.max(1, Math.round(look.scatterTableSteps || look.scatter || 48)), tblBinN = D.binCountsFor(tblSteps, look.scatterNearBias, look.scatterBinCounts, look.scatterQuality);
    // NE3: a valid slice override or near sampling on turns on the per-slice counts (tableBias); empty or invalid with it off is the old path.
    const tblPer = !!D.parseBinCounts(look.scatterBinCounts) || !!D.qualityCounts(look.scatterQuality) || +look.scatterNearBias > 0;
    // NE: tabStats.binN/bias are the values sent to the table pass (debug readback for the page test).
    set('tableH', th); set('tableSteps', tblSteps); set('tableBias', tblPer ? 1 : 0); set('tableBinN', tblBinN); tabStats.binN = tblBinN.slice(); tabStats.bias = tblPer ? 1 : 0; tabStats.override = !!D.parseBinCounts(look.scatterBinCounts); tabStats.quality = look.scatterQuality || 'steps'; tabStats.size = [tw, th];
    { const fr = fadeRangeOf(look); set('tableFade', fr ? 1 : 0); set('tableFadeS0', fr ? fr[0] : 1); set('tableFadeS1', fr ? fr[1] : 10); }
    const budget = Number.isFinite(globalThis.SD_TABLE_BUDGET_MS) ? globalThis.SD_TABLE_BUDGET_MS : TABLE_BUDGET_MS; tabStats.budgetMs = budget;
    const t0 = performance.now();
    let bank = null, rows = 0, finished = false;
    if (!cache) {
      // Cache off: the single version is rendered whole every frame, as before SE2.
      tabKey = key; if (!slots[0]) slots[0] = newBank();
      bank = slots[0]; drawRows(bank, 0, 0, th, tw, true); blurBank(bank, tw, th, sig);
      slotValid[0] = true; fillIdx = 1; rows = th; tabStats.recomputes++;
    } else {
      if (!tabKey || key !== tabKey) { tabKey = key; fillIdx = 0; fill = null; }
      if (fillIdx < wanted) {
        if (!spare) spare = newBank();
        if (!fill) fill = { row: 0, ms: 0, seed: fillIdx };
        bank = spare;
        rows = bandRows(budget, tabStats.msPerRow, th - fill.row);
        drawRows(bank, fill.seed, fill.row, rows, tw, false);
        fill.row += rows;
        if (fill.row >= th) { blurBank(bank, tw, th, sig); finished = true; }
      } else tabStats.skips++;
    }
    // Sync: read one texel of the last bank written, so the timer covers the GPU work that was submitted.
    let ms = NaN;
    if (rows > 0) { renderer.readRenderTargetPixels(bank[2], 0, 0, 1, 1, probePx); ms = performance.now() - t0; }
    if (compiling && rows > 0) { tabStats.compileMs = ms; tabStats.compiles++; }
    else if (rows > 0 && !finished) tabStats.msPerRow = smoothMsPerRow(tabStats.msPerRow, ms, rows);
    if (cache && fill) fill.ms += ms;
    if (!cache && rows > 0) tabStats.lastMs = ms;
    if (cache && finished) {
      // the finished spare swaps into its slot; the slot's old bank becomes the next spare
      const verMs = fill.ms, old = slots[fillIdx];
      slots[fillIdx] = spare; spare = old || null; slotValid[fillIdx] = true; fillIdx++; fill = null;
      tabStats.recomputes++; tabStats.fills++; tabStats.lastMs = verMs;
      tabStats.meanMs = tabStats.fills === 1 ? verMs : tabStats.meanMs + (verMs - tabStats.meanMs) / tabStats.fills;
    } else if (!cache) tabStats.fills = tabStats.recomputes;
    // Show: no valid slot yet = zero scatter term. Cycle off: the valid slots in rotation per frame (as before SM), or slot 0.
    // SM cycle 8: the version at the distance phase (nearest valid), and with cycle blend on the next version too, mixed by the phase's fraction.
    const valid = []; for (let i = 0; i < wanted; i++) if (slotValid[i] && slots[i]) valid.push(i);
    let shownIndex = -1, blendIndex = -1, fract = 0;
    if (cycle === 1) { cyc.t = cyc.dist = NaN; shownIndex = valid.length ? valid[tabFrame % valid.length] : -1; }
    else {
      const ph = advanceCycle(dist), i0 = Math.floor(ph) % TAB_VERSIONS; fract = ph - Math.floor(ph);
      shownIndex = nearestValid(i0);
      if (look.scatterCycleFade === 'on' && valid.length >= 2) { const j = nearestValid((i0 + 1) % TAB_VERSIONS); if (j >= 0 && j !== shownIndex) blendIndex = j; }
    }
    tabFrame++;
    const shown = shownIndex < 0 ? null : slots[shownIndex], blend = blendIndex < 0 ? null : slots[blendIndex];
    set('scatBank0', shown ? shown[0].texture : zeroTex); set('scatBank1', shown ? shown[1].texture : zeroTex); set('scatBank2', shown ? shown[2].texture : zeroTex);
    set('scatBankB0', blend ? blend[0].texture : zeroTex); set('scatBankB1', blend ? blend[1].texture : zeroTex); set('scatBankB2', blend ? blend[2].texture : zeroTex);
    set('scatFade', blend ? 1 : 0); set('scatFract', fract);
    tabStats.frames++;
    const doneN = cache ? fillIdx : 1;
    Object.assign(tabStats, { showingZero: shownIndex < 0, shown: shownIndex, blend: blendIndex, phase: cycle === 1 ? NaN : cyc.phase, fract: blend ? fract : NaN, cache, cycle: cycle === 1 ? 0 : cycle, wanted, valid: doneN, pending: Math.max(0, wanted - doneN),
      rowsDone: fill ? fill.row : (cache ? 0 : th), rowsTotal: th, status: cache ? tableStatus(fillIdx, wanted) : null,
      fraction: fillFraction(fillIdx, wanted, fill ? fill.row : 0, th), badge: tableBadge(cache, fillIdx, wanted, tabStats.lastMs) + (cycle === 1 ? '' : ' · phase ' + cyc.phase.toFixed(2) + (blend ? ' · blend ' + fract.toFixed(2) : '')) });
  }
  // BA5: pack the pool into the atlas. Cached: the same LUT objects, ids, tints, conventions and weights give the same texture.
  function atlasFor(pool) {
    const luts = pool.entries.map(e => e.lut), key = JSON.stringify([pool.key, pool.weights || null, pool.entries.map(e => e.conv)]);
    if (atlasPacked && key === atlasKey && luts.length === atlasLuts.length && luts.every((L, i) => L === atlasLuts[i])) return atlasPacked;
    const P = RF.BeamAtlas.packAtlas(pool.entries);
    if (atlasTexture) atlasTexture.dispose();
    atlasTexture = texture(P.data, P.width, P.height, T.RedFormat);
    for (let i = 0; i < P.count; i++) { u.beamMeta.value[i].fromArray(P.beamMeta, 4 * i); u.beamGrid.value[i].fromArray(P.beamGrid, 4 * i); u.beamTint.value[i].fromArray(P.beamTint, 4 * i); }
    atlasPacked = P; atlasKey = key; atlasLuts = luts; return P;
  }
  function update(p, world, dist) {
    const lut = p.lut, look = p.look, A = world.A || p.A;
    if (beamRef !== lut) { if (beamTexture) beamTexture.dispose(); beamRef = lut; beamTexture = texture(lut.data, lut.nh, lut.nv, T.RedFormat); set('beam', beamTexture); }
    u.lutInfo.value.set(lut.h0, lut.v0, lut.step, 0); u.lutSize.value.set(lut.nh, lut.nv); u.size.value.set(p.w, p.h);
    set('nLamp', p.lamps.length); if (p.lamps.length > 2) throw Error('more than two own lamps');
    p.lamps.forEach((l, i) => u.lamp.value[i].fromArray(l));
    u.lampRGB.value.fromArray(p.lampRGB || [1, 1, 1]);
    set('convention', p.conv === 'B' ? 1 : p.conv === 'S' ? 2 : 0); set('tanH', Math.tan(p.hfov * Math.PI / 360));
    set('lane', p.lane); set('sigma', D.sigmaOf(look)); set('scatterSteps', D.sigmaOf(look) > 0 && look.scatter > 0 ? Math.round(look.scatter) : 0); set('scatGain', scatterGainOf(look)); set('scatMode', D.sigmaOf(look) > 0 && look.scatter > 0 && look.scatterMode === 'table' && !p.airHold ? 1 : 0); set('scatGFwd', D.SCAT.gFwd); set('scatGBack', D.SCAT.gBack); set('scatWFwd', D.SCAT.wFwd); set('scatRMin', D.SCAT.rMin); set('scatSMax', D.SCAT.S_MAX); set('ambient', look.ambient || 0); set('wetness', D.wetnessOf(look)); set('sheen', D.wetnessOf(look) > 0 && look.wetSheen ? 1 : 0); set('wetModel', look.wetModel === 'ggx' ? 1 : 0);
    set('distance', dist); set('grain', look.grain && (p.src.tiles || (D.wetnessOf(look) > 0 && look.wetSheen)) ? 0.4 * (D.wetnessOf(look) > 0 ? 0.5 : 1) : 0);
    const vg = p.src.verge; set('vergeWidth', vg[1] || 1.5); u.verge.value.set(D.MAT_KEYS.indexOf(vg[0]), D.MAT_KEYS.indexOf(vg[2] || vg[0]));
    const materials = D.materials(look), width = D.MAT_KEYS.length;
    D.MAT_KEYS.forEach((k, i) => { const m = materials[k]; materialData.set(m.rho, i * 4); materialData.set(m.emit || [0, 0, 0], (3 * width + i) * 4); materialData.set(m.retro || [0, 0, 0], (width + i) * 4); materialData.set(m.gloss ? [m.gloss.a, m.gloss.F0, 0, 0] : [0, 0, 0, 0], (2 * width + i) * 4); }); materialTexture.needsUpdate = true;
    const marks = world.markings || p.src.markings.map(m => m.pat ? { ...m, pat: { ...m.pat, s0: m.pat.s0 - dist % m.pat.period, s1: m.pat.s1 - dist % m.pat.period } } : m);
    if (marks.length > 128) throw Error('too many ground markings'); set('nMark', marks.length);
    const skips = marks.find(m => m.skip)?.skip || []; if (skips.length > 16) throw Error('too many marking openings'); set('nSkip', skips.length); skips.forEach((q, i) => u.skip.value[i].fromArray(q));
    marks.forEach((m, i) => { markData.set([m.o0, m.o1, D.MAT_KEYS.indexOf(m.mat), m.skip ? 1 : 0], 4 * i); const pat = m.pat; markData.set(pat ? [pat.s0, pat.s1, pat.period, pat.on] : [0, 0, 0, 0], 4 * (128 + i)); }); markTexture.needsUpdate = true;
    const crossings = world.crossings || []; if (crossings.length > 16) throw Error('too many crossings'); set('nCross', crossings.length); crossings.forEach((c, i) => u.crossing.value[i].set(c.s0, c.s1, c.o0, c.o1));
    set('nPart', 0); u.arc.value.set(A && A.R || 0, A && A.sg || 0);
    if (A && A.tiles && !p.touge) {
      const parts = [];
      for (const tile of A.tiles) for (const [offset, len, c] of tile.curvature ? [[0, 50, 0], [50, 100, tile.curvature], [150, 50, 0]] : [[0, 200, 0]]) {
        const s = tile.s0 + offset - dist, q = A.at(s); parts.push({ s, len, c, q });
      }
      if (parts.length > 16) throw Error('too many route parts'); set('nPart', parts.length);
      parts.forEach(({ s, len, c, q }, i) => { u.part.value[i].set(q.p[0], q.p[1], Math.atan2(q.t[1], q.t[0]), c); u.partShape.value[i].set(s, len, 0, 0); });
    }
    u.eye.value.fromArray(p.eye || [-2,.37,1.2]);
    if (p.touge) {
      const a = globalThis.RF.Touge.attitude(dist), [f,l,n] = [a.forward,a.left,a.up];
      u.worldFromCar.value.set(f[0],l[0],n[0],f[1],l[1],n[1],f[2],l[2],n[2]); u.carFromWorld.value.copy(u.worldFromCar.value).transpose();
      u.eye.value.applyMatrix3(u.worldFromCar.value); u.lamp.value.forEach((q,i) => { if(i<p.lamps.length)q.applyMatrix3(u.worldFromCar.value); });
    } else u.carFromWorld.value.identity();   // flat frames: a pass frame earlier in the session must not leave its rotation behind

    set('pitch', p.pitch || 0); set('yaw', p.yaw || 0); u.cornering.value.set(p.cornerLeft || 0,p.cornerRight || 0);
    const traffic = p.trafficBeams ? D.trafficSources(world.objects, p.eye, p, world.A) : []; set('nTraffic', traffic.length);
    // BA5: a symmetric-mode car with a pool pick reads its beam from the atlas. No pool, or any other mode: the single table, as before.
    const pool = traffic.length ? p.trafficPool : null, atlas = !!(pool && pool.entries.length && traffic.some(q => q.beam));
    atlasOn = atlas;
    if (atlas) {
      atlasFor(pool);
      set('otherBeam', atlasTexture);   // not aliased to otherTexture: the single-table path disposes that one
      otherRef = null;   // the single table is rebound when the atlas is switched off
    } else if (traffic.length) {
      const b = D.trafficBeam(p), L = b.lut;
      if (otherRef !== L) { if (otherTexture) otherTexture.dispose(); otherRef = L; otherTexture = texture(L.data, L.nh, L.nv, T.RedFormat); set('otherBeam', otherTexture); }
      u.otherLutInfo.value.set(L.h0, L.v0, L.step, 0); u.otherLutSize.value.set(L.nh, L.nv); set('otherConvention', b.conv === 'B' ? 1 : b.conv === 'S' ? 2 : 0);
    }
    if (traffic.length) {
      traffic.forEach((q, i) => {
        if(p.touge){const f=world.A.frame(q.x,q.y),a=world.A.surface(f.s,f.off);u.trafficPitch.value[i]=Math.atan(a.grade*(q.nx*f.t[0]+q.ny*f.t[1]));
        }
        u.trafficLamp.value[i].set(q.x, q.y, q.z, q.w); u.trafficDir.value[i].set(q.nx, q.ny);
        if (atlas) u.trafficBeamIdx.value[i >> 2].setComponent(i & 3, D.trafficPickIndexOf(p, q.car));
        litCars[i] = q.car;
      });
    }
    const lights = world.lights || [], reflections = D.reflectionSources(world.objects, { ...p, pointLights: lights }).concat(lights);
    for (const [name, values] of [['light', lights], ['reflection', reflections]]) { if (values.length > 64) throw Error('too many ' + name + ' sources'); set(name === 'light' ? 'nLight' : 'nReflection', values.length); values.forEach((q, i) => { u[name].value[i].set(q.x, q.y, q.z, q.cd); u[name + 'RGB'].value[i].fromArray(q.rgb); }); }
  }
  return {
    version: T.REVISION,
    // SL2 test hook: the halo quads drawn for the last frame (0 = off, or no lamp on screen)
    lampHaloState() { return lampHalo.state(); },
    timeLampHalo(repeats) { return lampHalo.time(gl, repeats); },
    haloState() { return { drawn: halo.drawn, lamps: halo.lamps, passes: halo.passes, tab: halo.tab, on: u.haloOn.value, ms: halo.ms, msPolar: halo.msPolar, polar: halo.polar, polarNote: halo.polarNote, bins: halo.edges.length, tabClamp: halo.tabClamp, polars: halo.polars.length }; },
    haloProbe(sx, sy) { return halo.probe(sx, sy); }, haloSources() { return halo.sources; }, haloBeamAt(i, x, y, z) { const L = halo.sources[i]; return D.trafficAt ? D.trafficAt(L, null, x, y, z) : null; },
    haloLookup(bins, d) { return haloLookup(bins, d, halo.edges); }, haloEdges() { return halo.edges.slice(); },
    programCount() { return renderer.info.programs ? renderer.info.programs.length : -1; },
    // BB3 test hook: the lamp tint currently in the lampRGB uniform (what the GPU lights with)
    lampUniform() { return u.lampRGB && u.lampRGB.value ? u.lampRGB.value.toArray() : null; },
    // BA5 test hook: what the GPU got this frame: whether the atlas is on, the beam count, each lit source's atlas index, and the tints
    atlasState() { const n = u.nTraffic.value; return { on: atlasOn, beams: atlasPacked ? atlasPacked.count : 0, nTraffic: n, cars: litCars.slice(0, n), idx: Array.from({ length: n }, (_, i) => u.trafficBeamIdx.value[i >> 2].getComponent(i & 3)), tints: atlasPacked ? Array.from({ length: atlasPacked.count }, (_, i) => u.beamTint.value[i].toArray().slice(0, 3)) : [] }; },
    render(p, world, dist, destination, objectDestination, ss = 1) {
      update(p, world, dist);
      const extras = !!(p.trafficBeams || p.lampPitch || p.pitch || p.afs || p.corneringLamps || p.yaw || p.cornerLeft || p.cornerRight); const tableOn = u.scatMode.value === 1; shading(mat, extras, false, tableOn); shading(pass.material, extras, true, tableOn);
      u.scatUV.value.set(1 / p.w, 1 / p.h); u.haloUV.value.set(1 / p.w, 1 / p.h); if (tableOn) runTable(p, extras, dist);
      if (!p.touge && !p.airHold) halo.build(p, world); else u.haloOn.value = 0;   // SN: a deferred (air-off) frame builds no halo table   // SL: the traffic scatter table, before the ground pass reads it (the pass view is skipped)
      renderer.resetState();
      if (!target || target.width !== p.w || target.height !== p.h) { if (target) target.dispose(); target = new T.WebGLRenderTarget(p.w, p.h, { type: T.HalfFloatType, depthTexture: new T.DepthTexture(p.w,p.h,T.FloatType), depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
      renderer.setRenderTarget(target); if(p.touge){pass.update(world.A,dist);pass.shadows(renderer);renderer.setRenderTarget(target);renderer.render(pass.scene,pass.camera);}else renderer.render(scene, camera);
      lampHalo.draw(p, world, target);   // LAMP-HALO-SPRITES: additive veil into the frame target, before the blit (no-op unless lampHalos is 'on')
      set('passDepth', target.depthTexture);
      if (failure) throw Error(failure);
      // CPU textures use row zero = top; three's target uses row zero = bottom.
      const source = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
      gl.blitFramebuffer(0, 0, p.w, p.h, 0, p.h, p.w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      if (objectDestination) {
        if (!objectTarget || objectTarget.width !== p.w * ss || objectTarget.height !== p.h * ss) { if (objectTarget) objectTarget.dispose(); objectTarget = new T.WebGLRenderTarget(p.w * ss, p.h * ss, { type: T.FloatType, depthTexture: new T.DepthTexture(p.w * ss, p.h * ss, T.FloatType), depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
        u.scatUV.value.set(1 / (p.w * ss), 1 / (p.h * ss)); u.haloUV.value.set(1 / (p.w * ss), 1 / (p.h * ss)); objectView.update(p, world.objects, ss); objectView.scene.traverse(ob => { if (ob.material) shading(ob.material, extras, !!p.touge, tableOn); }); objectView.mask(false); renderer.setRenderTarget(objectTarget); renderer.setClearColor(0, 0); renderer.render(objectView.scene, objectView.camera);
        if (failure) throw Error(failure);
        const src = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, objectDestination);
        gl.blitFramebuffer(0, 0, p.w * ss, p.h * ss, 0, p.h, p.w, 0, gl.COLOR_BUFFER_BIT, ss > 1 ? gl.LINEAR : gl.NEAREST);
      }
      renderer.setRenderTarget(null); renderer.resetState();
    },
    masks(p, ss, debug = false) {
      renderer.resetState(); objectView.mask(debug ? 2 : true); renderer.setRenderTarget(objectTarget); renderer.render(objectView.scene, objectView.camera);
      const width = p.w * ss, height = p.h * ss, pixels = new Float32Array(width * height * 4), mask = new Uint8Array(p.w * p.h), eyes = new Uint8Array(p.w * p.h);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels); pixels.depthBits = gl.getParameter(gl.DEPTH_BITS);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const q = Math.floor((height - 1 - y) / ss) * p.w + Math.floor(x / ss), k = 4 * (y * width + x); mask[q] |= Math.round(pixels[k]); eyes[q] |= Math.round(pixels[k + 1]); }
      objectView.mask(false); renderer.setRenderTarget(null); renderer.resetState();
      if (debug) return pixels;
      return { mask, body: mask.map((b, i) => b & ~eyes[i]) };
    },
    modelState() { return { ...objectView.prototype, ...objectView.models.state, memory:{...renderer.info.memory} }; },
    objectWork(p, ss=1) {
      renderer.resetState();objectView.mask(3);renderer.setRenderTarget(objectTarget);renderer.render(objectView.scene,objectView.camera);
      const pixels=new Float32Array(p.w*p.h*ss*ss*4);gl.readPixels(0,0,p.w*ss,p.h*ss,gl.RGBA,gl.FLOAT,pixels);
      let steps=0,proxyPixels=0,hits=0,maxSteps=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]===1){steps+=pixels[i];proxyPixels++;hits+=pixels[i+1];maxSteps=Math.max(maxSteps,pixels[i]);}
      objectView.mask(false);renderer.setRenderTarget(null);renderer.resetState();return {steps,proxyPixels,hits,maxSteps,stepsPerProxyPixel:proxyPixels?steps/proxyPixels:0,totalStepsPerHitIncludingMisses: hits?steps/hits:0};
    },
    async timeObjects(repeats=8) {
      const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return {gpuMs:null,reason:'timer extension unavailable'};
      if(gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return {gpuMs:null,reason:'another timer is active'};
      const query=gl.createQuery();renderer.resetState();objectView.mask(false);renderer.setRenderTarget(objectTarget);
      gl.beginQuery(ext.TIME_ELAPSED_EXT,query);for(let i=0;i<repeats;i++)renderer.render(objectView.scene,objectView.camera);gl.endQuery(ext.TIME_ELAPSED_EXT);
      renderer.setRenderTarget(null);renderer.resetState();gl.flush();
      for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,10));if(gl.getParameter(ext.GPU_DISJOINT_EXT)){gl.deleteQuery(query);return {gpuMs:null,reason:'disjoint GPU timer'};}
        if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6/repeats;gl.deleteQuery(query);return {gpuMs,repeats};}}
      gl.deleteQuery(query);return {gpuMs:null,reason:'timer timeout'};
    },
    dispose() { renderer.setRenderTarget(null); renderer.debug.onShaderError = null; objectView.dispose(); if (objectTarget) objectTarget.dispose(); if (target) target.dispose(); if (atlasTexture) atlasTexture.dispose(); if (beamTexture) beamTexture.dispose(); if (otherTexture) otherTexture.dispose(); materialTexture.dispose(); markTexture.dispose(); mat.dispose(); mesh.geometry.dispose(); pass.dispose(); renderer.resetState(); },       // the renderer itself stays with the GL context (see shared)
  };
}
