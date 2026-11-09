// tests/catch-ignore-audit.js — T3: catch-and-ignore block audit
// glm5.2 11-01 (host ~07:00): frenchie's first-pass review (frenchie/APP-REVIEW-2026-10-31.md §"Silent-fallback
// greps") said "catch-and-ignore blocks in solver/engine/state/history/controller: 9 — not individually audited
// here." This test audits every catch block in the app source, classifies it, and fails if a new SILENT
// catch-and-ignore appears without a documented exemption.
//
// Classification rules (applied in order, first match wins):
//   - RE-THROW:    the catch re-throws (or throws a wrapped error). Errors propagate. SAFE.
//   - REJECT:      the catch rejects a promise (reject(...)). Errors propagate. SAFE.
//   - NOTICE:      the catch surfaces the error to the user (notice(), postMessage({error}), send({type:'error'}),
//                  console.warn/error, .textContent, V.why, .msg, .error, errors.push, tickError, failWorkers,
//                  contextFallback, gpuFallback, fail(), libSay, lastLoadError, status text, pass:false+detail).
//                  SAFE.
//   - CONTROLLED:  the catch handles a specific, expected condition (e.aborted, e.workerFailure, "gone",
//                  "display only", "a missing file is skipped", "storage full", etc.) and either re-throws or
//                  falls back to a documented default. SAFE.
//   - STORAGE:     the try block accesses localStorage/sessionStorage/IndexedDB (private browsing, quota).
//                  The app degrades gracefully (settings not saved). SAFE — standard pattern.
//   - SILENT:      the catch swallows the error with no user-visible notice and no re-throw. These need auditing.
//
// Accept: runs green on the current tree; fails when a new SILENT catch-and-ignore appears without exemption.

const fs = require('fs'), path = require('path');
const ok = (name, pass, detail) => { console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  - ' + detail : ''}`); if (!pass) process.exitCode = 1; };

const jsDir = path.join(__dirname, '..', 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();

// Extract catch blocks with their try-block context (to check for STORAGE pattern).
function extractCatchBlocks(src) {
  const blocks = [];
  const re = /catch\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const varName = m[1].trim();
    const braceStart = m.index + m[0].length - 1;
    let depth = 0, end = -1;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = src.substring(braceStart + 1, end);
    // Find the try block: scan backwards from catch for the matching `try {`
    // The try block is the `{ ... }` immediately before `catch`.
    let tryEnd = m.index - 1;
    // Skip whitespace backwards to find the `}` of the try block
    while (tryEnd >= 0 && /\s/.test(src[tryEnd])) tryEnd--;
    if (tryEnd < 0 || src[tryEnd] !== '}') continue;
    // Match braces backwards to find the try block opening `{`
    depth = 0; let tryStart = -1;
    for (let i = tryEnd; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{') { depth--; if (depth === 0) { tryStart = i; break; } }
    }
    const tryBody = tryStart >= 0 ? src.substring(tryStart + 1, tryEnd) : '';
    blocks.push({ varName, body, tryBody, start: m.index, end });
  }
  return blocks;
}

function classify(body, tryBody, varName) {
  const b = body.trim();
  // RE-THROW: contains `throw`
  if (/\bthrow\b/.test(b)) return 'RE-THROW';
  // REJECT: rejects a promise
  if (/reject\s*\(/.test(b)) return 'REJECT';
  // NOTICE: surfaces the error to the user
  if (/notice\s*\(|postMessage\s*\(\s*\{[^}]*(error|type:\s*['"]err|type:\s*['"]error)|post\s*\(\s*\{[^}]*error|send\s*\(\s*\{[^}]*(error|type:\s*['"]err|type:\s*['"]error)|console\.(warn|error|log)|\.textContent\s*=|\.store\.notice|tickError|failWorkers|contextFallback|gpuFallback|\bfail\s*\(|libSay|lastLoadError|V\.why\s*=|\.msg\s*=.*fail|\.msg\s*=.*error|\.error\s*=|errors\.push|pass:\s*false|detail:.*threw|status\s*=|pinError|\.store\s*\(|\.notice\s*=|\btext\s*\(.*e\.message|\btext\s*\(.*error|return\s*\{[^}]*error|\.spec\s*=.*error|\.goal\s*=.*error/.test(b)) return 'NOTICE';
  // CONTROLLED: handles a specific expected condition (in body OR tryBody)
  // qwen3.8max review (M1/B): removed dangerously generic comment-word patterns
  // (wind, window, \bnone\b, keep\b, gone, console.warn/error/log in tryBody) that caused
  // false negatives — a silent catch with an incidental "none" or "window" comment escaped
  // audit. The 4 real blocks that relied on them are now SILENT+exempt (see EXEMPT below).
  if (/e\.aborted|err\.aborted|e\.workerFailure|e\.kind|e2\b.*storage full|display only|never leave.*rejected|a missing file is skipped|a malformed preview is dropped|a source that no longer loads|killed mid|no storage|storage full|skip a damaged record|picture only|no score|no photometry|already ended|already-released|synthetic|storage blocked|stays off|not remembered|stays narrow|the report.*stands in|the picture.*stands|best effort|no history API|the hash stays|the copy stays|next load sees|failed\s*=\s*e|matchMedia|AudioContext|webgl|cctToRGB|releasePointerCapture|setPointerCapture|biState|storeOk|complete\s*=\s*false|previewTrace|ptr\.busy|polys:\s*\[\]|scene\s*=\s*null|awake\s*=\s*null|c\s*=\s*null|the grid settings/.test(b)) return 'CONTROLLED';
  // CONTROLLED (tryBody): feature detection or pointer-capture in the try block
  // qwen3.8max review (B): removed console.log from tryBody — a debug log should not make
  // a silent catch CONTROLLED. Kept console.warn/error: those ARE error surfacing (the
  // catch is a safety net for the console call itself, e.g. render-gl.js:127).
  if (/matchMedia|AudioContext|getContext\s*\(\s*['"]webgl|releasePointerCapture|setPointerCapture|console\.(warn|error)/.test(tryBody)) return 'CONTROLLED';
  // STORAGE: the try block accesses browser storage (private browsing, quota)
  if (/localStorage|sessionStorage|navigator\.storage|indexedDB|IDB|\.persist\b|\.persisted\b|\.estimate\b/.test(tryBody)) return 'STORAGE';
  // If it returns a value (false/null/0/undefined) it's a silent fallback
  if (/return\s+(false|null|0|undefined|''|""|\[\]|{})/.test(b)) return 'SILENT';
  // If it just does nothing (empty or comment only)
  if (b === '' || /^\/\*.*\*\/$/.test(b)) return 'SILENT';
  // If it returns bare (no value)
  if (/return\s*;?$/.test(b)) return 'SILENT';
  // Default: conservative — flag as silent
  return 'SILENT';
}

// ---- the exemption list: SILENT catch blocks that are intentionally silent ----
// qwen3.8max review (P1/A): keyed on { file, bodySig } not line number — line numbers
// drift when edits insert lines above (already happened once: parseCustomPreset shifted
// 448→449). bodySig is the trimmed catch body, stable across line shifts.
// Each entry: { file, bodySig, why }
const EXEMPT = [
  // solve-cache.js:79 — glm5.2 T7 F1 fix (11-01 ~23:55): a script URL that fails `new URL(s.src, baseURI)` is treated as cross-origin
  // and pushed as a sentinel — the fingerprint then falls back to URL-only for that entry, exactly the intended behaviour.
  // Not data-affecting: it only widens the hash inputs. Exempted per Claude host result 11-02 ~02:05 (frenchie, 11-02 ~01:00).
  { file: 'solve-cache.js', bodySig: 'cross.push(s.src);', why: 'engineVersion(): unparseable script src is classified cross-origin and hashed as a URL sentinel — deliberate fallback, not a swallowed error.' },
  // history.js — changedControls skips a control that throws on get()
  { file: 'history.js', bodySig: 'continue;', why: 'changedControls: if c.get() throws, the control is skipped in the diff display. Not data-affecting — only the change-description list is incomplete. The control itself still works.' },
  // solve-worker.js — GPU init fallback + preview drop
  { file: 'solve-worker.js', bodySig: 'return;', why: 'try { p = previewMsg(...) } catch (e) { return; } — "a malformed preview is dropped": the preview is display-only, never affects the solve result. (The gpuInit .catch(() => {}) on line 50 is a Promise method, not a catch block — the extractor does not find it; gpuReady falls back to CPU traceAsync.)' },
  // drive-anim.js — parseCustomPreset: user JSON preset input, returns null (= off) on parse failure
  { file: 'drive-anim.js', bodySig: 'return null;', why: 'try { j = JSON.parse(txt); } catch (e) { return null; } — parseCustomPreset parses user-provided endless preset JSON. Invalid JSON returns null (= off), the validated default. The function is called from src.tiles.custom; a null result means no custom preset, same as "off". Not data-affecting — the endless road uses the seeded biome walk instead.' },
  // endless-axis-config.js — safeJson: the endlessAxes settings JSON from storage or the scene tab.
  // Unparsable JSON means 'all axes auto' (the validated default) — the same fail-soft species as parseCustomPreset above.
  { file: 'endless-axis-config.js', bodySig: 'return {};', why: 'try { return JSON.parse(s); } catch (e) { return {}; } — safeJson parses user/stored endlessAxes settings. Invalid JSON returns {} which parse() fills with the all-auto defaults. Not data-affecting: the road falls back to the all-auto config; same species as drive-anim.js parseCustomPreset.' },
  // qwen3.8max review (B): the following 4 blocks were previously CONTROLLED via generic
  // comment-word patterns (gone, keep, none). Those patterns were removed because they
  // caused false negatives. These 4 are legitimate controlled catches — the comment
  // describes a specific expected condition — but the classifier can no longer see that
  // from the body text alone, so they are SILENT+exempt.
  { file: 'eurobeat.js', bodySig: '/* gone */', why: 'try { L.graph.master.disconnect(); } catch (e) { /* gone */ } — the master audio node may already be disconnected after a fade-out. Not data-affecting — the audio is stopping anyway.' },
  { file: 'history.js', bodySig: '/* keep */', why: 'try { if (!c.show({ scene: b })) continue; } catch (e) { /* keep */ } — c.show() throws, keep the control in the diff (hidden = follows another control). Not data-affecting — the control stays in the list.' },
  { file: 'solver-pool.js', bodySig: '/* gone */', why: 'try { w.terminate(); } catch (e) { /* gone */ } — the worker may already be terminated. Not data-affecting — the worker is being retired anyway.' },
  { file: 'ui.js', bodySig: '/* none */', why: 'try { recs = RF.Modes.recommend(...); } catch (e) { /* none */ } — recommend() throws, no recommendations available. Not data-affecting — recs stays empty, the UI shows no recommendations.' },
];

// ---- run the audit ----
const allBlocks = [];
const silentBlocks = [];

for (const file of files) {
  const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
  const blocks = extractCatchBlocks(src);
  const lines = src.split('\n');
  for (const block of blocks) {
    let line = 1, pos = 0;
    while (pos < block.start && line <= lines.length) {
      const next = lines[line - 1].length + 1;
      if (pos + next > block.start) break;
      pos += next;
      line++;
    }
    const cls = classify(block.body, block.tryBody, block.varName);
    const bodySig = block.body.trim();   // qwen3.8max review (A): stable signature, not line number
    allBlocks.push({ file, line, cls, varName: block.varName, body: bodySig.substring(0, 80) });
    if (cls === 'SILENT') silentBlocks.push({ file, line, bodySig: bodySig.substring(0, 80) });
  }
}

// ---- check: every SILENT block must be in the exemption list ----
// qwen3.8max review (A): key on { file, bodySig } not { file, line }
const exemptKeys = EXEMPT.map(e => `${e.file}:${e.bodySig}`);
const unexemptedSilent = [];
for (const s of silentBlocks) {
  const key = `${s.file}:${s.bodySig}`;
  if (!exemptKeys.includes(key)) unexemptedSilent.push(s);
}
ok('every SILENT catch-and-ignore block is in the exemption list',
  unexemptedSilent.length === 0,
  unexemptedSilent.length ? 'UNEXEMPTED SILENT: ' + unexemptedSilent.map(s => `${s.file}:${s.line} — ${s.bodySig}`).join('; ') : `${silentBlocks.length} silent blocks, all exempt`);

// ---- check: every exemption must match an actual SILENT block (not stale) ----
const silentKeys = [...new Set(silentBlocks.map(s => `${s.file}:${s.bodySig}`))];
const staleExempt = exemptKeys.filter(k => !silentKeys.includes(k));
ok('no exemption is stale (every exemption matches an actual SILENT catch block)',
  staleExempt.length === 0,
  staleExempt.length ? 'stale exemptions: ' + staleExempt.join(', ') : 'all exemptions active');

// ---- summary: classification breakdown ----
const byClass = {};
for (const b of allBlocks) byClass[b.cls] = (byClass[b.cls] || 0) + 1;
console.log(`\ncatch block audit: ${allBlocks.length} total — ${Object.entries(byClass).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

// ---- spot-check: the specific files frenchie flagged ----
const flagged = [
  { file: 'state.js', desc: 'saveLocal/loadLocal — localStorage guards' },
  { file: 'history.js', desc: 'changedControls — control get/show failures skipped' },
  { file: 'solver-host.js', desc: 'wake/loadSources/bundle — audio, worker, fetch guards' },
  { file: 'solver-pool.js', desc: 'retire/spawn/request/map — worker lifecycle guards' },
  { file: 'solve-worker.js', desc: 'gpuReady/preview — GPU init and preview guards' },
];
for (const f of flagged) {
  const blocks = allBlocks.filter(b => b.file === f.file);
  ok(`${f.file} catch blocks audited (${f.desc})`, blocks.length > 0, `${blocks.length} blocks: ${blocks.map(b => b.cls).join(', ')}`);
}

// ---- negative controls: the classifier must classify correctly ----
ok('negative control: bare `catch (e) {}` → SILENT', classify('', 'try-body', 'e') === 'SILENT', '');
ok('negative control: `catch (e) { throw e; }` → RE-THROW', classify('throw e;', 'try-body', 'e') === 'RE-THROW', '');
ok('negative control: `catch (e) { reject(e); }` → REJECT', classify('reject(e);', 'try-body', 'e') === 'REJECT', '');
ok('negative control: `catch (e) { notice(e.message); }` → NOTICE', classify('notice(e.message);', 'try-body', 'e') === 'NOTICE', '');
ok('negative control: `catch (e) { /* gone */ }` → SILENT (not CONTROLLED)', classify('/* gone */', 'try-body', 'e') === 'SILENT', '');   // qwen3.8max review (C): was CONTROLLED via generic 'gone' pattern, now SILENT
ok('negative control: `catch (e) { /* none */ }` → SILENT (not CONTROLLED)', classify('/* none */', 'try-body', 'e') === 'SILENT', '');   // qwen3.8max review (C): was CONTROLLED via generic 'none' pattern, now SILENT
ok('negative control: `catch (e) { return null; }` with console.log in try → SILENT (not CONTROLLED)', classify('return null;', 'console.log("dbg")', 'e') === 'SILENT', '');   // qwen3.8max review (C): was CONTROLLED via console.log in tryBody, now SILENT
ok('negative control: localStorage try + `catch (e) { /* ignore */ }` → STORAGE', classify('/* ignore */', 'localStorage.getItem("x")', 'e') === 'STORAGE', '');
