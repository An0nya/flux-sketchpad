/* endless-traffic.js: Endless road v2 — per-car traffic parameters from the settlement + roadClass axes (barbicane, 11-10).
   CONSUMES harbert's shared scheduler (RF.EndlessAxes in js/endless-axis-config.js) for the settlement and roadClass
   ladder values at each tile, and maps them to the per-car traffic-generation knobs:
     settlement/roadClass → safeGapMul / onMode / onKcdMs / pedStop / truckFraction

   Does NOT duplicate nemo's trafficDensity or speedLimit (settlementRoadAt owns those). This module adds the
   per-car behaviour parameters on top.

   Interface:
     trafficAt(seed, k, settings) -> { settlement, roadClass, safeGapMul, onMode, onKcdMs, pedStop, truckFraction }

   settings = the RAW endless-axes settings object (parsed internally by RF.EndlessAxes.timeline — do NOT
     pre-parse; double-parsing breaks ranges, same rule as endless-relief.js).

   The knobs:
     safeGapMul    0.5..1.5 — multiplier on the safe following distance (highway = larger, city = tighter)
     onMode        'symmetric' | 'signal' | 'none' — oncoming headlamp mode (signal syncs with intersections)
     onKcdMs       20..80 ms — oncoming headlamp cycle timer (city = shorter dips, highway = longer)
     pedStop       boolean — whether pedestrians stop traffic (city/suburb = true, rural/wild = false)
     truckFraction 0..1 — fraction of traffic that's trucks/lorries (highway = more, city = few)

   Deterministic in (seed, k, settings). No DOM, loads in Node. */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});

  // settlement rung → onMode. 'signal' means oncoming cars follow intersection signal timing;
  // 'symmetric' means a fixed onKcd cycle; 'none' means no oncoming headlamp management.
  const SETTLEMENT_ONMODE = {
    'city':   'signal',
    'suburb': 'signal',
    'rural':  'symmetric',
    'wild':   'none',
  };

  // settlement rung → pedStop. City/suburb pedestrians stop traffic; rural/wild don't.
  const SETTLEMENT_PEDSTOP = {
    'city':   true,
    'suburb': true,
    'rural':  false,
    'wild':   false,
  };

  // settlement rung → onKcdMs base (ms). Shorter in city (more headlamp dips), longer outside.
  // The base is then scaled by the speed limit (faster = longer gap between dips).
  const SETTLEMENT_ONKCD = {
    'city':   25,
    'suburb': 30,
    'rural':  40,
    'wild':   60,
  };

  // roadClass rung → safeGapMul (gap multiplier). Higher speed = larger gap needed.
  // The base gap is speed * 2 / 3.6 metres; safeGapMul scales it.
  const ROADCLASS_GAP = {
    'dense-highway':  1.5,
    'remote-highway': 1.3,
    'surface-2+2':    1.0,
    'suburban-1+1':   0.8,
    'two-lane':       0.9,
    'street':         0.6,
  };

  // roadClass rung → truckFraction (0..1). Highways carry more trucks; streets almost none.
  // Settlement modulates this: a city highway has fewer trucks than a rural highway.
  const ROADCLASS_TRUCK = {
    'dense-highway':  0.30,
    'remote-highway': 0.25,
    'surface-2+2':    0.15,
    'suburban-1+1':   0.08,
    'two-lane':       0.10,
    'street':         0.02,
  };

  const SETTLEMENT_TRUCK_MOD = {   // city suppresses trucks; wild has logging/mining trucks
    'city':   0.5,
    'suburb': 0.7,
    'rural':  1.0,
    'wild':   1.2,
  };

  // timeline memo (single-entry, same pattern as settlement-road/cover-water).
  let _key = null, _tl = null, _horizon = 0;
  function timelineFor(seed, settings, k) {
    const E = RF.EndlessAxes;
    const skey = seed + '|' + (typeof settings === 'string' ? settings : JSON.stringify(settings || {}));
    const need = k + 64;
    if (skey === _key && (_horizon >= need || _horizon >= 10000)) return _tl;
    const base = (skey === _key) ? _horizon : 0;
    const horizon = Math.min(10000, Math.max(need, base * 2, 4096));
    _tl = E.timeline(seed, settings, horizon);
    _key = skey; _horizon = horizon;
    return _tl;
  }

  // the traffic knobs for tile k. Deterministic in (seed, k, settings).
  function trafficAt(seed, k, settings) {
    const E = RF.EndlessAxes;
    const ki = Math.max(0, Math.floor(k));
    const tl = timelineFor(seed, settings, ki);
    const settlement = E.valueAt(tl.axes.settlement, ki);
    const roadClass  = E.valueAt(tl.axes.roadClass, ki);
    const speedLimit = E.speedLimitAt(tl.axes, ki);

    const onMode    = SETTLEMENT_ONMODE[settlement] || 'symmetric';
    const pedStop   = SETTLEMENT_PEDSTOP[settlement] !== false;
    const onKcdBase = SETTLEMENT_ONKCD[settlement] || 30;

    // onKcdMs scales with speed: faster → longer gaps between dips (more time between cars).
    // Base is for 50 km/h; scale linearly. Clamped 20..80 ms.
    const onKcdMs = Math.max(20, Math.min(80, Math.round(onKcdBase * speedLimit / 50)));

    const safeGapMul = ROADCLASS_GAP[roadClass] || 1.0;
    const truckBase  = ROADCLASS_TRUCK[roadClass] || 0.1;
    const truckMod   = SETTLEMENT_TRUCK_MOD[settlement] || 1.0;
    const truckFraction = Math.min(1, Math.max(0, truckBase * truckMod));

    return { settlement, roadClass, safeGapMul, onMode, onKcdMs, pedStop, truckFraction };
  }

  RF.EndlessTraffic = {
    SETTLEMENT_ONMODE, SETTLEMENT_PEDSTOP, SETTLEMENT_ONKCD,
    ROADCLASS_GAP, ROADCLASS_TRUCK, SETTLEMENT_TRUCK_MOD,
    trafficAt,
  };
  if (typeof module === 'object' && module && module.exports) module.exports = RF.EndlessTraffic;
})(typeof globalThis !== 'undefined' ? globalThis : this);