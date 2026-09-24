/* input.js — Pointer Events for every canvas (mouse, touch and stylus through one path).
 *   one pointer on a handle/target → drag it     one pointer elsewhere → primary gesture
 *   (orbit in 3D, paint in Mode A, pan in 2D)    two pointers → pinch-zoom + two-finger pan
 *   wheel → zoom                                  shift+drag → pan (mouse users; no right-click)
 *   short press without movement → tap
 * Handlers report interaction start/end so the UI can drop to a coarse preview while dragging. */
(function (root) {
  'use strict';
  const RF = root.RF;

  function attach(cv, h) {
    const pts = new Map();
    let mode = null, target = null, last = null, downAt = null, moved = 0, pinch = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const start = () => h.onInteract && h.onInteract(true);
    const end = () => h.onInteract && h.onInteract(false);

    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic / already-released pointer */ }
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        downAt = { p, t: performance.now() }; moved = 0; last = p;
        target = h.hitTest ? h.hitTest(p[0], p[1]) : null;
        if (target) { mode = 'drag'; h.onDragStart && h.onDragStart(target, p[0], p[1]); }
        else if (e.shiftKey && h.onPan) mode = 'pan';
        else mode = 'primary';
        if (mode === 'primary' && h.onPrimaryStart) h.onPrimaryStart(p[0], p[1]);
        start();
      } else if (pts.size === 2) {
        if (mode === 'drag' && h.onDragEnd) h.onDragEnd(target, true);
        if (mode === 'primary' && h.onPrimaryEnd) h.onPrimaryEnd(true);
        mode = 'pinch'; target = null;
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (!pts.has(e.pointerId)) { if (h.onHover) h.onHover(p[0], p[1]); return; }
      pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (h.onZoom && pinch.d > 0) h.onZoom(d / pinch.d, c[0], c[1]);
        if (h.onPan) h.onPan(c[0] - pinch.c[0], c[1] - pinch.c[1]);
        pinch = { d, c };
        return;
      }
      if (!last) return;
      const dx = p[0] - last[0], dy = p[1] - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = p;
      if (mode === 'drag' && h.onDrag) h.onDrag(target, p[0], p[1], dx, dy);
      else if (mode === 'pan' && h.onPan) h.onPan(dx, dy);
      else if (mode === 'primary' && h.onPrimary) h.onPrimary(p[0], p[1], dx, dy);
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e);
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        const isTap = downAt && moved < 6 && performance.now() - downAt.t < 450;
        if (mode === 'drag' && h.onDragEnd) h.onDragEnd(target, false);
        if (mode === 'primary' && h.onPrimaryEnd) h.onPrimaryEnd(false);
        if (isTap && h.onTap && mode !== 'pinch') h.onTap(p[0], p[1], target);
        mode = null; target = null; last = null; pinch = null;
        end();
      } else if (mode === 'pinch' && pts.size === 1) {
        last = [...pts.values()][0]; mode = 'pan-rest';          // lifting one finger: stop zooming
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (h.onZoom) { start(); h.onZoom(Math.exp(-e.deltaY * 0.0015), p[0], p[1]); clearTimeout(cv._wheelT); cv._wheelT = setTimeout(end, 180); }
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  RF.Input = { attach };
})(typeof globalThis !== 'undefined' ? globalThis : this);
