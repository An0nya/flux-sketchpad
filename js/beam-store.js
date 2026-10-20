// BI1: the beam library's durable store, a promise wrapper over IndexedDB. One database 'flux-beams', one object store
// 'beams', keyed by beam id. A record holds the full-resolution table as a Float32Array (structured clone keeps typed
// arrays as they are, so nothing is base64'd or coarsened). Nothing here throws synchronously: a missing, blocked or
// throwing IndexedDB rejects the promise, and the caller keeps the beam for this session and says so.
const R = (typeof RF !== 'undefined' && RF) || (globalThis.RF = globalThis.RF || {});
(function () {
  const DB_NAME = 'flux-beams', STORE = 'beams', VERSION = 1;
  let dbP = null;
  function open() {
    if (dbP) return dbP;
    dbP = new Promise((resolve, reject) => {
      let req;
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
        req = indexedDB.open(DB_NAME, VERSION);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open was blocked'));
    });
    dbP.catch(() => { dbP = null; });   // a failed open is retried on the next call
    return dbP;
  }
  // runs one request in one transaction; resolves with the request's result when the transaction completes
  function run(mode, makeRequest) {
    return open().then((db) => new Promise((resolve, reject) => {
      let t, req;
      try { t = db.transaction(STORE, mode); req = makeRequest(t.objectStore(STORE)); }
      catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || (req && req.error) || new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    }));
  }
  const store = {
    // true when the database opens; false (never a throw) when it does not
    available: () => open().then(() => true, () => false),
    get: (id) => run('readonly', (s) => s.get(id)),
    getAll: () => run('readonly', (s) => s.getAll()),
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
    clear: () => run('readwrite', (s) => s.clear()),
    // durable storage: asked once for; the answer is what the library manager shows. Feature-detected, never throws.
    persist: async () => { try { return !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) { return false; } },
    persisted: async () => { try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch (e) { return false; } },
    // { usage, quota } in bytes, or null when the browser does not say
    estimate: async () => { try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; } },
  };
  R.BeamStore = store;
})();
