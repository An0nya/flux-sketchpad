/* manufacturability-ui.js — transient Optics settings; scene JSON and solver inputs stay untouched. */
(function (root) {
  'use strict';
  const RF = root.RF, MF = RF.Manufacturability, byId = (id) => document.getElementById(id), fmt = (v) => v === null ? 'unknown' : RF.U.fmt(v, 3);
  function init(ui, schedule) {
    ui.mf = { on: false, metric: 'curvature', pull: null, draftMinDeg: 2 };
    const refresh = () => { ui.sceneDirty = true; schedule(); };
    byId('mf-on').addEventListener('change', (e) => { ui.mf.on = e.target.checked; byId('mf-panel').hidden = !ui.mf.on; refresh(); });
    byId('mf-metric').addEventListener('change', (e) => { ui.mf.metric = e.target.value; refresh(); });
    const vector = () => ['x', 'y', 'z'].map((k) => byId('mf-' + k).valueAsNumber);
    byId('mf-pull').addEventListener('change', (e) => {
      const custom = e.target.value === 'custom'; byId('mf-vector').hidden = !custom;
      if (custom && !ui.mf.pull) ['x', 'y', 'z'].forEach((k, i) => { byId('mf-' + k).value = ui.store.scene.source.axis[i]; });
      ui.mf.pull = custom ? vector() : null; refresh();
    });
    for (const k of ['x', 'y', 'z']) byId('mf-' + k).addEventListener('change', () => { ui.mf.pull = vector(); refresh(); });
    byId('mf-draft').addEventListener('change', (e) => { ui.mf.draftMinDeg = e.target.valueAsNumber; refresh(); });
  }
  function overlay(ui, model, preview) {
    if (!ui.mf || !ui.mf.on) return null;
    let result;
    try { result = MF.analyze(ui.store.scene, { G: model.P.G, polys: model.polys, pull: ui.mf.pull, draftMinDeg: ui.mf.draftMinDeg }); }
    catch (e) { byId('mf-error').textContent = e.message; ui.mfResult = null; byId('mf-legend').textContent = 'Measurements unavailable'; byId('mf-scale').replaceChildren(); byId('mf-summary').textContent = 'Correct the setting to resume measurements.'; byId('mf-worst').replaceChildren(); return null; }
    byId('mf-error').textContent = '';
    const metric = ui.mf.metric;
    if (ui.mfResult !== result || ui.mfShownMetric !== metric || ui.mfPreview !== !!preview) {
      ui.mfResult = result; ui.mfShownMetric = metric; ui.mfPreview = !!preview;
      const def = MF.METRICS[metric], scale = result.scales[metric], s = result.summary;
      byId('mf-legend').textContent = def.label + ' (' + def.unit + ')';
      byId('mf-scale').replaceChildren(...scale.map((v) => { const span = document.createElement('span'); span.textContent = fmt(v) + ' ' + def.unit; return span; }));
      byId('mf-summary').textContent = (preview ? 'Solve preview · ' : '') + s.surfaces + ' surfaces · ' + s.undercutSurfaces + ' undercut · ' + s.belowDraftSurfaces + ' below ' + fmt(result.draftMinDeg) + '°. Min feature ' + fmt(s.minFeatureMm) + ' mm · max step ' + fmt(s.maxStepMm) + ' mm (' + s.matchedSeams + ' estimated seams; ' + s.unmatchedSurfaces + ' surfaces unmatched).';
      const list = byId('mf-worst'), title = document.createElement('div'); title.textContent = 'Worst surfaces · ' + (metric === 'feature' || metric === 'draft' ? 'smallest first' : 'largest magnitude first'); list.replaceChildren(title);
      for (const row of MF.worst(result, metric)) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.mfFacet = row.id;
        b.textContent = row.id + ' · ' + fmt(MF.value(row, metric)) + ' ' + def.unit + (row.undercut ? ' · undercut' : '');
        b.disabled = !!preview; b.title = preview ? 'Preview facets are selectable after the design is applied.' : 'Select this surface in the facet inspector';
        b.addEventListener('click', () => ui.select({ kind: 'facet', id: row.id })); list.appendChild(b);
      }
    }
    return { result, metric };
  }
  RF.ManufacturabilityUI = { init, overlay };
})(typeof globalThis !== 'undefined' ? globalThis : this);
