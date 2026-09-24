/* render2d.js — 2D panels: target heatmaps (simulated / intended), Mode B stamps overlay and the
 * direction picker (polar map of directions around the emission axis, shaded by the source's
 * real intensity and by whether the envelope has room there), and the Mode C profile editor.
 * Each 2D canvas has its own zoom/pan view (pinch, two-finger pan, wheel).                    */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const { LUT, fitCanvas, rgba } = RF.Render;

  // ---------------------------------------------------------------- 2D view (content → screen)
  function View2D() { this.s = 1; this.ox = 0; this.oy = 0; this.fitted = false; this.w = 1; this.h = 1; this.bounds = [0, 0, 1, 1]; }
  // bounds = [x0, y0, x1, y1] in content units, y up
  View2D.prototype.fit = function (b, w, h, margin) {
    const m = margin === undefined ? 0.04 : margin, bw = b[2] - b[0], bh = b[3] - b[1];
    this.s = Math.min(w / (bw * (1 + 2 * m)), h / (bh * (1 + 2 * m)));
    this.ox = w / 2 - this.s * (b[0] + b[2]) / 2; this.oy = h / 2 + this.s * (b[1] + b[3]) / 2;
    this.fitted = true; this.bounds = b.slice(); this.w = w; this.h = h;
  };
  View2D.prototype.toScreen = function (x, y) { return [this.ox + this.s * x, this.oy - this.s * y]; };
  View2D.prototype.toContent = function (sx, sy) { return [(sx - this.ox) / this.s, (this.oy - sy) / this.s]; };
  View2D.prototype.zoomAt = function (f, sx, sy) { this.ox = sx - (sx - this.ox) * f; this.oy = sy - (sy - this.oy) * f; this.s *= f; };
  View2D.prototype.panBy = function (dx, dy) { this.ox += dx; this.oy += dy; };

  function prepare2d(cv, view, bounds, refit) {
    const box = fitCanvas(cv), ctx = cv.getContext('2d');
    if (!view.fitted || refit || view.w !== box.w || view.h !== box.h || view.bounds.join() !== bounds.join()) view.fit(bounds, box.w, box.h);
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    return { ctx, box };
  }

  // ---------------------------------------------------------------- grids → images
  // Optional display smoothing: a separable Gaussian (σ = 0.8 cell) applied to a COPY used only
  // for the picture.  Statistics never see it.
  function smoothCopy(vals, res) {
    const k = [0.0636, 0.2447, 0.3834, 0.2447, 0.0636];   // σ≈0.8, normalised
    const tmp = new Float64Array(res * res), out = new Float64Array(res * res);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const q = i + d; if (q >= 0 && q < res) { s += vals[j * res + q] * k[d + 2]; w += k[d + 2]; } } tmp[j * res + i] = s / w; }
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const q = j + d; if (q >= 0 && q < res) { s += tmp[q * res + i] * k[d + 2]; w += k[d + 2]; } } out[j * res + i] = s / w; }
    return out;
  }
  // res×res canvas, row 0 at the top (v max), normalised to its own max
  function gridCanvas(vals, res, canvas, maxOverride) {
    const c = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!c) return null;
    if (c.width !== res) { c.width = res; c.height = res; }
    const g = c.getContext('2d'), img = g.createImageData(res, res);
    let mx = 0; for (let i = 0; i < vals.length; i++) if (vals[i] > mx) mx = vals[i];
    const peak = mx; if (maxOverride > 0) mx = maxOverride;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const v = vals[j * res + i], t = mx > 0 ? Math.min(255, Math.round(v / mx * 255)) : 0;
      const o = 4 * ((res - 1 - j) * res + i);
      img.data[o] = LUT[3 * t]; img.data[o + 1] = LUT[3 * t + 1]; img.data[o + 2] = LUT[3 * t + 2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    c.maxValue = peak;
    return c;
  }

  // draw a grid image into a canvas using the view (content = cells, y up)
  function drawGridPanel(cv, view, img, res, overlay) {
    const { ctx, box } = prepare2d(cv, view, [0, 0, res, res]);
    const a = view.toScreen(0, res), b = view.toScreen(res, 0);
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    ctx.strokeStyle = 'rgba(143,184,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0] - 1, b[1] - a[1] - 1);
    // centre cross
    const c = view.toScreen(res / 2, res / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(c[0] - 6, c[1]); ctx.lineTo(c[0] + 6, c[1]); ctx.moveTo(c[0], c[1] - 6); ctx.lineTo(c[0], c[1] + 6); ctx.stroke();
    if (overlay) overlay(ctx, view, box);
    return { ctx, box };
  }

  // target (u, v) mm ↔ grid content coordinates
  function uvToCell(T, u, v) { const s = T.res / (2 * T.half); return [(u + T.half) * s, (v + T.half) * s]; }
  function cellToUV(T, x, y) { const s = (2 * T.half) / T.res; return [x * s - T.half, y * s - T.half]; }

  // Mode B overlay: requested tile (solid), solved tile width (dashed), selection
  function stampOverlay(scene, reports, selected) {
    const T = RF.Engine.targetFrame(scene.target), cell = 2 * T.half / T.res;
    return (ctx, view) => {
      scene.modeB.stamps.forEach((st, i) => {
        const rep = (reports || []).find((r) => r.id === st.id);
        const [cx, cy] = uvToCell(T, st.u, st.v), half = st.scale / cell / 2;
        const a = view.toScreen(cx - half, cy + half), b = view.toScreen(cx + half, cy - half);
        const sel = st.id === selected;
        ctx.lineWidth = sel ? 2 : 1.2; ctx.strokeStyle = sel ? '#4cc3d9' : 'rgba(76,195,217,0.7)';
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        if (rep && rep.ok && Math.abs(rep.tileWidth - st.scale) > 0.02 * st.scale) {
          const h2 = rep.tileWidth / cell / 2, a2 = view.toScreen(cx - h2, cy + h2), b2 = view.toScreen(cx + h2, cy - h2);
          ctx.setLineDash([4, 3]); ctx.strokeStyle = '#ff9a3d'; ctx.strokeRect(a2[0], a2[1], b2[0] - a2[0], b2[1] - a2[1]); ctx.setLineDash([]);
        }
        const p = view.toScreen(cx, cy);
        ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 8 : 6, 0, 2 * Math.PI); ctx.fillStyle = rep && !rep.ok ? '#ff9a3d' : '#4cc3d9'; ctx.fill();
        ctx.fillStyle = '#e8e6e1'; ctx.font = '11px system-ui'; ctx.fillText(String(i + 1), p[0] + 9, p[1] - 8);
      });
    };
  }

  // ---------------------------------------------------------------- direction picker (Mode B)
  // Polar map: centre = emission axis, radius ∝ polar angle θ (to 180° or 90° for planar dies).
  let pickerCache = { key: '', img: null };
  function pickerImage(scene) {
    const src = scene.source, key = JSON.stringify([src, scene.envelope]);
    if (pickerCache.key === key && pickerCache.img) return pickerCache.img;
    const N = 120, c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    const tmax = src.kind === 'planar' ? 90 : 180;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N * 2 - 1, py = 1 - (y + 0.5) / N * 2, rr = Math.hypot(px, py);
      const o = 4 * (y * N + x);
      if (rr > 1) { img.data[o + 3] = 0; continue; }
      const th = rr * tmax, ph = Math.atan2(py, px) * 180 / Math.PI;
      const info = RF.ModeB.dirInfo(scene, th, ph);
      const t = Math.min(255, Math.round(info.I * 230)), dim = info.room ? 1 : 0.28;
      img.data[o] = LUT[3 * t] * dim + 18; img.data[o + 1] = LUT[3 * t + 1] * dim + 20; img.data[o + 2] = LUT[3 * t + 2] * dim + 26; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    pickerCache = { key, img: c, tmax };
    return c;
  }
  function drawPicker(cv, view, scene, reports, selected) {
    const { ctx, box } = prepare2d(cv, view, [-1.08, -1.08, 1.08, 1.08]);
    const img = pickerImage(scene), tmax = pickerCache.tmax;
    const a = view.toScreen(-1, 1), b = view.toScreen(1, -1);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    const c0 = view.toScreen(0, 0), R = view.s;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    for (let t = 30; t <= tmax; t += 30) { ctx.beginPath(); ctx.arc(c0[0], c0[1], R * t / tmax, 0, 2 * Math.PI); ctx.stroke(); }
    for (let p = 0; p < 360; p += 45) { const q = view.toScreen(Math.cos(p * Math.PI / 180), Math.sin(p * Math.PI / 180)); ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
    ctx.fillStyle = 'rgba(232,230,225,0.75)'; ctx.font = '10px system-ui';
    for (let t = 30; t <= tmax; t += 30) ctx.fillText(t + '°', c0[0] + R * t / tmax + 2, c0[1] - 2);
    ctx.fillText('φ=0°', view.toScreen(1.0, 0)[0] - 26, c0[1] + 12);
    const marks = [];
    scene.modeB.stamps.forEach((st, i) => {
      const rep = (reports || []).find((r) => r.id === st.id);
      if (!rep || rep.th === undefined) return;
      const rr = rep.th / tmax, p = view.toScreen(rr * Math.cos(rep.ph * Math.PI / 180), rr * Math.sin(rep.ph * Math.PI / 180));
      const sel = st.id === selected;
      const hr = rep.halfAngle ? rep.halfAngle * 180 / Math.PI / tmax * R : 4;
      ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(4, hr), 0, 2 * Math.PI); ctx.strokeStyle = sel ? '#4cc3d9' : 'rgba(76,195,217,0.6)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 7 : 5, 0, 2 * Math.PI); ctx.fillStyle = st.dirMode === 'manual' ? '#4cc3d9' : 'rgba(76,195,217,0.55)'; ctx.fill();
      ctx.fillStyle = '#e8e6e1'; ctx.fillText(String(i + 1), p[0] + 8, p[1] - 6);
      marks.push({ id: st.id, x: p[0], y: p[1] });
    });
    return { marks, tmax };
  }

  // ---------------------------------------------------------------- profile editor (Mode C)
  function profileBounds(scene) {
    const pts = scene.modeC.profile;
    let x0 = -2, x1 = 20, y0 = -20, y1 = 20;
    for (const p of pts) { x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const pad = 0.15 * Math.max(x1 - x0, y1 - y0);
    return [x0 - pad * 0.3, y0 - pad, x1 + pad, y1 + pad];
  }
  function niceStep(span) { const r = span / 6, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p; }
  function drawProfile(cv, view, scene, sel, refit) {
    const b = profileBounds(scene);
    const { ctx } = prepare2d(cv, view, view.lockBounds || b, refit);
    const mc = scene.modeC, pts = mc.profile;
    // grid
    const tl = view.toContent(0, 0), br = view.toContent(view.w, view.h), st = niceStep(br[0] - tl[0]);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(154,161,173,0.7)'; ctx.font = '10px system-ui';
    for (let x = Math.ceil(tl[0] / st) * st; x <= br[0]; x += st) { const s = view.toScreen(x, 0); ctx.beginPath(); ctx.moveTo(s[0], 0); ctx.lineTo(s[0], view.h); ctx.stroke(); ctx.fillText(+x.toFixed(6), s[0] + 2, view.h - 4); }
    for (let y = Math.ceil(br[1] / st) * st; y <= tl[1]; y += st) { const s = view.toScreen(0, y); ctx.beginPath(); ctx.moveTo(0, s[1]); ctx.lineTo(view.w, s[1]); ctx.stroke(); if (s[1] < view.h - 16) ctx.fillText(+y.toFixed(6), 2, s[1] - 2); }
    // axis (sweep axis) and source
    const a0 = view.toScreen(0, br[1]), a1 = view.toScreen(0, tl[1]);
    ctx.strokeStyle = 'rgba(180,140,240,0.7)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(180,140,240,0.9)'; ctx.fillText(mc.sweep === 'revolve' ? 'revolve axis (z) →' : 'profile plane: x across, z along axis', a1[0] + 4, a1[1] + 12);
    const s0 = view.toScreen(0, 0);
    ctx.beginPath(); ctx.arc(s0[0], s0[1], 5, 0, 2 * Math.PI); ctx.fillStyle = '#ffd678'; ctx.fill();
    ctx.fillText('source', s0[0] + 7, s0[1] + 14);
    const drawLine = (P, dash, col) => { if (P.length < 2) return; ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); P.forEach((p, i) => { const q = view.toScreen(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.setLineDash([]); };
    if (mc.mirror) drawLine(mc.sweep === 'revolve' ? pts.map(([r, z]) => [r, -z]) : pts.map(([r, z]) => [-r, z]), [4, 4], 'rgba(180,140,240,0.5)');
    drawLine(pts, [], mc.interaction === 'refract' ? '#8fb8ff' : '#b48cf0');
    // front-side ticks (left normal, flipped if requested)
    ctx.strokeStyle = 'rgba(255,214,120,0.8)'; ctx.lineWidth = 1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [r0, z0] = pts[i], [r1, z1] = pts[i + 1], L = Math.hypot(r1 - r0, z1 - z0); if (!L) continue;
      let nx = -(z1 - z0) / L, ny = (r1 - r0) / L; if (mc.flipFacing) { nx = -nx; ny = -ny; }
      const m = view.toScreen((r0 + r1) / 2, (z0 + z1) / 2);
      ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(m[0] + nx * 7, m[1] - ny * 7); ctx.stroke();
    }
    const handles = pts.map((p, i) => { const q = view.toScreen(p[0], p[1]); return { i, x: q[0], y: q[1] }; });
    for (const h of handles) { ctx.beginPath(); ctx.arc(h.x, h.y, h.i === sel ? 7 : 5, 0, 2 * Math.PI); ctx.fillStyle = h.i === sel ? '#ffd678' : '#b48cf0'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke(); }
    return { handles };
  }

  function colorbarCSS() {
    const stops = []; for (let i = 0; i <= 10; i++) { const t = Math.round(i / 10 * 255); stops.push('rgb(' + LUT[3 * t] + ',' + LUT[3 * t + 1] + ',' + LUT[3 * t + 2] + ') ' + i * 10 + '%'); }
    return 'linear-gradient(90deg,' + stops.join(',') + ')';
  }

  RF.Render2D = { View2D, smoothCopy, gridCanvas, drawGridPanel, stampOverlay, drawPicker, drawProfile, uvToCell, cellToUV, colorbarCSS, profileBounds };
})(typeof globalThis !== 'undefined' ? globalThis : this);
