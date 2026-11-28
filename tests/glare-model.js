// glare-model (hdr-spike port, 11-27, Anya): the perceptual glare model's registry entries, presets and CPU-side maths.
// The GPU frames (off equals the lander, a model set up as "current" reproduces it, off after on, reduced motion) are tests/regress/GM-glare-model.js.
const path = require('path');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js')), D = RF.Drive;

// registry
const ids = Opt.GLARE_PARAMS.map((p) => p.id), entries = Opt.OPTIONS.filter((e) => e.id === 'glareModel' || ids.includes(e.id));
ok('registry: glareModel plus one entry per knob', entries.length === ids.length + 1, entries.length);
ok('registry: every entry is extra (no DV_DEF change, an untouched profile stays as it was)', entries.every((e) => e.kind === 'extra' && e.default === undefined));
ok('registry: every knob is gated on the model being on', entries.filter((e) => e.id !== 'glareModel').every((e) => (e.requires || []).some((r) => r.rule === 'glareModelOn')));
ok('registry: the knobs read as unmet with no model, met with one', Opt.unmet('gmTailBeta', {}, {}).length === 1 && Opt.unmet('gmTailBeta', { glareModel: 'perceptual' }, {}).length === 0);
ok('registry: preset bundles only write known knobs', Object.values(Opt.GLARE_MODELS).every((b) => Object.keys(b).every((k) => ids.includes(k))));
ok('registry: numeric defaults sit inside their ranges', Opt.GLARE_PARAMS.filter((p) => p.type === 'number').every((p) => p.def >= p.min && p.def <= p.max));
ok('registry: the perceptual preset is the spike\'s Anya Moffat tune (alpha 0.15, beta 1.5, 74 spokes, gain 106.4, veil off)',
  Opt.GLARE_MODELS.perceptual.gmTailAlpha === 0.15 && Opt.GLARE_MODELS.perceptual.gmTailBeta === 1.5 && Opt.GLARE_MODELS.perceptual.gmSpikeCount === 74 && Opt.GLARE_MODELS.perceptual.gmSpikeGain === 106.4 && Opt.GLARE_MODELS.perceptual.gmVeil === 'off');

// resolution
ok('model: unset and current give null (the drive as before)', D.glareModelGPU({}) === null && D.glareModelGPU({ glareModel: 'current' }) === null && D.glareModelGPU({ glareModel: 'bogus' }) === null);
const g = D.glareModelGPU(Object.assign({ glareModel: 'perceptual' }, Opt.GLARE_MODELS.perceptual));
ok('model: perceptual resolves tail and starburst on, bloom off', g && g.tail && g.spike && !g.bloom && g.veil === 0);
const gr = D.glareModelGPU(Object.assign({ glareModel: 'perceptual' }, Opt.GLARE_MODELS.perceptual), true);
ok('model: reduced motion turns the tail and the starburst off (Anya 11-27: play it safe)', gr && !gr.tail && !gr.spike);
ok('model: a stored knob wins over the default', Opt.glareParamsOf({ gmTailBeta: 1.3 }).gmTailBeta === 1.3 && Opt.glareParamsOf({}).gmTailBeta === 1.5);

// veil formulas
const sh = Opt.glareParamsOf({ gmVeilFloor: 1 }), cie = Opt.glareParamsOf({ gmVeilLaw: 'cie146', gmAge: 35, gmPigment: 0.5, gmVeilFloor: 0.1 });
ok('veil: Stiles-Holladay with a 1° floor equals veilAt (the drive today)', [0.2, 1, 3, 10].every((t) => {
  const c = Math.cos(t * Math.PI / 180), s = Math.sin(t * Math.PI / 180), src = [[c, s, 0, 2.5]];
  return Math.abs(D.veilModelAt([1, 0, 0], src, sh) - D.veilAt([1, 0, 0], src)) < 1e-9 * Math.max(1, D.veilAt([1, 0, 0], src));
}));
const hand = (t) => 10 / t ** 3 + (5 / t ** 2 + 0.05 / t) * (1 + (35 / 62.5) ** 4) + 2.5e-3 * 0.5;
ok('veil: CIE 146 general matches the hand formula at 1°, 5°, 30°', [1, 5, 30].every((t) => Math.abs(D.veilPsi(t, cie) - hand(t)) < 1e-9 * hand(t)));
ok('veil: CIE 146 rises with age', D.veilPsi(5, Opt.glareParamsOf({ gmVeilLaw: 'cie146', gmAge: 70 })) > D.veilPsi(5, Opt.glareParamsOf({ gmVeilLaw: 'cie146', gmAge: 25 })));

// starburst table
const gp = Opt.glareParamsOf(Opt.GLARE_MODELS.perceptual), t1 = D.spokeTable(gp), t2 = D.spokeTable(gp);
ok('spokes: the table is deterministic for one seed', t1.every((v, i) => v === t2[i]));
let mono = true; for (let b = 1; b < D.GM_BINS; b++) if (t1[2 * b] < t1[2 * (b - 1)]) mono = false;
ok('spokes: the running sum never falls (the shader averages arcs from it)', mono);
ok('spokes: length factors stay in (0, 1]', Array.from({ length: D.GM_BINS }, (_, b) => t1[2 * b + 1]).every((v) => v > 0 && v <= 1 + 1e-6));
ok('spokes: another seed gives another pattern and another key', D.spokeKey(gp) !== D.spokeKey(Object.assign({}, gp, { gmSpikeSeed: 8 })) && D.spokeTable(Object.assign({}, gp, { gmSpikeSeed: 8 }))[2 * 100] !== t1[2 * 100]);

// adaptation
const st = { k: 0.1 };
ok('adapt: no taus = the old constants, exactly', D.adaptStep(st, 0.4, 0.1).k === D.adaptStep(st, 0.4, 0.1, undefined).k && D.adaptStep(st, 0.4, 0.1, { down: D.ADAPT_DOWN_S, up: D.ADAPT_UP_S }).k === D.adaptStep(st, 0.4, 0.1).k);
ok('adapt: a longer recovery recovers more slowly', D.adaptStep(st, 0.4, 0.1, { down: 0.4, up: 20 }).k < D.adaptStep(st, 0.4, 0.1).k);

ok('gate: NODE registers this test', (() => {
  const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tests', 'gate.js'), '--list-node-all'], { encoding: 'utf8' });
  return out.includes('node:glare-model');
})());
console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
