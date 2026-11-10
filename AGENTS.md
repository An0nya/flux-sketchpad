# Flux, sealed VM build — read this first

You are in a sealed Linux VM. `/workspace` is your own git clone of the Flux repo (a headlamp and road-lighting
simulator, plain JavaScript, no build step), on branch `swarm`. Anya gives you the task in chat.

## Rules
1. **`/workspace` is yours, and it's a real git repo.** Commit, branch, stash and rebase as you like. Nothing you do there
   reaches anyone until you `land` it (rule 25). You can't push; `land` is the only way in. Ignore `docs/STANDARDS.md`
   §2.1 and §3 lines 38-40, which describe a different repo setup.
2. Work in `/workspace` (your clone), `/workspace/notes/` (shared, see below) and `/tmp`. Everything else is read-only.
3. Before changing code, read `docs/STANDARDS.md` §1 and §2.2-2.5. Those rules apply here. In short:
   - a new feature is an option, default OFF, and OFF must behave exactly as before;
   - declare the option once, in `js/options-registry.js`;
   - the CPU renderer (`js/drive.js`) and the GPU one both stay valid;
   - match the surrounding code: naming, comment density, one-liner style. No refactors, no new dependencies.
4. If the task needs a product decision (what the feature should do, not how), make the smallest reasonable
   choice, put it behind the option, and list it under "Decisions for Anya" in your report.
5. Stop and ask Anya if the task needs a change to the solver API or the saved-scene format.

## You are one of several models, each in its own clone (re-read after EVERY compaction)
Other models work at the same time, each from its own VM and clone. A compaction summary drops most of this, and this
file is the only thing that survives it, so follow it even if your summary doesn't mention any of it.

**Where things are** (`/peers`, `/upstream` and `/lander` are at the top of the filesystem, not under `/workspace`):
| Path | What | You can |
|---|---|---|
| `/workspace` | your clone | read, write, commit |
| `/workspace/scratch/` | your probes and page tests, not in git | read, write |
| `/workspace/notes/` | shared notes, not in git: `BACKLOG-2026-10-30.md` (holds Claims), `CLAUDE-NOTES.md`, `QUESTIONS-FOR-CLAUDE.md`, `REPORT.md`, `note from anya(updated).txt`, and a folder per seat | read, write. The host keeps every version |
| `/peers/<seat>/` | every other seat's clone, uncommitted files included | read files. Don't run git there |
| `/upstream` | the central repo. `git fetch` gets the latest `swarm` | fetch |
| `/lander/` | status of every patch, and gate records in `gates/` | read |

1. **After starting or compacting, read these, in this order, all in `/workspace/notes/`:** `note from anya(updated).txt` ·
   `tail -150 CLAUDE-NOTES.md` (Anya's decisions and relayed findings, newest at the bottom) · `tail -60 BACKLOG-2026-10-30.md`
   (new Claims are added at the bottom; `grep -n '^## '` finds the backlog sections) · `tail -60 QUESTIONS-FOR-CLAUDE.md` · your own
   `NOTES.md`/`CONTEXT.md`, if you have them. These files are large, so don't read them whole; grep them when you need something older.
2. **Keep your own notes file** in your notes folder (`/workspace/notes/<folder>/`; your session info message names it) up to
   date: what you're doing, what you've claimed, open asks, numbers you rely on. `/tmp` dies with your VM, so copy
   anything worth keeping into your folder.
3. **Claim before you start.** Add a line to Claims: `item — model — status (date)`. Two seats can edit one file now, and the
   lander catches real conflicts, but a claim still saves you from doing the same work twice. Before starting on a
   file someone has claimed, look at what they have in `/peers/<seat>/`.
4. **Never delete or overwrite another model's files.** Mark your own superseded work as superseded; don't delete it.
5. **Share code, not just conclusions:** work in your clone is already visible in `/peers/<you>/`. Work you drop still has
   value: put it in `notes/<folder>/app-edits/` with a README (what it is, the commit it was measured against, why it
   was rejected), even when it failed.
6. **Anya's standing rule:** every new build or setting is an option, **default OFF**, with a visible, labelled
   control. Don't remove or replace another model's option; add yours alongside.
7. **Talking:** to another seat, use the `send` tool (`to` = a seat, an alias, `lead`, `adults` or `all`); it arrives in
   their session, and replies arrive in yours. `status("all")` shows what every seat is doing, `status("<seat>")` one
   seat in detail. Claims stay the record of who owns what. To the host supervisor (Claude), `send` to `claude` or
   append to `notes/QUESTIONS-FOR-CLAUDE.md`. To Anya, `send` to `anya`, or "Decisions for Anya" in your report. Never block
   waiting for an answer. (Claude, 11-03, approved in advance by Anya)
8. **Before quoting a number,** state the beam (`ownLow: builtin:sqm-samples.json:4`, not the design fallback), the
   pose, and the reference you compared against. A dense whole-range integral is not a safe reference near a lamp.
9. `swarm` is what Anya tries. Have tests resolve paths from `__dirname`, not `/workspace`: gates run them elsewhere.
10. **Want this file changed?** Propose it in `/workspace/notes/CLAUDE-NOTES.md` (the shared notes folder; a file at your clone's
    root gets landed into the app tree) under `## AGENTS.md proposal — <model> — <time>`, with the exact
    text and the mistake it would prevent. Anya and Claude review proposals; don't edit AGENTS.md yourself.
11. **Stamp shared files with host time, not your VM's clock.** VM clocks drift, and differently per VM (one was 291 min
    behind). Read host time from the mtime of a file you CREATE, with a fresh name each time: `touch` on a file that
    already exists does not update its mtime from inside the VM (qwen3.8max found this), so a reused `.clock` file
    shows a stale time:
    `f=/workspace/notes/<folder>/.clock-$$-$RANDOM; : > $f; date -u -d @$(stat -c %Y $f); rm -f $f` (Claude, 11-03, approved in advance by Anya).
    Mail headers and job mail carry host time too. If you quote a time, say which clock.
12. **Keep up with `swarm`:** `git fetch`, then `git rebase origin/swarm`. `land` does this for you and stops on a conflict.
13. **Shared lists:** append new keys at the END, so that two seats adding options don't collide.
    A patch whose copy of a shared file is measurably STALE against the tip (its tests/gate.js NODE list lacks entries
    the tip has) gets rebased onto the tip BEFORE anyone approves it; don't approve it expecting the replay to conflict.
    A replay that doesn't conflict keeps your patch's own deletions, so a stale copy silently drops other seats'
    entries (11-09: 37ab dropped runner-selftest; aed1665 dropped gate-coverage; bee0 dropped the four Layer C suites).
    Reviewers: re-run md5-drift on shared files you recorded at review start; a mismatch against the tip is a
    require-rebase blocker, not a warning. The lander also refuses a patch whose gate.js would run fewer suites than
    swarm's ("REFUSED, NODE shrink"); to retire a suite on purpose, delete its test file in the same patch.
    (cyrus's proposal 11-09, spilett's amendment; accepted by Claude 11-10 under Anya's go-ahead.)
14. **Never put a full copy of the app tree in `notes/`.** It's shared and has no use for one. For a throwaway copy use
    `cp -r` into `/tmp`, never symlinks (rule 27).
15. **Split aggregate numbers.** An average can hide a trade: `haloMoment` improved the whole-column rms while making
    the near-lamp field 5.5x worse. Report near/far (or per-region) as well as the total. Prefer a loud failure to a
    silent skip in tests.
16. **Before you report back to Anya in chat** (status update, question, "done"), re-read the newest entries in
    `notes/CLAUDE-NOTES.md`, Claims and the `notes/QUESTIONS-FOR-CLAUDE.md` tail. Your answer may already be there, or someone may
    have changed what you are about to report on. Say in your report what you checked.
17. **A new option gets a second pair of eyes before it lands:**
    a) build it in your clone and post `REVIEW REQUEST: <option> — <model> — <host time>` in Claims, with what to check and
       your commit;
    b) another model reads it in `/peers/<seat>/` and tests a private `cp -r` copy: node tests pass, OFF is byte-identical,
       the option has a visible labelled control, and one in-renderer check that it does what it claims. It posts
       `REVIEWED: ok` or the blockers;
    c) the author `land`s it, and regenerates `docs/inventory` first if options changed. Fixes to another model's file go to
       its owner first; if they are inactive for over an hour, land it yourself and say so in Claims.
    Nobody picks a winner between competing implementations: both stay as options, and Anya decides.
18. **A new option is not finished until it is projected.** Every option in the `halo` group needs a key in the
    `look` literal in `js/drive-anim.js` (even a CPU-side one; the renderer ignores the extra key), or a named entry
    in the derived-exclusion list of `tests/halo-look-projection.js`. A missing key once made an option inert
    (`haloMoment`). Checklist for a new option: the registry entry · the UI control and its sync · the `look`
    projection (or the exclusion) · the cache keys that must change when it does · a node test · `tests/gate.js`.
19. **Before landing, read your own diff:** `git diff origin/swarm`. Copying a file over your clone from an old copy reverts
    whatever others landed since, and git will happily commit that.
20. **`xvfb-run` must never have a pipe as its stdout.** `timeout` signals only its direct child; Xvfb survives as a
    grandchild holding the pipe open, so the call hangs, and `timeout -k` does not help. Your harness's stdout IS a
    pipe, so always redirect: `timeout 900 xvfb-run -a ... node /tmp/x.js > /tmp/x.log 2>&1; echo "exit $?"; tail -40 /tmp/x.log`
    (measured by qwen3.8max: 6 s with a file, hung past 22 s with a pipe). Same for `chromium-browser` under xvfb-run.
    A killed Playwright run can also leave its in-script HTTP server holding the port (EADDRINUSE): use a fresh port.
21. **`pkill -f <pattern>` can kill your own shell** when the pattern is in your command line. Use `pkill -x <name>`.
22. **Record the commit you tested on, and re-run before reporting a failure.** Some page tests fail now and then.
23. **Pinned baselines (`beam-atlas`, `traffic-beams`, `scene-digest`, `scene-snapshot`) are re-pinned once, by the
    last lander.** If your change moves one, say so in your Claims entry ("moves pin: beam-atlas"). Don't re-pin while
    others are still landing; post "pins drifting, hold re-pins" in Claims, and whoever lands last re-pins once, with
    the cause in a comment. Re-pins usually change tests that wait for review (rule 25). Use the suite's `--repin` mode where it exists (qwen3.8max is adding it).

24. **All real rendering goes through the host GPU queue** (`node .harness/gpuq.mjs help`): timings, screenshots, a scene
    played through. Never do it on software GL here (llvmpipe/SwiftShader): a hefty scene takes minutes, its numbers mean
    nothing, and the CPU load slows the host's real-GPU runs for everyone. Software GL is for short does-it-load,
    does-it-compile checks, run as background jobs (`node .harness/job.mjs`). Before submitting, `gpuq.mjs find` shows
    past results of the same request and which app files differ from your tree. A job runs on your clone as it stands,
    uncommitted edits included. (Anya, 11-02.)
25. **Land changes to `js/`, `tests/`, `css/`, `index.html` and `.md` files with `land`:**
    - `land "what and why"` commits everything uncommitted, rebases on `swarm` and sends the patch. `land --no-commit "note"`
      sends only what you've committed. `land status` shows where your patches are. Other files stay uncommitted, and it lists them.
    - The host tests your patch on top of the current `swarm`, together with others waiting, and `swarm` moves only if nothing
      new fails. You get mail either way. Expect 10-30 minutes for a patch that touches code, even a comment; a `.md`-only patch
      takes seconds. Don't wait: carry on, and the mail will find you. A block lists the failing checks, and the full record is in `/lander/gates/`.
    - **Some changes are held for review by an adult or lead:** `land` them as usual, and the lander holds them and asks the
      reviewers itself, so there's nothing to post. It gates them once approved. This is separate from rule 17. It covers anything in `tests/regress/`, `tests/gate.js`, `tests/load.js`,
      `tests/serve.py`, `tests/drive-three-page.js`, `tests/scenario/`, `tests/baselines/`, and edits or deletions of `tests/*.js`.
      A new node test doesn't wait. Reviewers: `land review <seat>--<id>`, then `land approve <seat>--<id> <full commit>`; ask yourself
      whether the test still checks what it did. You can't approve your own.
    - After it lands: `git fetch`, then `git rebase origin/swarm`.
26. **End each turn with where you are.** If the task is finished, say DONE; if you can't go on, BLOCKED and why; if
    you're waiting on a reply, WAITING and on whom. Without one of those words the harness nudges you to carry on
    (up to 3 times), and when you're idle it sends a periodic look-around (reviews to do, seats to help, unclaimed
    items); answer NOTHING TO DO if there is nothing. At a natural checkpoint (a change landed, a review done) you
    may call the `compact` tool to compact your context; put anything that must survive word for word in a
    ```checkpoint fenced block first. (Claude, 11-03, approved in advance by Anya)
27. **Other seats' clones are read-only, so you can't damage them.** Your own can still be damaged by a review. To run someone's
    code, make a private copy with `cp -r`, into `/tmp/review/<name>/`. **A symlink into `/workspace` isn't a private copy:**
    writing through it changes the real file (11-05: this overwrote a gate file and deleted a test). Check with
    `find <copy> -type l` before writing there. Don't run another seat's script on your clone without reading it first.
28. **Add to shared notes with `cat >> file`, and nothing cleverer.** Never open a file for writing in the same statement that reads
    it: `open(p,'w').write(open(p).read()+line)` empties the file first (11-04: this wiped more than 2,300 lines of `BACKLOG-2026-10-30.md`, and
    the md5 printed afterwards looked fine). If a shared file suddenly looks short, stop and tell `claude`.
29. **An old version of an app file for a test to compare with** goes in `tests/baselines/<commit>/`, from your clone:
    `mkdir -p tests/baselines/<commit>/js; git show <commit>:js/<file>.js > tests/baselines/<commit>/js/<file>.js`, then `land` it. The lander holds it
    for review (rule 25). A reviewer can check it with the same `git show`. Add a row to `tests/baselines/README.md`.
30. **Never edit a script or a shared file with `sed` or a one-line `node -e`.** Shell quoting breaks quoted arrays and
    markdown silently: three times in one hour (11-06), `sed` into a quoted JS array left a watcher dead, and backticks in a
    `node -e` emptied a Claims line. Write the new text to a file with a quoted heredoc (`<<'EOF'`) and splice it in with a
    `node` script that fails if its anchor text isn't found. Then run or read the result. **A looping job isn't alive because
    `job.mjs status` says RUNNING:** in `for …; do node x.js; done; sleep 60` a failing `node x.js` keeps the loop going. Check that
    its log is still growing.

## Environment
- Run `export TMPDIR=/tmp` first (TMPDIR points at a path that does not exist here).
- `node` and `python3` are installed.
- **VMs differ: some have Chromium and some don't,** and `apk add` can fail because the root disk is small. Check with
  `ls /usr/bin/chromium-browser` before relying on the software-GL recipe below or the Playwright notes under "Driving
  the app" and "Shell commands". Without a browser, even a quick does-it-load check goes to the host GPU queue
  (`node /workspace/.harness/gpuq.mjs help`). Old app files for comparisons: `git show <commit>:<file>`,
  or `tests/baselines/<sha>/`; see its README.
- **WebGL2 works here in software** (found 10-29, see REPORT.md). Each session, first run
  `apk add mesa-gl mesa-gles xvfb xvfb-run`, then run Chromium or your Playwright script like this:
  `xvfb-run -a --server-args="-screen 0 1600x1000x24" env MESA_LOADER_DRIVER_OVERRIDE=swrast NODE_PATH=/usr/local/lib/node_modules timeout 120 node /tmp/script.js`
  with launch args `--no-sandbox --use-gl=angle --use-angle=gl --ignore-gpu-blocklist` and a 1440x900 viewport.
  The renderer is Mesa llvmpipe (software). It is slow, and its fps says nothing about real performance.
- **Drive's GPU renderer needs HTTP** (it loads `js/drive-three.js` as an ES module; on `file://` it falls back to
  the CPU picture: `js/drive-anim.js`, `gpuRenderer()`). Do not start a separate server process (see Shell
  commands). Start one **inside your Playwright script** and close it at the end, so nothing outlives the call:
  ```js
  const http = require('http'), fs = require('fs'), path = require('path');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer((q, r) => { const f = path.join('/workspace', decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
  await new Promise((ok) => server.listen(8090, '127.0.0.1', ok));
  // ... page.goto('http://127.0.0.1:8090/') and your checks ...
  await browser.close(); server.close();
  ```
- Static UI checks can still use `file:///workspace/index.html` with no server.
- The "Flashing lights" banner covers the bottom of the drive view (FPS counter included). Pre-dismiss it before
  the page loads: `await page.addInitScript(() => localStorage.setItem('flux/photosafeNotice', 'dismissed'));`
- Icons like ⏸ show as a box: the VM lacks the font. Cosmetic, not a bug.
- Browser tests (`tests/regress/*.js`) compare timings and exact pixels, so they cannot pass here. Do not run
  them in your VM. The lander runs the ones your change touches on the host GPU, and `gpuq.mjs` can run one
  for you. (Claude, 11-03, approved in advance by Anya)

## Driving the app (worked 10-29 over the in-script server)
1. Before `page.goto`, pre-dismiss both first-run overlays:
   `await page.addInitScript(() => { localStorage.setItem('flux/photosafeNotice', 'dismissed'); localStorage.setItem('flux/guideSeen', '1'); });`
2. Wait for the app: `await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store);`
3. Click `button[data-mode="D"]` (Spec), then `button[data-disp="drive"]`. The default scene is already solved, so
   Drive appears at once. Don't click Rebuild unless the task needs it: a solve can take minutes here.
4. Click `[data-anim="popout"]` for the full-window large view, then `[data-anim="play"]`. The button reads
   Pause while it plays. Esc or the popout button closes it.
5. Check the renderer with `RF.DriveAnim.stats()`: `renderer` is `"three"` on the GPU path and `"cpu"` on the
   fallback. It starts as `"cpu"` and switches after Play.
6. **Saved state files** (`{"kind": "flux-state", ...}`, for example `flux-state-straight-348m.json`) set every
   option and the car's position. Load them with Performance > Debug > Load state, not the sidebar's "Open from
   disk" (that one opens scene files). From a script: `await page.setInputFiles('[data-anim="state-file"]', '/workspace/<file>.json')`.
   A state loads paused, so screenshot it as-is, or press Play.
7. In overlay mode, clicks on empty canvas areas pass through to the picture by design. The bars and panels are
   still clickable. If a control looks missing, its panel is probably collapsed: open it with its tab or grab bar.

## Shell commands (these have already cost this session)
- ⛔ **Never run a command that will not end on its own.** Your shell call waits until the process exits, so a
  server, `tail -f`, a `--watch` mode or an interactive prompt blocks until the call is aborted, and you lose
  its output. **Backgrounding with `&` or `nohup ... &` does not fix this here**: the call still hangs.
- ⭐ **Never start a server as its own process.** For the UI, `file:///workspace/index.html` is enough; for the
  GPU drive path, serve from inside your Playwright script (see Environment).
- Put `timeout` in front of anything that might run long: `timeout 60 node tests/<name>.js > /tmp/out.txt 2>&1;
  echo "exit $?"; tail -40 /tmp/out.txt`. Exit 124 means it timed out. Some node tests take minutes; do not
  run `node tests/all.js` or `tests/gate.js`.
- One-shot Chromium works and cannot hang:
  `timeout 30 chromium-browser --headless=new --no-sandbox --screenshot=/workspace/shot.png --window-size=912,513 file:///workspace/index.html`.
  For anything more, write a Playwright script (`playwright-core` is at
  `/usr/local/lib/node_modules/playwright-core`, launch with `executablePath: '/usr/bin/chromium-browser'` and
  `--no-sandbox`), end it with `await browser.close()`, and run it under `timeout`.
- Chromium's stderr is noise (dbus, GPU, SSL). Send it to `/dev/null` or a file; don't build `grep -v` chains.
- If you cannot see images, do not read screenshots. Read numbers or page text instead.
- ⛔ **Image budget: some providers refuse a request holding more than 8 images, counting the whole
  conversation.** Past 8, every message fails, even plain text. Read at most ~5 screenshots per session. To compare
  a sequence, put all the frames in **one contact sheet** and read only that, for example in Playwright:
  `await page.setContent('<body style="margin:0;display:grid;grid-template-columns:repeat(4,1fr)">' + files.map(f => '<img style="width:100%" src="data:image/png;base64,' + fs.readFileSync(f).toString('base64') + '">').join('') + '</body>'); await page.screenshot({ path: '/workspace/sheet.png', fullPage: true });`

## Tests
- Run node tests as `node tests/<name>.js` (for example `node tests/regress-node.js`, `node tests/options-registry.js`).
- A new option gets a node check: OFF gives the same result as before, ON changes what it should.
- Never claim a test passed without pasting its output. Never invent a number; write "not measured".

## Report
Keep your section of `/workspace/notes/REPORT.md` up to date as you go:
- files you changed, and why;
- commands you ran, with their output pasted;
- Decisions for Anya;
- what is not done or not tested.
