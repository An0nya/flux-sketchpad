// Eurobeat pattern data (pure, no AudioContext): node tests/eurobeat.js — exits 1 on any failure.
// The audio itself (kick spacing, RMS, peak, start/stop) is checked in the browser: tests/regress/EB-eurobeat.js.
const { load } = require('./load.js');

function run(RF, ok) {
  const E = RF.Eurobeat, J = JSON.stringify;
  const bars = Array.from({ length: E.LOOP }, (_, i) => i);
  const SCALE = [0, 2, 3, 5, 7, 8, 10];                       // A natural minor, pitch classes relative to A

  ok('pattern is deterministic (two calls give identical data)',
    bars.every((b) => J(E.pattern(b)) === J(E.pattern(b))));

  ok('kick falls on every beat in every bar (0, 1, 2, 3)',
    bars.every((b) => J(E.pattern(b).kick) === '[0,1,2,3]'));

  const bassBeats = bars.flatMap((b) => E.pattern(b).bass.map((n) => n.beat));
  ok('bass sits only on off-beats (x.5), four per bar',
    bassBeats.length === E.LOOP * 4 && bassBeats.every((t) => t % 1 === 0.5),
    'off-beat count ' + bassBeats.length);

  const hatBeats = bars.flatMap((b) => E.pattern(b).hats);
  ok('hi-hat sits only on off-beats', hatBeats.every((t) => t % 1 === 0.5));

  const leads = bars.flatMap((b) => E.pattern(b).lead);
  ok('8 eighth-note lead notes per bar, all inside A minor',
    leads.length === E.LOOP * 8 && leads.every((n) => SCALE.includes((((n.midi - 9) % 12) + 12) % 12)),
    'notes ' + leads.length);

  ok('lead steps lie on eighth-note grid inside the bar (0..3.5 beats)',
    leads.every((n) => n.beat >= 0 && n.beat < 4 && (n.beat * 2) % 1 === 0));

  ok('16-bar loop repeats exactly: pattern(i + 16) equals pattern(i) for every bar',
    bars.every((b) => J(E.pattern(b + E.LOOP)) === J(E.pattern(b))));

  // Positive control for the loop check: the hook is NOT an 8-bar loop, so pattern(i + 8) must differ from pattern(i).
  ok('control: 8-bar period does not repeat (loop check can fail)',
    bars.slice(0, 8).some((b) => J(E.pattern(b + 8).lead) !== J(E.pattern(b).lead)));

  ok('chord cycle is Am-F-G-Am, one chord per bar, repeating every 4 bars',
    ['Am', 'F', 'G', 'Am'].every((c, i) => E.pattern(i).chord === c && E.pattern(i + 4).chord === c));
}

if (require.main === module) {
  let fail = 0;
  run(load(['eurobeat']), (name, cond, detail) => {
    console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
    if (!cond) fail++;
  });
  console.log(fail ? fail + ' FAILED' : 'all eurobeat pattern checks passed');
  process.exitCode = fail ? 1 : 0;
}
module.exports = { run };
