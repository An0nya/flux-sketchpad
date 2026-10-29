// UI (10-29, step C): the Drive view layout. One shell inside the drive bar (.drive-tools): a top bar, an always-visible strip, a left panel
// with folder tabs (Lighting | Scene | Performance; Lighting has the sub-tabs Oncoming | Ours | Lamps | Glare), the stage the canvas sits in, and a
// right panel (Details | Timings). Wide hosts put the panels left and right of the stage and push it; tall hosts stack top, stage, strip, panel.
// The controls are made where they always were (spec-ui.js driveTools, drive-anim.js bars/topButtons); place() moves each one to the spot the
// LAYOUT table names. It is idempotent and runs after every creator. A control no row names lands in Performance > other, and unplaced() lists it.
(function (root) {
  'use strict';
  const RF = root.RF = root.RF || {};
  const dv = (k) => '[data-dv="' + k + '"]', an = (k) => '[data-anim="' + k + '"]';
  const C = (ks) => ks.map((k) => an('c-' + k));
  // [tab, sub|null, group title, selectors]. The order inside a group is the order on screen.
  const LAYOUT = [
    ['lighting', 'oncoming', 'Oncoming headlamp scatter', [dv('trafficHalo'), dv('haloCars'), dv('haloQuality'), dv('haloRangeRow'), '.drive-halo-adv']],
    ['lighting', 'oncoming', 'Oncoming lamps', [dv('onMode'), '[data-dv-aim]', an('traffic-shuffle'), an('traffic-beam-list'), an('traffic-light-range'), an('traffic-nearest')]],
    ['lighting', 'ours', 'Air beam', [dv('airLevel'), '.drive-air-adv']],
    ['lighting', 'ours', 'Our beams', [an('own-low'), an('own-high'), '[data-dl=beam-label]', an('beam-name'), an('save-grid'), an('save-design'), an('import-beam'), an('export-beams'), an('beam-file'), an('beam-status'), an('beam-manager')]],
    ['lighting', 'lamps', 'Street lamps', [an('street-lamps'), dv('lampClass'), dv('lampRoad'), dv('lampCone'), dv('lampConeGain')]],
    ['lighting', 'lamps', 'Ambient', [an('ambient')]],
    ['lighting', 'glare', 'Wet road', [dv('wetSheen'), dv('wetModel'), an('surface-sheen')]],
    ['lighting', 'glare', 'Power lines', [an('powerline-reflectance')]],
    ['scene', null, 'Weather and air', [dv('wetness'), dv('visibility')]],
    ['scene', null, 'Objects', [an('enable-all'), ...C(['posts', 'signs', 'people', 'animals', 'veg', 'obstacle', 'rpm']), an('detailed-models'), an('leafy-foliage'), an('deer-behaviour'), an('powerlines'), an('reflective-clothing')]],
    ['scene', null, 'Road', [dv('shape'), an('tiles'), an('tile-status'), ...C(['wild']), an('seed'), an('dice'), an('density'), an('cline'), ...C(['tex'])]],
    ['scene', null, 'Traffic', [an('traffic-logic'), an('gap'), an('traffic-density'), an('traffic-range'), an('flashes'), an('reset-flashes')]],
    ['scene', null, 'Our car', [an('afs'), an('cornering-lamps'), an('lamp-pitch')]],
    ['performance', null, 'Exposure', [dv('expMode'), dv('evm'), dv('evp')]],
    ['performance', null, 'Resolution', [an('resolution'), an('dynamic-resolution'), an('min-fps'), dv('samples')]],
    ['performance', null, 'Renderer', [an('gpu-renderer'), ...C(['mt']), an('tile-cache')]],
    ['performance', null, 'Debug', [an('save-state'), an('load-state'), an('state-file'), an('state-msg')]],
    ['performance', null, 'View', [dv('fov'), an('canvas-shape'), an('panel-mode'), an('fps-counter'), an('large-card'), an('animate-ui')]],
    ['details', null, '', [an('scene-details'), an('scene-details-panel')]],
    ['timings', null, '', [an('debug-timings'), an('perf-readout')]],
  ];
  const TOP = [dv('scene'), an('play'), '[data-game=toggle]'];
  const STRIP = [an('traffic-beams'), dv('oncoming'), dv('preceding'), '|', an('high-beam'), '|', '.drive-speed', '|', dv('glare'), dv('ev')];
  const TABS = [['lighting', 'Lighting'], ['scene', 'Scene'], ['performance', 'Performance'], ['details', 'Details'], ['timings', 'Timings']];
  const SUBS = [['oncoming', 'Oncoming'], ['ours', 'Ours'], ['lamps', 'Lamps'], ['glare', 'Glare']];
  const RIGHT = ['details', 'timings'];
  const KEY = { tab: 'flux/driveTab', sub: 'flux/driveSub', rtab: 'flux/driveRightTab' };
  // panel open state is remembered per mode (push and overlay start differently); key e.g. flux/driveLeftOpen:push
  const openKey = (side, mode) => 'flux/drive' + (side === 'left' ? 'Left' : 'Right') + 'Open:' + mode;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };
  const E = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); e.append(...kids); return e; };
  // the unit a control moves with: a labelled slider's box, the speed box
  const unit = (e) => (e.parentElement && e.parentElement.matches('.drive-slider') ? e.parentElement : e);
  // a tall host stacks the panels under the stage: taller than wide (phones, a portrait pane). A narrow landscape host overlays instead
  // (the stack cannot fit its strip and tabs in a short box)
  const isTall = (w, h) => h > w;
  // push or overlay (owner 10-29, auto): a tall host always stacks; a wide host pushes when it is at least 940 x 420, else the bars and panels
  // float over a full-size canvas. A pushed host under 1180 wide starts with the right panel collapsed; overlay starts with both collapsed.
  const PUSH_MIN = { w: 940, h: 420 }, RIGHT_MIN = 1180;
  const modeOf = (pref, w, h, tall) => (tall ? 'stack' : pref === 'push' || pref === 'overlay' ? pref : w >= PUSH_MIN.w && h >= PUSH_MIN.h ? 'push' : 'overlay');
  // CANVAS SHAPE (owner 10-29, every layout): wide 16:9 (default), 3:4 or square. Portrait shapes keep the wide view's vertical field of view and
  // crop the sides (drive-anim.js hfovFor). Stacked with the panel open, 3:4 becomes square (one zoom step; owner OK), so the tabs keep room.
  const SHAPES = { wide: 16 / 9, '3:4': 3 / 4, square: 1 };
  const shapeOf = (pref, tall, open) => { const s = SHAPES[pref] ? pref : 'wide'; return s === '3:4' && tall && open ? 'square' : s; };
  function aspectOf(ui) { const L = ui.driveLayout; return SHAPES[L && L.shape ? L.shape : shapeOf(ui.dvOpts && ui.dvOpts.canvasShape, false, false)]; }
  const openDefault = (side, mode, w) => (mode === 'overlay' ? false : side === 'left' || mode === 'stack' || w >= RIGHT_MIN);

  // build: the skeleton, once, inside the bar. Returns the parts; ui.driveLayout keeps them.
  function build(ui, bar) {
    if (ui.driveLayout) return ui.driveLayout;
    bar.classList.add('dl');
    const L = { root: bar, panes: {}, subs: {}, groups: new Map() };
    L.top = E('div', { class: 'dl-top' }); L.strip = E('div', { class: 'dl-strip', role: 'toolbar', 'aria-label': 'Drive' });
    L.stage = E('div', { class: 'dl-stage' });
    L.left = E('div', { class: 'dl-panel dl-left', 'data-open': 'true' });
    L.right = E('div', { class: 'dl-panel dl-right', 'data-open': 'true' });
    L.staging = E('div', { class: 'dl-staging', hidden: '' });   // where creators append; place() empties it
    const grab = (side) => { const g = E('button', { type: 'button', class: 'dl-grab', 'data-dl-grab': side, 'aria-label': side === 'left' ? 'Show or hide the controls' : 'Show or hide details and timings' }); g.addEventListener('click', () => { toggle(ui, side); wake(ui); }); return g; };
    const tabRow = (list, cls, attr, pick) => { const row = E('div', { class: cls, role: 'tablist' }); for (const [id, label] of list) { const b = E('button', { type: 'button', role: 'tab', [attr]: id }, label); b.addEventListener('click', () => { pick(id); wake(ui); }); row.append(b); } return row; };
    L.tabs = tabRow(TABS, 'dl-tabs', 'data-dl-tab', (id) => select(ui, { tab: id }));
    L.rtabs = tabRow(TABS.filter(([id]) => RIGHT.includes(id)), 'dl-tabs', 'data-dl-rtab', (id) => select(ui, { rtab: id }));
    L.subRow = tabRow(SUBS, 'dl-seg', 'data-dl-sub', (id) => select(ui, { sub: id }));
    L.content = E('div', { class: 'dl-content' }); L.rcontent = E('div', { class: 'dl-content' });
    for (const [id] of TABS) L.panes[id] = E('div', { class: 'dl-pane', 'data-dl-pane': id, role: 'tabpanel' });
    for (const [id] of SUBS) { L.subs[id] = E('div', { class: 'dl-sub', 'data-dl-subpane': id }); L.panes.lighting.append(L.subs[id]); }
    L.panes.lighting.prepend(L.subRow);
    L.other = group(L, 'performance', null, 'Other');
    L.left.append(grab('left'), L.tabs, L.content); L.right.append(grab('right'), L.rtabs, L.rcontent);
    L.body = E('div', { class: 'dl-body' }, L.left, L.stage, L.right);
    // BOTTOM SHEET (owner 10-29, tall hosts only): the strip and the controls panel ride in a sheet dragged by its handle between detents
    L.handle = E('button', { type: 'button', class: 'dl-handle', 'data-dl-handle': '', 'aria-label': 'Controls drawer: drag to resize, press to open or close, arrow keys step through sizes' });
    L.sheet = E('div', { class: 'dl-sheet', 'data-dl-sheet': '' }, L.handle);
    bar.append(L.top, L.strip, L.body, L.sheet, L.staging);
    sheetDrag(ui, L);
    // the detents are px from the host's size: a host that changes height (the game dock, the large view, a rotated phone) re-places the sheet
    if (typeof ResizeObserver === 'function') { let k = ''; new ResizeObserver(() => { const n = bar.clientWidth + 'x' + bar.clientHeight; if (n !== k && L.tall && !L.dragging && ui.driveLayout) { k = n; sheetLayout(ui); } }).observe(bar); }
    L.state = { tab: load(KEY.tab, 'lighting'), sub: load(KEY.sub, 'oncoming'), rtab: load(KEY.rtab, 'details') };
    ui.driveLayout = L; return L;
  }
  function group(L, tab, sub, title) {
    const k = tab + '/' + (sub || '') + '/' + title; if (L.groups.has(k)) return L.groups.get(k);
    const g = E('section', { class: 'dl-grp', 'data-dl-group': k }); if (title) g.append(E('h4', {}, title));
    const row = E('div', { class: 'dl-row' }); g.append(row); g.row = row;
    (sub ? L.subs[sub] : L.panes[tab]).append(g); L.groups.set(k, g); return g;
  }
  const put = (target, e) => { if (e && e.parentElement !== target) target.append(e); };
  // ordered placement: each control right after the one before it; a control already in place is not touched (a move would drop focus)
  const seq = (target) => { let prev = null; return (e) => { if (!e) return; if (e.parentElement !== target || e.previousElementSibling !== prev) { if (prev) prev.after(e); else target.prepend(e); } prev = e; }; };
  // place: every control to its spot, then whatever is left in the creators' containers to Performance > other
  function place(ui) {
    const L = ui.driveLayout; if (!L) return;
    const root = L.root, find = (s) => root.querySelector(s) || (s === an('scene-details-panel') || s === an('perf-readout') || s === an('fps-readout') ? document.querySelector(s) : null);
    { const add = seq(L.top); for (const s of TOP) add(find(s)); }
    { const add = seq(L.strip); let sep = 0;
      for (const s of STRIP) {
        if (s === '|') { const id = 'sep' + sep++; add(L.strip.querySelector('[data-dl-sep="' + id + '"]') || E('span', { class: 'dl-sep', 'data-dl-sep': id })); continue; }
        const e = find(s); if (e) add(unit(e));
      } }
    const adders = new Map();
    for (const [tab, sub, title, sels] of LAYOUT) {
      const g = title ? group(L, tab, sub, title) : null, target = g ? g.row : L.panes[tab];
      if (!adders.has(target)) adders.set(target, seq(target));
      const add = adders.get(target), sp = target === L.panes.lighting ? L.subRow : null;
      for (const s of sels) { const e = find(s); if (e) add(unit(e)); }
      if (sp && L.panes.lighting.firstElementChild !== sp) L.panes.lighting.prepend(sp);
    }
    if (L.panes.performance.lastElementChild !== L.other) L.panes.performance.append(L.other);
    const fps = find(an('fps-readout')); if (fps) put(L.stage, fps);
    for (const c of containers(L)) for (const e of [...c.children]) if (!e.matches('.drive-primary, .drive-anim-tools, .dl-top, .dl-strip, .dl-body, .dl-sheet, .dl-staging, [data-dl-ignore]')) put(L.other.row, e);
    L.other.hidden = !L.other.row.children.length;
    layout(ui);
    if (!L.woke) { L.woke = true; setTimeout(() => wake(ui), 0); }   // a stored Details/Timings tab opens with its readout on (after this draw, not inside it)
  }
  // the containers the creators append into: the staging div, the spec-ui primary row, the drive-anim bar
  const containers = (L) => [L.staging, ...L.root.querySelectorAll('.drive-primary, .drive-anim-tools'), L.root].filter(Boolean);
  // controls no LAYOUT row names (the regression check wants none)
  function unplaced(ui) { const L = ui.driveLayout; return L ? [...L.other.row.children].map((e) => e.getAttribute('data-dv') || e.getAttribute('data-anim') || e.className || e.tagName) : []; }
  // the host's shape picks wide or tall; the panes move between left and right accordingly
  function layout(ui) {
    const L = ui.driveLayout; if (!L) return;
    const host = L.root.parentElement, w = host ? host.clientWidth : 0, h = host ? host.clientHeight : 0;
    if (w && h) { L.tall = isTall(w, h); L.mode = modeOf(ui.dvOpts && ui.dvOpts.panelMode, w, h, L.tall); L.w = w; }
    L.root.classList.toggle('dl-tall', !!L.tall); L.root.classList.toggle('dl-wide', !L.tall);
    const mode = L.mode || 'push'; L.root.classList.toggle('dl-overlay', mode === 'overlay'); L.root.classList.toggle('dl-push', mode === 'push');
    for (const side of ['left', 'right']) { const v = load(openKey(side, mode), null); (side === 'left' ? L.left : L.right).setAttribute('data-open', String(v === null ? openDefault(side, mode, L.w || 0) : v === 'true')); }
    L.shape = shapeOf(ui.dvOpts && ui.dvOpts.canvasShape, !!L.tall, L.left.getAttribute('data-open') === 'true');
    if (L.tall) { put(L.sheet, L.strip); put(L.sheet, L.left); sheetLayout(ui); }
    else { if (L.strip.parentElement !== L.root || L.strip.previousElementSibling !== L.top) L.top.after(L.strip); if (L.left.parentElement !== L.body) L.body.prepend(L.left); L.root.classList.remove('dl-sheet-push', 'dl-sheet-overlay'); }
    L.root.setAttribute('data-shape', L.shape);
    // ANIMATE UI (owner 10-29, option animateUI, default off; reduced motion wins): a CSS class turns the transitions on. When the layout
    // changes under it, hold the canvas re-render for the transition (drive-anim previews the old frame), then re-render once.
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, anim = !!(ui.dvOpts && ui.dvOpts.animateUI) && !reduce;
    L.root.classList.toggle('dl-animate', anim);
    const sig = [L.tall, mode, L.left.getAttribute('data-open'), L.right.getAttribute('data-open'), L.sheetAt, L.shape].join('|');
    if (anim && L.sig && sig !== L.sig && !L.dragging) { L.hold = true; clearTimeout(L.holdT); L.holdT = setTimeout(() => { L.hold = false; if (ui.redrawSpec) ui.redrawSpec(); }, ANIM_MS + 40); }
    L.sig = sig;
    for (const id of RIGHT) put(L.tall ? L.content : L.rcontent, L.panes[id]);
    for (const id of TABS.map((t) => t[0])) if (!RIGHT.includes(id)) put(L.content, L.panes[id]);
    show(ui);
  }
  function show(ui) {
    const L = ui.driveLayout, s = L.state;
    if (!L.tall && RIGHT.includes(s.tab)) s.tab = 'lighting';
    for (const b of L.tabs.children) { const id = b.getAttribute('data-dl-tab'); b.hidden = !L.tall && RIGHT.includes(id); b.setAttribute('aria-selected', String(id === s.tab)); }
    for (const b of L.rtabs.children) b.setAttribute('aria-selected', String(b.getAttribute('data-dl-rtab') === s.rtab));
    for (const b of L.subRow.children) b.setAttribute('aria-selected', String(b.getAttribute('data-dl-sub') === s.sub));
    for (const [id, p] of Object.entries(L.panes)) p.hidden = L.tall || !RIGHT.includes(id) ? id !== s.tab : id !== s.rtab;
    for (const [id, p] of Object.entries(L.subs)) p.hidden = id !== s.sub;
  }
  function select(ui, patch) {
    const L = ui.driveLayout; Object.assign(L.state, patch);
    for (const k of Object.keys(patch)) save(KEY[k], patch[k]);
    show(ui);
  }
  // Details and Timings switch their readout on when their tab is opened (owner 10-29: on a phone they opened empty). Only ever on: the
  // switch inside the tab still turns it off. Timings runs the sampled profiler while on. Only a click (tab or grab bar) and the first
  // placement wake; reveal() and select() from code do not, so a caller that opens a tab to press the switch gets what it pressed.
  const WAKE = { details: 'sceneDetails', timings: 'debugTimings' };
  function wake(ui) {
    const L = ui.driveLayout, o = ui.dvOpts, set = RF.SpecUI && RF.SpecUI.setDV; if (!L || !o || !set) return;
    for (const [id, key] of Object.entries(WAKE)) {
      const p = L.panes[id], panel = p && p.closest('.dl-panel');
      if (p && !p.hidden && panel && panel.getAttribute('data-open') === 'true' && !o[key]) set(ui, key, true);
    }
  }
  // reveal: the tab (and sub-tab) holding a control, so it can be seen and clicked (tests, and any caller that points at a control)
  function reveal(ui, selector) {
    const L = ui.driveLayout; if (!L) return false;
    const e = L.root.querySelector(selector) || document.querySelector(selector); if (!e) return false;
    const pane = e.closest('[data-dl-pane]'), sub = e.closest('[data-dl-subpane]');
    if (pane) { const id = pane.getAttribute('data-dl-pane'); select(ui, RIGHT.includes(id) && !L.tall ? { rtab: id } : { tab: id }); if (RIGHT.includes(id)) setOpen(ui, 'right', true); else setOpen(ui, 'left', true); }
    if (sub) select(ui, { sub: sub.getAttribute('data-dl-subpane') });
    for (let d = e.parentElement; d && d !== L.root; d = d.parentElement) if (d.tagName === 'DETAILS' && !d.open) d.open = true;
    return true;
  }
  function setOpen(ui, side, open) {
    const L = ui.driveLayout, p = side === 'left' ? L.left : L.right;
    if (L.tall && side === 'left') { if ((L.sheetAt !== 'closed') !== open) { if (open) { const n = detents(ui).map((x) => x[0]); setSheet(ui, n.includes(L.lastOpen) ? L.lastOpen : n[0]); } else { L.lastOpen = L.sheetAt; setSheet(ui, 'closed'); } } return; }   // tall: the sheet is the left panel
    if ((p.getAttribute('data-open') === 'true') === open) return;
    p.setAttribute('data-open', String(open)); save(openKey(side, L.mode || 'push'), open); layout(ui);   // the shape can follow the panel (3:4 stacked)
    if (ui.redrawSpec) ui.redrawSpec();      // the stage changed size: the canvas refits
  }
  const toggle = (ui, side) => setOpen(ui, side, (side === 'left' ? ui.driveLayout.left : ui.driveLayout.right).getAttribute('data-open') !== 'true');
  // ---- bottom sheet (tall hosts). Detents are named by the canvas shape whose bottom edge the sheet top meets: wide (the biggest sheet),
  // square, 3:4, and closed (handle + the strip's first row). Push: the stage ends at the sheet top and the detent IS the canvas shape (closed = 3:4).
  // Overlay: the canvas keeps its shape at full size and the sheet floats over it, slightly transparent. The detent is remembered per mode.
  const ANIM_MS = 200;   // matches the transitions in css/app.css (.dl-animate)
  const SHEET_MIN = 80, sheetKey = (m) => 'flux/driveSheet:' + m, DETENTS = ['wide', 'square', '3:4', 'closed'];
  const sheetModeOf = (pref) => (pref === 'overlay' ? 'overlay' : 'push');   // auto stacks as push (the old stacked layout)
  // detents for a tall host: [[name, sheet top y]] by y, top first. A shape whose canvas would leave the sheet under SHEET_MIN px is skipped.
  function detentsFor(H, W, topH, closedY) {
    const y = { wide: topH + W * 9 / 16, square: topH + W, '3:4': topH + W * 4 / 3, closed: closedY };
    return DETENTS.filter((n) => n === 'closed' || y[n] <= closedY - SHEET_MIN).map((n) => [n, Math.round(y[n])]);
  }
  function detents(ui) {
    const L = ui.driveLayout, H = L.root.clientHeight, W = L.root.clientWidth, topH = L.top.offsetHeight;
    // closed shows the handle and the strip's first row (the speed slider on a phone); the rest of the strip is under the screen edge
    const sp = L.strip.querySelector('.drive-speed'), first = sp && sp.offsetParent ? sp.getBoundingClientRect().bottom - L.strip.getBoundingClientRect().top + 3 : L.strip.offsetHeight;   // + 3 < the strip's 4 px row gap: the second row stays fully under the edge
    return detentsFor(H, W, topH, H - L.handle.offsetHeight - Math.round(first));
  }
  function sheetLayout(ui) {
    const L = ui.driveLayout, o = ui.dvOpts || {}, m = sheetModeOf(o.panelMode), d = detents(ui), names = d.map((x) => x[0]);
    L.sheetMode = m; L.root.classList.toggle('dl-sheet-push', m === 'push'); L.root.classList.toggle('dl-sheet-overlay', m === 'overlay');
    let at = load(sheetKey(m), m === 'overlay' ? 'closed' : SHAPES[o.canvasShape] ? o.canvasShape : 'wide');
    if (m === 'push' && at !== 'closed' && SHAPES[o.canvasShape]) at = o.canvasShape;   // the shape setting and the sheet agree
    if (!names.includes(at)) at = names.includes('wide') && at !== 'closed' ? names[0] : 'closed';
    L.sheetAt = at; L.left.setAttribute('data-open', String(at !== 'closed'));
    L.shape = m === 'push' ? (at === 'closed' ? '3:4' : at) : shapeOf(o.canvasShape, false, false);
    if (!L.dragging) setSheetY(L, d.find((x) => x[0] === at)[1]);
    L.root.style.setProperty('--dl-top-h', L.top.offsetHeight + 'px');
  }
  const setSheetY = (L, y) => { L.sheetY = y; L.root.style.setProperty('--dl-sheet-y', y + 'px'); };
  // a detent chosen (drag release, tap, keys, or code): push sets the canvas shape for real (saved), overlay only moves the sheet
  function setSheet(ui, name) {
    const L = ui.driveLayout, o = ui.dvOpts || {}, m = sheetModeOf(o.panelMode);
    save(sheetKey(m), name);
    if (m === 'push' && name !== 'closed' && o.canvasShape !== name && RF.SpecUI) { RF.SpecUI.setDV(ui, 'canvasShape', name); layout(ui); }
    else { layout(ui); if (ui.redrawSpec) ui.redrawSpec(); }
    if (name !== 'closed') wake(ui);
  }
  // pointer drag on the handle: the sheet follows the finger; release snaps to the nearest detent, or one further for a flick.
  // A press that moves under 6 px is a tap: open (to the last open detent, else the biggest) or close.
  function sheetDrag(ui, L) {
    let g = null;
    L.handle.addEventListener('pointerdown', (e) => {
      if (!L.tall) return; e.preventDefault(); try { L.handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer: drag without capture */ }
      g = { id: e.pointerId, y0: L.sheetY, py: e.clientY, moved: false, d: detents(ui), hist: [[performance.now(), e.clientY]] };
    });
    L.handle.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return; const dy = e.clientY - g.py;
      if (!g.moved && Math.abs(dy) < 6) return;
      if (!g.moved) { g.moved = true; L.dragging = true; L.root.classList.add('dl-dragging'); }
      const lo = g.d[0][1], hi = g.d[g.d.length - 1][1]; setSheetY(L, Math.max(lo, Math.min(hi, g.y0 + dy)));
      g.hist.push([performance.now(), e.clientY]); if (g.hist.length > 6) g.hist.shift();
      if (L.onDrag) L.onDrag(ui);
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return; const was = g; g = null;
      if (!was.moved) { tapSheet(ui); return; }
      L.dragging = false; L.root.classList.remove('dl-dragging');
      // velocity over the last 100 ms (px/ms). Slow: the nearest detent. A flick (> 0.6 px/ms): the next detent past the sheet in its direction.
      const now = performance.now(), h = was.hist.filter((x) => now - x[0] <= 100), [t0, y0] = h.length > 1 ? h[0] : was.hist[0], dt = now - t0, v = dt > 0 ? (e.clientY - y0) / dt : 0, y = L.sheetY;
      let best = was.d[0]; for (const x of was.d) if (Math.abs(x[1] - y) < Math.abs(best[1] - y)) best = x;
      if (Math.abs(v) > 0.6) { const next = v > 0 ? was.d.find((x) => x[1] > y + 1) : [...was.d].reverse().find((x) => x[1] < y - 1); if (next) best = next; }
      setSheet(ui, best[0]);
    };
    L.handle.addEventListener('pointerup', end); L.handle.addEventListener('pointercancel', end);
    L.handle.addEventListener('click', (e) => { if (e.detail === 0) tapSheet(ui); });   // keyboard Enter/Space (pointer taps are handled on pointerup)
    L.handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault();
      const d = detents(ui), i = d.findIndex((x) => x[0] === L.sheetAt), j = Math.max(0, Math.min(d.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      if (j !== i) setSheet(ui, d[j][0]);
    });
  }
  function tapSheet(ui) {
    const L = ui.driveLayout;
    if (L.sheetAt !== 'closed') { L.lastOpen = L.sheetAt; setSheet(ui, 'closed'); return; }
    const names = detents(ui).map((x) => x[0]); setSheet(ui, names.includes(L.lastOpen) ? L.lastOpen : names[0]);
  }
  // the stage's box in css px relative to an element (the CPU still is painted into it); null when the shell is not laid out
  function stageBox(ui, el) {
    const L = ui.driveLayout; if (!L || !el || !L.root.isConnected || L.root.parentElement !== el.parentElement) return null;
    const s = L.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return s.width > 0 && s.height > 0 ? { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height } : null;
  }
  RF.DriveLayout = { ANIM_MS, LAYOUT, TOP, STRIP, TABS, SUBS, isTall, modeOf, openDefault, PUSH_MIN, RIGHT_MIN, SHAPES, shapeOf, aspectOf, build, place, layout, select, reveal, setOpen, unplaced, stageBox, DETENTS, SHEET_MIN, detentsFor, detents, setSheet, sheetModeOf };
})(typeof window !== 'undefined' ? window : globalThis);
