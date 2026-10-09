# Active experiment state — 2026-10-09

User request: autonomously build spec headlamp v3; test six configs against SQM headlamp, v2, mosaic, dish; Liou in a long projector envelope. Latest steering: render LINEAR far-field isocandela plots plus LOG IIHS vertical-sensor road view out to 100 m with 5-lux outline. Exploring mode. No agents authorized. No publishing requested.

Repo `/Users/anya/Projects/flux-sketchpad`, initial clean main at c1cf3e1. All new work local. Read `tools/spec-hl-v3/NOTES.md` for plan, assumptions, caught harness mistakes, initial results. Memory read canonical `/Users/anya/.claude/projects/-Users-anya-Projects/memory/{MEMORY.md,project_flux_sketchpad.md,reference_illumination_optics.md}` plus method/gates. User priorities distance/width, shoulders 50m+, no dark holes; excessive foreground bad. Latest Liou work has noisy selection and big near-vertex images. Existing scorer fixes must remain unchanged.

Files: `solvers/spec-hl-v3.js` copied v2 and extended (road target + trace-guarded 3-candidate choice). Not yet registered in index.json. Tools in this folder: scenes.js, run.js, batch.js, plots.py. Results/saved scenes in ignored `bench-out/spec-hl-v3`; plots in docs/spec-hl-v3. First comparison PNG shown to user (rejected weight-1 trial). Plot venv `bench-out/spec-hl-v3/plot-venv/bin/python` has matplotlib/numpy/pillow. Default/bundled Python do NOT have matplotlib.

Running unified exec sessions (may have finished; poll with write_stdin):
- 69354 baseline 2M, 2 workers: 6 scenes × ECE R112 B + FMVSS LB2V × spec-hl-v2,sqm-hl,sqm-hl-dish,opus-mosaic-auto,dish-fit-auto. Earliest failures expected from fixed harness bugs, rerun missing when complete. Later metrics need harnessVersion 2. Batch automatically reuses existing scene.json if result missing/outdated.
- 54724 final v3, 8M, 2 workers: all 12 configs. Running guarded solver defaults. Save comparison notes in each solve.json.
- 24608 long Ø90×220 projectorLong, both specs, projector-liou and v2; 100-facet cap, 2M. Needs 8M retrace after.
- 4226 / 19308 ablations road03 / road3 on ledUp,led519a,filament7,osramSmall ECE, 2M. Likely done. Use earlier saved designs; source has since gained guarded wrapper. No overwrites of those scenes.

Commands:
`node tools/spec-hl-v3/batch.js --jobs 2 --rays 8000000` reruns baseline missing solves, otherwise retraces saved scenes; 8M becomes canonical.
`node tools/spec-hl-v3/batch.js --jobs 2 --solvers spec-hl-v3 --rays 8000000` resume v3.
`node tools/spec-hl-v3/batch.js --jobs 1 --scenes projectorLong --solvers projector-liou,spec-hl-v2 --rays 8000000` projector comparison.
`node tools/spec-hl-v3/batch.js ... --seed 71 --rays 8000000 --retrace yes` independent ray seeds; same solved design.
`bench-out/spec-hl-v3/plot-venv/bin/python tools/spec-hl-v3/plots.py <plot JSONs> --out docs/spec-hl-v3/<name>.png`

Outstanding:
1. Finish final baseline/v3 tables; inspect actual beam plots and failing rows, not only counts. Accept only harnessVersion 2. Old harness road mirror false bug was corrected, assertion added; no final reporting on v1. Energy asserts close.
2. Evaluate whether guarded v3 improves, fix if justified. Internal host trace capped at2M; external8M may disagree. Need choose default based on several configs, no cherry-pick. Save early negative trials.
3. Tests: v3 roadWeight0 should EXACTLY reproduce v2 under equal budget/settings; test low facet budgets/scale/settings wiring/geometry. Full `node tests/all.js` with timeout because Node exit hang known. Browser actual worker load + Rebuild + screenshot. Read local-canvas-browser-qa skill already; announce applying it when QA starts. It is `/Users/anya/.codex/memories/skills/local-canvas-browser-qa/SKILL.md`. No browser tool initialized yet. Use separate origin 8749 or other unused; don't alter user's live tab.
4. Register v3 in solvers/index.json default group alongside v2, do not change preferred ID. User only asked new solver, no publishing.
5. Final plots per config+spec comparing v2/v3 + baseline gallery, accessible local links, perhaps simple static results HTML. User requested plots; deliver images not just data. Document all cases and exact presets/dims/amps in report. Baseline aliases clear: both dish-fit-auto and sqm-hl-dish included.
6. Report what tried, what worked, tradeoffs, limits, future ideas/configs/goals. Be honest if v3 is conditional, no full compliance if uncertain rows remain. R112/FMVSS preset simulations not certification. Most road objectives approximate; not modern OEM reverse engineering.

Memory citation required at final: relevant generated memory files were used, including local-canvas skill. MEMORY.md line numbers drifted during session; re-query exact lines for Flux GUI test command before citing. Canonical Claude memory is outside Codex memory tree and should be linked normally if needed. Do not edit either shared memory; only project notes.
