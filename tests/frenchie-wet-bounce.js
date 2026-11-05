// frenchie (11-01, backlog 5 §4-O, Anya opt-in): option `wetBounce` — own lamps mirrored in the road plane,
// marched into the fog with the grazing-Fresnel weight (the wetVeil mirrorOf law). Default OFF; OFF is
// byte-identical: the CPU marches only add a branch that is skipped, and the GPU shader text is untouched
// (withWetBounce is applied only when the option is on, like withShimmer).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, Opt = RF.Options;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };

// ---- registry
const entries = Opt.OPTIONS;
const e = entries.find((x) => x.id === 'wetBounce');
ok('registry: wetBounce exists, bool, default false, at the END of OPTIONS', !!e && e.type === 'bool' && e.default === false && entries[entries.length - 1].id === 'wetBounce', e && e.id);
ok('registry: control selector + group + test named', !!e && e.control === '[data-dv="wetBounce"]' && e.group === 'air' && (e.tests || []).includes('node:frenchie-wet-bounce'));
ok('registry: note carries the weak-effect + conservation caveats', /weak/.test(e.note) && /NOT attenuated/.test(e.note));
ok('defaults() carries wetBounce false', Opt.defaults().wetBounce === false);

// ---- executed: the weight law (Schlick at grazing, same as the wetVeil mirrorOf)
ok('executed: wetBounceW head-on (dz=r) = 0.02*wet^2 (B3 c(W)=W^2)', Math.abs(D.wetBounceW(1, 1, 0.4) - 0.02 * 0.16) < 1e-12);
ok('executed: wetBounceW grazing (dz=0) = wet^2 (B3 c(W)=W^2)', Math.abs(D.wetBounceW(0, 1, 0.4) - 0.16) < 1e-12);
ok('executed: wetBounceW monotone in |dz|/r', D.wetBounceW(0.2, 1, 1) > D.wetBounceW(0.5, 1, 1) && D.wetBounceW(0.5, 1, 1) > D.wetBounceW(0.9, 1, 1));
ok('executed: wetBounceW c(W)=W^2 — W=1 standing water near-mirror (1), W=0.6 -> 0.36, dry road 0', D.wetBounceW(0, 1, 0) === 0 && Math.abs(D.wetBounceW(0, 1, 1) - 1) < 1e-12 && Math.abs(D.wetBounceW(0, 1, 0.6) - 0.36) < 1e-12);   // B3 c(W)=W^2

// ---- executed: the CPU march (inScatter) — OFF identical, ON adds the mirror term
const mkO = (wetBounce, wetness) => ({
  eye: [-2, 0.37, 1.2], lamps: [[0, 0.85, 0.65], [0, -0.85, 0.65]], lampRGB: [1, 1, 1],
  lut: RF.BeamStore ? null : null, conv: 'A', pitch: 0, yaw: 0, cornerLeft: 0, cornerRight: 0,
  look: { wetness, wetBounce, visibility: 200, scatter: 16 },
});
// the same generic-beam LUT the other scatter suites use (tests/scatter.js:28)
const lut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false));
ok('harness: a beam LUT is available for ownBeamAt', !!(lut && lut.nh));
if (lut) {
  const oOff = Object.assign(mkO(false, 1), { lut });
  const oUndef = Object.assign(mkO(undefined, 1), { lut });
  const oOn = Object.assign(mkO(true, 1), { lut });
  const a = D.inScatter(oOff, [1, 0, -0.02], 120, 0.5, 16);
  const b = D.inScatter(oUndef, [1, 0, -0.02], 120, 0.5, 16);
  const c = D.inScatter(oOn, [1, 0, -0.02], 120, 0.5, 16);
  ok('executed: OFF (false) === unset — the option absent changes nothing', JSON.stringify(a) === JSON.stringify(b), [a, b]);
  const sum = (v) => v[0] + v[1] + v[2];
  ok('executed: ON adds light (mirror term > 0) in fog with a wet road', sum(c) > sum(a) * 1.0001, { off: sum(a), on: sum(c) });
  const oDry = Object.assign(mkO(true, 0), { lut });
  const d = D.inScatter(oDry, [1, 0, -0.02], 120, 0.5, 16);
  ok('executed: ON but dry (wetness 0) = OFF exactly (the gate is wetness)', JSON.stringify(d) === JSON.stringify(a), [d, a]);
  // the table march agrees in direction
  const tOff = D.scatterTableBins(Object.assign({}, oOff), [1, 0, -0.02], 0.5, null);
  const tOn = D.scatterTableBins(Object.assign({}, oOn), [1, 0, -0.02], 0.5, null);
  const ts = (t) => Array.from(t).reduce((x, y) => x + y, 0);
  ok('executed: scatterTableBins ON > OFF (table march carries the mirrors too)', ts(tOn) > ts(tOff) * 1.0001, { off: ts(tOff), on: ts(tOn) });
}

// ---- GPU twin: the splicer is guarded and OFF leaves the shipped text alone
const esm = (file, extra, names) => new Function(...Object.keys(extra || {}), fs.readFileSync(path.join(ROOT, 'js', file), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '') + '\nreturn { ' + names.map((n) => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(', ') + ' };')(...Object.values(extra || {}));
const S = esm('drive-three-shaders.js', null, ['ground', 'withWetBounce', 'withShimmer']);
(async () => {
  ok('GPU: shipped ground text has no lampM (OFF = byte-identical)', !S.ground.includes('lampM'));
  const on = S.withWetBounce(S.ground);
  ok('GPU: withWetBounce splices the mirror march + own uniforms', on.includes('lampM[2]') && on.includes('nLampM') && on.includes('wetU') && on.includes('beamI(vec3(d.x,d.y,-d.z),lampM[i])'));
  ok('GPU: withWetBounce keeps the rest of inScatter intact', on.includes('acc+=sigma*p*E*exp(-sigma*r)*Tv*ds*lampRGB;'));
  let threw = false; try { S.withWetBounce(S.ground.replace('vec3 inScatter', 'vec3 inScatX')); } catch (err) { threw = /markers changed/.test(err.message); }
  ok('GPU: withWetBounce throws on a moved marker (silent no-op impossible)', threw);
  const composed = S.withWetBounce(S.withShimmer(S.ground));
  ok('GPU: withWetBounce composes over withShimmer (both options on)', composed.includes('lampM[2]') && composed.includes('shimmerAmp'));

  // ---- keys carry the option (all three picture keys) + look plumbing
  const spec = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
  const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
  const three = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
  ok('keys: spec-ui drive key + groundKey carry o.wetBounce', (spec.match(/o\.wetBounce\b/g) || []).length >= 2);
  ok('keys: drive-anim picture key carries o.wetBounce', /o\.wetBounce\b/.test(anim.match(/const key = JSON\.stringify\(\[I\.groundKey[\s\S]*?\]\)/)[0]));
  ok('look: V.p.look carries wetBounce from the option', /wetBounce: o\.wetBounce === true/.test(anim));
  ok('GPU table: tableKey carries the road-surface k only while wetBounce is on (the in-scatter mirror is scaled by kSurf)', /look\.wetBounce \? quant\(D\.surfKOf\(look\)/.test(three));
  {   // executed: surfKOf moves with roadSurfaces/roadSurface, so a key without it would serve a stale table
    const base = { ...Opt.defaults(), wetBounce: true, wetness: 0.6 }, a = D.surfKOf({ ...base, roadSurfaces: true, roadSurface: 'old' }), b = D.surfKOf({ ...base, roadSurfaces: false });
    ok('executed: surfKOf differs between a road surface and stock', a !== b, { a, b });
  }
  ok('GPU table: tableKey carries look.wetBounce + wetness only while it is on (the table rebuilds on toggle, not on every wetness change with the bounce off)', /!!look\.wetBounce/.test(three) && /look\.wetBounce \? quant\(D\.wetnessOf\(look\)/.test(three));
  ok('GPU: uniforms lampM/nLampM/wetU declared; per-frame fill mirrors z -> -z', /lampM: array\(2, T\.Vector3\)/.test(three) && /fromArray\(\[l\[0\], l\[1\], -l\[2\]\]\)/.test(three));
  ok('GPU: recompile only on the on/off flip (userData.wb), OFF = shipped text', /mat\.userData\.wb/.test(three) && /withWetBounce\(baseSrc\)/.test(three));
  ok('CPU: inScatter + scatterTableBins both gate on look.wetBounce && wetness > 0', (fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8').match(/o\.look\.wetBounce|lk\.wetBounce/g) || []).length >= 2);

  ok('gate + all registered', fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8').includes("'frenchie-wet-bounce'") && fs.readFileSync(path.join(ROOT, 'tests/all.js'), 'utf8').includes('frenchie-wet-bounce'));


  // ---- 4-O extension: oncoming beams in the air (trafficHalo) + painted beam on surfaces ----
  {
    const src = { x: 0, y: 200, z: 0.8, beam: { lut, conv: 'A' }, tint: [1, 1, 1], nx: 0, ny: -1, nz: 0 };   // an oncoming lamp 200 m ahead
    const lookBase = { visibility: 60, trafficBeams: true, trafficHalo: 16, wetness: 0.8, scatter: 16 };
    const ray = [0, 1, 0.02];
    const off = D.trafficHalo(ray, 400, [src], 16, { look: { ...lookBase } }, 0.5);
    const on = D.trafficHalo(ray, 400, [src], 16, { look: { ...lookBase, wetBounce: true } }, 0.5);
    const sum = (v) => v[0] + v[1] + v[2];
    ok('trafficHalo: wetBounce ON adds mirrored oncoming light', sum(on) > sum(off));
    const dry = D.trafficHalo(ray, 400, [src], 16, { look: { ...lookBase, wetBounce: true, wetness: 0 } }, 0.5);
    ok('trafficHalo: ON at wetness 0 === OFF', sum(dry) === sum(off));
    const unset = D.trafficHalo(ray, 400, [src], 16, { look: { ...lookBase, wetBounce: false } }, 0.5);
    ok('trafficHalo: OFF === option-unset', sum(unset) === sum(off));
    // the mirror term must vanish when the eye ray is below the road (mirror above it): ray pointing down
    const down = D.trafficHalo([0, 1, -0.5], 400, [src], 16, { look: { ...lookBase, wetBounce: true } }, 0.5);
    const downOff = D.trafficHalo([0, 1, -0.5], 400, [src], 16, { look: { ...lookBase } }, 0.5);
    ok('trafficHalo: downward ray gains only the (small) mirror term', sum(down) >= sum(downOff));
    // the mirror term must not be gated by the DIRECT beam: a hard cut-off beam (nothing above horizontal) lights the air above the lamp only
    // via the road mirror, so on a rising ray (every sample above the lamp) the direct term is 0 and the bounce alone must show
    const cut = { ...src, beam: { lut: D.lutFrom((h, v) => (v < -0.5 ? 20000 : 0)), conv: 'A' } }, up = [0, 1, 0.02];
    const cutOff = D.trafficHalo(up, 400, [cut], 16, { look: { ...lookBase } }, 0.5), cutOn = D.trafficHalo(up, 400, [cut], 16, { look: { ...lookBase, wetBounce: true } }, 0.5);
    ok('trafficHalo: hard cut-off beam, rising ray: direct 0, wetBounce adds the mirror anyway', sum(cutOff) === 0 && sum(cutOn) > 0, { off: sum(cutOff), on: sum(cutOn) });
  }
  {
    // GPU halo splicer
    const H = await import('file://' + path.join(ROOT, 'js', 'drive-three-halo.js'));   // dynamic import: host node 25.8 cannot require() the ESM file (pencroff 11-05 02:09Z)
    const off = H.haloTableSource(false);
    ok('haloTableSource OFF byte-identical (no wetU/lampM)', !off.includes('wetU') && !off.includes('lampM'));
    const on = H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, true);
    ok('halo wb variant splices the mirror march', on.includes('uniform float wetU, kSurf;') && on.includes('lampM') && on.includes('-lamp.z'));
    const onP = H.haloTableSource(false, true, false, '', false, false, 0, 0, false, 0, 0, true);
    ok('polar variant + wb splices too', onP.includes('lampM'));
    const m2 = H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 3, 0, true);
    ok('moment2 + wb marches the mirror into accM2 (same lamp set as the first-moment table)', m2.includes('lampM') && /accM2 \+= s \* s \* sigma \* p \* I \* w/.test(m2) && !/\bacc \+=/.test(m2));
    const m2r = H.haloTableSource(false, false, false, '', false, false, 8, 16, true, 3, 1, true);
    ok('moment2 + wb + crossing refine: no acc left in the second-moment text (it would not compile)', !/\bacc\b/.test(m2r) && /accM2 \+= rs \* rs \* sigma \* p \* I \* w/.test(m2r));
    const m1 = H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 1, 0, true);
    ok('moment + wb folds the mirror into accM', m1.includes('lampM') && /accM \+= s \* wm/.test(m1));
    const HS = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-halo.js'), 'utf8');
    const polarPick = (HS.match(/mp = pick\([^\n]*\);/) || [''])[0];
    ok('polar table pick maps moment2 to the first moment and keeps wb', /halo\.moment === 3 \? 1 : halo\.moment/.test(polarPick) && /!!halo\.wb\)/.test(polarPick), polarPick);
    let threw = false; try { H.withWetBounceHalo('void main() { gl_FragColor = vec4(0.0); }'); } catch (e) { threw = /markers/.test(e.message); }
    ok('withWetBounceHalo throws on moved markers', threw);
    // 11-03 brace-balance guard: qwen's M4 compile detector found wb=true left ONE brace unclosed
    // (COMPILE fragment ERROR 0:132 — the mirror block replaced TAIL's three closes with two). Brace
    // balance is a text property, so this catches the class in node with no GL. Full variant sweep, 2 s.
    const depth = (s) => { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}') d--; } return d; };
    const vVariants = ['', 'band', 'split'], vJits = [false, 'interleaved', 'jittered'];
    let vBad = [], vN = 0;
    for (const atlas of [false, true]) for (const polar of [false, true]) for (const occ of [false, true])
      for (const variant of vVariants) for (const jit of vJits) for (const sm of [false, true])
        for (const lw of [0, 1]) for (const refine of [0, 32, 512, 2048]) for (const nb of [false, true])
          for (const moment of [0, 1, 2, 3]) for (const widthStep of [0, 4]) for (const wb of [false, true]) {
            const a = [atlas, polar, occ, variant, jit, sm, lw, refine, nb, moment, widthStep, wb];
            let t; try { t = H.haloTableSource(...a); } catch (e) { vBad.push(a.join(',') + ' THROW ' + e.message); continue; }
            vN++;
            const d = depth(t); if (d !== 0) vBad.push(a.join(',') + ' depth ' + d);
            const code = t.replace(/\/\/[^\n]*/g, '');   // strip line comments first, or the walker matches words inside comments
            {   // 11-03 qwen M4 (corrected): the failure is SCOPE, not presence — a textual "decl exists" check passes the sm/refine combos the driver rejects. Walk brace scopes: every qq/qqM use needs a decl in an open enclosing scope.
              const stack = [new Set()], re = /for\s*\(\s*int\s+(\w+)\s*=|float\s+qqM\s*=|float\s+qq\s*=|\bqqM\b|\bqq\b|if\s*\(\s*(?:m == 0 && )?wetU|[{}]/g; let m, pendingLoop = null;
              while ((m = re.exec(code))) {
                if (/^for\s*\(\s*int\s+\w+\s*=/.test(m[0])) pendingLoop = m[1];   // 11-03: the for-int loop var belongs to the loop body scope
                else if (m[0] === '{') { const sc = new Set(); if (pendingLoop) { sc.add(pendingLoop); pendingLoop = null; } stack.push(sc); }
                else if (m[0] === '}') { if (stack.length > 1) stack.pop(); pendingLoop = null; }
                else if (/^if\s*\(\s*(?:m == 0 && )?wetU/.test(m[0])) { if (!stack.some((s) => s.has('m'))) { vBad.push(a.join(',') + ' MIRROR if outside any open for-m scope (m undeclared there — the m==0 guard must stay inside the loop)'); break; } }   // 11-03: consume the token; only fail when no for-m scope is open
                else if (/^float\s+qqM\s*=/.test(m[0])) stack[stack.length - 1].add('qqM');
                else if (/^float\s+qq\s*=/.test(m[0])) stack[stack.length - 1].add('qq');
                else if (!stack.some((s) => s.has(m[0]))) { vBad.push(a.join(',') + ' ' + m[0] + ' used outside any open declaring scope (qwen M4 0:127/0:171)'); break; }
              }
            }
          }
    ok('haloTableSource brace-balanced and qq/qqM scope-declared over the full variant space incl. wb=true (36,864 combos)', vN === 36864 && vBad.length === 0, vBad.slice(0, 3));
    // withWetBounce now also splices the surface loop (ext B)
    const S = await import('file://' + path.join(ROOT, 'js', 'drive-three-shaders.js'));
    const g = S.ground, wb = S.withWetBounce(g);
    ok('withWetBounce splices inScatter + surface loops', (wb.match(/lampM\[i\]/g) || []).length === 3 && wb.includes('intensity(vec3(d.x,d.y,-d.z))'));
    ok('ground OFF still clean', !g.includes('lampM'));
    const lit = S.withWetBounce(S.withLighting(S.ground, false));
    ok('lit variant + wb splices both loops', (lit.match(/lampM\[i\]/g) || []).length === 3);
    const tab = S.withWetBounce(S.tablePassSource(S.withLighting(S.ground, true)));
    ok('table pass + wb splices both loops', (tab.match(/lampM\[i\]/g) || []).length === 3);
  }
  {
    // CPU shade mirror (ext B): textual twin check + the shared Fresnel law at a grazing point
    const src = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
    ok('shade() mirror loop present, gated on look.wetBounce + wetness', /wetBounce, 4-O ext B/.test(src) && /const wb = o\.look && o\.look\.wetBounce \? wetnessOf\(o\.look\)/.test(src));
    ok('trafficHalo mirror present, beam read at the reflected point', /trafficAt\(L, beam, Px, Py, -Pz\)/.test(src));
    ok('surface weight uses the shared wetBounceW law', D.wetBounceW(0.1, 10, 0.8) > D.wetBounceW(9, 10, 0.8));
  }
  console.log('\n' + pass + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);

})().catch((e) => { console.error(e); process.exit(1); });
