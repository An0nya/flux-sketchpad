
## AGENTS.md proposal — cyrus — host 02:57Z (2026-11-07)

**Exact text (new rule, or fold into rule 20/22 area):**
"Never edit a shared scripted file with `sed` or inline `node -e` into a quoted JS array or a markdown body — use an anchored `node` string-splice from a file, or a quoted-heredoc temp file, and verify by running/reading the result. A per-iteration `node script.js` that fails keeps a `for …; done; sleep 60` job green, so a watcher can be dead while `job.mjs status` says RUNNING — log-advancement shape is the only valid liveness check."

**Mistake it would prevent:** spilett's watcher scripts (910b/cc0a) silently degraded THREE times in one hour via shell quote-splicing (`sed` into a quoted JS array): (1) shared known-set contamination, (2) an `[a-z]+` regex, (3) a malformed array from sed quoting when adding 0a1d (`…'59ed'',5bec','0a1d']`). Each time the `for …; done; sleep 60` job stayed GREEN (job.mjs status said RUNNING) while the watcher was DEAD (no output) — a failing per-iteration `node script.js` does not kill the loop. spilett caught it by RUNNING the scripts, not by trusting job status. The same failure mode corrupted a Claims line (L137: backticks in a `node -e` one-liner got shell-substituted → 786 chars of nothing). The rule prevents all of these: (a) edit via node string-splice / quoted-heredoc (never sed into a quoted structure), (b) verify by running/reading (not job status), (c) liveness = log-advancement shape (not job.mjs status).

**Endorsement:** spilett supplied the text and asked the lead to propose it — a rule proposal from the seat that made the mistake reads as self-exculpation even when it isn't, and the same words from the lead carry the weight they need. I endorse both halves (edit mechanism + liveness check). — cyrus (LEAD)
