/* history.js — undo/redo by snapshot-and-compare.
 * The UI checkpoints wherever it already autosaves (slider release, stroke end, drag end, loads):
 * if the scene's INTENT differs from the last checkpoint, the old intent is pushed.  Intent = what
 * the user asked for — paint, settings, stamps, profile, lenses, source, envelope, target.  It
 * excludes everything derived (solved surfaces; they are rebuilt on restore) and view/tool state
 * (mode tab, selection, brush, notices), so re-solves and tab switches never create entries.
 * Pure functions only; ui.js owns the buttons, keys and toast.                                   */
(function (root) {
  'use strict';
  const RF = root.RF;
  const DERIVED = ['A', 'B', 'C', 'L'];            // groups rebuilt from intent; M (manual) is intent

  function intent(scene) {
    const s = JSON.parse(JSON.stringify(scene));
    delete s.mode; delete s.notices;
    if (s.modeA) delete s.modeA.brush;
    if (s.modeB) {
      delete s.modeB.selected;
      // auto-aimed stamps get th/ph written back by the Mode B build (modeB.js) — derived, not intent
      for (const st of s.modeB.stamps || []) if (st.dirMode !== 'manual') { delete st.th; delete st.ph; }
    }
    if (s.sim) { delete s.sim.view; delete s.sim.surfaceView; delete s.sim.smoothing; }
    for (const g of DERIVED) if (s.groups && s.groups[g]) delete s.groups[g].surfaces;
    return s;
  }
  // Canonical key: object keys sorted, so the same data built in a different order compares equal
  // (apply() re-inserts properties, which would otherwise read as a change on the next checkpoint).
  function key(x) {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(key).join(',') + ']';
    return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + key(x[k])).join(',') + '}';
  }

  // Write an intent snapshot into a live scene, keeping its view/tool state; caller re-derives groups.
  function apply(scene, it) {
    const keep = { mode: scene.mode, notices: scene.notices, brush: scene.modeA.brush, selected: scene.modeB.selected,
      view: scene.sim.view, surfaceView: scene.sim.surfaceView, smoothing: scene.sim.smoothing };
    const c = JSON.parse(JSON.stringify(it));
    for (const k of Object.keys(scene)) if (!(k in c) && k !== 'mode' && k !== 'notices' && k !== 'groups') delete scene[k];
    for (const [k, v] of Object.entries(c)) {
      if (k === 'groups') continue;
      scene[k] = v;
    }
    for (const [g, v] of Object.entries(c.groups || {})) scene.groups[g] = Object.assign({ surfaces: [] }, v, DERIVED.includes(g) ? { surfaces: [] } : {});
    scene.mode = keep.mode; scene.notices = keep.notices; scene.modeA.brush = keep.brush;
    for (const st of scene.modeB.stamps) if (st.th === undefined) { st.th = 45; st.ph = 0; }   // newStamp defaults; the build re-aims
    if (scene.modeB) scene.modeB.selected = scene.modeB.stamps.some((t) => t.id === keep.selected) ? keep.selected : null;
    Object.assign(scene.sim, { view: keep.view, surfaceView: keep.surfaceView, smoothing: keep.smoothing });
  }

  // Human label for the change a → b (intents).  Single control → "Facet budget 48 → 400".
  const fmt = (v) => typeof v === 'number' ? (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toPrecision(3)) : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
  function changedControls(a, b) {
    const out = [];
    for (const c of RF.Controller.CONTROLS) {
      let va, vb;
      try { va = c.get({ scene: a }); vb = c.get({ scene: b }); } catch (e) { continue; }
      if (JSON.stringify(va) === JSON.stringify(vb)) continue;
      if (c.show) { try { if (!c.show({ scene: b })) continue; } catch (e) { /* keep */ } }   // hidden = follows another control (e.g. linked aim)
      out.push({ c, va, vb });
    }
    return out;
  }
  function describe(a, b) {
    let ch = changedControls(a, b);
    const only = (ids) => ch.length && ch.every((x) => ids.includes(x.c.id));
    if (only(['src.x', 'src.y', 'src.z'])) return { id: null, text: 'Source moved' };
    if (only(['src.az', 'src.el'])) return { id: null, text: 'Source aimed' };
    if (ch.length === 1) return { id: ch[0].c.id, text: ch[0].c.label + ' ' + fmt(ch[0].va) + ' → ' + fmt(ch[0].vb) };
    const J = (x) => JSON.stringify(x);
    const parts = [];
    if (J(a.modeA.paint) !== J(b.modeA.paint) && a.target.res === b.target.res) parts.push('paint');
    if (J(a.modeB.stamps) !== J(b.modeB.stamps)) {
      const d = b.modeB.stamps.length - a.modeB.stamps.length;
      parts.push(d > 0 ? 'stamp added' : d < 0 ? 'stamp removed' : 'stamp edit');
    }
    if (J(a.modeC.profile) !== J(b.modeC.profile)) parts.push('profile edit');
    if (J(a.lenses) !== J(b.lenses)) parts.push('lens change');
    if (J(a.source.pos) !== J(b.source.pos) || J(a.source.axis) !== J(b.source.axis)) { parts.push('source moved'); ch = ch.filter((x) => !/^src\.(x|y|z|az|el)$/.test(x.c.id)); }
    if (J(a.envelope) !== J(b.envelope) && !ch.some((x) => x.c.id.startsWith('env.'))) parts.push('envelope resized');
    if (ch.length > 1) parts.push(ch.length + ' settings');
    return { id: null, text: parts.length ? parts.join(', ').replace(/^./, (m) => m.toUpperCase()) : 'Edit' };
  }

  // History stack.  push() is called with the PREVIOUS intent when a checkpoint sees a change.
  function create(cap) {
    return {
      past: [], future: [], cap: cap || 100, base: null, baseKey: null, lastT: 0, lastId: null,
      reset(it) { this.past = []; this.future = []; this.base = it; this.baseKey = key(it); this.lastId = null; },
      // Returns the entry pushed (or merged into), or null if nothing changed.
      // mode: for whole-scene loads only — the mode tab to return to when this entry is undone
      checkpoint(it, now, hint, mode) {
        const k = key(it);
        if (k === this.baseKey) return null;
        const d = describe(this.base, it), label = hint || d.text;
        // coalesce repeated edits of one control (e.g. arrow-keying a number) into one entry
        const top = this.past[this.past.length - 1];
        if (!hint && d.id && d.id === this.lastId && top && now - this.lastT < 800) {
          top.label = top.label.replace(/→ .*$/, '→ ' + d.text.split(' → ').pop());
          this.base = it; this.baseKey = k; this.lastT = now; this.future = [];
          return top;
        }
        this.past.push({ it: this.base, label, mode: hint ? mode : undefined });
        if (this.past.length > this.cap) this.past.shift();
        this.future = []; this.base = it; this.baseKey = k; this.lastT = now; this.lastId = d.id;
        return this.past[this.past.length - 1];
      },
      undo(current, curMode) {
        const e = this.past.pop(); if (!e) return null;
        this.future.push({ it: current, label: e.label, mode: e.mode !== undefined ? curMode : undefined });
        this.base = e.it; this.baseKey = key(e.it); this.lastId = null;
        return e;
      },
      redo(current, curMode) {
        const e = this.future.pop(); if (!e) return null;
        this.past.push({ it: current, label: e.label, mode: e.mode !== undefined ? curMode : undefined });
        this.base = e.it; this.baseKey = key(e.it); this.lastId = null;
        return e;
      },
    };
  }

  RF.History = { intent, apply, describe, create, key };
})(typeof globalThis !== 'undefined' ? globalThis : this);
