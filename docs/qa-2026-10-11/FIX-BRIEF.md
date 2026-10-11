# Flux bug-fix batch — shared contract (every fix agent reads this first)

QA=/private/tmp/claude-501/-Users-anya/e131d530-06e8-45fd-966e-f5141ea2d478/scratchpad/qa
You fix ONE batch of bugs from $QA/GROUPS.md, in YOUR worktree only (path and branch given in your prompt).
GROUPS.md has, per group: root cause with file:line, member tags, a fix sketch, and the repro scripts. The
original bug reports with evidence are in $QA/<area>/findings.md (area by tag letter: L layout, C controls,
F lifecycle, S spec, E editing, M memory); repro scripts are in $QA/<area>/.

## Hard rules
1. Step 0: `git -C <worktree> log -1 --format=%h` must print the commit given in your prompt, and
   `git -C <worktree> branch --show-current` your branch. If not, STOP and report.
2. Edit files only inside your worktree. Never touch ~/Projects/flux-sketchpad itself (the main checkout) or
   another worktree. Commit on your branch only. Never push, merge, rebase or switch branches.
3. Stay inside your batch's groups and the files GROUPS.md lists for them. If the real root cause is
   different from GROUPS.md, or the fix needs a file outside your batch, or a product decision: STOP that
   group, write down what you found, and move on to the next group. Don't improvise around it.
4. Minimal diffs. Match the surrounding code: its naming, comment density and one-liner style. No
   refactors, no reformatting, no new dependencies.
5. Don't use the mcp__Claude_Browser or claude-in-chrome tools (shared). Playwright is not global here:
   load it with `require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'))`
   and run with PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright. Serve your worktree with
   `python3 tests/serve.py <your port>` (from the worktree, in the background); kill it when done.
6. Never claim a test passed without pasting its output. Never invent numbers.

## Per group, in this order
a. Regression test FIRST. Turn the group's repro into a test:
   - Logic reachable in Node (tests/load.js loads the app's scripts): add a check to an existing tests/*.js
     file that fits, or tests/regress-node.js (create it if missing; make it exit 1 on failure).
   - Needs the page: tests/regress/<Gxx>-<slug>.js, a self-contained Playwright script (port as argv[2],
     default your port) that prints [PASS]/[FAIL] lines and exits 1 on failure. Model it on
     tests/watch-solve-e2e.js. Self-identify the page (assert RF.UI exists) before reading state.
b. Run it on the unfixed code and capture the FAIL output. A test that passes before the fix tests nothing:
   fix the test, not the code.
c. Fix. Run the test again: capture the PASS output.
d. Commit that group alone: message "<Gxx>: <what was wrong, in plain words>" plus a line naming the
   test, ending with the line: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

## When the batch is done
- Run `node tests/all.js` in the worktree (takes several minutes; run it in the background and wait for
  it) and every tests/regress/*.js you added. Paste the summary lines.
- Write $QA/fixes/<batch>.md: per group: status (fixed / stopped + why), files changed, commit hash,
  test file, the FAIL-before and PASS-after lines, anything surprising. Append per group as you go.
- Final message: per group status in one line each, the all.js summary, and anything the reviewer
  should look at hardest.

## Added after the first round
- tests/regress-node.js already exists (fixes for G06 G04 G05 G09 G21). Add your Node checks as new blocks
  inside its async body, before `process.exitCode`. Don't edit other groups' blocks. Anything that
  measures process-wide memory goes in the sync section at the top (see G21).
- Run browser tests with PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright.
- NEVER use `git stash`: the stash stack is shared by every worktree and other agents (a pop already applied
  another batch's stash once). To set work aside, make a temporary WIP commit on your branch and amend or
  reset --soft it later. To compare with the base, use `git diff <base> -- file` or `git show <base>:file`.
