/* layout.js — workspace pane sizing.  Pure: layout state + workspace size in, pixel sizes out.
 *
 *   workspace:  [Scene] | [right]            split     = Scene's share of the width
 *   right:      [pair] over [Optics]         rowSplit  = the pair's share of the height
 *   pair:       [Editor] | [Result]          pairSplit = Editor's share (side by side, or stacked when narrow)
 *
 * Every split resolves the same way:
 *   one side collapsed  → it becomes a RAIL (side by side: a thin vertical strip) or a BAR
 *                         (stacked: just its header); the other side takes the rest
 *   a pane expanded     → its side gets at least DOM of the split; the other keeps ≥ MIN
 *   otherwise           → the stored share, clamped so both sides keep ≥ MIN
 * Nothing is ever hidden, so every collapsed pane can be clicked back one at a time.
 * ui.js owns the DOM; this file owns only the arithmetic (tests/layout.js runs it headless). */
(function (root) {
  'use strict';
  const RF = root.RF;
  const K = { RAIL: 34, BAR: 40, DIV: 10, MIN: 180, MIN_H: 140, DOM: 0.62, CHROME: 100, RIGHT_COLLAPSED_W: 220 };   // CHROME ≈ a map pane's head + caption + tools
  const PANES = ['scene', 'editor', 'result', 'optics'];

  function defaults() {
    return { split: 0.48, rowSplit: 0.58, pairSplit: 0.5, collapsed: {}, expanded: null, active: 'editor' };
  }
  // tolerate old / partial saved state
  function sanitize(s) {
    const d = defaults(), o = Object.assign({}, d, s || {});
    for (const k of ['split', 'rowSplit', 'pairSplit']) if (!(o[k] > 0.05 && o[k] < 0.95)) o[k] = d[k];
    o.collapsed = Object.assign({}, o.collapsed);
    if (!PANES.includes(o.expanded)) o.expanded = null;
    if (!PANES.includes(o.active)) o.active = d.active;
    if (o.expanded && o.collapsed[o.expanded]) o.expanded = null;
    return o;
  }

  // one split of `total` px between sides a and b, with a divider of `div` px between them
  function split(total, share, aCol, bCol, aExp, bExp, colSize, min, div) {
    if (aCol && bCol) return { a: colSize, b: Math.max(0, total - colSize - div), div };
    if (aCol) return { a: colSize, b: Math.max(0, total - colSize - div), div };
    if (bCol) return { a: Math.max(0, total - colSize - div), b: colSize, div };
    let s = share;
    if (aExp) s = Math.max(s, K.DOM); else if (bExp) s = Math.min(s, 1 - K.DOM);
    const room = Math.max(0, total - div);
    let a = Math.round(room * s);
    if (room >= 2 * min) a = Math.min(Math.max(a, min), room - min);
    return { a, b: room - a, div };
  }

  function compute(state, W, H) {
    const st = sanitize(state), c = st.collapsed, x = st.expanded;
    const pairCol = !!(c.editor && c.result), rightCol = pairCol && !!c.optics;
    const inRight = x === 'editor' || x === 'result' || x === 'optics', inPair = x === 'editor' || x === 'result';
    const cls = {}; for (const p of PANES) cls[p] = c[p] ? 'bar' : '';

    // Scene | right
    let h;
    if (rightCol && !c.scene) h = { a: Math.max(0, W - K.RIGHT_COLLAPSED_W - K.DIV), b: K.RIGHT_COLLAPSED_W, div: K.DIV };
    else h = split(W, st.split, !!c.scene, false, x === 'scene', inRight, K.RAIL, K.MIN, K.DIV);
    if (c.scene) cls.scene = 'rail';

    // pair over Optics
    const v = split(H, st.rowSplit, pairCol, !!c.optics, inPair, x === 'optics', K.BAR, K.MIN_H, K.DIV);

    // Editor | Result: the maps are squares, so pick the arrangement that draws the bigger square
    const sq = (w, hh) => Math.min(w, hh - K.CHROME);
    const stacked = !c.editor && !c.result && sq(h.b, (v.a - K.DIV) / 2) > sq((h.b - K.DIV) / 2, v.a);
    let p;
    if (pairCol) p = { a: 0, b: 0, div: K.DIV };          // both bars, laid out by CSS in the bar row
    else if (stacked) p = split(v.a, st.pairSplit, false, false, x === 'editor', x === 'result', K.BAR, K.MIN_H, K.DIV);
    else {
      p = split(h.b, st.pairSplit, !!c.editor, !!c.result, x === 'editor', x === 'result', K.RAIL, K.MIN, K.DIV);
      if (c.editor) cls.editor = 'rail';
      if (c.result) cls.result = 'rail';
    }
    return {
      cols: [h.a, h.div, h.b], rows: [v.a, v.div, v.b], pair: { stacked, both: pairCol, sizes: [p.a, p.div, p.b] },
      cls, dividers: { main: !c.scene && !rightCol, row: !pairCol && !c.optics, pair: !c.editor && !c.result },
    };
  }

  RF.Layout = { K, PANES, defaults, sanitize, compute };
})(typeof globalThis !== 'undefined' ? globalThis : this);
