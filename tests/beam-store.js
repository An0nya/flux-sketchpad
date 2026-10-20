// BI1: the beam store (js/beam-store.js) over a small in-memory IndexedDB shim. Node tests/beam-store.js, exits 1 on any failure.
// The shim covers only what the wrapper touches: open (with upgrade, blocked, error), one object store, transactions that
// complete after their requests, get/put/delete/getAll/clear. Records are structured-cloned, as a real store does, so typed
// arrays come back as typed arrays with the same bits. The page test (tests/regress/BI-beam-indexeddb.js) is the real-browser proof.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load } = require('./load.js'); const RF = load();
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'beam-store.js'), 'utf8');
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const tick = () => new Promise((r) => setImmediate(r));

// a fake IndexedDB: dbs[name] = { stores: { beams: Map } }
function fakeIndexedDB(opts) {
  const dbs = {};
  return {
    dbs,
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setImmediate(() => {
        if (opts && opts.openError) { req.error = new Error('open refused'); req.onerror && req.onerror(); return; }
        if (opts && opts.blocked) { req.onblocked && req.onblocked(); return; }
        const fresh = !dbs[name]; const db = dbs[name] || (dbs[name] = { stores: {} });
        const names = { contains: (s) => !!db.stores[s], get length() { return Object.keys(db.stores).length; } };
        const handle = { objectStoreNames: names, createObjectStore(s) { db.stores[s] = new Map(); return {}; },
          transaction(store) { return fakeTransaction(db, store); } };
        req.result = handle;
        if (fresh) { req.onupgradeneeded && req.onupgradeneeded(); }
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}
function fakeTransaction(db, store) {
  const map = db.stores[store]; if (!map) throw new Error('no such store ' + store);
  const t = { error: null, oncomplete: null, onerror: null, onabort: null, pending: 0 };
  const finish = () => { if (t.pending === 0) setImmediate(() => t.oncomplete && t.oncomplete()); };
  t.objectStore = () => ({
    _req(fn) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      t.pending++;
      setImmediate(() => { try { req.result = fn(); } catch (e) { req.error = e; } t.pending--; req.onsuccess && req.onsuccess(); finish(); });
      return req;
    },
    get(id) { return this._req(() => (map.has(id) ? structuredClone(map.get(id)) : undefined)); },
    getAll() { return this._req(() => [...map.values()].map((v) => structuredClone(v))); },
    put(rec) { return this._req(() => { map.set(rec.id, structuredClone(rec)); return rec.id; }); },
    delete(id) { return this._req(() => { map.delete(id); return undefined; }); },
    clear() { return this._req(() => { map.clear(); return undefined; }); },
  });
  return t;
}

// a fresh module instance over a given indexedDB (the module keeps its database handle per instance)
function freshStore(idb) {
  // the source reads indexedDB as a global and attaches to the shared RF; it is wrapped so each instance can re-run it
  if (idb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = idb;
  vm.runInThisContext('(function(){' + SRC + '\n})();', { filename: 'js/beam-store.js' });
  return globalThis.RF.BeamStore;
}

(async () => {
  // 1. round trip at full resolution: a Float32Array table comes back bit-for-bit with its grid
  const idb = fakeIndexedDB();
  const S = freshStore(idb);
  ok('store opens with the shim', (await S.available()) === true);
  const values = Float32Array.from({ length: 900 * 450 }, (_, i) => Math.sin(i * 0.001) * 1000 + (i % 7) * 1e-7);
  const rec = { id: 'b1', name: 'full', beamKind: 'low', conv: 'A', colour: { cct: 4300, rgb: [1, 0.8, 0.6] }, coarse: false, grid: { h0: -30, v0: -10, step: 0.1, nh: 900, nv: 450 }, values };
  await S.put(rec);
  const back = await S.get('b1');
  const same = back && back.values instanceof Float32Array && back.values.length === values.length && Buffer.compare(Buffer.from(back.values.buffer), Buffer.from(values.buffer)) === 0;
  ok('put then get: 900x450 table at 0.1 deg comes back bit-for-bit', same, { len: back && back.values && back.values.length });
  ok('put then get: grid and colour round trip', back.grid.step === 0.1 && back.grid.nh === 900 && back.colour.cct === 4300 && back.colour.rgb[1] === 0.8, back && back.grid);

  // 2. more than one record: getAll returns all, delete removes one, clear empties
  await S.put({ ...rec, id: 'b2', name: 'second' });
  await S.put({ ...rec, id: 'b3', name: 'third' });
  ok('getAll returns every stored beam', (await S.getAll()).length === 3);
  await S.delete('b2');
  const left = (await S.getAll()).map((r) => r.id).sort();
  ok('delete removes one beam and keeps the others', JSON.stringify(left) === '["b1","b3"]', left);
  await S.clear();
  ok('clear removes every beam', (await S.getAll()).length === 0);
  ok('get of a missing id resolves undefined', (await S.get('nope')) === undefined);

  // 3. the same database reopens with its data (a second instance over the same fake store)
  const S2 = freshStore(idb);
  await S2.put({ ...rec, id: 'persist' });
  const S3 = freshStore(idb);
  ok('a second open of the same database sees the stored record', !!(await S3.get('persist')));

  // 4. no IndexedDB at all: nothing throws, available is false, writes reject
  const S4 = freshStore(undefined);
  let threw = false, avail4, put4 = 'resolved';
  try { avail4 = await S4.available(); put4 = await S4.put(rec).then(() => 'resolved', (e) => 'rejected: ' + e.message); } catch (e) { threw = true; }
  ok('no IndexedDB: available() false, put rejects, nothing throws', !threw && avail4 === false && put4.startsWith('rejected'), { avail4, put4 });

  // 5. indexedDB getter that throws (private mode, blocked storage): same, no synchronous throw
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('storage blocked'); } });
  vm.runInThisContext('(function(){' + SRC + '\n})();', { filename: 'js/beam-store.js' });
  const S5 = globalThis.RF.BeamStore; let threw5 = false, avail5, put5;
  try { avail5 = await S5.available(); put5 = await S5.put(rec).then(() => 'resolved', (e) => 'rejected'); } catch (e) { threw5 = true; }
  ok('throwing indexedDB getter: available() false, put rejects, nothing throws', !threw5 && avail5 === false && put5 === 'rejected', { avail5, put5 });
  delete globalThis.indexedDB;

  // 6. open refused (error event) and blocked: rejects, does not hang
  const S6 = freshStore(fakeIndexedDB({ openError: true }));
  ok('open error: available() false', (await S6.available()) === false);
  const S7 = freshStore(fakeIndexedDB({ blocked: true }));
  ok('open blocked: available() false, does not hang', (await S7.available()) === false);

  // 7. durable storage helpers never throw (no navigator.storage in Node)
  ok('persist() without navigator.storage resolves false', (await S.persist()) === false);
  ok('estimate() without navigator.storage resolves null', (await S.estimate()) === null);

  // the shared RF from load.js is untouched by the instances above
  ok('the shared RF namespace is the one the instances attached to', globalThis.RF === RF && typeof RF.BeamStore.put === 'function');
  console.log(fails ? fails + ' FAILED of ' + n : 'all ' + n + ' beam-store checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('FAIL', e.stack || e); process.exitCode = 1; });
