/* drive-worker.js — one thread of the animated Drive view's object trace (drive-anim.js, "worker threads"). It has the same drive.js / drive-scenes.js / drive-anim.js as the page and no DOM.
 *   → { type: 'cfg', id, p, arc, src, act }                          the picture's recipe (camera, beam, scenery parameters; the scenery is rebuilt here: materials are functions)
 *   → { type: 'job', seq, dist, t, ss, act, c, K, ret, wid }          trace the tile rows ty % K === c of the frame at `dist` (act: which walkers/deer have started, and when); ret = a buffer handed back for reuse
 *   ← { type: 'rows', seq, cfg, wid, c, trows, buf, len, ms }         the traced rows, packed (buf is transferred)      | { type: 'err', message }                                  */
'use strict';
importScripts('core.js', 'road.js', 'drive.js', 'drive-scenes.js', 'drive-anim.js');
const T = self.RF.DriveAnim.tracer();
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'cfg') T.cfg(m);
    else if (m.type === 'job') { const r = T.job(m); self.postMessage(r, [r.buf]); }
  } catch (err) { self.postMessage({ type: 'err', message: String((err && err.stack) || err) }); }
};
