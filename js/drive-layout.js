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
    ['performance', null, 'View', [dv('fov'), an('canvas-shape'), an('panel-mode'), an('fps-counter'), an('fit-controls'), an('large-card')]],
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
    const grab = (side) => { const g = E('button', { type: 'button', class: 'dl-grab', 'data-dl-grab': side, 'aria-label': side === 'left' ? 'Show or hide the controls' : 'Show or hide details and timings' }); g.addEventListener('click', () => toggle(ui, side)); return g; };
    const tabRow = (list, cls, attr, pick) => { const row = E('div', { class: cls, role: 'tablist' }); for (const [id, label] of list) { const b = E('button', { type: 'button', role: 'tab', [attr]: id }, label); b.addEventListener('click', () => pick(id)); row.append(b); } return row; };
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
    bar.append(L.top, L.strip, L.body, L.staging);
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
    for (const c of containers(L)) for (const e of [...c.children]) if (!e.matches('.drive-primary, .drive-anim-tools, .dl-top, .dl-strip, .dl-body, .dl-staging, [data-dl-ignore]')) put(L.other.row, e);
    L.other.hidden = !L.other.row.children.length;
    layout(ui);
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
    L.shape = shapeOf(ui.dvOpts && ui.dvOpts.canvasShape, !!L.tall, L.left.getAttribute('data-open') === 'true'); L.root.setAttribute('data-shape', L.shape);
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
    if ((p.getAttribute('data-open') === 'true') === open) return;
    p.setAttribute('data-open', String(open)); save(openKey(side, L.mode || 'push'), open); layout(ui);   // the shape can follow the panel (3:4 stacked)
    if (ui.redrawSpec) ui.redrawSpec();      // the stage changed size: the canvas refits
  }
  const toggle = (ui, side) => setOpen(ui, side, (side === 'left' ? ui.driveLayout.left : ui.driveLayout.right).getAttribute('data-open') !== 'true');
  // the stage's box in css px relative to an element (the CPU still is painted into it); null when the shell is not laid out
  function stageBox(ui, el) {
    const L = ui.driveLayout; if (!L || !el || !L.root.isConnected || L.root.parentElement !== el.parentElement) return null;
    const s = L.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return s.width > 0 && s.height > 0 ? { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height } : null;
  }
  RF.DriveLayout = { LAYOUT, TOP, STRIP, TABS, SUBS, isTall, modeOf, openDefault, PUSH_MIN, RIGHT_MIN, SHAPES, shapeOf, aspectOf, build, place, layout, select, reveal, setOpen, unplaced, stageBox };
})(typeof window !== 'undefined' ? window : globalThis);
