/* Eurobeat loop for the Mountain pass game: our own procedural music, built live in WebAudio.
   155 BPM, A minor, chords Am-F-G-Am (one per bar), a 16-bar seeded lead hook.
   pattern(bar) is pure note data (times in beats) so it can be tested without an AudioContext.
   Only unlock() creates an AudioContext, and only the game UI calls it, from a click handler. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});
  const BPM = 155, BEATS = 4, LOOP = 16, MASTER = 0.25, FADE = 0.3, LOOKAHEAD = 0.1, TICK_MS = 25;
  const BAR_SEC = BEATS * 60 / BPM;
  const MINOR = [0, 2, 3, 5, 7, 8, 10];                       // natural minor, semitones above A
  const CHORD_BARS = [                                         // bass roots (MIDI): Am, F, G, Am
    { name: 'Am', root: 33 }, { name: 'F', root: 29 }, { name: 'G', root: 31 }, { name: 'Am', root: 33 }];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  // Seeded 16-bar lead hook: an eighth-note walk over two octaves of A minor (MIDI 69 = A4).
  const HOOK = (function () {
    const rng = mulberry32(0x1d0c4), STEPS = [-2, -1, -1, 1, 1, 2, 3, -3, -2], out = [];
    let deg = 4;
    for (let b = 0; b < LOOP; b++) {
      const bar = [];
      for (let i = 0; i < 8; i++) {
        deg = Math.min(9, Math.max(0, deg + STEPS[Math.floor(rng() * STEPS.length)]));
        bar.push(69 + MINOR[deg % 7] + 12 * Math.floor(deg / 7));
      }
      out.push(bar);
    }
    return out;
  })();

  // Pure data. Times are in beats from the start of the bar (4 beats per bar).
  function pattern(bar) {
    const b = ((Math.floor(bar) % LOOP) + LOOP) % LOOP, c = CHORD_BARS[b % 4];
    return {
      bar: b,
      chord: c.name,
      kick: [0, 1, 2, 3],
      hats: [0.5, 1.5, 2.5, 3.5],
      bass: [0.5, 1.5, 2.5, 3.5].map((beat) => ({ beat, dur: 0.5, midi: c.root + 12 })),
      lead: HOOK[b].map((midi, i) => ({ beat: i * 0.5, dur: 0.45, midi })),
    };
  }

  const done = (node, end) => { node.__end = end; return node; };
  const noiseCache = new WeakMap();
  function noiseBuf(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0), r = mulberry32(99);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      noiseCache.set(ctx, buf);
    }
    return buf;
  }
  function noiseHit(ctx, dest, t, dur, type, freq, peak) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf(ctx); f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + dur + 0.01);
    return [done(s, t + dur + 0.01)];
  }
  function kick(ctx, dest, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.36);
    return [done(o, t + 0.36)].concat(noiseHit(ctx, dest, t, 0.008, 'highpass', 3000, 0.35));
  }
  function adsr(g, t, dur, peak, sustain, release) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + 0.008);
    p.exponentialRampToValueAtTime(sustain, t + 0.09); p.setValueAtTime(sustain, t + dur);
    p.exponentialRampToValueAtTime(0.0001, t + dur + release);
  }
  function bass(ctx, dest, t, dur, midi) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), end = t + dur + 0.05;
    o.type = 'sawtooth'; o.frequency.value = mtof(midi);
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3;
    adsr(g, t, dur, 0.2, 0.12, 0.04);
    o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(end);
    return [done(o, end)];
  }
  // One lead note: three slightly detuned saws through a low-pass and an ADSR, into the delay bus.
  function lead(ctx, dest, t, dur, midi) {
    const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain(), end = t + dur + 0.15, out = [];
    lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 0.7;
    lp.connect(g).connect(dest);
    for (const cents of [-9, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
      o.connect(lp); o.start(t); o.stop(end); out.push(done(o, end));
    }
    adsr(g, t, dur, 0.22, 0.14, 0.12);
    return out;
  }
  // Drums go straight to the master; lead goes through a dotted-eighth delay (feedback 0.3).
  function makeGraph(ctx, dest, t0, bpm) {
    const master = ctx.createGain(), drums = ctx.createGain(), leadBus = ctx.createGain();
    const delay = ctx.createDelay(1.0), fb = ctx.createGain(), wet = ctx.createGain();
    master.gain.setValueAtTime(0, t0); master.gain.linearRampToValueAtTime(MASTER, t0 + FADE);
    master.connect(dest);
    drums.gain.value = 0.9; drums.connect(master);
    leadBus.gain.value = 0.5; leadBus.connect(master); leadBus.connect(delay);
    delay.delayTime.value = 0.75 * 60 / bpm; delay.connect(fb); fb.connect(delay); fb.gain.value = 0.3;
    delay.connect(wet); wet.gain.value = 0.25; wet.connect(master);
    return { master, drums, lead: leadBus };
  }
  // Every note of one bar, at absolute time `when`. only === 'kick' schedules just the kick (for the tempo test).
  function scheduleBar(ctx, g, when, bar, bpm, only) {
    const p = pattern(bar), spb = 60 / bpm, at = (beat) => when + beat * spb, out = [];
    for (const beat of p.kick) out.push(...kick(ctx, g.drums, at(beat)));
    if (only === 'kick') return out;
    for (const beat of p.hats) out.push(...noiseHit(ctx, g.drums, at(beat), 0.05, 'highpass', 7000, 0.06));
    for (const n of p.bass) out.push(...bass(ctx, g.drums, at(n.beat), n.dur * spb, n.midi));
    for (const n of p.lead) out.push(...lead(ctx, g.lead, at(n.beat), n.dur * spb, n.midi));
    return out;
  }
  // Offline render for tests and for checking the sound: schedules `bars` bars from t0 into dest.
  function render(ctx, dest, t0, bars, opts) {
    const o = opts || {}, bpm = o.bpm || BPM, graph = makeGraph(ctx, dest, t0, bpm);
    for (let b = 0; b < bars; b++) scheduleBar(ctx, graph, t0 + FADE + b * BEATS * 60 / bpm, b % LOOP, bpm, o.only || null);
  }

  // Live playback. ctx is created by unlock() only; start() never creates one.
  let ctx = null, live = null;
  function unlock() {
    try {
      if (!ctx) { const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return false; ctx = new AC(); }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return true;
    } catch (e) { return false; }
  }
  function fill() {
    if (!live || !ctx) return;
    const now = ctx.currentTime;
    while (live.next < now + LOOKAHEAD) {
      live.nodes.push(...scheduleBar(ctx, live.graph, live.next, live.bar % LOOP, BPM));
      live.next += BAR_SEC; live.bar++;
    }
    live.nodes = live.nodes.filter((n) => n.__end > now);
  }
  function start() {
    if (!ctx) return false;
    if (live) return true;
    const t0 = ctx.currentTime + 0.05;
    live = { graph: makeGraph(ctx, ctx.destination, t0, BPM), nodes: [], next: t0 + FADE, bar: 0, timer: 0 };   // first bar after the fade-in, so the downbeat is not muted
    live.timer = setInterval(fill, TICK_MS);
    fill();
    return true;
  }
  function stop() {
    if (!live || !ctx) { live = null; return; }
    const L = live; live = null; clearInterval(L.timer);
    const now = ctx.currentTime, stopAt = now + FADE + 0.02, p = L.graph.master.gain;
    p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + FADE);
    for (const n of L.nodes) { try { n.stop(stopAt); } catch (e) { /* already ended */ } }
    setTimeout(() => { try { L.graph.master.disconnect(); } catch (e) { /* gone */ } }, (FADE + 0.1) * 1000);
  }
  const playing = () => !!live;

  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) stop(); });
  }
  RF.Eurobeat = { BPM, BAR_SEC, LOOP, pattern, render, unlock, start, stop, playing };
})(typeof globalThis !== 'undefined' ? globalThis : this);
