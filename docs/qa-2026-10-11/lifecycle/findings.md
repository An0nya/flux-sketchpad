# lifecycle — QA findings (port 8803)
HEAD: 2dc83f6 (verified). Harness: h.js (shared boot/state helper). Note: the BRIEF's `npm root -g` playwright path
does not exist on this Mac (/opt/homebrew/lib/node_modules has no playwright); used /Users/anya/Projects/agent-qa/node_modules/playwright.

### Requesting a solve while the solver worker is being rebuilt hangs every worker solve until page reload
- Severity: crash/blocker
- Repro: p2_reload_race.js race — start fill-fix, after 1.2 s ui.stopSolve(); immediately start fill-fix, 120 ms later start patch-array (i.e. any two solve requests in the ~1 s after a Stop / timeout / replace).
- Observed: patch-array (normally ~0.2 s) still "Solving" after 25 s and 60 s; Stop button shown, body.solving set, RF.SolverHost.busy() null. Pressing Stop then starting haiku55-spots: also stuck "Solving" after 15 s. Every worker solver is dead until reload. The time budget does not rescue it: with RF.SolverHost.testBudget(3000) (p2b_reload_race_budget.js) still solving at 25 s, no timeout notice. Control (p2_reload_race.js control: one solve after Stop) finishes in ~1.0 s.
- Expected: the newer solve runs (or at worst times out).
- Reproduced: 3 of 5 runs (2/3 plain, 1/2 with budget); timing-dependent.
- Suspected cause (code reading, consistent with repro): js/solver-host.js abort() → `ready = reload()`. reload() sends 'load' messages via ask(), which sets the module-level `cancel`/`pending`. A second abort() during the rebuild (ui.js stopWorkerSolve → SolverHost.abort('replaced')) sees `cancel` set (it belongs to reload's load, not a solve), terminates the worker, rejects that load, and starts a SECOND reload() concurrently. Both reloads now share the single `pending` slot: one reload's load reply resolves the other's promise, the other's ask never gets a reply, so the new `ready` never resolves, and proxy.solve's `ready.then(...)` (where the budget timer would be armed) never runs. Also abort() returns true for a load, so the UI thinks it stopped a solve.
- Natural trigger (p19_nudge.js): Auto-solve on settings ON, change the facet budget 5 times at 700 ms intervals (each change re-solves and replaces the last). 1 of 3 runs hung: status "Solving · Fill & fix · 31 s" still counting 30 s after the last nudge, SolverHost.busy() null. The other 2 settled in ~8 s.

### A solve's result is applied as "up to date" after you changed a setting mid-solve (store.version never increments)
- Severity: wrong result
- Repro: p4_stale_apply.js budget — start fill-fix, at 1.5 s call RF.UI.setControl('A.budget', 20) (the sidebar's own path; Auto-solve on settings is off by default), wait for the solve to end.
- Observed: the result solved with budget 100 is applied: 93 facets placed, store.dirty has no 'A', Rebuild button not marked stale (title "Re-solve the reflector…"), status up to date. The only hint is a warning "The solver placed 93 facets — over your budget of 20", which blames the solver for a budget it was never given. Same with the paint edited mid-solve (p4_stale_apply.js paint: paint wiped to one cell, old-paint design applied, not stale).
- Expected: the result is dropped (regenerateAAsync returns null) or at least the design stays marked out of date.
- Evidence: RF.UI.store.version === 0 before and after the change.
- Reproduced: 3 of 3 (2 budget, 1 paint).
- Suspected cause (confirmed by grep): store.notify() (js/controller.js:23), the only thing that increments store.version, is never called anywhere in js/. So the `store.version === v` guard in regenerateAAsync (controller.js:49) and the version check in ui.useCandidate (ui.js:465) are always true. Also applySolve does store.dirty.delete('A'), erasing the dirty flag the mid-solve edit set.

### Switching to a built-in solver mid-solve does not stop the running worker solve (UI says "Solving" another solver, preview overlays the new design)
- Severity: broken UI
- Repro: p5_battery.js builtin — start fill-fix, at 1.5 s pick "spoke" in the Solver dropdown (#solver-box select, dispatch change).
- Observed (+0.4 s): the Spoke design is already applied (reports.A.solver = spoke, dirty A cleared) but ui.solving is still Fill & fix, Stop button shown, body.solving, status "Solving · Fill & fix · shell 2/5 … 12%", RF.SolverHost.busy() = fill-fix (worker still burning a core), and the Watch badge "PREVIEW · shell 1/5" still draws fill-fix's candidate in place of the spoke reflector. Clears only when fill-fix finishes on its own (~6 s; for a 120 s solver, up to 120 s). Picking a worker solver instead (p5_battery.js worker) correctly stops it with "replaced by a newer request".
- Expected: the built-in solve replaces the worker solve, as ui.generateA does (ui.js:55 stopWorkerSolve).
- Reproduced: 2 of 2.
- Suspected cause: ui.js tick() (~line 499-525): the solveArmed branch for a non-worker solver calls C.regenerateA(store) directly without stopWorkerSolve(); only ui.generateA (Rebuild button) has that call. The dropdown path goes through pendingA → tick.

### A superseded worker solve leaves ui.pendingA set, so the next settings change auto-solves even with "Auto-solve on settings" off
- Severity: broken UI
- Repro: p6_pending_leak.js — (continuation of the previous finding) start fill-fix, switch to spoke mid-solve, wait for fill-fix to end; then RF.UI.setControl('A.budget', 30). Control: p6_pending_leak.js control (spoke solved normally, same setting change).
- Observed: after the solve ends ui.pendingA stays at a timestamp (22684, 19556) with dirty A false. The setting change then re-solves immediately (reports.A replaced, status "up to date"). Control: dirty A stays, status "out of date — press Rebuild", Rebuild marked stale, no re-solve.
- Expected: with autoSet off a setting change marks the design stale and waits for Rebuild.
- Reproduced: 2 of 2 (control 1 of 1 behaves as expected).
- Suspected cause: ui.js tick() success handler `if (!rep) { ui.pendingA = performance.now(); schedule(); return; }` sets pendingA, but tick only consumes it when dirty has 'A' (already cleared by the sync solve), so it is never reset; stale() also requires !ui.pendingA, which hides the stale marker.

### Mode B direction picker throws `ReferenceError: clearZero is not defined`; the exception kills the render loop, so a trace stalls mid-way
- Severity: crash/blocker (Mode B)
- Repro: p7_modeB.js (switch to Stamp mode, no solve): 2 pageerrors "ReferenceError: clearZero is not defined". p8_modeB_stall.js (switch to Stamp mid fill-fix solve): 11-14 pageerrors; after the solve ends the trace freezes at "tracing 74%" (371712/500000 rays) and stays there 20 s; a mouse-wheel event restarts the loop and it finishes.
- Observed vs expected: picker should draw; the progressive trace should run to completion without user input.
- Evidence: modeB-stall.png; ui.run.ctx.next unchanged over 18 s.
- Reproduced: p7 1/1, p8 2/2.
- Cause (confirmed by reading): js/render2d.js:128 inside pickerImage() — `img.data[o + 3] = clearZero && !(v > 0) ? 0 : 255;` — `clearZero` and `v` are not in scope there (copied from gridCanvas line 65). The throw propagates out of ui.js tick() (drawLeft is called before the final `schedule()`), so no next frame is scheduled. Not lifecycle code proper, but it's committed in HEAD 2dc83f6 and it's what makes a mode switch mid-solve stall.

### Loading a preset (or any ui.loadScene) mid-solve keeps the old scene's solve running and overlays its preview on the new scene
- Severity: broken UI
- Repro: p9_preset_mid.js parabola — start fill-fix in the default Paint scene, at 1.5 s pick Presets → "Parabolic reflector (Mode C)" → confirm.
- Observed (+0.8 s): new scene is mode C (RF.UI.store is a new object) but ui.solving = Fill & fix, Stop shown, topbar "SOLVING · FILL & FIX · shell 3/5 …", and the PREVIEW badges + fill-fix's pink candidate facets are drawn into the parabola scene (Scene and Optics), the Result map shows the old painting's traced candidate, and the footer stats show the candidate's numbers (11.6 % delivered, "PREVIEW shell 2/5 · 200k rays"). When fill-fix ends its result is applied to the discarded old store (window.__old.reports.A.solver.id = fill-fix), new scene untouched, so ~6 s (up to 120 s for slow solvers) of worker CPU go nowhere. Same mechanism with the Stamps preset (p5_battery.js presetStamps). The Headlamp preset (paint mode) is fine because the preset handler calls generateA, which replaces the solve.
- Expected: loading a scene stops the running solve (kind 'replaced') and drops its watch.
- Evidence: preset-mid-parabola.png
- Reproduced: 2 of 2 (parabola, stamps).
- Suspected cause: ui.js loadScene (line 122) swaps ui.store without stopWorkerSolve()/dropWatch(); the in-flight regenerateAAsync closed over the old store. Applies to Reset, Open from disk, Restore snapshot too (all go through loadScene) — not individually tested.

### After Stop (or timeout / crash) the kept old design is reported "up to date" although the painting changed
- Severity: broken UI (notice contradicts state)
- Repro: p10_stop_dirty.js — solve fill-fix to completion, then edit the painting through RF.UI.afterChange() (auto-solve on painting starts a solve), after 1 s click #btn-stop.
- Observed: within 100 ms the status reads "up to date" (the "stopped — previous design kept" text set by ui.stopSolve never survives a frame), store.dirty has no 'A', Rebuild is not marked stale — while the persistent notice says "your previous design is kept" and the shown design was solved for the old painting.
- Expected: design stays marked out of date ("out of date — press Rebuild", stale Rebuild button) after a stop/timeout/crash.
- Reproduced: 2 of 2 (also seen in p5_battery.js stopTwice). Variant (p21_spec_trace.js, 1/1): load the Spec preset spec-box (it clears group A and auto-solves), Stop at 1.5 s → notice says the previous design is kept and status "up to date", but there is no previous design (group A empty).
- Suspected cause: ui.js ui.stopSolve (line 325) and the tick() reject handler for aborted solves (line ~515) both do `store.dirty.delete('A')`; then tick's status logic sees !stale() and writes "up to date". Likely the root of the BRIEF's known "timeout silently keeps the previous design" — the notice exists now, but the status line and Rebuild marker still claim the design is current.
- Additional evidence (p11_timeout.js): after a forced timeout (testBudget 2500) the "Use last candidate" button stays offered after RF.UI.setControl('A.budget', 10); clicking it applies the 95-facet candidate solved for budget 100. ui.useCandidate's "scene changed since that solve" refusal (ui.js:465) never fires for the same reason (store.version stuck at 0). 1 of 1.

### Refine button stays enabled during a solve and silently does nothing when clicked
- Severity: broken UI (minor)
- Repro: p13_refine.js — wait for the boot trace to finish, start fill-fix, click #btn-refine.
- Observed: btn-refine.disabled === false ("Refine → 1M rays") while RF.UI.canRefine() === false; clicking leaves ctx.N at 500000, no status/notice. Becomes correct only when a new run starts.
- Expected: disabled while a solve runs (canRefine already says so), or a message on click.
- Reproduced: 2 of 2.
- Suspected cause: ui.js tick() line ~561 refreshes the button only on `justDone || ui._refineN !== run.ctx.N`; starting/stopping a solve (showStop) does not refresh it.

### After a solver worker crash, every later worker solve fails with "solver X is not loaded in the worker" (until page reload); the crashed worker is leaked
- Severity: crash/blocker
- Repro: p15_errors.js / p15b_errors.js — RF.SolverHost.load() a test solver whose solve() does `setTimeout(() => { throw new Error('qa async boom') }, 50); return new Promise(() => {})` (an uncaught error in the worker → worker.onerror → kind 'crash'), then start patch-array (bundled, ~0.3 s).
- Observed: the crash itself is surfaced well ("QA async crash: the solver worker crashed after 0 s (… solver worker crashed: Uncaught Error: qa async boom); your previous design is kept."). But every following worker solve — patch-array ×5, qa-spin, qa-badout — fails immediately: "Patch array failed after 0 s: solver patch-array is not loaded in the worker". Playwright sees 3 workers afterwards (2 solve-workers + preview): the crashed one was never terminated.
- Expected: after a crash the worker is rebuilt with all solvers (as abort() does) and the next solve runs.
- Reproduced: 2 of 2.
- Suspected cause: js/solver-host.js spawn() onerror: `worker = null; if (cancel) cancel(why, 'crash');` — it drops the reference without worker.terminate() and without `ready = reload()`. The next ask() calls spawn() → a fresh solve-worker.js that only has the built-in solvers, so every bundled/loaded id is unknown. (Chrome keeps a worker alive after an uncaught error, so the old one leaks and keeps any timers running.)

### A solver error replaces the report of the kept design: report says 0 placed while the old design (100 surfaces) is still shown
- Severity: wrong result (report/notice contradict state)
- Repro: p15b_errors.js — solve patch-array (100 surfaces), then a loaded solver that throws ('qa-throw') or returns an uncloneable output ('qa-badout').
- Observed: notice "QA throw failed …; your previous design is kept", and groups.A.surfaces still has 100, but reports.A = { error: 'Solver QA throw: qa boom', placed: 0 } — the panels/Details describe a failed design with 0 placed while the 100-facet design is drawn and traced; status "up to date". Aborted solves (timeout/stop) don't do this (report kept, placed 100).
- Expected: keep the previous report alongside the kept design (the error belongs in the notice).
- Reproduced: 2 of 2 (qa-throw, qa-badout), plus the "not loaded" failures in the crash finding.
- Suspected cause: ui.js tick() reject handler (~line 517) `store.reports.A = { error: …, warnings: [], placed: 0 }` for non-aborted errors.
- Side note (works): qa-spin (infinite loop) with testBudget(2000) is stopped at 2.3 s with the timeout notice and the next solve works; qa-badout's DataCloneError is surfaced, not swallowed.

### Pressing Rebuild while the bundled solvers are still loading silently switches the scene's solver to the built-in Spoke
- Severity: wrong result
- Repro: p17_boot_rebuild.js (60 ms/file route delay) and p17b.js nodelay (no delay) — fresh context, page.goto, as soon as RF.UI.store exists click #btn-generate-top (RF.SolverHost.loading() is true; wanted = 'auto', current = 'spoke').
- Observed: Spoke solves synchronously; applySolve writes scene.solve = spoke; after loading finishes nothing re-solves with Auto; the Solver dropdown shows Spoke, report is Spoke, no notice. The user's (or saved scene's) solver choice is lost.
- Expected: Rebuild during loading waits for the chosen solver (as the boot path does via `waiting`), or says it is using the fallback.
- Reproduced: 3 of 3 (1 with delay, 2 without).
- Suspected cause: ui.generateA (ui.js:52) uses RF.Solvers.current(), which falls back to DEFAULT_ID 'spoke' while loading; only boot() and store.commit check `SolverHost.loading()`. applySolve (controller.js:63) then persists the fallback as scene.solve.

### Switching to Stamp/Profile mode mid-solve keeps the Paint solve's status, Stop button and (in Stamp) its PREVIEW overlay
- Severity: cosmetic
- Repro: p18_modeC_mid.js (Profile) and p5_battery.js modeB (Stamp) — start fill-fix, at 1.5 s click the mode tab.
- Observed: in Profile mode the topbar reads "SOLVING · FILL & FIX · shell 1/5 …", Stop shown, while the scene has group A disabled and the Optics pane says "No optical surfaces yet" (modeC-mid-solve.png). In Stamp mode the "PREVIEW · shell 1/5" badge is up and the paint candidate is drawn into the stamp scene. When the solve ends its result is applied to group A silently (fine, used when you return to Paint).
- Expected: either stop the paint solve on leaving Paint/Spec, or keep it running quietly without the PREVIEW overlay in a mode that doesn't show group A.
- Reproduced: 1 of 1 each (Profile, Stamp).
- Suspected cause: ui.setMode (ui.js:139) doesn't touch ui.solving/ui.watch; watchShown() doesn't check the mode.

### Turning Watch off mid-solve hides the badges but leaves the footer frozen on an old candidate's PREVIEW numbers
- Severity: cosmetic
- Repro: p20b.js — start sqm, after 2 s RF.UI.setWatch(false) (same as unticking "Watch solve").
- Observed: badges hidden, but the footer/Details keep "PREVIEW: the solver's candidate size 1 · compensate 1/2 · 200k rays, not the design · Fidelity 77.4 %" for the rest of the solve, frozen: ui.watch.n moves 2 → 4 while the numbers don't change (no new traces with Watch off). See watch-off-footer.png.
- Expected: with Watch off, the footer shows the current design's numbers (or keeps updating if "Live numbers" is meant to be independent of Watch).
- Reproduced: 2 of 2 (p20_watch_toggle.js, p20b.js).
- Suspected cause: ui.js previewStatsOn() (line 380) checks ui.previewStats but not ui.watchOn, while onPreview only calls tracePreview when ui.watchOn.

### Loading a solver file while a solve runs: the load fails and the running solve hangs forever (the time budget can't stop it)
- Severity: crash/blocker
- Repro: p22_load_during_solve.js — start fill-fix, at 1.5 s call RF.SolverHost.load(src) (what "Load solver file…" does) with a trivial valid solver.
- Observed: load rejects "d.defs is not iterable" (qa-ok never registered); fill-fix is still "Solving" at 35 s with the status frozen ("… 19% · 35 s"), SolverHost.busy() null. p22b_load_budget.js with testBudget(5000): the load rejects with "ran over its 5 s budget and was stopped" (the solve's timeout was delivered to the load), and fill-fix still hangs at 35 s.
- Expected: load waits for the running solve (or stops it), and the solve finishes or times out.
- Reproduced: 2 of 2.
- Suspected cause: js/solver-host.js — ask() keeps one module-level `pending`/`cancel`. load() only awaits `ready`, not a running solve, so its ask() overwrites the solve's `pending`: the solve's 'done' goes to the load (→ defs undefined), the solve's promise never settles. The solve's budget timer calls abort() → cancel(), which now belongs to the load, so it rejects the load instead of the solve. Same root as the rebuild-race finding: there is no serialisation of requests to the worker.

## Checked and fine (negative results)
- Worker accounting (p12b_workers.js, Worker wrapped in the page): 4 replace+stop cycles → made 10, terminated 8, live = 1 solve-worker + 1 preview-worker. No leak on the abort path (Playwright's own worker list lags on close events and briefly showed 3).
- Replace by a newer worker solve, Undo mid-solve, headlamp preset mid-solve, Forget loaded mid-solve (p16_forget.js), reload mid-solve (p14_reload.js: re-solves on boot), Stop twice, a solve during a Refine (p23_trace_mix.js): all leave consistent state, no console errors.
- Timeout path (p11_timeout.js): limitMs() = 120000 by default; testBudget(2500) stops the solve at ~2.9 s with "ran past its 3 s budget … previous design is kept" + Use last candidate; the next solve runs normally. An infinite-loop solver is stopped by the budget too (p15b).

## Already known (BRIEF list)
- "A solve that hits the 120 s limit silently keeps the previous design": no longer silent (persistent notice + Use last candidate), but the status line and Rebuild marker still say "up to date" (see the Stop/timeout finding above).
- Other known items (blank canvas after collapse, SPEC-MODE.md duplicates, sidebar jumps, label overlap, Safari memory): outside this scope, not checked.

## Suspected (not reproduced)
- abort() during the boot restore() (a solve replaced while bundled solvers are still loading) should hit the same shared-`pending` problem as the rebuild race; not attempted.
- ui.stopSolve racing a just-finished solve (result message in flight) would discard a completed result and say "You stopped …"; reasoned from code only.
