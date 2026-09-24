/* render.js — Canvas 2D rendering: orthographic ("isometric") 3D camera with an unrestricted
 * trackball, the scene view (envelope, source as its real geometry, surfaces, target plane with
 * the heatmap texture, ray paths, handles), the surface view, and shared colour helpers.
 * The target heatmap is mapped onto the plane with an exact affine transform (orthographic
 * projection of a planar rectangle is affine), so the picture is not an approximation.        */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;

  // ---------------------------------------------------------------- colour
  // Inferno-like anchors: luminance rises monotonically (readable without hue discrimination).
  const CMAP = [[0, 0, 0, 4], [0.25, 66, 10, 104], [0.5, 147, 38, 103], [0.7, 221, 81, 58], [0.85, 252, 165, 10], [1, 252, 255, 164]];
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 0; while (k < CMAP.length - 2 && t > CMAP[k + 1][0]) k++;
    const a = CMAP[k], b = CMAP[k + 1], f = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) LUT[3 * i + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  const GROUP_COL = { A: [242, 180, 65], B: [76, 195, 217], C: [180, 140, 240], L: [143, 184, 255], M: [200, 200, 200] };
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

  // ---------------------------------------------------------------- camera
  function Camera(az, el) {
    // focal: 35 mm-equivalent lens, Infinity = orthographic; fitted: false until fit() has sized it to a real canvas
    this.R = null; this.focal = Infinity; this.scale = 4; this.fitted = false; this.pan = [0, 0]; this.center = [0, 0, 0]; this.w = 300; this.h = 300;
    this.setAngles(az === undefined ? -50 : az, el === undefined ? 30 : el);
  }
  Camera.prototype.setAngles = function (azDeg, elDeg) {
    const a = azDeg * Math.PI / 180, b = elDeg * Math.PI / 180;
    const e = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
    const f = V.neg(e);
    let right = V.cross(f, [0, 0, 1]); if (V.len(right) < 1e-9) right = [1, 0, 0];
    right = V.norm(right);
    const up = V.cross(right, f);
    this.R = [right, up, e];
  };
  Camera.prototype.lookAlong = function (dirToEye, upHint) {       // view with the eye along dirToEye
    const e = V.norm(dirToEye), f = V.neg(e);
    let right = V.cross(f, upHint || [0, 0, 1]); if (V.len(right) < 1e-9) right = V.cross(f, [0, 1, 0]);
    right = V.norm(right);
    this.R = [right, V.cross(right, f), e];
  };
  Camera.prototype.view = function (p) {
    const d = [p[0] - this.center[0], p[1] - this.center[1], p[2] - this.center[2]], R = this.R;
    return [V.dot(R[0], d), V.dot(R[1], d), V.dot(R[2], d)];
  };
  // Eye distance from the orbit centre for the current lens: frame width × focal / 36 mm (35 mm film).
  Camera.prototype.eyeDist = function () { return isFinite(this.focal) ? (this.w / this.scale) * this.focal / 36 : Infinity; };
  Camera.prototype.project = function (p) {
    const v = this.view(p);
    // Perspective: scale by D/(D − depth), so the orbit centre keeps its size. Depth is clamped for points
    // at or behind the eye (squashed, not clipped) — good enough for a viewing aid.
    let k = 1; if (isFinite(this.focal)) { const D = this.eyeDist(); k = D / Math.max(D - v[2], 0.05 * D); }
    return [this.w / 2 + this.pan[0] + this.scale * v[0] * k, this.h / 2 + this.pan[1] - this.scale * v[1] * k, v[2]];
  };
  // screen delta → world delta in the view plane
  Camera.prototype.screenToWorldDelta = function (dx, dy) {
    const R = this.R;
    return V.add(V.mul(R[0], dx / this.scale), V.mul(R[1], -dy / this.scale));
  };
  // Free trackball: rotate about the screen axes; no clamp, so the camera can go over the poles
  Camera.prototype.orbit = function (dx, dy) {
    const k = 0.008, R = this.R;
    const rot = (vecs, axis, ang) => vecs.map((v) => V.rotate(v, axis, ang));
    let rows = rot(R, R[1], -dx * k);           // about screen-vertical
    rows = rot(rows, rows[0], -dy * k);         // about screen-horizontal
    // re-orthonormalise
    const e = V.norm(rows[2]), right = V.norm(V.sub(rows[0], V.mul(e, V.dot(rows[0], e))));
    this.R = [right, V.cross(e, right), e];
  };
  // Turntable: drag x spins about world up (z), drag y tilts; up stays vertical so the view never
  // settles crooked. Elevation is clamped short of the poles, where azimuth is undefined.
  Camera.prototype.turntable = function (dx, dy) {
    const e = this.R[2], k = 0.008 * 180 / Math.PI;           // same drag speed as orbit()
    const el = Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180 / Math.PI, az = Math.atan2(e[1], e[0]) * 180 / Math.PI;
    this.setAngles(az - dx * k, Math.max(-89, Math.min(89, el + dy * k)));
  };
  Camera.prototype.zoomAt = function (factor, sx, sy) {
    const ox = sx - this.w / 2 - this.pan[0], oy = sy - this.h / 2 - this.pan[1];
    this.scale *= factor;
    this.pan[0] -= ox * (factor - 1); this.pan[1] -= oy * (factor - 1);
  };
  Camera.prototype.fit = function (pts, margin) {
    if (!pts.length || !(this.w > 0) || !(this.h > 0)) return;   // a collapsed (0×0) canvas would fit scale 0
    const R = this.R;
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], c = [0, 0, 0];
    for (const p of pts) c = V.add(c, p);
    c = V.mul(c, 1 / pts.length);
    this.center = c; this.fitted = true;
    for (const p of pts) { const d = V.sub(p, c), x = V.dot(R[0], d), y = V.dot(R[1], d); lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; }
    const m = margin || 0.12;
    this.scale = Math.min(this.w / Math.max(1e-9, (hi[0] - lo[0]) * (1 + 2 * m)), this.h / Math.max(1e-9, (hi[1] - lo[1]) * (1 + 2 * m)));
    this.pan = [-this.scale * (lo[0] + hi[0]) / 2, this.scale * (lo[1] + hi[1]) / 2];
  };

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w: r.width, h: r.height, dpr };
  }

  // ---------------------------------------------------------------- scene model for drawing
  // Built once per compile: surface outlines (world polygons), group, normals.
  function buildDrawModel(scene, P) {
    const polys = [];
    const G = P.G;
    for (let k = 0; k < G.n; k++) {
      const meta = G.metas[k];
      const g = (meta.group || 'M').charAt(0);
      const inter = RF.Geo.INTER_NAMES[G.D[k * RF.Geo.STRIDE + 28]];
      for (const poly of RF.Geo.outline(G, k)) {
        const c = V.mul(poly.reduce((s, q) => V.add(s, q), [0, 0, 0]), 1 / poly.length);
        let n = V.cross(V.sub(poly[1], poly[0]), V.sub(poly[poly.length - 1], poly[0]));
        if (V.len(n) < 1e-12 && poly.length > 2) n = V.cross(V.sub(poly[1], poly[0]), V.sub(poly[2], poly[0]));
        polys.push({ k, g, inter, pts: poly, c, n: V.norm(n), id: meta.id });
      }
    }
    return { polys, P };
  }

  function drawArrow(ctx, a, b, col, w) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w || 1.5;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 8;
    ctx.beginPath(); ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang - 0.4), b[1] - L * Math.sin(ang - 0.4));
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.4), b[1] - L * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  /* drawScene: opts = { scene, model, paths, heatCanvas, fit:'fixture'|'all', showRays,
   *   handles (out: list of {id, x, y, r, ...}), highlight, preview (single-ray path) }       */
  function drawScene(cv, cam, opts) {
    const box = fitCanvas(cv), ctx = cv.getContext('2d');
    cam.w = box.w; cam.h = box.h;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const sc = opts.scene, T = RF.Engine.targetFrame(sc.target), handles = [];
    const L = cam.scale;
    // ---- envelope wireframe (behind everything)
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160,170,190,0.35)'; ctx.setLineDash([4, 3]);
    for (const line of RF.Geo.envWire(sc.envelope)) {
      ctx.beginPath(); line.forEach((p, i) => { const s = cam.project(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }); ctx.stroke();
    }
    ctx.setLineDash([]);
    // ---- polygons: surfaces + target plane, painter-sorted
    const items = [];
    for (const p of opts.model.polys) {
      const pr = p.pts.map((q) => cam.project(q));
      items.push({ type: 'surf', p, pr, z: pr.reduce((s, q) => s + q[2], 0) / pr.length });
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => RF.Engine.targetUVtoWorld(T, a * T.half, b * T.half));
    const tpr = corners.map((q) => cam.project(q));
    items.push({ type: 'target', pr: tpr, z: tpr.reduce((s, q) => s + q[2], 0) / 4 });
    items.sort((a, b) => a.z - b.z);
    const light = V.norm(V.add(V.add(cam.R[2], V.mul(cam.R[1], 0.6)), V.mul(cam.R[0], -0.3)));
    for (const it of items) {
      if (it.type === 'target') { drawTargetPlane(ctx, cam, T, it.pr, opts.heatCanvas); continue; }
      const p = it.p, col = GROUP_COL[p.g] || GROUP_COL.M;
      const lam = 0.35 + 0.65 * Math.abs(V.dot(p.n, light));
      const a = p.inter === 'refract' ? 0.22 : p.inter === 'absorb' ? 0.55 : 0.42;
      const c = p.inter === 'absorb' ? [70, 70, 76] : col.map((x) => Math.round(x * lam));
      ctx.fillStyle = rgba(c, opts.highlight === p.id ? 0.85 : a);
      ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 0.7;
      ctx.beginPath(); it.pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // ---- rays
    if (opts.showRays && opts.paths) {
      ctx.lineWidth = 1;
      for (const path of opts.paths) {
        const col = path.end === 'target' ? 'rgba(255,214,120,0.55)' : path.end === 'direct' ? 'rgba(143,184,255,0.35)' : path.end === 'escape' ? 'rgba(170,170,180,0.16)' : 'rgba(255,154,61,0.35)';
        ctx.strokeStyle = col; ctx.beginPath();
        for (let i = 0; i < path.length; i += 3) { const s = cam.project([path[i], path[i + 1], path[i + 2]]); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }
        ctx.stroke();
      }
    }
    if (opts.preview) {                                   // single-ray preview (stamp placement)
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#4cc3d9'; ctx.beginPath();
      opts.preview.forEach((p, i) => { const s = cam.project(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      ctx.stroke();
    }
    // ---- source (its real geometry) + emission axis
    drawSource(ctx, cam, sc.source);
    const src = sc.source, sp = cam.project(src.pos);
    const axLen = Math.max(12, RF.Source.boundingRadius(src) * 4, 60 / L);
    const tip = V.madd(src.pos, V.norm(src.axis), axLen), tp = cam.project(tip);
    drawArrow(ctx, [sp[0], sp[1]], [tp[0], tp[1]], '#ffd678', 2);
    handles.push({ id: 'src', x: sp[0], y: sp[1], r: 14, label: 'source' }, { id: 'axis', x: tp[0], y: tp[1], r: 14, tip, label: 'emission axis' });
    // ---- envelope face handles
    const e = sc.envelope;
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      const p = e.center.slice(); p[a] += s * e.half[a];
      const q = cam.project(p);
      handles.push({ id: 'env', axis: a, sign: s, x: q[0], y: q[1], r: 12, p, label: 'envelope ' + 'xyz'[a] + (s > 0 ? '+' : '−') });
    }
    // ---- target distance handle
    const tc = cam.project(T.C);
    handles.push({ id: 'tgt', x: tc[0], y: tc[1], r: 14, label: 'target distance' });
    // draw handles
    for (const h of handles) {
      const on = opts.activeHandle === h;
      ctx.beginPath(); ctx.arc(h.x, h.y, on ? 9 : 7, 0, 2 * Math.PI);
      ctx.fillStyle = h.id === 'env' ? 'rgba(170,180,200,0.75)' : h.id === 'tgt' ? 'rgba(143,184,255,0.9)' : h.id === 'axis' ? '#ffd678' : '#f2b441';
      ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke();
    }
    // off-screen target indicator
    if (tc[0] < 0 || tc[0] > box.w || tc[1] < 0 || tc[1] > box.h) {
      const cx = box.w / 2, cy = box.h / 2, ang = Math.atan2(tc[1] - cy, tc[0] - cx);
      const ex = cx + Math.cos(ang) * (box.w / 2 - 28), ey = cy + Math.sin(ang) * (box.h / 2 - 28);
      drawArrow(ctx, [ex - Math.cos(ang) * 30, ey - Math.sin(ang) * 30], [ex, ey], 'rgba(143,184,255,0.8)', 2);
      ctx.fillStyle = 'rgba(143,184,255,0.9)'; ctx.font = '11px system-ui';
      ctx.fillText('target plane ' + Math.round(sc.target.distance) + ' mm', Math.min(box.w - 150, Math.max(4, ex - 60)), Math.min(box.h - 6, Math.max(12, ey + (Math.sin(ang) > 0 ? -14 : 18))));
    }
    // axes gizmo
    const gz = [36, box.h - 36];
    [['x', [1, 0, 0], '#e0a060'], ['y', [0, 1, 0], '#80c0e0'], ['z', [0, 0, 1], '#c0a0f0']].forEach(([n, d, c]) => {
      const v = [V.dot(cam.R[0], d), -V.dot(cam.R[1], d)];
      drawArrow(ctx, gz, [gz[0] + v[0] * 22, gz[1] + v[1] * 22], c, 1.5);
      ctx.fillStyle = c; ctx.font = '10px system-ui'; ctx.fillText(n, gz[0] + v[0] * 30 - 3, gz[1] + v[1] * 30 + 3);
    });
    return handles;
  }

  function drawTargetPlane(ctx, cam, T, pr, heat) {
    const facing = V.dot(T.n, cam.R[2]) > 0;                    // lit side toward the viewer
    ctx.save();
    ctx.beginPath(); pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
    if (facing && heat && heat.width && isFinite(cam.focal)) {
      // Perspective: the plane's image isn't affine, so map the texture piecewise — each tile of a
      // G×G grid gets its own affine transform (exact at its corners, error shrinks as 1/G²).
      ctx.restore(); ctx.save();
      const G = 16, N = heat.width, dpr = ctx.getTransform().a, s = N / G;
      const P = (a, b) => cam.project(RF.Engine.targetUVtoWorld(T, (-1 + 2 * a / G) * T.half, (1 - 2 * b / G) * T.half));
      ctx.imageSmoothingEnabled = false;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const q00 = P(i, j), q10 = P(i + 1, j), q01 = P(i, j + 1), q11 = P(i + 1, j + 1);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(q00[0], q00[1]); ctx.lineTo(q10[0], q10[1]); ctx.lineTo(q11[0], q11[1]); ctx.lineTo(q01[0], q01[1]); ctx.closePath();
        ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(0,0,0,0)'; ctx.clip();
        // texture (i·s, j·s) → q00, +x → q10, +y → q01 ; overdraw by one texel to hide seams
        ctx.setTransform(dpr * (q10[0] - q00[0]) / s, dpr * (q10[1] - q00[1]) / s, dpr * (q01[0] - q00[0]) / s, dpr * (q01[1] - q00[1]) / s, dpr * q00[0], dpr * q00[1]);
        ctx.drawImage(heat, i * s - 0.5, j * s - 0.5, s + 1, s + 1, -0.5, -0.5, s + 1, s + 1);
        ctx.restore();
      }
      ctx.beginPath(); pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
      ctx.strokeStyle = 'rgba(143,184,255,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (facing && heat && heat.width) {
      ctx.clip();
      const N = heat.width, p00 = pr[0], p10 = pr[1], p01 = pr[3];
      // image x → +u, image y (down) → −v ; origin at (u=−h, v=+h) = p01
      const dpr = ctx.getTransform().a;
      ctx.setTransform(dpr * (p10[0] - p00[0]) / N, dpr * (p10[1] - p00[1]) / N, -dpr * (p01[0] - p00[0]) / N, -dpr * (p01[1] - p00[1]) / N, dpr * p01[0], dpr * p01[1]);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(heat, 0, 0);
      ctx.restore(); ctx.save();
      ctx.beginPath(); pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
      ctx.strokeStyle = 'rgba(143,184,255,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(60,66,78,0.55)'; ctx.fill();
      ctx.strokeStyle = 'rgba(143,184,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      const c = pr.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0]);
      ctx.fillStyle = 'rgba(200,210,230,0.7)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(facing ? 'target' : 'target (back) — orbit round to see the lit side', c[0], c[1]);
    }
    ctx.restore();
  }

  function drawSource(ctx, cam, src) {
    const o = RF.Source.outline(src);
    ctx.fillStyle = 'rgba(255,214,120,0.85)'; ctx.strokeStyle = '#ffe9b0'; ctx.lineWidth = 1.2;
    if (src.kind === 'point') { const s = cam.project(src.pos); ctx.beginPath(); ctx.arc(s[0], s[1], 4, 0, 2 * Math.PI); ctx.fill(); return; }
    for (const c of o.circles) {                                   // sphere: a shaded disc
      const s = cam.project(c.c), r = Math.max(2, c.r * cam.scale);
      const g = ctx.createRadialGradient(s[0] - r / 3, s[1] - r / 3, r / 6, s[0], s[1], r);
      g.addColorStop(0, '#fff3cf'); g.addColorStop(1, '#c9892a');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    if (o.cyl) {                                                   // cylinder: two end rings + silhouette
      const a = o.cyl.a.map((p) => cam.project(p)), b = o.cyl.b.map((p) => cam.project(p));
      ctx.fillStyle = 'rgba(255,214,120,0.55)';
      ctx.beginPath(); a.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); b.slice().reverse().forEach((q) => ctx.lineTo(q[0], q[1])); ctx.closePath(); ctx.fill();
      for (const ring of [a, b]) { ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.stroke(); }
      for (let i = 0; i < a.length; i += 3) { ctx.beginPath(); ctx.moveTo(a[i][0], a[i][1]); ctx.lineTo(b[i][0], b[i][1]); ctx.stroke(); }
      return;
    }
    for (const poly of o.polys) {                                  // planar: the actual rect/disc
      const q = poly.map((p) => cam.project(p));
      ctx.beginPath(); q.forEach((s, i) => (i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // tiny sources: always visible marker
    const s = cam.project(src.pos); ctx.beginPath(); ctx.arc(s[0], s[1], 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
  }

  // ---------------------------------------------------------------- surface view
  function drawSurfaceView(cv, cam, opts) {
    const box = fitCanvas(cv), ctx = cv.getContext('2d');
    cam.w = box.w; cam.h = box.h;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const model = opts.model, sc = opts.scene, S = sc.source.pos;
    if (!model.polys.length) {
      ctx.fillStyle = '#6c7380'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('No optical surfaces yet', box.w / 2, box.h / 2); ctx.textAlign = 'left';
      return;
    }
    const light = V.norm(V.add(cam.R[2], V.mul(cam.R[1], 0.6)));
    const items = model.polys.map((p) => { const pr = p.pts.map((q) => cam.project(q)); return { p, pr, z: pr.reduce((s, q) => s + q[2], 0) / pr.length }; });
    items.sort((a, b) => a.z - b.z);
    const G = model.P.G;
    for (const it of items) {
      const col = GROUP_COL[it.p.g] || GROUP_COL.M;
      if (opts.style === 'pairs') {
        ctx.strokeStyle = rgba(col, 0.35); ctx.lineWidth = 0.8;
        ctx.beginPath(); it.pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.stroke();
      } else {
        const lam = 0.35 + 0.65 * Math.abs(V.dot(it.p.n, light));
        ctx.fillStyle = rgba(col.map((x) => Math.round(x * lam)), it.p.inter === 'refract' ? 0.3 : 0.5);
        ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 0.7;
        ctx.beginPath(); it.pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // per-surface annotation: normals (shaded) or source→surface→out ray pairs
    const seen = new Set(), sizeRef = 40 / cam.scale;
    for (let k = 0; k < G.n; k++) {
      const m = G.metas[k]; if (seen.has(k)) continue; seen.add(k);
      if (!m.frame) continue;
      const o = k * RF.Geo.STRIDE, D = G.D;
      let c = m.frame.P, n;
      if (m.kind === 'rev') {                          // mid-profile point on the +e1 side
        const seg = m.seg; if (!seg) continue;
        const r = 0.5 * (seg.r0 + seg.r1), z = 0.5 * (seg.z0 + seg.z1);
        c = V.add(m.frame.P, V.add(V.mul(m.frame.ex, r), V.mul(m.frame.ez, z)));
        const nn = new Float64Array(3); RF.Geo.frontNormal(D, k, r, 0, z, nn); n = [nn[0], nn[1], nn[2]];
      } else { const nn = new Float64Array(3); RF.Geo.frontNormal(D, k, 0, 0, 0, nn); n = [nn[0], nn[1], nn[2]]; }
      const col = rgba(GROUP_COL[(m.group || 'M').charAt(0)] || GROUP_COL.M, 0.95);
      const a = cam.project(c);
      if (opts.style === 'pairs') {
        const d = V.norm(V.sub(c, S));
        const inter = D[o + 28];
        let out = inter === 0 ? V.reflect(d, n) : d;
        const s0 = cam.project(V.madd(c, d, -sizeRef * 0.9)), s1 = cam.project(V.madd(c, out, sizeRef * 0.9));
        drawArrow(ctx, [s0[0], s0[1]], [a[0], a[1]], 'rgba(255,214,120,0.8)', 1.2);
        drawArrow(ctx, [a[0], a[1]], [s1[0], s1[1]], col, 1.2);
      } else {
        const b = cam.project(V.madd(c, n, sizeRef * 0.5));
        drawArrow(ctx, [a[0], a[1]], [b[0], b[1]], col, 1);
      }
    }
    const s = cam.project(S); ctx.beginPath(); ctx.arc(s[0], s[1], 3.5, 0, 2 * Math.PI); ctx.fillStyle = '#ffd678'; ctx.fill();
  }

  RF.Render = { Camera, fitCanvas, buildDrawModel, drawScene, drawSurfaceView, drawArrow, LUT, GROUP_COL, rgba };
})(typeof globalThis !== 'undefined' ? globalThis : this);
