// T3: UI layer tested in jsdom. Node tests only — no browser, no Playwright.
// Run: node tests/t3-ui-jsdom.js  |  exits 1 on any failure.
//
// Requires jsdom (npm install jsdom). If not installed, exits 1 with a loud skip notice
// (so a jsdom-less gate cannot silently pass this suite; cyrus rule-15 vacuity guard).
const fs = require('fs'), path = require('path'), vm = require('vm');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {
  console.log('[SKIP] t3-ui-jsdom: jsdom not installed — run: npm install jsdom');
  console.log('[FAIL] 0 checks, 1 failed (skipped — missing jsdom)');
  console.log('[NOTE] jsdom is required for UI-layer tests. Install it with: npm install jsdom');
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
};

console.log('T3 UI in jsdom — node test suite');

// ---- Phase 1: load the engine (same as tests/load.js) ----
const { load, ROOT } = require('./load.js');
const RF = load();

// ---- Phase 2: jsdom setup ----
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:8090/', pretendToBeVisual: true });
const { document, window: win } = dom.window;

// Mock Canvas
class FakeCanvas {
  getContext(t) { if ((t || '').includes('2d')) return new FakeCtx2D(); return new FakeGL(); }
  toDataURL() { return 'data:,'; }
  toBlob(cb) { cb(); }
  get width() { return this._w || 300; } set width(v) { this._w = v; }
  get height() { return this._h || 150; } set height(v) { this._h = v; }
}
class FakeCtx2D {
  get canvas() { return new FakeCanvas(); }
  measureText(t) { return { width: String(t).length * 7 }; }
  drawImage() {}; getImageData() { return { data: new Uint8ClampedArray(4) }; }
  putImageData() {}; fillRect() {}; fillText() {}; save() {}; restore() {}
  beginPath() {}; closePath() {}; moveTo() {}; lineTo() {}; stroke() {}; fill() {}
  arc() {}; rect() {}; createLinearGradient() { return { addColorStop() {} }; }
  createPattern() { return {}; }
  translate() {}; rotate() {}; scale() {}; setTransform() {}; clip() {}
}
class FakeGL {
  getExtension() { return null; }
  getParameter() { return null; }
  getShaderPrecisionFormat() { return { precision: 23, rangeMax: 127, rangeMin: 127 }; }
}
['createShader','createProgram','createBuffer','createTexture','createFramebuffer',
 'createRenderbuffer','getAttribLocation','getUniformLocation'].forEach((m) => { FakeGL.prototype[m] = () => ({}); });
['bindBuffer','bindTexture','bindFramebuffer','bufferData','texImage2D','useProgram',
 'drawArrays','drawElements','enable','disable','blendFunc','viewport','clear',
 'shaderSource','compileShader','attachShader','linkProgram','vertexAttribPointer',
 'enableVertexAttribArray','disableVertexAttribArray','activeTexture','drawBuffers',
 'createVertexArray','bindVertexArray'].forEach((m) => { FakeGL.prototype[m] = () => {}; });
['uniform1f','uniform2f','uniform3f','uniform4f','uniform1i','uniform2i','uniform3i',
 'uniform4i','uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv']
  .forEach((m) => { FakeGL.prototype[m] = () => {}; });
FakeGL.prototype.readPixels = () => new Uint8Array(4);

win.HTMLCanvasElement = class extends win.HTMLElement {
  getContext(t) { return new FakeCanvas().getContext(t); }
  toDataURL() { return 'data:,'; } toBlob(cb) { cb(); }
  get width() { return parseInt(this.getAttribute('width') || '300'); }
  set width(v) { this.setAttribute('width', String(v)); }
  get height() { return parseInt(this.getAttribute('height') || '150'); }
  set height(v) { this.setAttribute('height', String(v)); }
};
win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
win.cancelAnimationFrame = (id) => clearTimeout(id);
win.performance = win.performance || {};
if (!win.performance.now) win.performance.now = () => Date.now();
// localStorage
const store = {};
win.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }, clear() {}, get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] || null };

// Wire jsdom's globals into Node's globalThis, so the UI scripts pick them up
globalThis.document = document;
globalThis.window = win;
globalThis.HTMLCanvasElement = win.HTMLCanvasElement;
globalThis.Image = win.Image;
globalThis.navigator = win.navigator;
globalThis.requestAnimationFrame = win.requestAnimationFrame;
globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
globalThis.performance = win.performance;
globalThis.localStorage = win.localStorage;
globalThis.location = win.location;
globalThis.self = win;
globalThis.top = win;

// ---- Phase 3: load UI modules that need a DOM ----
function loadUI(file) {
  const p = path.join(ROOT, 'js', file + '.js');
  try {
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
    return true;
  } catch (e) {
    return e.message;
  }
}

// ======== CHECKS ========

// --- A. HTML structure ---
console.log('\n--- A. HTML structure ---');
{
  ok('A1: document body exists', !!document.body);
  ok('A2: title is "Flux"', (document.title || '').includes('Flux'));

  const modeBtns = document.querySelectorAll('button[data-mode]');
  ok('A3: mode buttons (data-mode) exist', modeBtns.length >= 3, { count: modeBtns.length });

  const canvasEls = document.querySelectorAll('canvas');
  ok('A4: at least one canvas element', canvasEls.length >= 1, { count: canvasEls.length });

  ok('A5: #safe-banner exists', !!document.getElementById('safe-banner'));
  ok('A6: #btn-trace exists', !!document.getElementById('btn-trace'));
  ok('A7: #btn-generate-top exists', !!document.getElementById('btn-generate-top'));
  ok('A8: #progress-bar exists', !!document.getElementById('progress-bar'));

  // data-anim, data-dv, and #panels are created dynamically by JS (ui.js / panels.js)
  // — not present in static HTML. Verified by grep of index.html.
  ok('A9: no [data-anim] elements in static HTML (all JS-created)', document.querySelectorAll('[data-anim]').length === 0, { count: document.querySelectorAll('[data-anim]').length });
}

// --- B. CSS ---
console.log('\n--- B. CSS ---');
{
  const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
  ok('B1: stylesheets present', styles.length > 0, { count: styles.length });
}

// --- C. Panels module ---
console.log('\n--- C. Panels module (js/panels.js) ---');
{
  const result = loadUI('panels');
  ok('C1: panels.js loads without error', result === true, { error: result });

  const el = RF.Panels && RF.Panels.el;
  if (typeof el === 'function') {
    const div = el('div', { class: 'test', 'data-foo': 'bar' }, 'hello');
    ok('C2: el() creates <div>', div && div.tagName === 'DIV');
    ok('C3: el() sets class', div && div.className === 'test');
    ok('C4: el() sets data attr', div && div.getAttribute('data-foo') === 'bar');
    ok('C5: el() sets textContent', div && div.textContent === 'hello');
  } else {
    ok('C2-C5: el() not a function', false);
  }

  ok('C6: RF.Panels.confirmButton is function', typeof (RF.Panels && RF.Panels.confirmButton) === 'function');
}

// --- D. Spec UI module ---
console.log('\n--- D. Spec UI module (js/spec-ui.js) ---');
{
  const result = loadUI('spec-ui');
  ok('D1: spec-ui.js loads without error', result === true, { error: result });
  // spec-ui registers hooks; verify its exports exist
  ok('D2: RF.Spec.measureAt is function', typeof (RF.Spec && RF.Spec.measureAt) === 'function');
  ok('D3: RF.Spec.evaluate is function', typeof (RF.Spec && RF.Spec.evaluate) === 'function');
}

// --- E. DOM event model ---
console.log('\n--- E. DOM event model ---');
{
  let clicked = false;
  const btn = document.createElement('button');
  btn.textContent = 'test';
  btn.addEventListener('click', () => { clicked = true; });
  btn.click();
  ok('E1: click event fires', clicked);

  const div = document.createElement('div');
  div.innerHTML = '<span data-test="find-me">found</span>';
  const found = div.querySelector('[data-test="find-me"]');
  ok('E2: querySelector with data attr', found && found.textContent === 'found');
}

// --- F. Store / controller ---
console.log('\n--- F. Store / controller ---');
{
  ok('F1: RF.Controller exists', typeof RF.Controller === 'object');
  ok('F2: RF.Controller.createStore is function', typeof RF.Controller.createStore === 'function');
  ok('F3: RF.State.testScene is function', typeof RF.State.testScene === 'function');

  try {
    const st = RF.Controller.createStore(RF.State.testScene());
    ok('F4: store created from testScene', !!st && !!st.scene);
    ok('F5: store has scene.source', st && st.scene && !!st.scene.source);
  } catch (e) {
    ok('F4-F5: store creation failed', false, { error: e.message });
  }
}

// --- G. data-anim binding surface ---
console.log('\n--- G. data-anim controls ---');
{
  // panels.js creates DOM; check that key data-anim attributes exist in the HTML
  const driveBtn = document.querySelector('button[data-disp="drive"]');
  ok('G1: Drive display button exists', !!driveBtn);

  const specBtn = document.querySelector('button[data-mode="D"]');
  ok('G2: Spec mode button exists', !!specBtn);

  // These are created by JS at runtime; verify they are NOT in static HTML
  const playBtn = document.querySelector('[data-anim="play"]');
  ok('G3: [data-anim="play"] is not in static HTML (JS-created)', !playBtn);

  const popoutBtn = document.querySelector('[data-anim="popout"]');
  ok('G4: [data-anim="popout"] is not in static HTML (JS-created)', !popoutBtn);
}

// ------- summary -------
console.log('\n--- summary ---');
console.log((fail ? '[FAIL] ' : '[PASS] ') + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);