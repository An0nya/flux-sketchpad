// Scenario schema: a small hand validator with no dependencies. Used by tests/scenario/run.js and tests/scenario-node.js.
// A scenario is a JSON file that sets up one drive-view situation. See tests/scenario/README.md for the fields.
// The option keys are checked against the UI's own list: DV_DEF in js/spec-ui.js plus every key the UI passes to setDV.
// js/spec-ui.js needs the DOM, so Node cannot load it; DV_DEF is read from its source text instead (one line, checked below).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SCENES = ['road', 'forest', 'city'];
const TOP_KEYS = ['name', 'scene', 'seed', 'dist', 'pos', 'speed', 'options', 'beams', 'frames', 'capture', 'regions'];
// these live at top level only; putting them under options would be a second source of truth
const TOP_ONLY = ['scene', 'seed', 'speed', 'playing'];
// fractions of the frame, [x0, y0, x1, y1] with the origin at the top left
const DEFAULT_REGIONS = { sky: [0, 0, 1, 0.3], road: [0, 0.65, 1, 1], ahead: [0.4, 0.4, 0.6, 0.6], left: [0, 0.3, 0.4, 0.65], right: [0.6, 0.3, 1, 0.65] };
// enum-valued options that the drive view reads as strings
const ENUMS = { scatterMode: ['direct', 'table'], scatterRes: ['half', 'full'], scatterBlur: ['off', 'mid', 'strong'], scatterCache: ['on', 'off'] };

class ScenarioError extends Error {}

// DV_DEF is one line in js/spec-ui.js: "  const DV_DEF = { ... };"
function readDvDefaults(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'js', 'spec-ui.js'), 'utf8');
  const m = src.match(/const DV_DEF = (\{.*\});/);
  if (!m) throw new Error('scenario schema: could not find "const DV_DEF = {...};" on one line in js/spec-ui.js (it moved or changed shape; update readDvDefaults)');
  const defs = vm.runInNewContext('(' + m[1] + ')');
  if (!defs || typeof defs.wet !== 'boolean') throw new Error('scenario schema: DV_DEF did not parse as expected');
  return defs;
}

// every key the UI can set: DV_DEF plus the literal keys passed to setDV(ui, '...') in js/
function readOptionKeys(root = ROOT) {
  const keys = new Set(Object.keys(readDvDefaults(root)));
  const jsDir = path.join(root, 'js');
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/setDV\(ui, '(\w+)'/g)) keys.add(m[1]);
  }
  return keys;
}

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// Returns a normalized scenario (defaults filled in) or throws ScenarioError listing every problem.
// dv: the DV_DEF defaults (readDvDefaults()); keys: the allowed option keys (readOptionKeys()).
function parse(raw, dv, keys, where = 'scenario') {
  const errs = [];
  const bad = (msg) => errs.push(msg);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ScenarioError(where + ': must be a JSON object');
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) bad('unknown field "' + k + '" (allowed: ' + TOP_KEYS.join(', ') + ')');
  const name = raw.name;
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) bad('name: required, lowercase letters, digits and dashes (it names the output file), got ' + JSON.stringify(name));
  const scene = raw.scene === undefined ? 'road' : raw.scene;
  if (!SCENES.includes(scene)) bad('scene: ' + JSON.stringify(scene) + ' is not one of ' + SCENES.join(', '));
  const seed = raw.seed === undefined ? dv.seed : raw.seed;
  if (!isInt(seed, 0, 99999)) bad('seed: expected an integer 0..99999, got ' + JSON.stringify(seed));
  if (raw.dist !== undefined && raw.pos !== undefined) bad('dist and pos are the same field: give one');
  const dist = raw.dist !== undefined ? raw.dist : raw.pos !== undefined ? raw.pos : 0;
  if (!isNum(dist, 0, 1e6)) bad((raw.pos !== undefined && raw.dist === undefined ? 'pos' : 'dist') + ': expected a number of metres 0..1000000, got ' + JSON.stringify(dist));
  const speed = raw.speed === undefined ? dv.speed : raw.speed;
  if (!isNum(speed, 0, 130)) bad('speed: expected km/h 0..130, got ' + JSON.stringify(speed));
  const options = {};
  const opts = raw.options === undefined ? {} : raw.options;
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) bad('options: expected an object of option keys');
  else for (const [k, v] of Object.entries(opts)) {
    const at = 'options.' + k;
    if (TOP_ONLY.includes(k)) { bad(at + ': set "' + k + '" at top level, not under options'); continue; }
    if (!keys.has(k)) { bad(at + ': unknown option (not a key the drive view uses; see js/spec-ui.js DV_DEF)'); continue; }
    if (ENUMS[k]) {
      if (!ENUMS[k].includes(v)) bad(at + ': expected one of ' + ENUMS[k].join(', ') + ', got ' + JSON.stringify(v));
    } else if (k in dv && dv[k] !== null) {
      if (kind(v) !== typeof dv[k]) bad(at + ': expected ' + typeof dv[k] + ' (default ' + JSON.stringify(dv[k]) + '), got ' + JSON.stringify(v));
    } else if (k in dv && dv[k] === null) {
      if (v !== null && typeof v !== 'number') bad(at + ': expected a number or null, got ' + JSON.stringify(v));
    }
    options[k] = v;
  }
  let beams = [];
  if (raw.beams !== undefined) {
    if (!Array.isArray(raw.beams) || !raw.beams.every((b) => typeof b === 'string' && b.length)) bad('beams: expected an array of library entry names');
    else beams = raw.beams;
  }
  const frames = raw.frames === undefined ? 1 : raw.frames;
  if (!isInt(frames, 1, 600)) bad('frames: expected an integer 1..600, got ' + JSON.stringify(frames));
  let capture = [];
  if (raw.capture === undefined) capture = [{ name: 'last', frame: Math.max(0, (Number.isInteger(frames) ? frames : 1) - 1) }];
  else if (!Array.isArray(raw.capture) || !raw.capture.length) bad('capture: expected a non-empty array of {name, frame} (or frame numbers)');
  else {
    const seen = new Set();
    for (const c of raw.capture) {
      const e = typeof c === 'number' ? { name: 'f' + c, frame: c } : c;
      if (!e || typeof e !== 'object' || typeof e.frame !== 'number') { bad('capture: each entry needs a frame number, got ' + JSON.stringify(c)); continue; }
      if (!isInt(e.frame, 0, (Number.isInteger(frames) ? frames : 1) - 1)) bad('capture "' + e.name + '": frame ' + JSON.stringify(e.frame) + ' is outside 0..' + ((Number.isInteger(frames) ? frames : 1) - 1));
      const cn = e.name === undefined ? 'f' + e.frame : e.name;
      if (typeof cn !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(cn)) bad('capture: name ' + JSON.stringify(cn) + ' must be lowercase letters, digits and dashes');
      if (seen.has(cn)) bad('capture: name "' + cn + '" is used twice');
      seen.add(cn); capture.push({ name: cn, frame: e.frame });
    }
  }
  const regions = Object.assign({}, DEFAULT_REGIONS);
  if (raw.regions !== undefined) {
    if (!raw.regions || typeof raw.regions !== 'object' || Array.isArray(raw.regions)) bad('regions: expected an object of name: [x0, y0, x1, y1]');
    else for (const [rn, r] of Object.entries(raw.regions)) {
      const ok = Array.isArray(r) && r.length === 4 && r.every((x) => isNum(x, 0, 1)) && r[0] < r[2] && r[1] < r[3];
      if (!ok) bad('regions.' + rn + ': expected [x0, y0, x1, y1] fractions 0..1 with x0 < x1 and y0 < y1, got ' + JSON.stringify(r));
      else regions[rn] = r;
    }
  }
  if (errs.length) throw new ScenarioError(where + ':\n  ' + errs.join('\n  '));
  return { name, scene, seed, dist, speed, options, beams, frames, capture, regions };
}

module.exports = { parse, readDvDefaults, readOptionKeys, ScenarioError, SCENES, DEFAULT_REGIONS, ROOT };
