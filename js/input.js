/* input.js — Pointer Events for every canvas (mouse, touch and stylus through one path).
 *   one pointer on a handle/target → drag it     one pointer elsewhere → primary gesture
 *   (orbit in 3D, paint in Mode A, pan in 2D)    two pointers → pinch-zoom + two-finger pan
 *   wheel → zoom                                  shift+drag → pan (mouse users; no right-click)
 *   short press without movement → tap
 * Click-to-focus (h.isLive, h.cold): a press on a pane that wasn't active only activates it.
 *   cold: 'swallow' → the whole press is ignored (Editor: no stray paint / stamp / profile point)
 *   cold: 'view'    → view gestures only: orbit / pan go through, handles and taps don't
 *   wheel on an inactive pane does nothing and doesn't preventDefault, so the page scrolls instead.
 *   Pinch stays live: two fingers is never an accident.
 * Handlers report interaction start/end so the UI can drop to a coarse preview while dragging. */
(function (root) {
  'use strict';
  const RF = root.RF;

  function attach(cv, h) {
    const pts = new Map();
    let mode = null, target = null, last = null, downAt = null, moved = 0, pinch = null, cold = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const start = () => h.onInteract && h.onInteract(true);
    const end = () => h.onInteract && h.onInteract(false);

    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic / already-released pointer */ }
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        downAt = { p, t: performance.now() }; moved = 0; last = p;
        cold = !!h.isLive && !h.isLive(true);
        if (cold && h.cold === 'swallow') { mode = 'swallowed'; target = null; e.preventDefault(); return; }
        target = h.hitTest && !cold ? h.hitTest(p[0], p[1]) : null;
        if (target) { mode = 'drag'; h.onDragStart && h.onDragStart(target, p[0], p[1]); }
        else if (e.shiftKey && h.onPan) mode = 'pan';
        else mode = 'primary';
        if (mode === 'primary' && h.onPrimaryStart && !cold) h.onPrimaryStart(p[0], p[1]);
        start();
      } else if (pts.size === 2) {
        if (mode === 'swallowed') { const q = [...pts.values()]; pinch = { d: Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]), c: [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2] }; mode = 'pinch'; start(); e.preventDefault(); return; }
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
        if (isTap && h.onTap && mode !== 'pinch' && mode !== 'swallowed' && !cold) h.onTap(p[0], p[1], target);
        const was = mode; mode = null; target = null; last = null; pinch = null; cold = false;
        if (was !== 'swallowed') end();
      } else if (mode === 'pinch' && pts.size === 1) {
        last = [...pts.values()][0]; mode = 'pan-rest';          // lifting one finger: stop zooming
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (h.isLive && !h.isLive(false)) return;          // inactive pane: let the page scroll
      e.preventDefault();
      const p = pos(e);
      if (h.onZoom) { start(); h.onZoom(Math.exp(-e.deltaY * 0.0015), p[0], p[1]); clearTimeout(cv._wheelT); cv._wheelT = setTimeout(end, 180); }
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerleave', (e) => { if (!pts.has(e.pointerId) && h.onLeave) h.onLeave(); });
  }

  RF.Input = { attach };
})(typeof globalThis !== 'undefined' ? globalThis : this);
