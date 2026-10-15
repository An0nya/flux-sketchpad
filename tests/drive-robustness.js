// RB: deterministic deadlines; no real clock, browser, or worker thread needed.
const fs = require('fs'), path = require('path'), vm = require('vm');
async function run(RF, ok) {
  function host(file, extra) {
    const timers = new Map(); let id = 0;
    const ctx = vm.createContext(Object.assign({ RF: { Drive: {} }, console, performance: { now: () => 0 }, setTimeout: (f) => { timers.set(++id, f); return id; }, clearTimeout: (k) => timers.delete(k) }, extra));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file + '.js'), 'utf8'), ctx);
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    return { ctx, timers, flush, async expire() { const e = timers.entries().next().value; if (!e) throw new Error('expected an armed deadline'); timers.delete(e[0]); e[1](); await flush(); } };
  }
  function fakePool(h, behavior) {
    const ws = [], seen = [], notices = [], inline = [];
    const spawn = () => { const n = ws.length, w = { dead: false, post(m) { seen.push({ n, m }); behavior(w, n, m); }, terminate() { w.dead = true; } }; ws.push(w); return w; };
    const pool = h.ctx.RF.SolverPool.create({ size: 2, spawn, deadlineMs: 10, maxRespawns: 2, run: (name, arg) => { inline.push(arg); return arg * 3; }, onNotice: (s) => notices.push(s) });
    return { pool, ws, seen, notices, inline };
  }
  const reply = (w, m) => Promise.resolve().then(() => w.onmessage(m.type === 'init' ? { rid: m.rid, ok: true } : { rid: m.rid, result: m.arg * 3, rays: 10 }));
  {
    const h = host('solver-pool'), f = fakePool(h, () => {}), p = f.pool.map('triple', [4, 2, 9]);
    await h.flush(); for (let i = 0; i < 4 && h.timers.size; i++) await h.expire();
    const out = await p;
    ok('RB solver silent initialization: two replacements then ordered CPU results, all workers terminated', JSON.stringify(out) === '[12,6,27]' && f.ws.length === 4 && f.ws.every((w) => w.dead) && h.timers.size === 0 && f.notices.some((s) => /caller CPU/.test(s)), JSON.stringify({ out, spawned: f.ws.length, inline: f.inline }));
    f.pool.close();
  }
  {
    const h = host('solver-pool'), f = fakePool(h, (w, n, m) => { if (n !== 0 || m.type === 'init') reply(w, m); });
    const p = f.pool.map('triple', [4, 2, 9, 1]); await h.flush(); await h.expire(); const out = await p;
    const old = f.seen.find((s) => s.n === 0 && s.m.type === 'task'), retried = f.seen.find((s) => s.n === 2 && s.m.type === 'task');
    f.ws[0].onmessage({ rid: old.m.rid, result: -999 });
    ok('RB solver task timeout retries only the missing task; completed tasks and late replies preserve order', JSON.stringify(out) === '[12,6,27,3]' && f.ws.length === 3 && old.m.arg === retried.m.arg && !f.inline.length && h.timers.size === 0, JSON.stringify({ out, retry: retried.m.arg }));
    f.pool.close();
  }
  {
    const h = host('solver-pool'); let w, spawned = 0;
    const pool = h.ctx.RF.SolverPool.create({ size: 1, spawn: () => { spawned++; return (w = { post(m) { Promise.resolve().then(() => w.onmessage(m.type === 'init' ? { rid: m.rid } : { rid: m.rid, error: 'bad task' })); }, terminate() {} }); }, run: () => -1 });
    const error = await pool.map('bad', [1]).then(() => '', (e) => e.message);
    ok('RB solver task exceptions stay errors, without retries or fabricated results', error === 'bad task' && spawned === 1 && h.timers.size === 0, error); pool.close();
  }
  {
    const h = host('solver-pool'), pool = h.ctx.RF.SolverPool.create({ size: 1, recovery: false, spawn: () => ({ post() {}, terminate() {} }) });
    const p = pool.map('hang', [1]).then(() => '', (e) => e.message); await h.flush();
    const noDeadline = h.timers.size === 0; pool.close();
    ok('RB recovery OFF has no deadline; closing a pending pool settles its promise', noDeadline && /closed/.test(await p) && h.timers.size === 0);
  }
  {
    RF = RF || require('./load.js').load();
    let lose; const buffers = [], lost = new Promise((resolve) => { lose = resolve; });
    const noop = () => {}, pass = { setPipeline: noop, setBindGroup: noop, dispatchWorkgroups: noop, end: noop };
    const dev = { lost, createShaderModule: () => ({}), createComputePipelineAsync: async () => ({ getBindGroupLayout: noop }),
      createBuffer: ({ size }) => { const b = { dead: false, mapAsync: async () => { lose({ reason: 'test' }); }, getMappedRange: () => new ArrayBuffer(size), unmap: noop, destroy() { b.dead = true; } }; buffers.push(b); return b; },
      createBindGroup: noop, createCommandEncoder: () => ({ clearBuffer: noop, beginComputePass: () => pass, copyBufferToBuffer: noop, finish: noop }), queue: { writeBuffer: noop, submit: noop } };
    const h = host('gpu-trace', { RF: { U: RF.U, Engine: RF.Engine }, navigator: { gpu: { requestAdapter: async () => ({ limits: {}, requestDevice: async () => dev }) } }, GPUBufferUsage: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, MAP_READ: 8 }, GPUMapMode: { READ: 1 } });
    const G = h.ctx.RF.GpuTrace; await G.init(); G.enable(true);
    const scene = RF.State.testScene(), prepared = RF.Engine.prepare(scene, []), ctx = RF.Engine.newCtx(prepared, 64, 8);
    const err = await new Promise((resolve) => G.step(ctx, 32, resolve));
    const unchanged = ctx.next === 0 && ctx.E.emitted === 0 && !ctx._gpuBusy && !!ctx.gpuError && !G.use(ctx);
    while (!ctx.done) RF.Engine.step(ctx, 100);
    const expected = RF.Engine.runSync(RF.Engine.prepare(scene, []), 64, 8);
    ok('RB GPU lost during readback: batch stays uncommitted (including CPU path samples), CPU finishes exact ledger', !!err && unchanged && JSON.stringify(ctx.E) === JSON.stringify(expected.E) && buffers.filter((b) => b.dead).length >= 4, JSON.stringify({ error: ctx.gpuError, next: ctx.next, ledger: ctx.E }));
  }
  function drive() {
    const ws = [], h = host('drive-anim', { Worker: function () { this.sent = []; this.dead = false; this.postMessage = (m) => this.sent.push(m); this.terminate = () => { this.dead = true; }; ws.push(this); } });
    const a = h.ctx.RF.DriveAnim._; a.V.info = { o: { mt: true } }; a.Wk.forced = 1; a.mt(); a.Wk.cfgId = 7; a.Wk.config = { type: 'cfg', id: 7 };
    a.Wk.busy = { seq: 11, next: 1, K: 1, done: 0, parts: [] };
    const msg = { type: 'job', seq: 11, c: 0, K: 1, wid: 0, dist: 32, t: 5, traffic: [{ id: 'same snapshot' }] };
    a.postJob(0, msg); return { h, a, ws, msg };
  }
  {
    const { h, a, ws, msg } = drive(); const old = ws[0]; await h.expire();
    const retry = ws[1].sent[1], same = JSON.stringify(retry) === JSON.stringify(msg);
    old.onmessage({ data: { type: 'rows', seq: 11, cfg: 7, c: 0, wid: 0, buf: new ArrayBuffer(0) } });
    const ignored = a.Wk.busy.done === 0;
    ws[1].onmessage({ data: { type: 'rows', seq: 11, cfg: 7, c: 0, wid: 0, buf: new ArrayBuffer(0) } });
    ok('RB Drive stalled job: terminate, configure replacement, resend exact pose/snapshot; retired replies ignored', old.dead && ws[1].sent[0].id === 7 && same && ignored && h.timers.size === 0 && !a.Wk.busy, JSON.stringify({ sent: ws[1].sent, restarts: a.Wk.restarts })); a.killWorkers();
  }
  {
    const { h, a, ws } = drive(); let settled = null; a.Wk.afterFrame = (done) => { settled = done; };
    await h.expire(); await h.expire(); await h.expire();
    ok('RB Drive permanent hang: respawn cap, CPU fallback notice, no pending timers or frame promise', ws.length === 3 && ws.every((w) => w.dead) && a.Wk.restarts === 2 && /limit/.test(a.Wk.failed) && /page traces/.test(a.V.why) && h.timers.size === 0 && settled === false, JSON.stringify({ spawned: ws.length, why: a.V.why }));
  }
  {
    const { h, a } = drive(); a.killWorkers();
    ok('RB leaving Drive cancels watchdogs instead of respawning a hidden view', h.timers.size === 0 && a.Wk.list.length === 0);
  }
  {
    const { h, a, ws } = drive(); let prevented = 0, redraws = 0;
    a.V.ui = { dvAnim: { view: 'anim', playing: true, popout: false }, redrawSpec() { redraws++; } };
    a.V.canvas = { hidden: false };
    a.contextLost({ preventDefault() { prevented++; } });
    const paused = !a.V.ui.dvAnim.playing && a.V.lost && a.V.canvas.hidden && ws.every((w) => w.dead);
    await h.expire();
    ok('RB graphics loss pauses and cancels work; missing restoration reaches CPU still with notice', prevented === 1 && paused && a.V.glFailed && a.V.ui.dvAnim.view === 'still' && /8 seconds/.test(a.V.why) && /CPU still/.test(a.V.why) && redraws > 0 && h.timers.size === 0, a.V.why);
  }
  {
    const { h, a } = drive();
    a.V.ui = { dvAnim: { view: 'anim', playing: false, popout: false }, redrawSpec() {} };
    a.V.canvas = { hidden: false, getContext: () => null };
    a.contextLost({ preventDefault() {} }); a.contextRestored();
    ok('RB graphics rebuild failure takes CPU still fallback and cancels restore deadline', a.V.glFailed && a.V.ui.dvAnim.view === 'still' && /rebuild failed/.test(a.V.why) && h.timers.size === 0, a.V.why);
  }

}
module.exports = { run };
if (require.main === module) { let fail = 0; run(null, (n, yes, detail) => { console.log((yes ? '[PASS] ' : '[FAIL] ') + n + (detail ? ' — ' + detail : '')); if (!yes) fail++; }).then(() => { process.exitCode = fail ? 1 : 0; }, (e) => { console.error(e); process.exitCode = 1; }); }
