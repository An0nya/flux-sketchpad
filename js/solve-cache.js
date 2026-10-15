/* solve-cache.js — opt-in browser solve memo, and the separate pinned design. No solver API changes. */
(function (root) {
  'use strict';
  const RF = root.RF, VERSION = 'solve-cache/1', MAX_BYTES = 32 * 1024 * 1024, MAX_ENTRIES = 40;
  let dbp, enginep, bypass = false, status = '', generation = 0;
  const prefs = {};
  const pref = (k) => { if (k in prefs) return prefs[k]; try { return localStorage.getItem('flux/cache/' + k) === '1'; } catch (e) { return false; } };
  const setPref = (k, v) => { prefs[k] = !!v; try { localStorage.setItem('flux/cache/' + k, v ? '1' : '0'); } catch (e) { status = 'Cache preference applies this session; browser preference storage unavailable.'; } };
  const canonical = (x) => {
    if (typeof x === 'number' && !isFinite(x)) return JSON.stringify(String(x));
    if (!x || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x) || ArrayBuffer.isView(x)) return '[' + Array.from(x, canonical).join(',') + ']';
    return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  };
  const bytes = (x) => new TextEncoder().encode(canonical(x)).byteLength;
  async function hash(x) { const b = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(x))); return Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, '0')).join(''); }
  function open() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const r = indexedDB.open('flux-designs', 2);
      r.onupgradeneeded = () => {
        const s = r.result.objectStoreNames.contains('solves') ? r.transaction.objectStore('solves') : r.result.createObjectStore('solves', { keyPath: 'key' });
        if (!s.indexNames.contains('used')) s.createIndex('used', 'used');
        if (!r.result.objectStoreNames.contains('pins')) r.result.createObjectStore('pins');
      };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; resolve(r.result); };
      r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('browser storage upgrade blocked'));
    });
    return dbp;
  }
  async function transaction(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), s = tx.objectStore(store); let result;
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('browser storage failed'));
      fn(s, (v) => { result = v; });
    });
  }
  // Keep a cleared record too: a reload before the scene's debounced autosave must not resurrect an old embedded A.
  const pin = (scene) => transaction('pins', 'readwrite', (s) => s.put({ version: 1, scene: scene || null }, 'A'));
  const pinned = () => transaction('pins', 'readonly', (s, done) => { s.get('A').onsuccess = (e) => done(e.target.result); });
  // A strictly increasing access order, including requests from other tabs and accesses within the same millisecond.
  const stamp = (s, done) => { s.index('used').openCursor(null, 'prev').onsuccess = (e) => done(Math.max(Date.now(), e.target.result ? e.target.result.value.used + 1 : 0)); };
  async function get(key) {
    return transaction('solves', 'readwrite', (s, done) => { s.get(key).onsuccess = (e) => { const row = e.target.result; if (!row) { done(null); return; } stamp(s, (used) => { row.used = used; s.put(row); done(row.output); }); }; });
  }
  // Pure eviction policy also exercised in Node; the transaction serialises concurrent cache writers.
  function victims(rows, maxBytes, maxEntries) {
    const sorted = rows.slice().sort((a, b) => a.used - b.used || a.key.localeCompare(b.key)), out = [];
    let total = sorted.reduce((n, r) => n + r.bytes, 0), count = sorted.length;
    for (const r of sorted) { if (total <= maxBytes && count <= maxEntries) break; out.push(r.key); total -= r.bytes; count--; }
    return out;
  }
  async function put(key, output) {
    const n = bytes(output) + key.length * 2 + 128; if (n > MAX_BYTES) return false;
    await transaction('solves', 'readwrite', (s) => {
      stamp(s, (used) => {
        s.put({ key, output, bytes: n, used });
        s.getAll().onsuccess = (e) => { for (const k of victims(e.target.result, MAX_BYTES, MAX_ENTRIES)) s.delete(k); };
      });
    });
    return true;
  }
  const clear = () => transaction('solves', 'readwrite', (s) => s.clear());
  // Worker code (including loaded files) can hide a clock behind a helper: require the owner's opt-in for all of it.
  // For page solvers, clock/random/delegation references are also uncertain (even progress-only clocks).
  function timed(def) {
    const src = def.cacheSource || String(def.solve);
    return !!def.worker || /\bDate\b|\bperformance\b|Math\s*\.\s*random|budget\s*(?:\.\s*ms|\[)|RF\s*\.\s*Solvers\s*\.\s*get/.test(src);
  }
  async function engineVersion() {
    if (!enginep) enginep = (async () => {
      const files = new Set((root.RF_SOLVER_ENV || []).map((f) => 'js/' + f + '.js'));
      for (const f of ['solver-env', 'solve-worker', 'solver-pool', 'solver-pool-worker', 'gpu-trace', 'solver-host', 'solve-cache']) files.add('js/' + f + '.js');
      for (const s of document.scripts) if (s.src) files.add(s.src);
      const srcs = await Promise.all([...files].sort().map(async (f) => { const r = await fetch(new URL(f, document.baseURI), { cache: 'no-store' }); if (!r.ok) throw new Error('cannot fingerprint ' + f); return [f, await r.text()]; }));
      return hash(srcs);
    })();
    return enginep;
  }
  async function keyOf(r, engine, host) {
    const registry = RF.Solvers.list().map((d) => [d.id, d.version, d.cacheSource || String(d.solve)]).sort((a, b) => a[0].localeCompare(b[0]));
    return VERSION + '/' + await hash({ engine, registry, input: r.input, problem: r.tools.scene, id: r.id, version: r.def.version, settings: r.settings, seed: r.input.seed, host });
  }
  async function solve(r, run) {
    const force = bypass, gen = generation; bypass = false;
    const checkedRun = () => { if (gen !== generation) throw Object.assign(new Error('solve replaced during cache lookup'), { aborted: true, kind: 'replaced' }); return run(); };
    if (!pref('enabled')) return { output: await checkedRun(), fromCache: false };
    if (timed(r.def) && !pref('timed')) { status = 'Cache skipped: worker or clock-dependent/uncertain solver; opt in below.'; return { output: await checkedRun(), fromCache: false }; }
    let key;
    try {
      const h = RF.SolverHost, host = { ms: h ? h.limitMs() : null, threads: h ? h.threads() : 0, gpu: RF.GpuTrace ? RF.GpuTrace.userChoice() : null };
      key = await keyOf(r, await engineVersion(), host);
      const output = !force && await get(key);
      if (output && !RF.Solvers.verify(r.tools.scene, output).errors.length) { status = 'From cache — saved surfaces; trace statistics are recomputed.'; if (gen !== generation) throw Object.assign(new Error('solve replaced during cache lookup'), { aborted: true, kind: 'replaced' }); return { output, fromCache: true }; }
      status = force ? 'Re-solving anyway…' : 'Cache miss — solving…';
    } catch (e) { if (e.aborted) throw e; status = 'Cache unavailable: ' + e.message + '. Solving normally.'; }
    const output = await checkedRun();
    if (key && !RF.Solvers.verify(r.tools.scene, output).errors.length) {
      try { const saved = await put(key, output); status = saved ? 'Solved; saved in browser cache.' : 'Solved; result exceeds the 32 MiB cache cap (not stored).'; } catch (e) { status = 'Solved; cache write failed: ' + e.message; }
    }
    return { output, fromCache: false };
  }
  RF.SolveCache = { cancelPending: () => { generation++; }, enabled: () => pref('enabled'), setEnabled: (v) => setPref('enabled', v), timedEnabled: () => pref('timed'), setTimed: (v) => setPref('timed', v), bypass: () => { bypass = true; }, status: () => status, solve, keyOf, canonical, hash, bytes, victims, timed, get, put, clear, pin, pinned, MAX_BYTES, MAX_ENTRIES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
