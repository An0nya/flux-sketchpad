/* source-presets.js — RF.SourcePresets: real light sources as source settings.  Pure data + two helpers; no DOM.
 * Applying a preset keeps the source's position (and, for LEDs, its aim); it sets the emitter's geometry, emission and
 * power.  Where a datum is assumed rather than sourced, the preset says so.                                         */
(function (root) {
  'use strict';
  const RF = root.RF;

  // Luminus SFT-40-WxH (PDS-003302 Rev 01): 3000 K > 95 CRI, emitting area 1.97 × 1.97 mm (p. 10), Lambertian (120° FWHM,
  // p. 6; I(60°) = 0.5 on p. 8), absolute max DC current 4 A (p. 6).  Two flux models:
  //   datasheet — bin D9 minimum flux at Tj = 85 °C (p. 3: 198 / 395 / 502 / 695 / 861 lm at 0.7 / 1.5 / 2 / 3 / 4 A; the off-1.5 A
  //               values are Luminus' calculated ones), Vf = 2.8 V typ at 1.5 A plus the ΔVf curve (p. 7)
  //   koef3     — one sample measured by koef3 (BLF/TLF, 22.10.2023): Cu DTP board, fan-cooled, 25 °C solder point, driven to
  //               14.8 A (3.7× the rating).  Brighter (cooler junction) and beyond the datasheet past 4 A.
  const SFT40_CURVE = [[0, 0], [1, 280], [2, 510], [3, 710], [4, 880], [5, 1030], [6, 1170], [7, 1285], [8, 1385], [9, 1475], [10, 1555], [11, 1615], [12, 1665], [13, 1700], [14, 1715], [14.8, 1715]];
  const SFT40_VF = [[0.2, 2.65], [1, 2.80], [2, 2.93], [3, 3.05], [4, 3.16], [5, 3.26], [6, 3.36], [7, 3.46], [8, 3.55], [9, 3.63], [10, 3.72], [11, 3.82], [12, 3.91], [13, 4.00], [14, 4.10], [14.8, 4.18]];
  // Past 4 A the datasheet says nothing: continue with koef3's curve SHAPE, scaled to meet the datasheet at 4 A (flux × 861/880,
  // Vf − 0.05 V) — an estimate for a hot junction, not a measurement.
  const SFT40_DS = [[0, 0], [0.7, 198], [1.5, 395], [2, 502], [3, 695], [4, 861]].concat(SFT40_CURVE.filter(([a]) => a > 4).map(([a, lm]) => [a, Math.round(lm * 861 / 880)]));
  const SFT40_DS_VF = [[0.1, 2.56], [0.5, 2.66], [1, 2.73], [1.5, 2.80], [2, 2.87], [2.5, 2.94], [3, 3.00], [3.5, 3.06], [4, 3.11]].concat(SFT40_VF.filter(([a]) => a > 4).map(([a, v]) => [a, +(v - 0.05).toFixed(2)]));
  const lerp = (tab, x) => {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return tab[tab.length - 1][1];
  };

  // Luminus SFT-40-WxS / WxE (PDS-003134 Rev 05): cool white 5000 / 5700 / 6500 K, CRI ~70, same 1.97 mm flat-window die
  // (p. 11), 120° FWHM, DC max 8 A, Pd max 29 W (p. 6).  Flux = each bin's correlated minimum at Tj 85 °C (p. 3; off-1.5 A
  // values calculated by Luminus); Vf = 2.8 V typ at 1.5 A plus the ΔVf-vs-current curve (p. 7, read off the plot).
  const CW_VF = [[0.1, 2.57], [1, 2.72], [1.5, 2.80], [2, 2.88], [3, 3.02], [4, 3.16], [5, 3.28], [6, 3.40], [7, 3.50], [8, 3.60]];
  const cwBin = (a07, a15, a2, a3, a5, a6, a8) => [[0, 0], [0.7, a07], [1.5, a15], [2, a2], [3, a3], [5, a5], [6, a6], [8, a8]];
  // Luminus SFT-25R-WG CRI > 90 (PDS-003551 Rev 03): ROUND flat-window emitter, Ø 1.70 mm (p. 12; "25" = 2.5 mm² chip),
  // 116° / 115° FWHM (≈ Lambertian; I(60°) ≈ 0.5 on pp. 10–11), DC max 5 A, Pd max 18 W (p. 7).  Flux = the bin's correlated
  // minimum at Tj 85 °C (p. 3: 1 / 1.5 / 3 / 4 / 5 A); Vf = 2.9 V typ at 1.5 A plus the ΔVf curves (pp. 8–9, read off the plots).
  const R25_VF_WARM = [[0.1, 2.61], [0.5, 2.71], [1, 2.80], [1.5, 2.90], [2, 2.98], [3, 3.13], [4, 3.27], [5, 3.40]];
  const R25_VF_COOL = [[0.1, 2.56], [0.5, 2.69], [1, 2.79], [1.5, 2.90], [2, 2.99], [3, 3.17], [4, 3.34], [5, 3.52]];
  const r25Bin = (a1, a15, a3, a4, a5) => [[0, 0], [1, a1], [1.5, a15], [3, a3], [4, a4], [5, a5]];
  // koef3's measurements (BLF/TLF): flux and Vf read off his comparison chart "LED comparison – Osram CSLNM1.TG, CSLPM1.TG,
  // Black Flat HWQP, LE UW Q8WP" (Cu DTP boards, integrating sphere, fan-cooled, 25 °C solder point; ±3 % / ±0.05 V reading
  // error), luminance from his cd/mm² tables.  These LEDs carry no die size here: the EFFECTIVE emitting area comes from
  // A = Φ / (π L) at each luminance row — what a Lambertian die of that luminance and flux must measure, which is what the
  // optics see.  It stays within a few % across current for all four (a sanity check on the readings).
  // Rows: flux [A, lm], vf [A, V], lum [A, cd/mm²].  Max current = where koef3 stopped, not a rating.
  const KOEF3 = {
    'osram-cslpm1': { label: 'Osram CSLPM1.TG (domeless)', flux: [[0, 0], [1, 345], [2, 622], [3, 852], [4, 1046], [5, 1211], [6, 1346], [7, 1441], [8, 1493], [8.6, 1500]],
      vf: [[0.2, 2.75], [1, 2.89], [2, 3.01], [3, 3.12], [4, 3.22], [5, 3.31], [6, 3.40], [7, 3.49], [8, 3.57], [8.6, 3.62]], lum: [[2.8, 126.9], [6, 209.6], [8.6, 232.4]], defaultA: 6 },
    'osram-cslnm1': { label: 'Osram CSLNM1.TG (domeless)', flux: [[0, 0], [0.5, 190], [1, 350], [2, 598], [3, 796], [4, 931], [5, 1015], [5.6, 1031]],
      vf: [[0.2, 2.85], [1, 3.04], [2, 3.23], [3, 3.35], [4, 3.51], [5, 3.62], [5.6, 3.70]], lum: [[0.7, 56.2], [2.8, 160.6], [5.6, 211.7]], defaultA: 4 },
    'osram-hwqp': { label: 'Osram Black Flat HWQP (domeless)', flux: [[0, 0], [1, 317], [2, 548], [3, 719], [4, 848], [5, 926], [5.4, 937], [5.8, 933]],
      vf: [[0.2, 2.80], [1, 3.01], [2, 3.19], [3, 3.36], [4, 3.56], [5, 3.77], [5.8, 4.00]], lum: [[0.7, 61.0], [2.8, 166.5], [5.4, 225.4]], defaultA: 4,
      note: 'koef3 has two luminance tables for this LED (61.0 / 166.5 / 225.4 and 66.1 / 181.2 / 245.9 cd/mm²); the first, repeated in three of his tables, is used.' },
    // charts "LED comparison – FFL505A (3500 K 95 CRI rosy type)", "– Nichia 519A / 519A-V1", "– Luminus SFT-70 3000K 95CRI";
    // luminance from his cd/mm² tables.  DOMED emitters: the dome magnifies the die, so the effective area is the dome's apparent
    // size seen head-on; it shrinks off-axis, which a flat Lambertian disc doesn't capture.
    'ffl505a': { label: 'FFL505A 3500 K 95 CRI rosy (domeless)', flux: [[0, 0], [1, 230], [2, 440], [3, 590], [4, 715], [5, 805], [6, 880], [7, 935], [8, 975], [8.8, 985]],
      vf: [[0.2, 2.72], [1, 2.86], [2, 3.01], [3, 3.11], [4, 3.20], [5, 3.28], [6, 3.37], [7, 3.45], [8, 3.52]], lum: [[0.7, 19.3], [2.8, 60.9], [8.8, 106.5]], defaultA: 5 },
    'yinding5050-6500': { label: 'Yinding 5050 6500 K 95 CRI (domeless)', flux: [[0, 0], [1, 370], [2, 670], [3, 905], [4, 1105], [5, 1255], [6, 1370], [7, 1455], [8, 1505], [8.8, 1517]],
      vf: [[0.2, 2.72], [1, 2.91], [2, 3.12], [3, 3.28], [4, 3.43], [5, 3.57], [6, 3.69], [7, 3.80], [8, 3.95], [8.8, 4.05]], lum: [[0.7, 30.1], [2.8, 98.5], [8.4, 164.2]], defaultA: 6 },
    'nichia519a-domed': { label: 'Nichia 519A 5000 K R9080 sm503 (domed)', flux: [[0, 0], [1, 360], [2, 640], [3, 885], [4, 1090], [5, 1265], [6, 1400], [7, 1500], [7.6, 1523], [8, 1520], [8.6, 1500]],
      vf: [[0.2, 2.70], [1, 2.90], [2, 3.06], [3, 3.17], [4, 3.25], [5, 3.32], [6, 3.39], [7, 3.44], [8, 3.49], [8.6, 3.52]], lum: [[0.7, 9.1], [2.8, 30.1], [7.6, 58.3]], defaultA: 5, domeOf: 'nichia519a-dedomed', domeR: 2.0,
      note: 'Domed: the effective area is the dome\u2019s head-on apparent size (~9 mm²). "Die + dome" traces the DEDOMED sample\u2019s die (its effective area from his luminance) under a real n = 1.41 hemisphere, radius 2.0 mm assumed (not measured), at this sample\u2019s domed flux.' },
    'nichia519a-dedomed': { label: 'Nichia 519A 5000 K 90 CRI sm503 (dedomed)', flux: [[0, 0], [1, 285], [2, 530], [3, 725], [4, 880], [5, 1020], [6, 1130], [7, 1200], [7.6, 1213], [8, 1200]],
      vf: [[0.2, 2.68], [1, 2.89], [2, 3.03], [3, 3.14], [4, 3.23], [5, 3.30], [6, 3.37], [7, 3.42], [8, 3.47]], lum: [[0.7, 14.3], [2.8, 46.6], [7.6, 83.8]], defaultA: 5 },
    'nichia519a-v1-domed': { label: 'Nichia 519A-V1 5700 K R9080 sm573 (domed)', flux: [[0, 0], [1, 400], [2, 730], [3, 1000], [4, 1230], [5, 1425], [6, 1595], [7, 1730], [8, 1825], [8.6, 1850], [9, 1840], [10, 1800]],
      vf: [[0.2, 2.67], [1, 2.88], [2, 3.03], [3, 3.15], [4, 3.25], [5, 3.34], [6, 3.41], [7, 3.48], [8, 3.54], [8.6, 3.57], [10, 3.64]], lum: [[0.7, 14.4], [2.8, 46.6], [8.6, 91.0]], defaultA: 6,
      note: 'Domed: the effective area is the dome\u2019s head-on apparent size (~6.5 mm²).' },
    // chart "LED comparison – LMP W5050SQ3 3000 K 70 CRI"; round die, 2.3 mm² per the user (Ø 1.71 mm).  koef3's luminance gives
    // ≈ 2.47 mm² effective (+7 %), the same direction as the SFT-40 (+10 %): his cd/mm² reads a little under Φ / (π A_die).
    'lmp-w5050sq3': { label: 'LMP W5050SQ3 3000 K 70 CRI (round, domeless)', shape: 'disc', geomArea: 2.3, flux: [[0, 0], [1, 360], [2, 640], [3, 880], [4, 1080], [5, 1245], [6, 1385], [7, 1480], [7.6, 1525], [8, 1555], [8.6, 1568], [9, 1560], [9.4, 1525]],
      vf: [[0.2, 2.70], [1, 2.93], [2, 3.05], [3, 3.18], [4, 3.29], [5, 3.40], [6, 3.50], [7, 3.59], [8, 3.68], [9, 3.75], [9.4, 3.79]], lum: [[0.7, 34.0], [2.8, 107.7], [8.6, 199.2]], defaultA: 6,
      note: 'Round die, 2.3 mm² (Ø 1.71 mm). koef3\u2019s luminance implies ≈ 2.47 mm² effective; the "die size" model uses the 2.3 mm² disc instead.' },
    'samsung-lh351d-5700': { label: 'Samsung LH351D 5700 K 90 CRI (domed)', flux: [[0, 0], [1, 430], [2, 780], [3, 1050], [4, 1270], [5, 1440], [5.6, 1520], [6, 1555], [6.4, 1578], [7, 1585], [7.2, 1580]],
      vf: [[0.2, 2.70], [1, 2.97], [2, 3.25], [3, 3.46], [4, 3.66], [5, 3.85], [6, 4.02], [7, 4.18], [7.2, 4.21]], lum: [[0.7, 9.4], [2.8, 30.1], [6.8, 49.3]], defaultA: 5,
      note: 'Domed: the effective area is the dome\u2019s head-on apparent size (~10.5 mm²).' },
    'sft70-3000': { label: 'Luminus SFT-70 3000 K 95 CRI (6 V, domeless)', flux: [[0, 0], [1, 520], [2, 945], [3, 1290], [4, 1580], [5, 1830], [6, 2030], [7, 2185], [8, 2300], [9, 2370], [9.6, 2390], [10, 2385]],
      vf: [[0.2, 5.30], [1, 5.62], [2, 5.91], [3, 6.17], [4, 6.40], [5, 6.61], [6, 6.80], [7, 6.99], [8, 7.18], [9, 7.37], [10, 7.55]], lum: [[0.7, 17.1], [2.8, 54.9], [9.6, 117.8]], defaultA: 6 },
    'sft70x-6500': { label: 'Luminus SFT-70-X 6500 K 70 CRI (6 V, domeless)', flux: [[0, 0], [1, 830], [2, 1530], [3, 2100], [4, 2580], [5, 3000], [6, 3330], [7, 3600], [8, 3790], [9, 3890], [9.6, 3925]],
      vf: [[0.2, 5.32], [1, 5.70], [2, 5.99], [3, 6.23], [4, 6.48], [5, 6.69], [6, 6.89], [7, 7.10], [8, 7.29], [9, 7.48], [9.6, 7.58]], lum: [[0.7, 27.8], [2.8, 89.3], [9.6, 191.5]], defaultA: 6 },
    'osram-q8wp': { label: 'Osram OSTAR LE UW Q8WP (domeless)', flux: [[0, 0], [1, 340], [2, 607], [3, 839], [4, 1028], [5, 1189], [6, 1330], [7, 1448], [8, 1546], [9, 1602], [9.6, 1607], [10, 1604]],
      vf: [[0.2, 2.76], [1, 2.84], [2, 2.95], [3, 3.03], [4, 3.12], [5, 3.20], [6, 3.28], [7, 3.36], [8, 3.43], [9, 3.51], [10, 3.57]], lum: [[2.8, 121.8], [6, 205.9], [9.6, 244.6]], defaultA: 6 },
  };
  // koef3 TWO-POINT presets (10-08, LOW CONFIDENCE): his stated luminous area (LES) + the flux / Vf points he quotes in text (usually the
  // official maximum and the highest current reached); curves are straight lines between those points through (0, 0), so mid-current flux
  // can be off by ~10–20 %. Generated from tools/source-specs/koef3 by script; areaVerified = his LES sentence found verbatim in the thread.
  // To be replaced by chart readings (see tools/source-specs/README.md).
  const KOEF3_2PT = [{"id": "k3-219467", "label": "Cree CLP6B-WKW, domed", "area": 0.26, "areaQuote": "The luminous area is 3 x 0.26 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-clp6b-wkw-5000-6500-k-low-power-3-channel-emitter-in-plcc6-format/219467", "date": "2023-07-29", "pts": [[0.15, 42.0, 3.34], [0.8, 115.1, 4.74]], "warn": ""}, {"id": "k3-223546", "label": "Cree XLamp XHP70.3 HI N4 5D, 4000K 70CRI, domeless", "area": 14.6, "areaQuote": "The luminous area is 14.6 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp70-3-hi-n4-color-kit-5d-4000-k-70-cri-domeless-performance-even-at-20-a/223546", "date": "2024-04-01", "pts": [[7.2, 5097.0, 6.28], [19.8, 8730.0, 7.11]], "warn": ""}, {"id": "k3-218719", "label": "Getian GT-FC40 5000K 90CRI, domeless", "area": 30.8, "areaQuote": "segmented LES 16 segments (4S4P); luminous area 30.8 mm2 (koef3 'The luminous area is 30.8 mm² in size')", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-getian-gt-fc40-5000k-90-cri/218719", "date": "2023-06-11", "pts": [[4.0, 3871.0, 12.51], [10.8, 6503.0, 14.31]], "warn": ""}, {"id": "k3-219049", "label": "Luminus SST-12-W 5000K, 70/65 CRI class, domed", "area": 2.64, "areaQuote": "The round light emitting area is 2.64 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sst-12-wxs-specialty-white-5000-k-typ-65-cri/219049", "date": "2023-07-02", "pts": [[2.0, 642.0, 3.24], [2.4, 601.0, 3.2], [3.2, 771.0, 3.49]], "warn": ""}, {"id": "k3-219346", "label": "Nichia NVSW719AC sm405 T550f26 R9050, 4000K, domeless", "area": 4.69, "areaQuote": "The luminous area is 4.69 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-nichia-nvsw719ac-sm405-t550f26-r9050-4000-k-min-90-cri-r9-50-first-led-with-stacked-dies/219346", "date": "2023-07-23", "pts": [[1.8, 804.0, 6.72], [2.2, 925.0, 6.78], [3.2, 1104.0, 6.89]], "warn": ""}, {"id": "k3-219598", "label": "Luminus SFT-70-X Specialty White 6500K, domeless", "area": 6.51, "areaQuote": "The luminous area is 6.51 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sft-70-x-specialty-white-6500-k-typ-70-cri/219598", "date": "2023-08-07", "pts": [[7.0, 3605.0, 7.1], [9.6, 3926.0, 7.58]], "warn": ""}, {"id": "k3-220770", "label": "LMP LML2AW.DC koef3 calls it LMP; not a da, domed", "area": 9.25, "areaQuote": "The luminous area is 9.25 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-lmp-lml2aw-dc-possibly-a-sst-40-but-with-good-tint-and-high-efficacy/220770", "date": "2023-10-23", "pts": [[6.0, 2062.0, 3.43], [9.8, 2600.0, 3.92]], "warn": ""}, {"id": "k3-221071", "label": "YLX N3535B cool white round die", "area": 1.4, "areaQuote": "The luminous area is 1.40 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-ylx-n3535b-cool-white-round-die-led-with-high-luminance-for-3535-footprint-but-very-green/221071", "date": "2023-11-11", "pts": [[5.0, 1155.0, 3.43], [9.4, 1421.0, 3.87]], "warn": ""}, {"id": "k3-221112", "label": "Nichia NV4WB35AMT sm653 R9080 E900, 6500K, domeless", "area": 9.83, "areaQuote": "The luminous area is 9.83 mm² in size. ... 9.73 mm² specified by Nichia (3.12 x 3.12 mm illuminated area).", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-nichia-nv4wb35amt-sm653-r9080-e900-very-high-light-quality-but-limited-performance/221112", "date": "2023-11-13", "pts": [[1.8, 1227.0, 5.86], [3.4, 2031.0, 6.09], [5.0, 2521.0, 6.24]], "warn": ""}, {"id": "k3-222273", "label": "Osram OSCONIQ 3737 PUSTA1.PM DURIS P9, 6500K typ 72CRI", "area": 6.9, "areaQuote": "The luminous area is 6.9 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-osram-osconiq-3737-pusta1-pm-duris-p9-6500-k-typ-72-cri/222273", "date": "2024-01-16", "pts": [[3.0, 1318.0, 3.07], [5.0, 1965.0, 3.27], [7.2, 2473.0, 3.54]], "warn": ""}, {"id": "k3-222391", "label": "LatticePower CSP2323 6000K 90CRI, domeless", "area": 3.2, "areaQuote": "The luminous area is 3.2 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-latticepower-csp2323-6000-k-90-cri-led-used-in-wurkkos-ts10-mini/222391", "date": "2024-01-22", "pts": [[1.4, 455.0, 3.09], [3.2, 683.0, 3.41]], "warn": ""}, {"id": "k3-49731", "label": "Lumileds Luxeon V CSP, domed", "area": 9.83, "areaQuote": "With dome on the LES is 9.83 mm²", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-lumileds-luxeon-v-csp-4000-k-70-cri-high-flux-and-nice-beam-pattern-but-differences-in-vf/49731", "date": "2018-02-04", "pts": [[1.4, 587.6, 2.98], [4.8, 1591.0, 3.42], [7.6, 2149.0, 3.7], [10.6, 2405.0, 3.88]], "warn": ""}, {"id": "k3-49788", "label": "Luminus SST-40-W Specialty White N4 BA dome and dedomed, lateral si", "area": 8.02, "areaQuote": "The LES equals with dome 8.02 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sst-40-w-specialty-white-n4-ba-dedomed-here-it-is-the-next-gen-xm-l2/49788", "date": "2018-02-07", "pts": [[0.7, 357.0, 2.84], [5.0, 1843.0, 3.31], [7.4, 2388.0, 3.56], [8.4, 2116.0, 3.69], [9.2, 2669.0, 3.84]], "warn": "non-monotonic points (mixed variants in one thread?)"}, {"id": "k3-50303", "label": "Nichia NVSW319AT sm503 D400f2 5000K, typ 83 CRI, hexagonal, domeless", "area": 5.72, "areaQuote": "The die is 5.72 mm² (only top view)", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-nichia-nvsw319at-sm503-d400f2-r8000-cct-5000-k-typ-83-cri/50303", "date": "2018-03-10", "pts": [[1.05, 438.8, 2.96], [2.0, 743.8, 3.1], [2.4, 852.9, 3.14], [4.6, 1318.0, 3.3], [7.8, 1592.0, 3.46]], "warn": ""}, {"id": "k3-48945", "label": "Osram SYNIOS P2720 DMLQ31.SG white, small chip, 2.75 x 2., domeless", "area": 0.503, "areaQuote": "The total light emitting surface area (LES) is 0.503 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-osram-synios-p2720-dmlq31-sg-white-small-chip-but-big-in-luminance-at-low-current/48945", "date": "2017-12-24", "pts": [[0.35, 122.1, 2.97], [0.7, 215.7, 3.11], [1.75, 410.7, 3.41], [2.5, 461.2, 3.6]], "warn": ""}, {"id": "k3-48963", "label": "Cree XLamp CXA1304 COB 9V variant, B4 color kit E1,, domeless", "area": 7.86, "areaQuote": "a total of 7.86 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-cxa1304-cob-b4-color-kit-e1-6500-k-are-cobs-suitable-for-flashlight-use-maybe/48963", "date": "2017-12-26", "pts": [[0.4, 538.0, 9.43], [1.0, 1024.0, 10.77], [1.2, 1134.7, 11.18], [1.75, 1289.3, 12.23]], "warn": ""}, {"id": "k3-71860", "label": "Cree XLamp XP-E2 Q4 Y2 PC Amber 1500K class, domed", "area": 3.23, "areaQuote": "The light area with dome is 3.23 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-e2-q4-y2-pc-amber/71860", "date": "2022-11-29", "pts": [[0.35, 99.0, 3.01], [1.0, 228.0, 3.27], [2.2, 367.0, 3.57], [3.9, 430.0, 3.9]], "warn": ""}, {"id": "k3-71898", "label": "Cree XLamp XM-L2 U3 color kit 51 new design, 2022 PCN version, domed", "area": 7.9, "areaQuote": "The luminous area is 7.90 mm² with dome", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-new-cree-xlamp-xm-l2-u3-color-kit-51-6200-k-design-change-after-pcn-issued/71898", "date": "2022-12-03", "pts": [[0.7, 379.0, 2.8], [3.0, 1369.0, 3.18], [9.0, 3036.0, 3.85], [16.2, 3231.0, 4.44], [16.8, 3833.0, 4.48]], "warn": ""}, {"id": "k3-72137", "label": "Cree XLamp XP-P U5 color kit E3 5000K typ 65CRI, domeless", "area": 1.05, "areaQuote": "The square luminous surface is 1.05 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-p-u5-color-kit-e3-5000k-typ-65-cri/72137", "date": "2022-12-31", "pts": [[1.0, 348.0, 3.07], [3.0, 729.0, 3.51], [4.8, 849.0, 3.77]], "warn": ""}, {"id": "k3-219338", "label": "Cree XLamp XM-L3 U4 color kit E2 5700K, domed", "area": 7.75, "areaQuote": "The luminous surface is 7.75 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-xm-l3-u4-color-kit-e2-basically-more-powerful-1st-gen-xm-l2-low-vf-high-light-flux-but-not-so-nice-light-in-optics/219338", "date": "2023-07-23", "pts": [[5.0, 1952.0, 3.4], [6.6, 2349.0, 3.58], [9.4, 2798.0, 3.93]], "warn": ""}, {"id": "k3-223296", "label": "Cree XLamp XHP35.2 HI D4 color kit E3 5000K 70CRI, domeless", "area": 4.95, "areaQuote": "The luminous area is 4.95 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp35-2-hi-d4-e3-5000-k-min-70-cri-just-more-evolution-than-revolution/223296", "date": "2024-03-16", "pts": [[1.5, 1820.0, 13.84], [3.2, 2485.0, 15.91]], "warn": ""}, {"id": "k3-223311", "label": "Nichia NVSL219AT-H1 B10 sw45 4500K min 85 CRI", "area": 4.8, "areaQuote": "The luminous area is 4.8 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-nichia-nvsl219at-h1-b10-sw45-4500-k-min-85-cri-the-first-of-its-kind/223311", "date": "2024-03-17", "pts": [[1.5, 370.0, 3.64], [3.4, 536.0, 4.35]], "warn": ""}, {"id": "k3-224065", "label": "Fireflylite FFL351A 3700K 95CRI, domeless", "area": 4.3, "areaQuote": "The luminous area is 4.3 mm² in size.... The LED chip here is probably 2.0 x 2.0 mm", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-fireflylite-ffl351a-3700-k-95-cri-the-rosy-allrounder/224065", "date": "2024-05-09", "pts": [[3.0, 802.0, 3.28], [8.4, 1385.0, 3.74]], "warn": ""}, {"id": "k3-224738", "label": "Cree XLamp XP-G4 HI C1 color kit E1 6500K min 70CRI, domeless", "area": 2.0, "areaQuote": "The illuminated area is 2.0 mm²", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-g4-hi-c1-color-kit-e1-6500-k-min-70-cri-not-good-looking-beam-and-low-luminance/224738", "date": "2024-07-05", "pts": [[3.0, 1177.0, 3.33], [10.0, 2200.0, 4.04]], "warn": ""}, {"id": "k3-224789", "label": "Luminus SST-25 G2 BA 6500K 70CRI, domed", "area": 5.8, "areaQuote": "The illuminated area is 5.8 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sst-25-g2-ba-6500-k-70-cri-just-a-bigger-sst-20/224789", "date": "2024-07-09", "pts": [[3.75, 1614.0, 3.56], [7.4, 2243.0, 4.29]], "warn": ""}, {"id": "k3-227594", "label": "Fireflylite FFL707A 4000K 95CRI, 7070, domeless", "area": 25.8, "areaQuote": "The illuminated area is 25.8 mm2 in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-fireflylite-ffl707a-4000-k-95-cri-extremely-rosy-but-relatively-high-performance/227594", "date": "2025-02-14", "pts": [[7.2, 3764.0, 6.64], [15.2, 5254.0, 7.63]], "warn": ""}, {"id": "k3-227615", "label": "Cree XLamp XFL05K High Density 5000K 70CRI, 6V, domed", "area": 39.8, "areaQuote": "The illuminated area is 39.8 mm2.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xfl05k-high-density-5000-k-70-cri-6-v-similar-performance-to-xhp70-family-but-problematic-beam/227615", "date": "2025-02-16", "pts": [[15.0, 8660.0, 7.24], [17.0, 8861.0, 7.39]], "warn": ""}, {"id": "k3-228242", "label": "Luminus CBT-140-WCS cool white 5700K 70CRI, koef", "area": 14.0, "areaQuote": "The LED chip ... 14 mm2 circular illuminated area", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-luminus-cbt-140-wcs-expensive-led-with-one-of-the-biggest-led-chips-of-all-time/228242", "date": "2025-04-08", "pts": [[28.0, 4885.0, 3.89], [53.0, 6206.0, 4.43]], "warn": ""}, {"id": "k3-229647", "label": "Lumenpioneer LHP531 1800-6500K, 70CRI, 5050", "area": 13.5, "areaQuote": "The light-emitting area is 13.5 mm² (1800K: 14.3 mm²).", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-lumenpioneer-lhp531-all-cct-1800-3000-4000-5000-6500-k-70-cri-very-popular-5050-led-with-good-beam-and-very-good-price/229647", "date": "2025-08-04", "pts": [[9.0, 3298.0, 3.03], [25.4, 5952.0, 3.44]], "warn": ""}, {"id": "k3-220791", "label": "Luminus SFT-40 cool white 6500K color group 652, N4 bin, domeless", "area": 4.02, "areaQuote": "The luminous area is 4.02 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sft-40-3000-6500-k-warm-white-thrower-led-with-good-tint-and-perfect-light/220791", "date": "2023-10-24", "pts": [[8.0, 2521.0, 3.47], [9.0, 2703.0, 3.55], [14.2, 3208.0, 3.97]], "warn": ""}, {"id": "k3-220791-2", "label": "Luminus SFT-40 warm white 3000K color group HB4, L5 bin, domeless", "area": 4.02, "areaQuote": "The luminous area is 4.02 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sft-40-3000-6500-k-warm-white-thrower-led-with-good-tint-and-perfect-light/220791", "date": "2023-10-24", "pts": [[8.0, 1384.0, 3.55], [9.0, 1475.0, 3.64], [13.8, 1717.0, 4.08]], "warn": ""}, {"id": "k3-222478", "label": "Moonleds MN-S3535 High CRI 6000K typ 97CRI, domed", "area": 2.2, "areaQuote": "The luminous area is 2.2 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-moonleds-mn-s3535-6000-k-typ-97-cri-r9-r12-min-90-real-daylight-led/222478", "date": "2024-01-27", "pts": [[1.0, 268.0, 3.04], [1.8, 356.0, 3.23]], "warn": ""}, {"id": "k3-222822", "label": "Cree XP-G4 B4 2B 5700K min 90CRI, dome", "area": 4.61, "areaQuote": "The luminous area is 4.61 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-cree-xp-g4-b4-2b-5700-k-min-90-cri-r9-min-50/222822", "date": "2024-02-18", "pts": [[3.0, 1030.0, 3.29], [10.2, 1844.0, 4.01]], "warn": ""}, {"id": "k3-222962", "label": "Luminus SFT-12 F4 BC 6500K typ 70CRI, domeless", "area": 1.27, "areaQuote": "The luminous area is 1.27 mm² in size.", "areaVerified": true, "url": "https://budgetlightforum.com/t/led-test-review-luminus-sft-12-f4-bc-6500-k-typ-70-cri/222962", "date": "2024-02-25", "pts": [[1.8, 605.0, 3.22], [5.0, 1070.0, 3.89]], "warn": ""}, {"id": "k3-49020", "label": "Cree XLamp XHP70.2 P2 40E 4000K, quad-die flip-chip, 6, domed", "area": 31.52, "areaQuote": "total LES area of the XHP70.2 is 31.52 mm²", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp70-2-p2-40e-4000-k-the-second-generation-of-extreme-overcurrent-and-light-flux-capability/49020", "date": "2017-12-28", "pts": [[2.1, 1876.0, 5.73], [4.8, 3810.0, 6.09], [15.0, 8379.0, 6.95], [20.0, 9228.0, 7.29]], "warn": ""}, {"id": "k3-49237", "label": "Cree XLamp XP-L2 V5 40E 70CRI, domed", "area": 10.41, "areaQuote": "die 10.41 mm² domed, 5.581 mm² dedomed", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-l2-v5-40e-u6-40h-90-cri-high-light-flux-and-low-vf-but-very-huge-spread-in-performance/49237", "date": "2018-01-09", "pts": [[3.0, 1184.6, 3.34], [7.5, 2147.0, 3.99], [12.0, 2606.0, 4.39], [13.0, 2438.0, 3.91]], "warn": ""}, {"id": "k3-49328", "label": "Lumileds Luxeon MZ 5700K min 90CRI LMZ9-QW57, 3V, quad-die flip, domeless", "area": 7.92, "areaQuote": "The total LES is 7.92 mm²", "areaVerified": false, "url": "https://budgetlightforum.com/t/led-test-review-lumileds-luxeon-mz-5700-k-min-90-cri-3v-finally-high-cri-high-power-beautiful-light/49328", "date": "2018-01-15", "pts": [[2.8, 867.8, 2.9], [4.8, 1344.6, 3.0], [5.5, 1492.6, 3.04], [9.0, 2173.6, 3.2], [16.8, 2909.1, 3.48]], "warn": ""}];
  // effective area (mm²) at current a, from the luminance rows: Φ(a_i) / (π L_i), interpolated (clamped at the ends)
  function areaAt(m, a) {
    const tab = m.lum.map(([ai, L]) => [ai, lerp(m.curve, ai) / (Math.PI * L)]).filter(([, A]) => A > 0);
    return tab.length ? lerp(tab, a) : NaN;
  }
  // a model built from pasted rows (the "measured" emitter): rows = [[A, lm, cd/mm²], …], optional vf rows [[A, V]]
  function measuredModel(meas) {
    const rows = (meas && meas.rows || []).filter((r) => r[0] > 0 && r[1] > 0).sort((a, b) => a[0] - b[0]);
    if (!rows.length) return null;
    return { label: meas.name || 'Measured', curve: [[0, 0]].concat(rows.map((r) => [r[0], r[1]])), lum: rows.filter((r) => r[2] > 0).map((r) => [r[0], r[2]]), vf: meas.vf && meas.vf.length ? meas.vf : null, maxA: rows[rows.length - 1][0] };
  }
  const PRESETS = {
    sketch: {
      label: 'Sketch LED · 1 × 1 mm, 1,000 lm',
      note: 'The app’s default emitter: a 1 mm² Lambertian die at 1,000 lm (≈ 318 cd/mm², brighter than most real LEDs).',
      set: { kind: 'planar', shape: 'rect', w: 1, h: 1, dist: 'lambertian', power: 1000 },
    },
    generic: {
      label: 'Generic automotive LED · 2 × 2 mm, 150 cd/mm² (1,885 lm)',
      note: 'The default emitter: a 2 × 2 mm Lambertian die at 150 cd/mm² (Φ = π L A = 1,885 lm). About where a well-cooled production automotive or flashlight LED sits under 4500 K without cooking it (Anya, 10-04: ~200 is hot, 300 sustained is a pipe dream).',
      set: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian', power: 1885 },
    },
    'generic-warm': {
      label: 'Generic warm LED · 3000 K high CRI · 2 × 2 mm, 100 cd/mm² (1,257 lm)',
      note: 'A 3000 K, R9 ≥ 50 class die at what such phosphors reach without heat death, ~100 cd/mm² (Anya, 10-04). Same 2 × 2 mm die as the generic LED.',
      set: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian', power: 1257 },
    },
    'sft40-3000k': {
      label: 'Luminus SFT-40-W · 3000 K 95 CRI · 1.97 mm',
      note: 'Luminus SFT-40-WxH datasheet (PDS-003302 Rev 01): flat window, 1.97 × 1.97 mm emitting area, Lambertian (120° FWHM), 4 A absolute maximum. "Datasheet" flux = bin D9 minimum at Tj 85 °C; "koef3" = one sample on a fan-cooled copper board at a 25 °C solder point.',
      set: { kind: 'planar', shape: 'rect', w: 1.97, h: 1.97, dist: 'lambertian' },
      drive: { models: { datasheet: { label: 'Datasheet (bin D9 min, Tj 85 °C; > 4 A estimated)', curve: SFT40_DS, vf: SFT40_DS_VF, maxA: 14.8 }, koef3: { label: 'koef3 test (25 °C solder point, overdriven; his luminance)', curve: SFT40_CURVE, vf: SFT40_VF, maxA: 14.8, lum: [[0.7, 15.2], [2.8, 49.9], [14.8, 127.6]] } }, model: 'datasheet', ratedA: 4, maxW: 13, defaultA: 3 },
    },
    'sft40-cw': {
      label: 'Luminus SFT-40-W (cool white, CRI ~70) · 1.97 mm',
      note: 'Luminus SFT-40-WxS/WxE datasheet (PDS-003134 Rev 05): 5000/5700/6500 K, CRI ~70, flat window, 1.97 × 1.97 mm, Lambertian (120° FWHM), 8 A and 29 W maximum. Flux = the chosen bin\u2019s minimum at Tj 85 °C (Luminus\u2019 calculated values away from 1.5 A).',
      set: { kind: 'planar', shape: 'rect', w: 1.97, h: 1.97, dist: 'lambertian' },
      drive: { models: {
        n4: { label: '5000 / 5700 K · bin N4 min', curve: cwBin(303, 594, 760, 1057, 1550, 1758, 2128), vf: CW_VF, maxA: 8 },
        n5: { label: '6500 K · bin N5 min', curve: cwBin(323, 634, 812, 1129, 1655, 1877, 2272), vf: CW_VF, maxA: 8 },
        p3: { label: 'Top bin P3 min (any CCT, if you get one)', curve: cwBin(364, 713, 913, 1269, 1861, 2110, 2555), vf: CW_VF, maxA: 8 },
      }, model: 'n5', ratedA: 8, maxW: 29, defaultA: 6 },
    },
    'sft25r': {
      label: 'Luminus SFT-25R-WG · CRI > 90 · Ø 1.70 mm round',
      note: 'Luminus SFT-25R-WG datasheet (PDS-003551 Rev 03): round flat-window emitter Ø 1.70 mm, ≈ Lambertian (116° FWHM), 5 A and 18 W maximum, 2700–5700 K. Flux = the chosen bin\u2019s minimum at Tj 85 °C (Luminus\u2019 calculated values away from 1.5 A).',
      set: { kind: 'planar', shape: 'disc', radius: 0.85, dist: 'lambertian' },
      drive: { models: {
        f1: { label: '3000 K · bin F1 min', curve: r25Bin(295, 415, 718, 884, 1021), vf: R25_VF_WARM, maxA: 5 },
        d9: { label: '2700 / 3000 K · bin D9 min', curve: r25Bin(280, 395, 683, 841, 972), vf: R25_VF_WARM, maxA: 5 },
        f3: { label: '4000–5700 K · bin F3 min', curve: r25Bin(330, 465, 804, 990, 1144), vf: R25_VF_COOL, maxA: 5 },
        f5: { label: 'Top bin F5 min', curve: r25Bin(369, 520, 900, 1108, 1279), vf: R25_VF_COOL, maxA: 5 },
      }, model: 'f1', ratedA: 5, maxW: 18, defaultA: 4 },
    },
    ...Object.fromEntries(Object.entries(KOEF3).map(([id, k]) => [id, {
      label: k.label + ' · koef3', measured: true,
      note: 'koef3\u2019s measurements (BLF/TLF, Cu board, fan-cooled, 25 °C solder point): flux and Vf read off his chart, luminance from his tables. The die is a square of the EFFECTIVE area Φ / (π L) at the drive current (no die size given). Max current = where his test stopped, not a rating.' + (k.note ? ' ' + k.note : ''),
      set: { kind: 'planar', shape: k.shape || 'rect', dist: 'lambertian' },
      drive: { models: Object.assign({ koef3: { label: 'koef3 test · effective area from his luminance', curve: k.flux, vf: k.vf, lum: k.lum, maxA: k.flux[k.flux.length - 1][0], shape: k.shape } },
        k.domeOf ? { dome: { label: 'koef3 flux · dedomed die + real dome (n 1.41, r ' + k.domeR + ' mm)', curve: k.flux, vf: k.vf, maxA: k.flux[k.flux.length - 1][0], areaFrom: { curve: KOEF3[k.domeOf].flux, lum: KOEF3[k.domeOf].lum }, set: { dome: { r: k.domeR, n: 1.41, z: 0 } } } } : {},
        k.geomArea ? { die: { label: 'koef3 flux · die size ' + k.geomArea + ' mm²', curve: k.flux, vf: k.vf, maxA: k.flux[k.flux.length - 1][0], set: k.shape === 'disc' ? { shape: 'disc', radius: +Math.sqrt(k.geomArea / Math.PI).toFixed(4) } : { shape: 'rect', w: +Math.sqrt(k.geomArea).toFixed(4), h: +Math.sqrt(k.geomArea).toFixed(4) } } } : {}),
        model: 'koef3', ratedA: Infinity, defaultA: k.defaultA },
    }])),
    ...Object.fromEntries(KOEF3_2PT.map((k) => [k.id, {
      label: k.label + ' · koef3 2-pt', measured: true, lowConfidence: true,
      note: 'LOW CONFIDENCE — koef3’s quoted points only (' + k.pts.map((p) => p[0] + ' A ' + p[1] + ' lm').join(', ') + '), joined by straight lines from 0; mid-current flux may be off by 10–20 %. Emitting area ' + k.area + ' mm² (' + (k.areaVerified ? 'his sentence verified in the thread' : 'NOT verified verbatim') + ': “' + k.areaQuote + '”), modelled as a square Lambertian die. ' + k.url + ' (' + k.date + ').' + (k.warn ? ' Warning: ' + k.warn + '.' : ''),
      set: { kind: 'planar', shape: 'rect', w: +Math.sqrt(k.area).toFixed(4), h: +Math.sqrt(k.area).toFixed(4), dist: 'lambertian' },
      drive: { models: { pts2: { label: 'koef3 quoted points (2-pt, low confidence)', curve: [[0, 0]].concat(k.pts.map((p) => [p[0], p[1]])), vf: k.pts.map((p) => [p[0], p[2]]), maxA: k.pts[k.pts.length - 1][0] } }, model: 'pts2', ratedA: Infinity, defaultA: k.pts[0][0] },
    }])),
    measured: {
      label: 'Measured LED (paste flux + luminance rows)', measured: true, custom: true,
      note: 'Your own rows: current (A), flux (lm), luminance (cd/mm²), e.g. from a koef3 test. Flux follows the rows; the die is a square (or disc) of the effective area Φ / (π L), interpolated at the drive current. Lambertian.',
      set: { kind: 'planar', dist: 'lambertian' },
      drive: { models: {}, model: 'rows', ratedA: Infinity, defaultA: 1 },
    },
    hb3: {
      label: 'HB3 / 9005 halogen · axial filament 5.1 mm',
      note: 'UN R37 sheets HB3/1–4 (E/ECE/324/Rev.1/Add.36/Rev.7): filament length f = 5.1 mm on the reference axis, centre e = 31.5 mm from the reference plane; 1,860 lm ± 12 % at 13.2 V (1,300 lm at 12 V). Filament DIAMETER is not on those sheets: 1.4 mm assumed (edit Radius). Opaque coil (Lambertian skin). Not modelled: the glass bulb, the cap and holder shadowing light behind it.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 5.1, emission: 'surface', dist: 'isotropic', power: 1860 },
      axis: [1, 0, 0],                                   // axial filament: along the throw axis, as in a reflector headlamp
      volts: { 12: 1300, 13.2: 1860 },
      halogen: true,
    },
    h1: {
      label: 'H1 halogen · axial filament 5.0 mm', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets H1/1–2: axial filament, f = 5.0 ± 0.5 mm, e = 25.0 mm; 1,550 lm ± 15 % at 13.2 V (reference 1,150 lm at 12 V). Diameter NOT on the sheet (g = 0.5 d ± 0.5 d only): 1.4 mm assumed. The lamp has a metal CAP on the tip, obscuration angle ε = 45° ± 12° (not modelled in the source; projector-liou cap mode “bulb” uses it). The bulb Liou 2009 used.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 5.0, emission: 'surface', dist: 'isotropic', power: 1550 },
      axis: [1, 0, 0],
      volts: { 12: 1150, 13.2: 1550 },
      obscuration: { kind: 'cap', angle: 45, sheet: 'H1/1 ε 45° ± 12°' },
    },
    h7: {
      label: 'H7 halogen · axial filament 4.1 mm, black top', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets H7/1–3: axial filament on the reference axis (h1 = h2 = 0), f = 4.1 mm, e = 25.0 mm; 1,500 lm ± 10 % at 13.2 V (reference 1,100 lm at 12 V). Diameter: the sheet’s objective d max. 1.3 mm (12 V). BLACK TOP required: covers the bulb tip back at least to where γ3 = 30° (min.) crosses the bulb (not modelled in the source; projector-liou cap mode “bulb” uses it). Glass distortion-free within γ1 40° / γ2 50°.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.65, length: 4.1, emission: 'surface', dist: 'isotropic', power: 1500 },
      axis: [1, 0, 0],
      volts: { 12: 1100, 13.2: 1500 },
      obscuration: { kind: 'black top', angle: 30, sheet: 'H7/2–3 γ3 30° min.' },
    },
    h9: {
      label: 'H9 halogen · axial filament 4.8 mm', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets H9/1–3: axial filament, f = 4.8 mm, e = 25.0 mm; 2,100 lm ± 10 % at 13.2 V (reference 1,500 lm at 12 V, 1,650 lm at 12.2 V). Diameter: the sheet’s objective d max. 1.4 mm. No obscuration on the sheet. H9B: same filament, 1,650 lm.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 4.8, emission: 'surface', dist: 'isotropic', power: 2100 },
      axis: [1, 0, 0],
      volts: { 12: 1500, 13.2: 2100 },
    },
    h11: {
      label: 'H11 halogen · axial filament 4.5 mm, black top', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets H11/1–3: axial filament (h1 = h2 = 0), f = 4.5 mm, e = 25.0 mm; 1,350 lm ± 10 % at 13.2 V (reference 1,000 lm at 12 V). Diameter: the sheet’s objective d max. 1.4 mm. BLACK TOP required: γ3 = 30° min. (not modelled in the source; projector-liou cap mode “bulb” uses it).',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 4.5, emission: 'surface', dist: 'isotropic', power: 1350 },
      axis: [1, 0, 0],
      volts: { 12: 1000, 13.2: 1350 },
      obscuration: { kind: 'black top', angle: 30, sheet: 'H11/2–3 γ3 30° min.' },
    },
    hir2: {
      label: 'HIR2 / 9012 halogen · axial filament 5.3 mm', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets HIR2/1–2: axial filament, f = 5.3 mm; 1,875 lm ± 15 % at 13.2 V (reference 1,355 lm at 12 V). Diameter: the sheet’s d 1.6 mm MAX (a real coil may be thinner). No obscuration on the sheet.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.8, length: 5.3, emission: 'surface', dist: 'isotropic', power: 1875 },
      axis: [1, 0, 0],
      volts: { 12: 1355, 13.2: 1875 },
    },
    hb4: {
      label: 'HB4 / 9006 halogen · axial filament 5.1 mm, black top', halogen: true,
      note: 'UN R37 Rev.7 (E/ECE/324/Rev.1/Add.36/Rev.7, 2012; Anya’s copy R037r7e.pdf), sheets HB4/1–3: axial filament, f = 5.1 mm, e = 31.5 mm; 1,095 lm ± 15 % at 13.2 V (reference 825 lm at 12 V). Diameter NOT on the sheet: 1.4 mm assumed. The drawing shows a black bulb top (“shall extend to at least angle γ3”); its angle not read yet, so no obscuration data here.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 5.1, emission: 'surface', dist: 'isotropic', power: 1095 },
      axis: [1, 0, 0],
      volts: { 12: 825, 13.2: 1095 },
    },
  };

  // set src to preset id (position kept).  opts.amps / opts.volts for the drive.  Returns the applied preset.
  // the flux model a source uses under preset p (the pasted rows for the measured emitter)
  function modelOf(src, p) {
    if (p.custom) return measuredModel(src.measured);
    return p.drive.models[src.fluxModel] || p.drive.models[p.drive.model];
  }
  function apply(src, id, opts) {
    const p = PRESETS[id]; if (!p) return null;
    Object.assign(src, JSON.parse(JSON.stringify(p.set)));
    if (p.axis) { src.axis = p.axis.slice(); src.roll = 0; }
    if (p.obscuration) src.obscuration = JSON.parse(JSON.stringify(p.obscuration)); else delete src.obscuration;      // the bulb's cap / black top (R37), carried with the scene so solvers in a worker see it
    src.preset = id;
    delete src.effArea; delete src.dome;                  // a dome comes only with a model that has one
    if (p.custom && opts && opts.measured) src.measured = JSON.parse(JSON.stringify(opts.measured));
    if (p.custom && !src.shape) src.shape = (src.measured && src.measured.shape) || 'rect';
    if (p.drive) {
      if (!p.custom) src.fluxModel = opts && p.drive.models[opts.model] ? opts.model : (p.drive.models[src.fluxModel] ? src.fluxModel : p.drive.model);
      else src.fluxModel = 'rows';
      const m = modelOf(src, p);
      if (!m) return p;                                   // the measured emitter before any rows: geometry left as is
      src.driveA = opts && opts.amps > 0 ? Math.min(m.maxA, opts.amps) : (src.driveA > 0 ? Math.min(m.maxA, src.driveA) : Math.min(m.maxA, p.drive.defaultA));
      src.power = Math.round(lerp(m.curve, src.driveA));
      if (m.set) Object.assign(src, JSON.parse(JSON.stringify(m.set)));   // a model with a fixed die (e.g. the datasheet die size) or a dome
      const am = m.areaFrom || m;                         // the die's own effective area (a domed model: the dedomed sample's)
      if (am.lum && am.lum.length) {                      // measured: the die is the effective area at this current
        const A = areaAt(am, src.driveA);
        if (A > 0) {
          if ((p.custom && src.measured && src.measured.shape === 'disc') || m.shape === 'disc') { src.shape = 'disc'; src.radius = +Math.sqrt(A / Math.PI).toFixed(4); }
          else { src.shape = 'rect'; src.w = src.h = +Math.sqrt(A).toFixed(4); }
          src.effArea = +A.toFixed(4);
        }
      }
    } else { delete src.driveA; delete src.fluxModel; }
    if (p.volts) { src.volts = opts && p.volts[opts.volts] ? opts.volts : (p.volts[src.volts] ? src.volts : 13.2); src.power = p.volts[src.volts]; }
    else delete src.volts;
    return p;
  }
  // the preset's electrical side at the source's current drive: { amps, vf, watts, lmPerW } (LEDs) or null
  function electrical(src) {
    const p = PRESETS[src.preset]; if (!p || !p.drive || !(src.driveA > 0)) return null;
    const m = modelOf(src, p); if (!m) return null;
    const vf = m.vf ? lerp(m.vf, src.driveA) : NaN, w = vf * src.driveA;
    return { amps: src.driveA, vf, watts: w, lmPerW: src.power / w, overRated: src.driveA > p.drive.ratedA + 1e-9, ratedA: p.drive.ratedA, maxA: m.maxA, overPower: p.drive.maxW > 0 && w > p.drive.maxW, maxW: p.drive.maxW, extrapolated: src.fluxModel === 'datasheet' && src.driveA > p.drive.ratedA };
  }
  // does the source still match its preset's geometry and emission (or has it been edited since)?
  function matches(src) {
    const p = PRESETS[src.preset]; if (!p) return false;
    const m = p.drive && !p.custom ? p.drive.models[src.fluxModel] : null;
    if (m && m.set) for (const [k, v] of Object.entries(m.set)) if (typeof v === 'object' ? JSON.stringify(src[k]) !== JSON.stringify(v) : src[k] !== v) return false;
    if (src.dome && !(m && m.set && m.set.dome)) return false;          // a dome added by hand
    const geo = ['w', 'h', 'radius', 'shape'].concat(m && m.set ? Object.keys(m.set) : []);               // a measured die follows the drive current: compare its area instead
    for (const [k, v] of Object.entries(p.set)) if (k !== 'power' && !(src.effArea > 0 && geo.includes(k)) && src[k] !== v) return false;
    if (src.effArea > 0) {                // the die follows the drive current: check it still has the effective area
      const A = src.shape === 'disc' ? Math.PI * src.radius * src.radius : src.w * src.h;
      if (Math.abs(A / src.effArea - 1) > 0.01) return false;
    }
    return true;
  }

  // surface luminance (cd/mm²) of a Lambertian planar source: L = Φ / (π A)
  // (domed: of the apparent emitter, the die magnified by the dome — what a luminance meter sees from outside)
  const luminanceOf = (src) => { if (src.kind === 'planar' && src.dist === 'lambertian') { const s = RF.Source.apparent(src); return s.power / (Math.PI * (s.shape === 'disc' ? Math.PI * s.radius * s.radius : s.w * s.h)); } return null; };
  // parse pasted rows: one per line, "A lm cd/mm²" (commas, tabs, spaces; thousands separators like 1,500 allowed when the
  // numbers are tab/space separated).  Lines that don't hold three numbers are skipped.
  function parseRows(text) {
    const rows = [];
    for (const line of String(text || '').split(/\n/)) {
      let parts = line.trim().split(/[\t ;]+/).filter(Boolean);
      if (parts.length < 3) parts = line.trim().split(/,\s*/).filter(Boolean);
      const nums = parts.map((x) => parseFloat(x.replace(/,(?=\d{3}\b)/g, ''))).filter((x) => isFinite(x));
      if (nums.length >= 3) { let [a, lm, L] = nums; if (a > 50) a /= 1000; rows.push([a, lm, L]); }   // mA → A
    }
    return rows;
  }
  RF.SourcePresets = { luminanceOf, areaAt, measuredModel, parseRows, KOEF3, PRESETS, apply, electrical, matches, lumensAt: (id, a, model) => { const d = PRESETS[id] && PRESETS[id].drive; return d ? lerp((d.models[model] || d.models[d.model]).curve, a) : NaN; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
