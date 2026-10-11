# Flux QA sweep — shared contract (every agent reads this first)

App: ~/Projects/flux-sketchpad (branch main, HEAD should be 2dc83f6). A browser sketchpad for
designing reflectors/headlamps: classic <script> files in js/, entry index.html, global `RF`
(RF.UI, RF.UI.store, RF.Spec, RF.SolverHost, RF.Solvers, RF.Engine ...). Read README.md first
(skim), then the code for your scope. Docs may be stale vs code; trust the code.

## Hard rules
1. REPORT ONLY. Do not edit, create or delete anything inside ~/Projects/flux-sketchpad. No git
   commands that change state (no commit/checkout/stash/branch/reset). Two other sessions are
   working on branches of this repo; a stray edit collides with them.
2. Your own files go ONLY in your directory: $QA/<your-area>/ where
   QA=/private/tmp/claude-501/-Users-anya/e131d530-06e8-45fd-966e-f5141ea2d478/scratchpad/qa
3. DO NOT use the mcp__Claude_Browser__* or claude-in-chrome tools. That pane is shared with other
   agents and silently retargets. Drive the page with your own headless Playwright instead:
     const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
   Template for driving the app: tests/watch-solve-e2e.js (waits for boot, starts solves, reads
   RF.UI state, screenshots). Serve the app with YOUR port only:
     python3 ~/Projects/flux-sketchpad/tests/serve.py <PORT>    (run it in the background)
   Kill your server and any browsers you launched when you finish.
4. Step 0: `git -C ~/Projects/flux-sketchpad log -1 --format=%h` must print 2dc83f6. If not,
   note the hash in your report header and continue.
5. Every probe self-identifies: assert you are on the right page/state (e.g. document.title,
   RF.UI.store.scene.mode) before trusting a reading.
6. Persist as you go: append each finding to $QA/<area>/findings.md THE MOMENT it is confirmed
   (cat >> ... <<'EOF'), not at the end. If a write to that file ever fails, say so plainly in
   your final message and list findings there; never invent detail to fill a gap.
7. Never fabricate. A finding needs a reproduction you actually ran. Things you suspect but did
   not reproduce go in a separate "## Suspected (not reproduced)" section, labelled as such.
8. Long solves: some solvers take 30-120 s. Prefer fast solvers / small ray counts where the bug
   doesn't need a real solve. Don't run more than one heavy solve at a time in your browser.

## Finding format (append one block per bug)
### <short title>
- Severity: crash/blocker | wrong result | broken UI | cosmetic | perf/memory
- Repro: exact steps or the exact page.evaluate/script snippet (save scripts in your dir and name them)
- Observed vs expected
- Evidence: console error text, numbers, screenshot path (in your dir)
- Reproduced: N of M attempts
- Suspected cause: file:line, if you found it (label it a guess unless you confirmed it)

## Already known (confirm still present, one line each, don't re-investigate deeply)
- Collapsing then reopening the Paint or Result pane leaves its canvas blank until Reset zoom.
- A solve that hits the 120 s limit silently keeps the previous design.
- SPEC-MODE.md has duplicated sections. Sidebar jumps while solving. Label overlap in some panels.
- Safari memory bloat (1.4 GB idle, 3 GB solving): not reproduced in Chromium yet.

## Finish
End your final message with: count of confirmed findings by severity, the path to findings.md,
and the 3 you think matter most. Stop when your scope is exhausted or you have ~25 confirmed
findings, whichever is first.
