// Driver's-eye view (headless): node tests/drive.js — exits 1 on failure.
// Oracles are closed forms: Lambert L = ρ/π · I·cosθ/r², retro L = R·I/r², footprint coverage, energy of a sub-pixel eye.
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12);
const uniformLut = (cd) => D.lutFrom(() => cd);
const lam = (rho) => ({ rho: [rho, rho, rho], gloss: null, emit: null, retro: null, id: 1 });
const retro = (r) => ({ rho: [0, 0, 0], gloss: null, emit: null, retro: [r, r, r], id: 2 });
const base = (extra) => Object.assign({ w: 65, h: 36, hfov: 60, eye: [-2, 0, 1.2], lamps: [[0, 0, 0.65]], lut: uniformLut(20000), conv: 'A', lane: 3.5, scene: { objects: [], markings: [], verge: ['gravel', 1, 'gravel'] } }, extra);
const tanH = Math.tan(30 * Math.PI / 180), tanV = tanH * 36 / 65;
// the ray of pixel (x, y) at its centre, as the renderer builds it
const ray = (x, y, w = 65, h = 36) => { const u = (x + 0.5) / w * 2 - 1, v = 1 - (y + 0.5) / h * 2; let dx = 1, dy = -u * tanH, dz = v * Math.tan(30 * Math.PI / 180) * h / w; const l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
const lumaAt = (res, x, y) => D.probe(res, x, y).L;

// 1. the angle lookup agrees with FarField.hvOf in all three conventions (seeded: the suite forbids the platform RNG)
{ const rnd = D.rng(11); let worst = 0;
  for (const conv of ['A', 'B', 'S']) for (let k = 0; k < 400; k++) {
    const d = [0.2 + rnd(), (rnd() - 0.5) * 2, (rnd() - 0.5) * 0.4], ref = RF.FarField.hvOf(d, conv); D.hvFast(d[0], d[1], d[2], conv); const hv = D.hv();
    worst = Math.max(worst, Math.abs(hv[0] - ref[0]), Math.abs(hv[1] - ref[1])); }
  ok('hvFast = FarField.hvOf (A, B, S)', worst < 1e-9, 'worst ' + worst.toExponential(1) + '°'); }

// 2. a Lambertian road under a uniform lamp: L = ρ/π · I · cosθ / r²   (centre column, several distances)
{ const ρ = 0.2, res = D.render(base({ mats: { asphalt: lam(ρ), gravel: lam(ρ) } })); let worst = 0, n = 0;
  for (let y = 19; y < 36; y += 3) {
    const d = ray(32, y), t = 1.2 / -d[2], P = [-2 + t * d[0], 0, 0], r = Math.hypot(P[0], 0.65), exp = ρ / Math.PI * 20000 / (r * r) * (0.65 / r);
    worst = Math.max(worst, Math.abs(lumaAt(res, 32, y) / exp - 1)); n++; ok.dummy = 0; }
  ok('Lambert road: L = ρ/π · I cosθ / r² at ' + n + ' distances', worst < 1e-4, 'worst error ' + (100 * worst).toExponential(1) + ' %');
  const d = ray(32, 30), t = 1.2 / -d[2], r = Math.hypot(-2 + t * d[0], 0.65), wrong = ρ / Math.PI * 20000 / (r * r);
  ok('control: dropping the cosθ would be a visible error', Math.abs(lumaAt(res, 32, 30) / wrong - 1) > 0.05, 'cosθ = ' + (0.65 / r).toFixed(3)); }

// 3. a wide retroreflective stripe: L = R · I / r²  (no cosθ), and it beats the asphalt around it by R·cosθ... 
{ const R = 0.2, res = D.render(base({ mats: { asphalt: lam(0.1), gravel: lam(0.1), 'white-paint': retro(R) }, scene: { objects: [], markings: [{ o0: -1, o1: 1, mat: 'white-paint', pat: null }], verge: ['gravel', 1, 'gravel'] } }));
  let worst = 0; for (let y = 20; y < 36; y += 4) { const d = ray(32, y), t = 1.2 / -d[2], r = Math.hypot(-2 + t * d[0], 0.65); worst = Math.max(worst, Math.abs(lumaAt(res, 32, y) / (R * 20000 / (r * r)) - 1)); }
  ok('retro stripe: L = R · I / r²', worst < 1e-4, 'worst error ' + (100 * worst).toExponential(1) + ' %'); }

// 4. footprint coverage: a 10 cm line far away is narrower than a pixel — its pixel is a coverage-weighted mix
{ const R = 0.2, ρ = 0.1, w0 = 0.1, res = D.render(base({ mats: { asphalt: lam(ρ), gravel: lam(ρ), 'white-paint': retro(R) }, scene: { objects: [], markings: [{ o0: -w0 / 2, o1: w0 / 2, mat: 'white-paint', pat: null }], verge: ['gravel', 1, 'gravel'] } }));
  const y = 20, d = ray(32, y), t = 1.2 / -d[2], r = Math.hypot(-2 + t * d[0], 0.65), Ep = 20000 / (r * r), delta = 2 * tanH / 65, hw = 0.5 * (t / 1) * delta, c = w0 / (2 * hw);
  const exp = c * R * Ep + (1 - c) * ρ / Math.PI * Ep * (0.65 / r);
  ok('a sub-pixel line is coverage-weighted (' + (100 * c).toFixed(0) + ' % at ' + (-2 + t * d[0]).toFixed(0) + ' m)', c < 1 && near(lumaAt(res, 32, y), exp, 0.01), 'got ' + lumaAt(res, 32, y).toFixed(4) + ' cd/m², want ' + exp.toFixed(4));
  ok('coverage helpers: inside / outside / partial', D.covLat(0, 1, -5, 5) === 1 && D.covLat(0, 1, 2, 3) === 0 && near(D.covLat(0, 1, 0.5, 5), 0.25, 1e-12), 'partial 0.25');
  let avg = 0, nn = 400; for (let k = 0; k < nn; k++) avg += D.covLon(10 + 12 * k / nn, 6, { s0: -20, s1: 1e5, period: 12, on: 4 }) / nn;   // a footprint of one period, anywhere = on / period
  ok('a dash pattern averages to on/period over one period', near(avg, 4 / 12, 1e-6), avg.toFixed(5) + ' (1/3)');
  const dash = { s0: -20, s1: 1e5, period: 12, on: 4 }; ok('inside a dash = 1, in a gap = 0 (tiny footprint)', near(D.covLon(5, 0.01, dash), 1, 1e-9) && D.covLon(0, 0.01, dash) === 0, ''); }

// 4b. 2×2 supersampling (used in tiles that hold objects) must not change plain ground: same picture with an object far off to one side
{ const mats = { asphalt: lam(0.2), gravel: lam(0.2) }, plain = D.render(base({ mats }));
  // a tiny object ahead puts the road's tiles through 2×2 supersampling (a mutation test of the weight bug: 4× brighter, 303 % off)
  const near = D.render(base({ mats, scene: { objects: [{ k: 'cyl', x: 4, y: 0, r: 0.01, z0: 0, z1: 0.02, mat: 'wall' }], markings: [], verge: ['gravel', 1, 'gravel'] } }));
  let w2 = 0, cnt = 0; for (let y = 24; y < 36; y++) for (let x = 20; x < 45; x++) { w2 = Math.max(w2, Math.abs(lumaAt(plain, x, y) - lumaAt(near, x, y)) / lumaAt(plain, x, y)); cnt++; }
  ok('…including where the object IS: tiles over the road keep the road\'s luminance within 2 %', w2 < 0.02, 'worst ' + (100 * w2).toFixed(2) + ' % over ' + cnt + ' pixels'); }

// 5. a dark lamp is a black picture; ambient light alone lights diffuse surfaces and a faint sky, not the retro stripe's glow
{ const res = D.render(base({ lut: uniformLut(0) })); let mx = 0; for (const v of res.rgb) mx = Math.max(mx, v);
  ok('lamp off → black', mx === 0, 'max ' + mx);
  const amb = D.render(base({ lut: uniformLut(0), look: { ambient: 1 } })), g = lumaAt(amb, 32, 30), sky = lumaAt(amb, 32, 2);
  ok('ambient 1 lx: road ≈ ρ·E/π (asphalt 0.10 → 0.032), sky faint but not black', near(g, 0.1 * 1 / Math.PI, 0.02) && sky > 0 && sky < g, 'road ' + g.toFixed(4) + ', sky ' + sky.toFixed(4)); }

// 6. the horizon: above it there is no ground (depth ∞); below it the depth is eye height / sin(depression)
{ const res = D.render(base()); const a = D.probe(res, 32, 5), b = D.probe(res, 32, 30), d = ray(32, 30);
  ok('sky pixel has no depth; ground depth = h / −dz', a.depth === Infinity && near(b.depth, 1.2 / -d[2], 1e-5), 'ground at ' + b.depth.toFixed(2) + ' m'); }

// 7. primitives: each against a ray worked out by hand
{ const hit = (ob, o, d) => { D.boundOf(ob); const t = D.hitObj(ob, o[0], o[1], o[2], d[0], d[1], d[2], 1e9, 0.001); return { t, n: D.hit().n }; };
  const s = hit({ k: 'ell', x: 10, y: 0, z: 1, rx: 1, ry: 1, rz: 1 }, [0, 0, 1], [1, 0, 0]);
  ok('sphere: t = 9, normal −x', near(s.t, 9, 1e-9) && near(s.n[0], -1, 1e-9), 't ' + s.t);
  const e = hit({ k: 'ell', x: 10, y: 0, z: 1, rx: 2, ry: 1, rz: 1 }, [0, 0, 1], [1, 0, 0]);
  ok('ellipsoid with rx = 2: t = 8', near(e.t, 8, 1e-9), 't ' + e.t);
  const c = hit({ k: 'cyl', x: 10, y: 0, r: 0.5, z0: 0, z1: 2 }, [0, 0, 1], [1, 0, 0]);
  ok('cylinder: t = 9.5, normal −x', near(c.t, 9.5, 1e-9) && near(c.n[0], -1, 1e-9), 't ' + c.t);
  const top = hit({ k: 'cyl', x: 10, y: 0, r: 0.5, z0: 0, z1: 0.5 }, [9.2, 0, 1.2], [Math.cos(0.9), 0, -Math.sin(0.9)]);
  ok('cylinder top cap seen from above: normal +z', top.t < Infinity && near(top.n[2], 1, 1e-9), 'n ' + top.n);
  const b0 = hit({ k: 'box', x: 10, y: 0, z0: 0, z1: 2, hx: 2, hy: 0.5, yaw: 0 }, [0, 0, 1], [1, 0, 0]), b1 = hit({ k: 'box', x: 10, y: 0, z0: 0, z1: 2, hx: 2, hy: 0.5, yaw: Math.PI / 2 }, [0, 0, 1], [1, 0, 0]);
  ok('box: yaw 0 → t = 8, yaw 90° → t = 9.5 (its x half-size becomes 0.5)', near(b0.t, 8, 1e-9) && near(b1.t, 9.5, 1e-9) && near(b0.n[0], -1, 1e-9), 't ' + b0.t + ' / ' + b1.t);
  const miss = hit({ k: 'box', x: 10, y: 0, z0: 0, z1: 2, hx: 1, hy: 1, yaw: 0 }, [0, 3, 1], [1, 0, 0]);
  ok('box: a ray alongside misses', miss.t === Infinity, '');
  const dc = hit({ k: 'disc', x: 10, y: 0, z: 1, r: 0.3, nx: -1, ny: 0, nz: 0 }, [0, 0, 1], [1, 0, 0]), dm = hit({ k: 'disc', x: 10, y: 0.4, z: 1, r: 0.3, nx: -1, ny: 0, nz: 0 }, [0, 0, 1], [1, 0, 0]);
  ok('disc: hit at t = 10, a ray 0.4 m off a 0.3 m disc misses', near(dc.t, 10, 1e-9) && dm.t === Infinity, ''); }

// 8. an object in front occludes the ground, and is shaded as Lambert with its own normal
{ const ρ = 0.3, ob = { k: 'cyl', x: 15, y: 0, r: 0.5, z0: 0, z1: 2, mat: 'wall' };
  const res = D.render(base({ mats: { asphalt: lam(0.1), gravel: lam(0.1), wall: lam(ρ) }, scene: { objects: [ob], markings: [], verge: ['gravel', 1, 'gravel'] } }));
  const y = 18, d = ray(32, y), t = 16.5 / d[0], P = [14.5, 0, 1.2 + t * d[2]], r = Math.hypot(P[0], P[2] - 0.65), exp = ρ / Math.PI * 20000 / (r * r) * (P[0] / r);
  const p = D.probe(res, 32, y);
  ok('cylinder occludes: depth ≈ ' + t.toFixed(2) + ' m, L = Lambert with normal −x', near(p.depth, t, 2e-3) && near(p.L, exp, 0.02), 'depth ' + p.depth.toFixed(3) + ', L ' + p.L.toFixed(3) + ' vs ' + exp.toFixed(3));
  const none = D.render(base({ mats: { asphalt: lam(0.1), gravel: lam(0.1) } }));
  ok('control: without it, that pixel is far ground', D.probe(none, 32, y).depth > t * 5, D.probe(none, 32, y).depth.toFixed(0) + ' m'); }

// 9. a sub-pixel retroreflecting eye keeps its energy: Σ L·Ω over the image = R · E⊥ · A / r_eye²
{ const Rr = 900, rad = 0.012, X = 100, ob = { k: 'disc', x: X, y: 0, z: 1.2, r: rad, nx: -1, ny: 0, nz: 0, sub: true, mat: 'eyeshine' };
  const res = D.render(base({ eye: [-2, 0, 1.2], lamps: [[0, 0, 1.2]], mats: { eyeshine: retro(Rr), asphalt: lam(0), gravel: lam(0) }, scene: { objects: [ob], markings: [], verge: ['gravel', 1, 'gravel'] } }));
  let sum = 0; for (let q = 0; q < res.w * res.h; q++) sum += res.rgb[3 * q + 1]; const dl = 2 * tanH / 65, got = sum * dl * dl, want = Rr * (20000 / (X * X)) * Math.PI * rad * rad / ((X + 2) * (X + 2));
  ok('eyeshine 2.4 cm at 100 m (' + (100 * rad / (X * dl)).toFixed(0) + ' % of a pixel): Σ L·Ω = E at the eye', near(got, want, 0.05), 'got ' + got.toExponential(3) + ' lx, want ' + want.toExponential(3)); }

// 10. glossy surface: the renderer's GGX against the formula written out again; wet asphalt is not dry asphalt
{ const wet = D.render(base({ look: { wet: true } })), dry = D.render(base()), y = 24, d = ray(32, y), t = 1.2 / -d[2], P = [-2 + t * d[0], 0, 0];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = (a) => { const l = Math.sqrt(dot(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; };
  const L = [0, 0, 0.65], Ev = [-2, 0, 1.2], l = nrm(sub(L, P)), v = nrm(sub(Ev, P)), n = [0, 0, 1], h = nrm([l[0] + v[0], l[1] + v[1], l[2] + v[2]]), a = 0.09, F0 = 0.02;
  const NoL = dot(n, l), NoV = dot(n, v), NoH = dot(n, h), VoH = dot(v, h), D2 = a * a / (Math.PI * Math.pow(NoH * NoH * (a * a - 1) + 1, 2)), F = F0 + (1 - F0) * Math.pow(1 - VoH, 5), k = a / 2, G1 = (x) => x / (x * (1 - k) + k);
  const r2 = dot(sub(P, L), sub(P, L)), Ep = 20000 / r2, spec = D2 * F * G1(NoL) * G1(NoV) / (4 * NoV) * Ep, diff = 0.05 / Math.PI * Ep * NoL;
  ok('wet asphalt = Lambert 0.05 + GGX(α 0.09, F0 0.02), checked at ' + (-2 + t * d[0]).toFixed(0) + ' m', near(lumaAt(wet, 32, y), spec + diff, 1e-3), 'got ' + lumaAt(wet, 32, y).toFixed(5) + ', want ' + (spec + diff).toFixed(5) + ' (spec share ' + (100 * spec / (spec + diff)).toFixed(0) + ' %)');
  ok('wet ≠ dry', Math.abs(lumaAt(wet, 32, y) / lumaAt(dry, 32, y) - 1) > 0.02, 'wet ' + lumaAt(wet, 32, y).toFixed(4) + ' vs dry ' + lumaAt(dry, 32, y).toFixed(4)); }

// 11. a bend: the lane stripe goes where the arc goes, and a right bend mirrors a left bend (symmetric lamps, eye on the centre line)
{ const mk = (dir) => D.render(base({ w: 129, h: 72, eye: [-2, 0, 1.2], lamps: [[0, 0.7, 0.65], [0, -0.7, 0.65]], arc: RF.Road.arc(150, dir), mats: { asphalt: lam(0.1), gravel: lam(0.1), 'white-paint': retro(0.2) }, scene: { objects: [], markings: [{ o0: -0.1, o1: 0.1, mat: 'white-paint', pat: null }], verge: ['gravel', 1, 'gravel'] } }));
  const R = mk('right'), L = mk('left'); let worst = 0; for (let y = 0; y < 72; y++) for (let x = 0; x < 129; x++) { const a = R.rgb[3 * (y * 129 + x) + 1], b = L.rgb[3 * (y * 129 + 128 - x) + 1]; worst = Math.max(worst, Math.abs(a - b) / Math.max(a, b, 1e-9)); }
  ok('right bend = mirror image of the left bend', worst < 1e-3, 'worst relative difference ' + worst.toExponential(1));
  const row = 40; let bx = 0, bv = 0; for (let x = 0; x < 129; x++) { const v = R.rgb[3 * (row * 129 + x) + 1]; if (v > bv) { bv = v; bx = x; } }
  const d = ray(bx, row, 129, 72), t = 1.2 / -d[2], Py = t * d[1];
  ok('right bend: the centre-line stripe at ' + (-2 + t * d[0]).toFixed(0) + ' m is ' + (-Py).toFixed(1) + ' m to the right of straight', Py < -1.5, 'y = ' + Py.toFixed(2));
  const S = D.render(base({ w: 129, h: 72, lamps: [[0, 0.7, 0.65], [0, -0.7, 0.65]], mats: { asphalt: lam(0.1), gravel: lam(0.1), 'white-paint': retro(0.2) }, scene: { objects: [], markings: [{ o0: -0.1, o1: 0.1, mat: 'white-paint', pat: null }], verge: ['gravel', 1, 'gravel'] } }));
  let sx = 0, sv = 0; for (let x = 0; x < 129; x++) { const v = S.rgb[3 * (row * 129 + x) + 1]; if (v > sv) { sv = v; sx = x; } }
  ok('control: the straight road keeps the stripe in the centre column', Math.abs(sx - 64) <= 1 && bx > sx + 3, 'straight col ' + sx + ', right bend col ' + bx); }

// 12. exposure: fixed is absolute (a brighter scene looks brighter), auto is relative (it does not); EV = stops
{ const res = D.render(base({ mats: { asphalt: lam(0.1), gravel: lam(0.1) } })), tenfold = Object.assign({}, res, { rgb: res.rgb.map((v) => v * 10) });
  const meanOf = (px) => { let s = 0; for (let q = 0; q < px.length; q += 4) s += px[q + 1]; return s / (px.length / 4); };
  const f1 = D.tonemap(res, { mode: 'fixed', ev: 0 }), f2 = D.tonemap(tenfold, { mode: 'fixed', ev: 0 }), a1 = D.tonemap(res, { mode: 'auto' }), a2 = D.tonemap(tenfold, { mode: 'auto' });
  ok('fixed exposure: a 10× brighter scene is brighter on screen', meanOf(f2.px) > meanOf(f1.px) + 5, meanOf(f1.px).toFixed(1) + ' → ' + meanOf(f2.px).toFixed(1));
  let dmax = 0; for (let q = 0; q < a1.px.length; q++) dmax = Math.max(dmax, Math.abs(a1.px[q] - a2.px[q]));
  ok('auto exposure: a 10× brighter scene looks the same', dmax <= 1, 'max pixel difference ' + dmax + ' / 255');
  ok('EV +1 doubles the gain; white = 10 cd/m² at EV 0', near(D.tonemap(res, { mode: 'fixed', ev: 1 }).k / f1.k, 2, 1e-9) && near(f1.white, 10, 1e-9), 'white ' + f1.white);
  const blank = D.tonemap({ w: 4, h: 4, rgb: new Float32Array(48) }, { mode: 'auto' }); ok('an all-black picture does not blow up the auto exposure', Number.isFinite(blank.k) && blank.px[0] === 0, 'k ' + blank.k);
  const g0 = D.tonemap(res, { mode: 'fixed', ev: 3 }), g1 = D.tonemap(res, { mode: 'fixed', ev: 3, glare: true });
  ok('glare adds light, never removes it', meanOf(g1.px) >= meanOf(g0.px), meanOf(g0.px).toFixed(2) + ' → ' + meanOf(g1.px).toFixed(2)); }

// 13. lane markings: EU = white dashes, US = double yellow; the right edge line sits just inside the lane
{ const eu = D.laneMarkings(3.5, { us: false }), us = D.laneMarkings(3.5, { us: true });
  ok('markings: EU 3 white (one dashed), US edge lines + double yellow', eu.length === 3 && eu.filter((m) => m.pat).length === 1 && us.filter((m) => m.mat === 'yellow-paint').length === 2, eu.length + ' / ' + us.length);
  ok('right edge line is inside the lane', eu[0].o0 > -1.75 && eu[0].o1 < -1.2, eu[0].o0.toFixed(2) + '…' + eu[0].o1.toFixed(2)); }


// 14. scenes: a cross street is pavement across every offset in its s-range; markings can be cut; emitters are Lambertian and per-object
const pixOf = (res, X, Y, Z, eye = [-2, 0, 1.2]) => { const dx = X - eye[0], dy = Y - eye[1], dz = Z - eye[2], th = Math.tan(30 * Math.PI / 180), tv = th * res.h / res.w; return [((-dy / dx / th) + 1) / 2 * res.w, (1 - dz / dx / tv) / 2 * res.h]; };
{ const mk = (cross) => D.render(base({ w: 130, h: 72, scene: { objects: [], markings: [], verge: ['gravel', 1, 'gravel'], cross } }));
  const [px, py] = pixOf({ w: 130, h: 72 }, 15, 7, 0), a = D.probe(mk({ s0: 10, s1: 20 }), px, py), b = D.probe(mk(null), px, py);
  ok('cross street: ground 7 m left of the road at s = 15 is pavement (and shoulder without the cross street)', a.mat === 'asphalt' && b.mat === 'gravel shoulder', a.mat + ' / ' + b.mat);
  const [qx, qy] = pixOf({ w: 130, h: 72 }, 25, 7, 0), c = D.probe(mk({ s0: 10, s1: 20 }), qx, qy); ok('…and outside its s-range it is shoulder again', c.mat === 'gravel shoulder', c.mat); }
{ const M = { asphalt: lam(0.1), gravel: lam(0.1), 'white-paint': retro(0.2) }, res = D.render(base({ w: 130, h: 72, mats: M, scene: { objects: [], markings: [{ o0: -0.5, o1: 0.5, mat: 'white-paint', pat: null, skip: [[10, 20]] }], verge: ['gravel', 1, 'gravel'] } }));
  const at = (X) => { const [x, y] = pixOf(res, X, 0, 0); return D.probe(res, x, y).L; }, inCut = at(15), after = at(25);
  const ref = D.render(base({ w: 130, h: 72, mats: M })), [x15, y15] = pixOf(res, 15, 0, 0);
  ok('a marking with a gap: none inside it (= bare asphalt), bright just after', near(inCut, D.probe(ref, x15, y15).L, 0.02) && after > 20 * inCut, 'in the gap ' + inCut.toFixed(4) + ', after ' + after.toFixed(3) + ' cd/m²'); }
{ const E0 = 4000, disc = (yawDeg, extra) => Object.assign({ k: 'disc', x: 20, y: 0, z: 1.2, r: 1, nx: -Math.cos(yawDeg * Math.PI / 180), ny: Math.sin(yawDeg * Math.PI / 180), nz: 0, mat: 'pole' }, extra);
  const go = (obs) => D.render(base({ lut: uniformLut(0), scene: { objects: obs, markings: [], verge: ['gravel', 1, 'gravel'] } }));
  const L0 = lumaAt(go([disc(0, { emit: [E0, E0, E0] })]), 32, 17), L60 = lumaAt(go([disc(60, { emit: [E0, E0, E0] })]), 32, 17), none = lumaAt(go([disc(0)]), 32, 17);
  ok('emitters are Lambertian: a disc turned 60° away shows cos 60° = half the luminance', near(L0, E0, 0.02) && near(L60 / L0, 0.5, 0.02), 'face-on ' + L0.toFixed(0) + ', 60° ' + L60.toFixed(0) + ' cd/m²');
  ok('control: the same disc without ob.emit is dark (the emission is per object, not per material)', none < 1e-6, none.toExponential(1));
  const Lp60 = lumaAt(go([disc(60, { emit: [E0, E0, E0], emitPow: 8 })]), 32, 17);
  ok('directional lamps (emitPow 8): cos^8 60° = 1/256 of face-on, face-on unchanged', near(lumaAt(go([disc(0, { emit: [E0, E0, E0], emitPow: 8 })]), 32, 17), E0, 0.02) && near(Lp60 / L0, 1 / 256, 0.05), 'off-axis ' + Lp60.toFixed(2) + ' cd/m²'); }
{ const scenes = Object.keys(D.scenes), bad = [];
  for (const name of scenes) for (const shape of ['straight', '150R']) {
    const A = shape === 'straight' ? null : RF.Road.arc(150, 'right'), sc = D.buildScene(name, { Lw: 3.5, A, us: name === 'city' }, { oncoming: { dist: 80, kcd: 30 }, preceding: { dist: 50 } });
    const finite = sc.objects.every((o) => o.bs === undefined || o.bs.every(Number.isFinite)) && sc.objects.every((o) => ['cyl', 'ell', 'box', 'disc'].includes(o.k)) && sc.objects.every((o) => typeof o.mat === 'function' || D.MAT_DEF[o.mat]);
    const res = D.render(base({ w: 160, h: 90, lut: uniformLut(20000), arc: A, scene: sc, lamps: [[0, 0.7, 0.65], [0, -0.7, 0.65]] })); let nan = 0, lit = 0; for (let q = 0; q < res.w * res.h; q++) { const v = res.rgb[3 * q + 1]; if (!Number.isFinite(v)) nan++; else if (v > 1e-3) lit++; }
    if (!finite || nan || lit < 200) bad.push(name + ' ' + shape + ' (valid ' + finite + ', NaN ' + nan + ', lit ' + lit + ')'); }
  ok('every scene × (straight, 150R) with both cars builds valid primitives and renders finite, lit pictures', bad.length === 0 && scenes.length >= 4, scenes.join(', ') + (bad.length ? ' — ' + bad.join('; ') : '')); }
{ const sc = D.buildScene('intersection', { Lw: 3.5 }), eR = -1.75, eL = 5.25, m = sc.markings, c0 = sc.cross.s0, c1 = sc.cross.s1;
  const near = m.some((x) => x.pat && x.pat.s0 === c0 - 4 && x.pat.on === 3), far = m.some((x) => x.pat && x.pat.s0 === c1 + 1 && x.pat.on === 3), left = m.some((x) => x.o0 > eL && x.pat && x.pat.period === 1), right = m.some((x) => x.o1 < eR && x.pat && x.pat.period === 1);
  ok('intersection: four crossings (near and far across the road, one on each leg of the cross street), cross street cuts the road', near && far && left && right && c1 > c0 && sc.markings.filter((x) => x.skip).length >= 3, 'cross s ' + c0 + '–' + c1.toFixed(1) + ' m, ' + m.length + ' markings');
  const sig = sc.objects.filter((o) => o.emit && o.mat === 'pole'), cars = sc.objects.filter((o) => o.emit && o.mat === 'lamp-head');
  ok('intersection: the signal has exactly the red lamps lit (2 heads), and the two cross cars carry 4 headlamps', sig.length === 2 && sig.every((o) => o.emit[0] > 10 * o.emit[1]) && cars.length === 4, sig.length + ' lit signal lamps, ' + cars.length + ' car lamps'); }
{ const sc = D.buildScene('road', { Lw: 3.5 }, { oncoming: { dist: 80, kcd: 30 }, preceding: { dist: 50 } }), lamps = sc.objects.filter((o) => o.emit && o.emit[0] > 1e5), tails = sc.objects.filter((o) => o.emit && o.emit[0] < 5e4 && o.emit[0] > 1e3 && o.emit[1] < 0.1 * o.emit[0]);
  const I = lamps.reduce((s, o) => s + o.emit[1] * Math.PI * o.r * o.r, 0);
  ok('oncoming car: two headlamps whose intensities sum to the requested 30 kcd; preceding car: two red tail lamps', lamps.length === 2 && near(I, 30000, 1e-9) && tails.length === 2, lamps.length + ' lamps, ' + I.toFixed(0) + ' cd; ' + tails.length + ' tail lamps');
  const res = D.render(base({ w: 129, h: 72, lut: uniformLut(0), scene: { objects: lamps.map((o, i) => Object.assign({}, o, { y: i ? 0.62 : -0.62, z: 1.2 })), markings: [], verge: ['gravel', 1, 'gravel'] } })); let sum = 0; for (let q = 0; q < res.w * res.h; q++) sum += res.rgb[3 * q + 1];
  const dl = 2 * Math.tan(30 * Math.PI / 180) / 129, got = sum * dl * dl, want = 30000 / Math.pow(lamps[0].x + 2, 2);
  ok('an oncoming car at 80 m puts E = I / r² at the driver\'s eye: Σ L·Ω over its two sub-pixel lamps', near(got, want, 0.06), 'got ' + got.toFixed(3) + ' lx, want ' + want.toFixed(3) + ' lx'); }
{ const res = D.render(base({ mats: { asphalt: lam(0.1), gravel: lam(0.1) }, lut: uniformLut(20000) })), meanOf = (px) => { let s = 0; for (let q = 0; q < px.length; q += 4) s += px[q + 1]; return s / (px.length / 4); };
  const m0 = meanOf(D.tonemap(res, { mode: 'fixed', ev: 3, glare: 0 }).px), m3 = meanOf(D.tonemap(res, { mode: 'fixed', ev: 3, glare: 0.3 }).px), m1 = meanOf(D.tonemap(res, { mode: 'fixed', ev: 3, glare: 1 }).px), mt = meanOf(D.tonemap(res, { mode: 'fixed', ev: 3, glare: true }).px);
  ok('glare strength: off < low < high, and `true` is the old full strength', m0 <= m3 && m3 <= m1 && mt === m1, m0.toFixed(2) + ' / ' + m3.toFixed(2) + ' / ' + m1.toFixed(2)); }

console.log(fails ? fails + ' FAILED' : 'all drive checks passed');
process.exitCode = fails ? 1 : 0;   // not process.exit(): it intermittently hung in Node 25.8 platform shutdown
