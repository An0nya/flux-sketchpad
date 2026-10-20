/* cct.js — RF.CCT: correlated colour temperature (kelvin) of a light source → the tint of the Drive view's lamp light.
 * Pure functions, no DOM.  A source with no `cct` is white ([1,1,1]); the scene's lamp colour is the flux-weighted mean
 * of its sources' tints, so an all-white scene returns exactly [1,1,1] and renders as it always did.
 *
 * Chromaticity: Kim, Kim, Choi, Lee, Kim, Park, Yoon et al. 2002, "Design of advanced color temperature control system
 * for HDTV applications" (J. Korean Phys. Soc. 41(6), 865–871), cubic-spline fit of the Planckian locus, CIE 1931 xy,
 * valid 1667–25000 K.  Converted to linear Rec.709/sRGB primaries (D65 matrix), negatives clamped to 0 (happens below
 * about 1900 K), then scaled so the Rec.709 luminance is exactly 1: the tint changes colour, not brightness.
 */
(function (root) {
  'use strict';
  const RF = root.RF;

  const K_MIN = 1667, K_MAX = 25000;

  // Kim et al. 2002, eqs. 1–2: CIE x as a function of T.
  function planckX(T) {
    if (T <= 4000) return -0.2661239e9 / (T * T * T) - 0.2343589e6 / (T * T) + 0.8776956e3 / T + 0.179910;
    return -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390;
  }
  // Kim et al. 2002, eq. 3: CIE y as a function of x, one cubic per temperature band.
  function planckY(T, x) {
    if (T <= 2222) return -1.1063814 * x ** 3 - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
    if (T <= 4000) return -0.9549476 * x ** 3 - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
    return 3.0817580 * x ** 3 - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  }

  // CIE 1931 [x, y] of the Planckian locus at K (clamped to the fit's range).
  function xyOf(K) {
    const T = Math.min(K_MAX, Math.max(K_MIN, K)), x = planckX(T);
    return [x, planckY(T, x)];
  }

  // Duv: signed distance off the Planckian locus in CIE 1960 (u,v). + = above the locus = green; - = below = pink/magenta.
  // Clamped to +-DUV_MAX; a value outside that is clamped, not rejected. Only a finite non-zero duv changes the colour.
  const DUV_MAX = 0.05;
  function uvOf(x, y) { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d]; }
  function xyOfUv(u, v) { const d = 2 * u - 8 * v + 4; return [3 * u / d, 2 * v / d]; }

  // The locus point at K, moved duv along its unit normal (the normal with positive v). K is clamped to the fit's range FIRST,
  // so the +-1 % finite difference never collapses to two identical points at the ends.
  function shiftedXy(K, duv) {
    const Kc = Math.min(K_MAX, Math.max(K_MIN, K));
    const [u, v] = uvOf(...xyOf(Kc));
    const [u1, v1] = uvOf(...xyOf(Math.max(K_MIN, Kc * 0.99)));
    const [u2, v2] = uvOf(...xyOf(Math.min(K_MAX, Kc * 1.01)));
    const tu = u2 - u1, tv = v2 - v1, len = Math.hypot(tu, tv);
    let nu = -tv / len, nv = tu / len;                           // unit normal to the tangent
    if (nv < 0) { nu = -nu; nv = -nv; }                          // pick the normal that points to +v
    return xyOfUv(u + duv * nu, v + duv * nv);
  }

  // Kelvin → [r, g, b] linear sRGB, luminance 1.  Non-finite or non-positive K means "no CCT": white.
  // duv (optional, see above): 0, unset, or non-finite leaves the Planckian colour exactly as it was.
  function cctToRGB(K, duv) {
    if (!(K > 0) || !Number.isFinite(K)) return [1, 1, 1];
    const d = Number.isFinite(duv) ? Math.max(-DUV_MAX, Math.min(DUV_MAX, duv)) : 0;
    const [x, y] = d === 0 ? xyOf(K) : shiftedXy(K, d);
    const X = x / y, Z = (1 - x - y) / y;                        // Y = 1
    let r = 3.2406 * X - 1.5372 - 0.4986 * Z, g = -0.9689 * X + 1.8758 + 0.0415 * Z, b = 0.0557 * X - 0.2040 + 1.0570 * Z;
    r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);  // clamp before normalising
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [r / L, g / L, b / L];
  }

  // A preset's default CCT. Only a single stated value ("≈ 4000 K", "5000K") counts; a range such as "5000 - 6500 K"
  // is not one colour, so it is skipped.  Halogen and HID presets have no stated value: they get the assumed values below.
  //   halogen 3200 K — tungsten filament at roughly the rated lamp temperature; an ASSUMPTION, not a measurement.
  //   HID 4200 K     — metal-halide arc; an ASSUMPTION within the 4000–4300 K band typical for D2/D3 lamps.
  const HALOGEN_CCT = 3200, HID_CCT = 4200;

  // LED presets whose label states no K. Two kinds, both from the owner:
  //   ASSUMED_CCT: the owner's assumed values (not measured): cool white 6500 K for Osram, Nichia NCSW170HT, Lumileds Altilon,
  //     SFT-40 default (its bin menu sets the value, source-presets.js), LMP LML2AW.DC, and Cree CLP6B-WKW (several bins).
  //   KNOWN_CCT: the owner's measured or known values (koef3 tests, datasheet bins). No 'assumed' note.
  // Left OUT on purpose (stay white): sketch, generic, measured, the coloured/amber parts (existing rule), and Cree CXA1304
  // colour kit (k3-48963, owner to decide). Real LED CCT rises with drive current; not modelled (see the report).
  const ASSUMED_CCT = {
    'osram-cslpm1': 6500, 'osram-cslnm1': 6500, 'osram-hwqp': 6500, 'osram-q8wp': 6500,
    'osram-oslon-bfx-kw4': 6500, 'osram-oslon-bfx-kw3': 6500, 'k3-48945': 6500,          // Osram SYNIOS
    'nichia-ncsw170h': 6500, 'nichia-ncsw170h-sa': 6500, 'nichia-ncsw170h-sb': 6500,
    'lumileds-altilon-intense-1x1': 6500, 'lumileds-altilon-intense-1x2': 6500,
    'sft40-cw': 6500,
    'k3-220770': 6500,                                                                  // LMP LML2AW.DC
    'k3-219467': 6500,                                                                  // Cree CLP6B-WKW (several bins)
  };
  const KNOWN_CCT = {
    'sft25r': 5700,                                                                     // Luminus SFT-25R-WG (owner)
    'k3-49788': 6500,                                                                   // Luminus SST-40-W specialty white (owner)
    'k3-49731': 4000,                                                                   // Lumileds Luxeon V CSP (owner)
    'k3-71898': 6200,                                                                   // Cree XM-L2 U3 colour kit 51 (owner)
    'k3-49237': 4000,                                                                   // Cree XP-L2 V5 40E 70CRI (owner)
    'k3-221071': 5928,                                                                  // YLX N3535B cool white, koef3 CRI-tool reading
    'k3-229647': 5429,                                                                  // Lumenpioneer LHP531 5000 K series, koef3 spectrometer (owner's table)
    'k3-229647-6500': 6485, 'k3-229647-4000': 4211, 'k3-229647-3000': 3172,            // the other LHP531 CCT variants (LV1 presets)
    'k3-229647-1800': 1733,                                                             // 1800 K PC amber: owner-approved exception to the coloured rule
  };
  const MULTI_BIN = new Set(['k3-219467']);                                             // assumed values sold in several bins: the note says so
  // Owner-measured CCT beats a stated K in the label (the label prints the nominal bin, e.g. 6500 K, but koef3 read 6485 K),
  // and is checked BEFORE the coloured-LED rule, so the 1800 K PC amber variant gets a CCT. Only these five LHP531 ids.
  const MEASURED_OVERRIDE = new Set(['k3-229647', 'k3-229647-6500', 'k3-229647-4000', 'k3-229647-3000', 'k3-229647-1800']);

  // Full answer for a preset: { cct, source, assumed, multiBin }. source is 'label' | 'halogen' | 'hid' | 'table' | 'unset'.
  // id is the PRESETS key (the preset object itself has none); pass it, or the table is not consulted.
  // A stated K in the label always wins over the table.
  function presetCctInfo(p, id) {
    const none = { cct: undefined, source: 'unset', assumed: false, multiBin: false };
    if (!p) return none;
    if (id && MEASURED_OVERRIDE.has(id)) return { cct: KNOWN_CCT[id], source: 'table', assumed: false, multiBin: false };
    if (!p.halogen && !p.hid && /amber|red|green|blue/i.test(p.label || '')) return none;   // coloured LEDs have no CCT (e.g. "PC Amber 1500K class")
    const m = /(?<![-–]\s?)\b(\d{4})\s*K\b/.exec(p.label || '');
    if (m && +m[1] >= 1500 && +m[1] <= 10000) return { cct: +m[1], source: 'label', assumed: false, multiBin: false };
    if (p.halogen) return { cct: HALOGEN_CCT, source: 'halogen', assumed: true, multiBin: false };
    if (p.hid) return { cct: HID_CCT, source: 'hid', assumed: true, multiBin: false };
    if (id && Object.prototype.hasOwnProperty.call(ASSUMED_CCT, id)) return { cct: ASSUMED_CCT[id], source: 'table', assumed: true, multiBin: MULTI_BIN.has(id) };
    if (id && Object.prototype.hasOwnProperty.call(KNOWN_CCT, id)) return { cct: KNOWN_CCT[id], source: 'table', assumed: false, multiBin: false };
    return none;
  }
  // A preset's default CCT (kelvin) or undefined. See presetCctInfo for the rules.
  function presetCct(p, id) { return presetCctInfo(p, id).cct; }

  // Duv a preset sets by default. Only one: the YLX N3535B cool white (koef3 reading, with its 5928 K CCT above).
  // Everything else is 0, unset. Typed values in Light source (src.duv) win for the same preset (see source-presets.js).
  const PRESET_DUV = { 'k3-221071': 0.0189 };
  function presetDuv(id) { return id && Object.prototype.hasOwnProperty.call(PRESET_DUV, id) ? PRESET_DUV[id] : undefined; }

  // Flux weight of a source: its luminous flux (lm; the `power` field is lm for every preset), or 1 if unset.
  const weightOf = (s) => (s && Number.isFinite(s.power) && s.power > 0 ? s.power : 1);

  // Scene lamp colour: flux-weighted mean of the sources' tints.  Sources with no cct count as white.  If no source has a
  // cct, returns [1, 1, 1] exactly.  Mean of luminance-1 tints is itself luminance 1, so brightness is unchanged.
  function lampRGB(sources) {
    const list = (sources || []).filter(Boolean);
    if (!list.some((s) => Number.isFinite(s.cct) && s.cct > 0)) return [1, 1, 1];
    let W = 0, R = 0, G = 0, B = 0;
    for (const s of list) {
      const w = weightOf(s), c = Number.isFinite(s.cct) && s.cct > 0 ? cctToRGB(s.cct, s.duv) : [1, 1, 1];
      W += w; R += w * c[0]; G += w * c[1]; B += w * c[2];
    }
    return W > 0 ? [R / W, G / W, B / W] : [1, 1, 1];
  }

  RF.CCT = { cctToRGB, xyOf, shiftedXy, uvOf, presetCct, presetCctInfo, presetDuv, lampRGB, HALOGEN_CCT, HID_CCT, ASSUMED_CCT, KNOWN_CCT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
