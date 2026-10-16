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

  // Kelvin → [r, g, b] linear sRGB, luminance 1.  Non-finite or non-positive K means "no CCT": white.
  function cctToRGB(K) {
    if (!(K > 0) || !Number.isFinite(K)) return [1, 1, 1];
    const [x, y] = xyOf(K);
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
  function presetCct(p) {
    if (!p) return undefined;
    if (!p.halogen && !p.hid && /amber|red|green|blue/i.test(p.label || '')) return undefined;   // coloured LEDs have no CCT (e.g. "PC Amber 1500K class")
    const m = /(?<![-–]\s?)\b(\d{4})\s*K\b/.exec(p.label || '');
    if (m && +m[1] >= 1500 && +m[1] <= 10000) return +m[1];
    if (p.halogen) return HALOGEN_CCT;
    if (p.hid) return HID_CCT;
    return undefined;
  }

  // Flux weight of a source: its luminous flux (lm; the `power` field is lm for every preset), or 1 if unset.
  const weightOf = (s) => (s && Number.isFinite(s.power) && s.power > 0 ? s.power : 1);

  // Scene lamp colour: flux-weighted mean of the sources' tints.  Sources with no cct count as white.  If no source has a
  // cct, returns [1, 1, 1] exactly.  Mean of luminance-1 tints is itself luminance 1, so brightness is unchanged.
  function lampRGB(sources) {
    const list = (sources || []).filter(Boolean);
    if (!list.some((s) => Number.isFinite(s.cct) && s.cct > 0)) return [1, 1, 1];
    let W = 0, R = 0, G = 0, B = 0;
    for (const s of list) {
      const w = weightOf(s), c = Number.isFinite(s.cct) && s.cct > 0 ? cctToRGB(s.cct) : [1, 1, 1];
      W += w; R += w * c[0]; G += w * c[1]; B += w * c[2];
    }
    return W > 0 ? [R / W, G / W, B / W] : [1, 1, 1];
  }

  RF.CCT = { cctToRGB, xyOf, presetCct, lampRGB, HALOGEN_CCT, HID_CCT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
