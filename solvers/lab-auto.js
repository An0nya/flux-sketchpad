/* Auto — picks a solver for your painting (Flux solver lab, phase 2, 2026-09-30).
 *
 * Nobody should have to know which solver suits which painting.  Auto reads the paint map, decides what kind of painting it is
 * (RF.Modes.classify: text / cutoff / photo / hotspot / even wash / general), and hands it to the solver that did best on that kind
 * in the lab's trials (SWEEP-2026-09-30.md, AUTOTUNE-MODES.md).  Whatever it decides goes in `notes`.
 *
 *   effort quick  : classify (~25 ms), then ONE solve with the picked solver.
 *   effort search : a goal tuner (below) tries a short menu of solver × settings, ranks them on a cheap look, and gives only the
 *                   finalists a full 1M-ray trace.  Goal: Auto-detect, Cutoff, Hotspot, Text / line art, Photo, Even wash, Fewest facets.
 *
 * The other solvers are called through RF.Solvers.get(id).solve(...) inside this same worker; `tools` (progress, budget, trace)
 * is passed through.  Nothing here is new physics: the judging code is js/modes.js (shared with the bench and the tools).
 *
 * How a search ranks (all relative to the candidates in THIS search, never to an absolute target):
 *   cheap pass : every candidate is solved (Fill & fix at quality fast) and traced at 250k rays, scored by RF.Modes.rank(goal)
 *   finalists  : the best cheap result, the quick pick, Fill & fix defaults and the runner-up (as many as the time allows) are re-solved at
 *                full quality and traced at 1M rays; the winner is chosen among these
 *   guardrails : each goal's gates (glare, fill, legibility, light floors …) veto candidates; see RF.Modes.GATES
 * Cost control: a soft time limit (the 'Search time limit' setting, 55 s by default) shrinks the menu and the number of finalists.               */
(function () {
  'use strict';
  const M = RF.Modes;
  const now = () => Date.now();

  // ------------------------------------------------------------------ what to run for each kind (the quick picks)
  // Chosen from measured runs on the lab's scenes at fidelity v2 (AUTOTUNE-PHASE2.md).  photo: dish-fit won all four photos and takes ~2 s
  // (Fill & fix ~12 s).  cutoff: Fill & fix "most light" (equal or better on all four cutoff scenes; but see CUTOFF_MAX_KERNEL).  hotspot, text,
  // wash, general: Fill & fix's own defaults: "most light" looked better on the first scenes and then lost on scenes it hadn't been chosen on
  // (one with a big LED fell from 98 to 59 fidelity), and the round-facet advice from the earlier trial did not hold at v2.
  // The first picks were made after looking at those scenes; a hold-out set is reported separately.
  const PICKS = {
    photo: { solver: 'dish-fit', over: {}, name: 'dish-fit' },
    hotspot: { solver: 'fill-fix', over: { quality: 'normal' }, name: 'Fill & fix (defaults)' },
    cutoff: { solver: 'fill-fix', over: { priority: 'light', quality: 'normal' }, name: 'Fill & fix (most light)' },
    text: { solver: 'fill-fix', over: { quality: 'normal' }, name: 'Fill & fix (defaults)' },
    wash: { solver: 'fill-fix', over: { quality: 'normal' }, name: 'Fill & fix (defaults)' },
    general: { solver: 'fill-fix', over: { quality: 'normal' }, name: 'Fill & fix (defaults)' },
  };
  // ------------------------------------------------------------------ the menus a search tries (first = the quick pick)
  // Fill & fix: hand-tuned around what mattered per goal in the phase-1 corpus.  Other solvers: only a few of their visible settings.
  const ff = (label, over) => ({ label, solver: 'fill-fix', over });
  const oth = (label, solver, over) => ({ label, solver, over: over || {} });
  const MENUS = {
    cutoff: [ff('ff default', {}), ff('ff light', { priority: 'light' }), ff('ff bal gap4', { priority: 'balanced', gapWeight: 4 }), ff('ff sharp gap4', { priority: 'sharp', gapWeight: 4 }), ff('ff bal gap1', { priority: 'balanced', gapWeight: 1 }), ff('ff bal gap8', { priority: 'balanced', gapWeight: 8 }),
      ff('ff bal gap4 round', { priority: 'balanced', gapWeight: 4, shapes: 'round' }), ff('ff sharp gap8 shell4', { priority: 'sharp', gapWeight: 8, sharp: 4 }), oth('opus-mosaic', 'opus-mosaic'), oth('dish-fit', 'dish-fit')],
    hotspot: [ff('ff default', {}), ff('ff light', { priority: 'light' }), ff('ff light util1.2', { priority: 'light', util: 1.2 }), ff('ff bal util1.2', { priority: 'balanced', util: 1.2 }), ff('ff bal round', { priority: 'balanced', shapes: 'round' }),
      ff('ff light useAll', { priority: 'light', useAll: 'on' }), oth('dish-fit', 'dish-fit'), oth('opus-mosaic', 'opus-mosaic')],
    text: [ff('ff default', {}), ff('ff bal two gap2', { priority: 'balanced', gapWeight: 2 }), ff('ff bal round gap2', { priority: 'balanced', shapes: 'round', gapWeight: 2 }), ff('ff sharp round gap2', { priority: 'sharp', shapes: 'round', gapWeight: 2 }), ff('ff bal round gap4', { priority: 'balanced', shapes: 'round', gapWeight: 4 }),
      ff('ff bal round feat1', { priority: 'balanced', shapes: 'round', gapWeight: 2, feature: 1 }), ff('ff bal two gap4', { priority: 'balanced', gapWeight: 4 }), oth('opus-mosaic', 'opus-mosaic'), oth('dish-fit', 'dish-fit'), oth('bowl-image', 'bowl-image')],
    photo: [oth('dish-fit', 'dish-fit'), oth('dish-fit util1.15', 'dish-fit', { util: 1.15 }), oth('dish-fit flux-first', 'dish-fit', { order: 'flux-first' }), ff('ff default', {}), ff('ff light', { priority: 'light' }), ff('ff sharp', { priority: 'sharp' }), oth('opus-mosaic', 'opus-mosaic')],
    wash: [ff('ff default', {}), ff('ff bal round', { shapes: 'round' }), ff('ff light', { priority: 'light' }), ff('ff bal shell0', { sharp: 0 }), ff('ff bal shell2', { sharp: 2 }), oth('dish-fit', 'dish-fit')],
    general: [ff('ff default', {}), ff('ff light', { priority: 'light' }), ff('ff sharp', { priority: 'sharp' }), oth('dish-fit', 'dish-fit'), ff('ff bal round', { shapes: 'round' })],
  };
  const CUTOFF_MAX_KERNEL = 5;                 // a smeared LED image (cells) makes "most light" spill: fall back to the defaults
  const LADDER = [8, 12, 16, 24, 32, 48, 64, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000];

  // ------------------------------------------------------------------ helpers
  function make(input, S, tools, T) {
    const cp = () => RF.U.deepCopy(input);
    const ctx = M.context(input, 1e6), seed = input.seed | 0, notes = [], t0 = now();
    const softMs = Math.min(1000 * (S.limit || 55), 0.9 * ((tools.budget && tools.budget.ms) || 120000));
    let raysLeft = (tools.budget && tools.budget.rays) || 5e7;
    const prog = (f, stage) => { if (tools.progress) tools.progress(Math.max(0, Math.min(0.999, f)), stage); };
    // solve with a registered solver; falls back to Fill & fix if the picked solver isn't loaded
    async function solve(cand, over, budget, base, span) {
      let def = RF.Solvers.get(cand.solver), id = cand.solver, fell = false;
      if (!def) { def = RF.Solvers.get('fill-fix'); id = 'fill-fix'; over = {}; fell = true; }
      if (!def) throw new Error('Auto needs Fill & fix (or the picked solver) to be loaded');
      const st = RF.Solvers.sanitize(def, Object.assign(RF.Solvers.defaults(def), { minDistance: S.minDistance }, over || {}));
      const inp = cp(); if (budget) inp.limits.maxFacets = budget;
      const sub = { progress: (f, stage) => prog(base + span * f, stage), budget: tools.budget, trace: tools.trace, scene: tools.scene };
      const t = now(), out = await def.solve(inp, st, sub);
      return { out, id, ms: now() - t, fell };
    }
    // trace a design and score it for the goal
    function look(goal, out, rays, opt) {
      const n = Math.min(rays, raysLeft); raysLeft -= n;
      const t = now(), tr = tools.trace(out.surfaces, { rays: n, seed }), c = Object.assign({}, ctx, { rays: n });
      const run = M.runFromTrace(input, tr, c), ev = M.evaluate(goal, run, opt);
      return { ev, run, tr, ms: now() - t };
    }
    return { ctx, seed, notes, t0, softMs, cp, prog, solve, look, left: () => softMs - (now() - t0), rays: () => raysLeft };
  }
  const pc = (x) => (isFinite(x) ? Math.round(100 * x) : '—');
  const line = (c) => c.label + ': ' + (c.veto ? 'vetoed (' + c.veto + ')' : 'score ' + c.score.toFixed(2)) + ', fidelity ' + pc(c.ev.fid) + '%, ' + pc(c.ev.onPaint) + '% on paint';

  // ------------------------------------------------------------------ the search shared by every goal tuner
  async function tune(goal, menu, A, opt) {
    const tried = [], tStart = now();
    // 1. cheap pass: solve (Fill & fix at fast) and trace at 250k rays
    let lastFast = 0;
    for (let i = 0; i < menu.length; i++) {
      if (i >= 3 && A.left() < 0.55 * A.softMs) { A.notes.push('time: ' + (menu.length - i) + ' candidate(s) skipped'); break; }
      const c = menu[i], fast = c.solver === 'fill-fix' && !(c.over && c.over.quality);
      A.prog(0.05 + 0.5 * i / menu.length, 'trying ' + c.label);
      const r = await A.solve(c, fast ? Object.assign({}, c.over, { quality: 'fast' }) : c.over, 0, 0.05 + 0.5 * i / menu.length, 0.5 / menu.length);
      if (!r.out.surfaces || !r.out.surfaces.length) { tried.push({ label: c.label, cand: c, ev: { fid: 0, onPaint: 0, peak: 0, gates: { pass: false, why: ['no facets'] }, m: {} }, veto: 'no facets', score: 0 }); continue; }
      if (fast) lastFast = r.ms;
      const l = A.look(goal, r.out, 250000, opt);
      tried.push({ label: c.label, cand: c, fast, solved: r, ev: l.ev, ms: r.ms + l.ms });
    }
    const ranked = M.rank(goal, tried.filter((t) => t.solved).map((t) => t)).concat(tried.filter((t) => !t.solved));
    const tCheap = now() - tStart;
    // 2. finalists: the top two and the quick pick (the first candidate); how many depends on the time left
    // finalists, in priority order: the best cheap result, the quick pick, Fill & fix defaults, the runner-up; as many as the time allows (at least one)
    const good = ranked.filter((x) => x.solved), qp = PICKS[opt.kind] || PICKS.general, isQuick = (t) => t.cand.solver === qp.solver && Object.keys(qp.over).every((k) => k === 'quality' || t.cand.over[k] === qp.over[k]) && Object.keys(t.cand.over).every((k) => k === 'quality' || qp.over[k] === t.cand.over[k]);
    const want = []; for (const t of [good[0], tried.find((x) => x.solved && isQuick(x)), tried.find((x) => x.solved && x.label === 'ff default'), good[1]]) if (t && !want.includes(t)) want.push(t);
    const finalCost = (t) => (t.fast ? Math.max(1500, 5.5 * lastFast) : t.solved.ms) + 1500;
    const fin = []; let plan = 0;
    for (const t of want) { const c = finalCost(t); if (fin.length && plan + c > A.left()) continue; fin.push(t); plan += c; }
    const finals = [];
    for (let i = 0; i < fin.length; i++) {
      const t = fin[i]; A.prog(0.6 + 0.35 * i / fin.length, 'checking ' + t.label + ' at full quality');
      let r = t.solved;
      if (t.fast) r = await A.solve(t.cand, t.cand.over && t.cand.over.quality ? t.cand.over : Object.assign({}, t.cand.over, { quality: 'normal' }), 0, 0.6 + 0.35 * i / fin.length, 0.35 / fin.length);
      const l = A.look(goal, r.out, 1000000, opt);
      finals.push({ label: t.label, cand: t.cand, solved: r, ev: l.ev, run: l.run, ms: t.ms + (t.fast ? r.ms : 0) + l.ms });
    }
    const order = M.rank(goal, finals);
    return { tried, ranked, finals: order, all: tried, tCheap, tFinal: now() - tStart - tCheap };
  }

  // ------------------------------------------------------------------ Fewest facets: a ladder of budgets, quality slider 0…100
  // Q = the app's fidelity.  q = 100 asks for the best Q the ladder reached; q = 0 for HALF of it (Anya, 09-30: below that it stops being recognisable).  Answer: the fewest PLACED facets whose Q
  // meets the level AND whose next rung up also does (a dip can't fool it); the goal's own gates are then checked on a full trace.
  async function fewest(kind, A, input, S, opt) {
    const pick = PICKS[kind], cap = input.limits.maxFacets, rungs = LADDER.filter((b) => b < cap).concat(cap), rows = [];
    for (let i = 0; i < rungs.length; i++) {
      if (i >= 3 && A.left() < 0.4 * A.softMs) { A.notes.push('time: ladder stopped at ' + rungs[i - 1] + ' facets'); break; }
      A.prog(0.05 + 0.6 * i / rungs.length, 'budget ' + rungs[i]);
      const over = pick.solver === 'fill-fix' ? Object.assign({}, pick.over, { quality: 'fast' }) : pick.over;
      const r = await A.solve(pick, over, rungs[i], 0.05 + 0.6 * i / rungs.length, 0.6 / rungs.length);
      if (!r.out.surfaces || !r.out.surfaces.length) { rows.push({ b: rungs[i], placed: 0, q: 0 }); continue; }
      const l = A.look('general', r.out, 250000, opt);
      rows.push({ b: rungs[i], placed: r.out.surfaces.length, q: l.ev.fid || 0, onPaint: l.ev.onPaint });
    }
    const best = Math.max(...rows.map((r) => r.q)), level = best * (0.5 + 0.5 * S.quality / 100);
    let at = rows.findIndex((r, i) => r.q >= level && (i === rows.length - 1 || rows[i + 1].q >= level));
    if (at < 0) at = rows.length - 1;
    return { rows, best, level, at, pick, kind };
  }

  // ------------------------------------------------------------------ the solver
  RF.Solvers.register({
    id: 'auto', name: 'Auto (picks a solver for your painting)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'Auto-detect' }, { value: 'cutoff', label: 'Cutoff' }, { value: 'hotspot', label: 'Hotspot' }, { value: 'text', label: 'Text / line art' }, { value: 'photo', label: 'Photo' }, { value: 'wash', label: 'Even wash' }, { value: 'fewest', label: 'Fewest facets' }],
        help: 'Auto-detect reads the painting. The other goals steer the search (Effort: search) toward what that kind of painting needs.' },
      { key: 'effort', label: 'Effort', type: 'select', default: 'quick', options: [{ value: 'quick', label: 'quick (classify, one solve)' }, { value: 'search', label: 'search (tries several, ~1 min)' }],
        help: 'Quick: pick the best-known solver for this kind of painting and run it once. Search: try a short menu of solvers and settings and keep the best for the goal.' },
      { key: 'quality', label: 'Quality (Fewest facets only)', type: 'number', min: 0, max: 100, step: 5, default: 80, help: '100 = the best quality any budget reached, 0 = half of it. Auto finds the fewest facets that reach the level.' },
      { key: 'limit', adv: true, label: 'Search time limit (s)', type: 'number', min: 10, max: 110, step: 5, default: 55, help: 'Search effort stops trying new candidates after about this long (the app aborts a solve at 120 s).' },
      { key: 'tol', label: 'Edge tolerance, cells (Cutoff only)', type: 'number', min: 0, max: 8, step: 0.5, default: 1, help: 'How far the light-dark edge may be from the painted line before a design is rejected.' },
    ],
    async solve(input, S, tools) {
      tools = tools || {}; const A = make(input, S, tools), notes = A.notes, R = input.paint.res;
      if (!input.paint.cells.some((w) => w > 0)) return { surfaces: [], intent: [], notes: ['Auto: nothing is painted'] };
      const cls = M.classify(input.paint.cells, R, A.ctx.kernelCells), feat = cls.features;
      let goal = S.goal === 'auto' || S.goal === 'fewest' ? cls.kind : S.goal;
      const asked = S.goal !== 'auto' && S.goal !== 'fewest' && S.goal !== cls.kind;
      notes.push('Auto: ' + cls.why + (asked ? '; you asked for ' + S.goal + ', so it is judged as ' + S.goal : ''));
      const opt = { tol: S.tol, kind: goal };
      const recs = () => { try { return M.recommend(goal, feat, A.ctx, input); } catch (e) { return []; } };
      let out;

      if (S.goal === 'fewest') {
        const f = await fewest(goal, A, input, S, opt), row = f.rows[f.at], pick = f.pick;
        notes.push('Fewest facets (quality ' + S.quality + '): tried budgets ' + f.rows.map((r) => r.b + '→' + r.placed + ' placed, fidelity ' + pc(r.q)).join(' · '));
        notes.push('best fidelity on the ladder ' + pc(f.best) + '%, level ' + pc(f.level) + '% → ' + row.placed + ' facets (budget ' + row.b + '), confirmed by the next rung');
        const top = f.rows[f.rows.length - 1]; if (f.rows.length > 1 && top.q > 1.1 * f.rows[Math.max(0, f.rows.length - 3)].q) notes.push('more facets would still help: fidelity is still climbing at ' + top.placed + ' facets (' + pc(top.q) + '%)');
        const r = await A.solve(pick, pick.solver === 'fill-fix' ? Object.assign({}, pick.over) : pick.over, row.b, 0.7, 0.25);
        const l = A.look(goal, r.out, 1000000, opt);
        notes.push('final design (' + pick.name + ', full quality): ' + r.out.surfaces.length + ' facets, fidelity ' + pc(l.ev.fid) + '%, ' + pc(l.ev.onPaint) + '% on paint' + (l.ev.gates.pass ? '' : '; ' + goal + ' gates: ' + l.ev.gates.why.join(', ')));
        out = r.out; out.extras = Object.assign({}, out.extras, { auto: { kind: goal, ladder: f.rows, level: f.level, final: { fid: l.ev.fid, onPaint: l.ev.onPaint } } });
      } else if (S.effort === 'search') {
        const menu = (MENUS[goal] || MENUS.general).slice();
        const res = await tune(goal, menu, A, opt), win = res.finals[0];
        if (!win) throw new Error('Auto: no candidate produced facets');
        notes.push('search (' + goal + '): cheap pass on ' + res.tried.length + ' candidates (250k rays each) → ' + res.ranked.filter((c) => c.solved).slice(0, 4).map(line).join(' | '));
        notes.push('time: cheap pass ' + (res.tCheap / 1000).toFixed(1) + ' s, finalists ' + (res.tFinal / 1000).toFixed(1) + ' s');
        notes.push('finalists at full quality and 1M rays: ' + res.finals.map(line).join(' | '));
        notes.push('winner: ' + win.label + (win.solved.fell ? ' (fell back: the picked solver is not loaded)' : '') + '; ' + (win.veto ? 'every finalist failed a gate, this failed the least' : 'passed every gate') + '.');
        out = win.solved.out; out.extras = Object.assign({}, out.extras, { auto: { kind: goal, winner: win.label, solver: win.solved.id, finalists: res.finals.map((f) => ({ label: f.label, score: f.score, veto: f.veto, fid: f.ev.fid, onPaint: f.ev.onPaint })) } });
      } else if (S.goal === 'auto' && (goal === 'photo' || goal === 'hotspot') && feat.levels >= 6 && feat.peakStands >= 3) {
        // Photo or beam?  In linear light a photo's bright subject stands over a dim rest just like a hotspot over its fill, and
        // no feature separated them (an imported beamshot looks like a dark photo).  They want different solvers (dish-fit won
        // every photo, Fill & fix the beamshot 87 vs 53), so measure instead of guessing: both, quickly, at 250k rays.
        A.prog(0.03, 'photo or beam? trying dish-fit');
        const d = await A.solve(PICKS.photo, PICKS.photo.over, 0, 0.03, 0.2);
        A.prog(0.25, 'photo or beam? trying Fill & fix (fast)');
        const f = await A.solve(PICKS.hotspot, { quality: 'fast' }, 0, 0.25, 0.2);
        const cand = [{ label: 'dish-fit', solved: d }, { label: 'Fill & fix (fast)', solved: f }].filter((c) => c.solved.out.surfaces && c.solved.out.surfaces.length);
        for (const c of cand) c.ev = A.look('general', c.solved.out, 250000, opt).ev;
        const ranked = M.rank('general', cand), win = ranked[0];
        notes.push('photo or beam? not clear from the painting (' + feat.levels + ' levels, brightest ' + feat.peakStands.toFixed(1) + '× the typical level), so both were tried at 250k rays: ' + ranked.map((c) => c.label + ' ' + pc(c.ev.fid) + '% fidelity, ' + pc(c.ev.onPaint) + '% on paint').join(' vs '));
        if (win && win.label === 'dish-fit') { out = d.out; goal = 'photo'; notes.push('picked dish-fit (' + (d.ms / 1000).toFixed(1) + ' s)'); }
        else { A.prog(0.5, 'solving with Fill & fix (defaults)'); const r = await A.solve(PICKS.hotspot, PICKS.hotspot.over, 0, 0.5, 0.48); out = r.out; goal = 'hotspot'; notes.push('picked Fill & fix (defaults), re-solved at full quality (' + (r.ms / 1000).toFixed(1) + ' s)'); }
        out.extras = Object.assign({}, out.extras, { auto: { kind: goal, tiebreak: ranked.map((c) => ({ label: c.label, fid: c.ev.fid, onPaint: c.ev.onPaint })) } });
      } else {
        let pick = PICKS[goal] || PICKS.general;
        if (goal === 'cutoff' && A.ctx.kernelCells > CUTOFF_MAX_KERNEL) { pick = PICKS.general; notes.push('the LED image is ' + A.ctx.kernelCells.toFixed(1) + ' cells wide (over ' + CUTOFF_MAX_KERNEL + '): "most light" would spill, using the defaults'); }
        A.prog(0.05, 'solving with ' + pick.name);
        const r = await A.solve(pick, pick.over, 0, 0.05, 0.9);
        notes.push('picked ' + pick.name + (r.fell ? ' (not loaded here: fell back to Fill & fix)' : '') + '; effort quick: one solve, ' + (r.ms / 1000).toFixed(1) + ' s');
        out = r.out; out.extras = Object.assign({}, out.extras, { auto: { kind: goal, solver: r.id, ms: r.ms } });
      }
      for (const r of recs()) notes.push('Recommendation: ' + r);
      out.notes = notes.concat((out.notes || []).map((x) => '· ' + x));
      out.pred = undefined; out.debug = undefined;
      return out;
    },
  });
})();
