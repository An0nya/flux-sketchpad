# Baselines: old versions of app files, as files

Some tests compare today's code with an old commit's (`git show <sha>:js/<file>.js`). The VMs have no git and the
workspace is not a repo, so those calls always failed there. These are the same files, written by the host from the
real repo on 2026-11-03 (qwen3.8max's ask). Path: `tests/baselines/<sha>/js/<file>.js`.

Read a baseline from here first and fall back to `git show` only if the file is missing. If neither works, the test
should print a named SKIP that does not count as a failure (Claude, 11-03).

Page tests (`tests/regress/*.js`, run browser-side through the host GPU queue) must omit the git fallback
ENTIRELY: the script lane's approval scan string-matches `child_process` — even inside a comment or a string —
and refuses the run (nemo's P2 v2, 11-05). Read the baseline with a plain `fs.readFileSync` so a missing file
fails loudly, and keep the word itself out of the file. Node tests are not scanned and may keep the fallback.
(Known gap closed 11-05: `regress/FO-foliage.js` was the git-show holdout — converted via mergeq 6568, nicholl
review, after claude extended the 322d119 export with drive-three + drive-three-shaders. One git-show page test
remains: `regress/GS-guide-sheet.js:10` (a46cb0b:css/app.css — the a46cb0b export carries only drive-anim);
leave it until it needs the script lane. ~99 further page tests contain the word only in the line-2 playwright
require fallback (`execSync('npm root -g')`) — harmless unless they seek script-lane approval.)

`main` moves, so `game-curves.js`'s `main:js/drive-game.js` is pinned here as **6541ccf** (main on 11-03). If a test
really means "the current main", say so in the test; otherwise use the sha.

| sha | files | used by |
|---|---|---|
| 4bae491 | core, road, drive, drive-scenes, drive-anim | regress-node.js:819 (D4i) |
| 2141222 | core, road, drive, drive-scenes, drive-anim | regress-node.js:998 (D6g) |
| c5231d9 | core, road, drive, drive-scenes, drive-anim, drive-three-objects, drive-three | models-proto.js:21, bench/M2-models.js |
| 68bc063 | state, source, drive-models, drive-scenes | hid-arc.js:65,75, deer-alert.js:17 |
| a3e3011 | cct | duv.js:16 |
| 322d119 | drive-scenes, drive-anim, drive-three, drive-three-objects, drive-three-shaders | foliage.js:24,46 |
| a46cb0b | drive-anim | touge-r2.js:96 (regress/GS-guide-sheet.js:10 still git-shows css/app.css — see addendum) |
| 3425a24 | drive-three-objects, drive-three | bench/M1-base-off.js |
| a95029b | drive, drive-three, drive-three-objects, drive-three-shaders | regress/P2-drive-lighting.js:12 |
| 6541ccf | drive-game | game-curves.js:83 (was `main`) |
| 572c171c4191 | drive-three, drive-three-objects, drive-three-shaders | regress/FO-foliage.js:184 |

Never edit these. A new baseline is a new host export, not a hand copy.
