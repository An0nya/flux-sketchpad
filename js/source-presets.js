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
  const KOEF3_2PT = [{"id":"k3-219467","label":"Cree CLP6B-WKW, domed","area":0.26,"areaQuote":"The luminous area is 3 x 0.26 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-clp6b-wkw-5000-6500-k-low-power-3-channel-emitter-in-plcc6-format/219467","date":"2023-07-29","pts":[[0.15,42,3.34],[0.8,115.1,4.74]],"warn":"","tr":{"flux":[[0.1,28.9],[0.2,52.7],[0.3,71.5],[0.4,86.7],[0.5,98.7],[0.6,107],[0.7,113],[0.8,115]],"vf":[[0.1,3.17],[0.2,3.51],[0.3,3.77],[0.4,4],[0.5,4.2],[0.6,4.39],[0.7,4.58],[0.8,4.74]],"lum":null,"from":"chart","name":"Cree CLP6B-WKW (5000 - 6500 K, low-power 3-channel emitter in PLCC6 format)","err":2.9,"note":""}},{"id":"k3-223546","label":"Cree XLamp XHP70.3 HI N4 5D, 4000K 70CRI, domeless","area":14.6,"areaQuote":"The luminous area is 14.6 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp70-3-hi-n4-color-kit-5d-4000-k-70-cri-domeless-performance-even-at-20-a/223546","date":"2024-04-01","pts":[[7.2,5097,6.28],[19.8,8730,7.11]],"warn":"","tr":{"flux":[[1,928],[2,1737],[3,2487],[4,3189],[5,3834],[6,4431],[7,4993],[8,5509],[9,5986],[10,6428],[11,6826],[12,7206],[13,7532],[14,7833],[15,8088],[16,8297],[17,8469],[18,8604],[19,8685],[19.95,8705]],"vf":[[1,5.51],[2,5.69],[3,5.83],[4,5.96],[5,6.07],[6,6.17],[7,6.27],[8,6.35],[9,6.43],[10,6.51],[11,6.58],[12,6.65],[13,6.71],[14,6.78],[15,6.84],[16,6.9],[17,6.96],[18,7.01],[19,7.07],[19.95,7.12]],"lum":[[0.7,9.1],[2.8,32.1],[19.8,124.3]],"from":"chart","name":"Cree XLamp XHP70.3 HI N4 color kit 5D (≈ 4000 K, 70 CRI) - domeless performance even at 20 A!","err":0.3,"note":""}},{"id":"k3-218719","label":"Getian GT-FC40 5000K 90CRI, domeless","area":30.8,"areaQuote":"segmented LES 16 segments (4S4P); luminous area 30.8 mm2 (koef3 'The luminous area is 30.8 mm² in size')","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-getian-gt-fc40-5000k-90-cri/218719","date":"2023-06-11","pts":[[4,3871,12.51],[10.8,6503,14.31]],"warn":"","tr":{"flux":[[1,1186],[2,2196],[3,3071],[4,3855],[5,4524],[6,5065],[7,5619],[8,6011],[9,6296],[10,6445],[10.85,6488]],"vf":[[1,11.3],[2,11.82],[3,12.24],[4,12.6],[5,12.93],[6,13.22],[7,13.48],[8,13.72],[9,13.96],[10,14.18],[10.85,14.35]],"lum":[[0.7,9.5],[4,43.2],[10.8,72.8]],"from":"chart","name":"Getian GT-FC40 (≈ 5000K, 90 CRI)","err":0.4,"note":""}},{"id":"k3-219049","label":"Luminus SST-12-W 5000K, 70/65 CRI class, domed","area":2.64,"areaQuote":"The round light emitting area is 2.64 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sst-12-wxs-specialty-white-5000-k-typ-65-cri/219049","date":"2023-07-02","pts":[[2,642,3.24],[2.4,601,3.2],[3.2,771,3.49]],"warn":"","tr":{"flux":[[0.5,229],[1,394],[1.5,539],[2,646],[2.5,725],[3,771],[3.15,774],[3.2,771]],"vf":[[0.5,2.88],[1,3.03],[1.5,3.16],[2,3.27],[2.5,3.36],[3,3.47],[3.15,3.49],[3.2,3.49]],"lum":[[0.35,19.7],[0.7,37.5],[2.6,101.2]],"from":"chart","name":"Luminus SST-12-WxS Specialty White (≈ 5000 K, typ. 65 CRI)","err":18,"note":""}},{"id":"k3-219346","label":"Nichia NVSW719AC sm405 T550f26 R9050, 4000K, domeless","area":4.69,"areaQuote":"The luminous area is 4.69 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-nichia-nvsw719ac-sm405-t550f26-r9050-4000-k-min-90-cri-r9-50-first-led-with-stacked-dies/219346","date":"2023-07-23","pts":[[1.8,804,6.72],[2.2,925,6.78],[3.2,1104,6.89]],"warn":"","tr":{"flux":[[0.5,284],[1,516],[1.5,707],[2,868],[2.5,1001],[3,1091],[3.35,1106]],"vf":[[0.5,6.37],[1,6.55],[1.5,6.67],[2,6.76],[2.5,6.82],[3,6.87],[3.35,6.91]],"lum":[[0.7,25.1],[1.8,53],[3.2,72.9]],"from":"chart","name":"Nichia NVSW719AC sm405 T550f26 R9050 (≈ 4000 K, min. 90 CRI / R9 50) - first LED with stacked dies","err":0.4,"note":""}},{"id":"k3-219598","label":"Luminus SFT-70-X Specialty White 6500K, domeless","area":6.51,"areaQuote":"The luminous area is 6.51 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sft-70-x-specialty-white-6500-k-typ-70-cri/219598","date":"2023-08-07","pts":[[7,3605,7.1],[9.6,3926,7.58]],"warn":"","tr":{"flux":[[1,849],[2,1531],[3,2103],[4,2588],[5,2993],[6,3336],[7,3604],[8,3790],[9,3900],[9.57,3924],[9.6,3926]],"vf":[[1,5.68],[2,6],[3,6.26],[4,6.49],[5,6.69],[6,6.91],[7,7.1],[8,7.29],[9,7.48],[9.57,7.58],[9.6,7.58]],"lum":[[0.7,27.8],[2.8,89.3],[9.6,191.5]],"from":"chart","name":"Luminus SFT-70-X Specialty White (6500 K, typ. 70 CRI)","err":0,"note":""}},{"id":"k3-220770","label":"LMP LML2AW.DC koef3 calls it LMP; not a da, domed","area":9.25,"areaQuote":"The luminous area is 9.25 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-lmp-lml2aw-dc-possibly-a-sst-40-but-with-good-tint-and-high-efficacy/220770","date":"2023-10-23","pts":[[6,2062,3.43],[9.8,2600,3.92]],"warn":"","tr":{"flux":[[1,485],[2,888],[3,1236],[4,1551],[5,1822],[6,2060],[7,2265],[8,2429],[9,2550],[9.75,2598],[9.8,2600]],"vf":[[1,2.82],[2,2.97],[3,3.1],[4,3.22],[5,3.33],[6,3.44],[7,3.54],[8,3.66],[9,3.79],[9.75,3.92],[9.8,3.92]],"lum":[[2.8,41.1],[6,73],[9.8,94.2]],"from":"chart","name":"LMP LML2AW.DC - SST-40/XM-L2 clone, but with good tint and high efficacy","err":0.1,"note":""}},{"id":"k3-221071","label":"YLX N3535B cool white round die","area":1.4,"areaQuote":"The luminous area is 1.40 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-ylx-n3535b-cool-white-round-die-led-with-high-luminance-for-3535-footprint-but-very-green/221071","date":"2023-11-11","pts":[[5,1155,3.43],[9.4,1421,3.87]],"warn":"","tr":{"flux":[[1,370],[2,636],[3,848],[4,1018],[5,1155],[6,1257],[7,1337],[8,1390],[9,1417],[9.57,1421]],"vf":[[1,2.89],[2,3.07],[3,3.21],[4,3.33],[5,3.44],[6,3.54],[7,3.64],[8,3.73],[9,3.82],[9.57,3.88]],"lum":[[0.7,50.2],[2.8,145.8],[9.4,252.1]],"from":"chart","name":"YLX N3535B cool white - round-die LED with high luminance for 3535 footprint, but very green","err":0.1,"note":""}},{"id":"k3-221112","label":"Nichia NV4WB35AMT sm653 R9080 E900, 6500K, domeless","area":9.83,"areaQuote":"The luminous area is 9.83 mm² in size. ... 9.73 mm² specified by Nichia (3.12 x 3.12 mm illuminated area).","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-nichia-nv4wb35amt-sm653-r9080-e900-very-high-light-quality-but-limited-performance/221112","date":"2023-11-13","pts":[[1.8,1227,5.86],[3.4,2031,6.09],[5,2521,6.24]],"warn":"","tr":{"flux":[[0.5,389],[1,740],[1.5,1053],[2,1337],[2.5,1608],[3,1850],[3.5,2073],[4,2274],[4.5,2439],[5,2520],[5.17,2520]],"vf":[[0.5,5.49],[1,5.68],[1.5,5.8],[2,5.9],[2.5,5.98],[3,6.04],[3.5,6.11],[4,6.15],[4.5,6.2],[5,6.25],[5.17,6.26]],"lum":[[0.7,13],[2.8,41.9],[4,53.6],[5,59.4]],"from":"chart","name":"Nichia NV4WB35AMT sm653 R9080 E900 - very high light quality, but limited performance","err":0.3,"note":""}},{"id":"k3-222273","label":"Osram OSCONIQ 3737 PUSTA1.PM DURIS P9, 6500K typ 72CRI","area":6.9,"areaQuote":"The luminous area is 6.9 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-osram-osconiq-3737-pusta1-pm-duris-p9-6500-k-typ-72-cri/222273","date":"2024-01-16","pts":[[3,1318,3.07],[5,1965,3.27],[7.2,2473,3.54]],"warn":"","tr":{"flux":[[1,506],[2,940],[3,1317],[4,1659],[5,1963],[6,2224],[7,2436],[7.17,2468],[7.2,2473]],"vf":[[1,2.85],[2,2.97],[3,3.07],[4,3.17],[5,3.28],[6,3.38],[7,3.51],[7.17,3.54],[7.2,3.54]],"lum":[[0.7,12.6],[2.8,42.4],[5,67],[7.2,85.1]],"from":"chart","name":"Osram OSCONIQ 3737 PUSTA1.PM (\"DURIS P9\", ≈ 6500 K, typ. 72 CRI)","err":0.1,"note":""}},{"id":"k3-222391","label":"LatticePower CSP2323 6000K 90CRI, domeless","area":3.2,"areaQuote":"The luminous area is 3.2 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-latticepower-csp2323-6000-k-90-cri-led-used-in-wurkkos-ts10-mini/222391","date":"2024-01-22","pts":[[1.4,455,3.09],[3.2,683,3.41]],"warn":"","tr":{"flux":[[0.5,190],[1,349],[1.5,477],[2,580],[2.5,649],[3,680],[3.18,682],[3.2,683]],"vf":[[0.5,2.84],[1,2.99],[1.5,3.11],[2,3.22],[2.5,3.31],[3,3.39],[3.18,3.41],[3.2,3.41]],"lum":[[0.35,9.9],[0.7,18.2],[2.8,47.5],[3.2,48.3]],"from":"chart","name":"LatticePower CSP2323 (≈ 6000 K 90 CRI) - LED used in Wurkkos TS10 Mini","err":0.8,"note":""}},{"id":"k3-49731","label":"Lumileds Luxeon V CSP, domed","area":9.83,"areaQuote":"With dome on the LES is 9.83 mm²","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-lumileds-luxeon-v-csp-4000-k-70-cri-high-flux-and-nice-beam-pattern-but-differences-in-vf/49731","date":"2018-02-04","pts":[[1.4,587.6,2.98],[4.8,1591,3.42],[7.6,2149,3.7],[10.6,2405,3.88]],"warn":"","tr":{"flux":[[1,442],[2,802],[3,1113],[4,1393],[5,1643],[6,1870],[7,2058],[8,2207],[9,2314],[10,2380],[11,2406],[12,2369],[12.4,2331]],"vf":[[1,2.92],[2,3.08],[3,3.21],[4,3.33],[5,3.44],[6,3.55],[7,3.64],[8,3.74],[9,3.82],[10,3.9],[11,3.98],[12,4.06],[12.4,4.09]],"lum":[[2.8,42],[6,76.1],[10.6,93]],"from":"table","name":"Luxeon V CSP 4000 K Led4power sample (domed)","err":0.4,"note":""}},{"id":"k3-49788","label":"Luminus SST-40-W Specialty White N4 BA dome and dedomed, lateral si","area":8.02,"areaQuote":"The LES equals with dome 8.02 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sst-40-w-specialty-white-n4-ba-dedomed-here-it-is-the-next-gen-xm-l2/49788","date":"2018-02-07","pts":[[0.7,357,2.84],[5,1843,3.31],[7.4,2388,3.56],[8.4,2116,3.69],[9.2,2669,3.84]],"warn":"non-monotonic points (mixed variants in one thread?)"},{"id":"k3-50303","label":"Nichia NVSW319AT sm503 D400f2 5000K, typ 83 CRI, hexagonal, domeless","area":5.72,"areaQuote":"The die is 5.72 mm² (only top view)","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-nichia-nvsw319at-sm503-d400f2-r8000-cct-5000-k-typ-83-cri/50303","date":"2018-03-10","pts":[[1.05,438.8,2.96],[2,743.8,3.1],[2.4,852.9,3.14],[4.6,1318,3.3],[7.8,1592,3.46]],"warn":"","tr":{"flux":[[1,423],[2,739],[3,1000],[4,1208],[5,1378],[6,1499],[7,1573],[8,1586],[8.17,1584]],"vf":[[1,2.96],[2,3.09],[3,3.19],[4,3.26],[5,3.32],[6,3.37],[7,3.42],[8,3.47],[8.17,3.47]],"lum":[[2.8,44.2],[6,73.2],[7.8,80.4]],"from":"chart","name":"Nichia NVSW319AT sm503 D400f2 R8000 (CCT 5000 K, typ. 83 CRI)","err":1.1,"note":""}},{"id":"k3-48945","label":"Osram SYNIOS P2720 DMLQ31.SG white, small chip, 2.75 x 2., domeless","area":0.503,"areaQuote":"The total light emitting surface area (LES) is 0.503 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-osram-synios-p2720-dmlq31-sg-white-small-chip-but-big-in-luminance-at-low-current/48945","date":"2017-12-24","pts":[[0.35,122.1,2.97],[0.7,215.7,3.11],[1.75,410.7,3.41],[2.5,461.2,3.6]],"warn":"","tr":{"flux":[[0.25,92.6],[0.5,164],[0.75,228],[1,283],[1.25,333],[1.5,375],[1.75,410],[2,438],[2.25,456],[2.49,460],[2.5,461.2]],"vf":[[0.5,3.03],[0.75,3.13],[1,3.2],[1.25,3.27],[1.5,3.35],[1.75,3.41],[2,3.47],[2.25,3.54],[2.49,3.58],[2.5,3.6]],"lum":[[0.2,30.5],[0.7,89.6],[2.5,195]],"from":"chart","name":"Osram SYNIOS P2720 DMLQ31.SG white - Small chip, but big in luminance - at low current!","err":0.8,"note":"no value at A=[0.25] (curve end / line hidden); left null; axis tick labels partly missing: axis mapped from manually chosen label pixel positions"}},{"id":"k3-48963","label":"Cree XLamp CXA1304 COB 9V variant, B4 color kit E1,, domeless","area":7.86,"areaQuote":"a total of 7.86 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-cxa1304-cob-b4-color-kit-e1-6500-k-are-cobs-suitable-for-flashlight-use-maybe/48963","date":"2017-12-26","pts":[[0.4,538,9.43],[1,1024,10.77],[1.2,1134.7,11.18],[1.75,1289.3,12.23]],"warn":"","tr":{"flux":[[0.25,369],[0.5,637],[0.75,851],[1,1023],[1.25,1154],[1.5,1237],[1.75,1288],[1.89,1278]],"vf":[[0.25,9],[0.5,9.69],[0.75,10.24],[1,10.77],[1.25,11.27],[1.5,11.73],[1.75,12.25]],"lum":null,"from":"chart","name":"CXA1304 B4 COB","err":1.5,"note":"no value at A=[1.89] (curve end / line hidden); left null; comparison chart, series CXA1304_B4_COB"}},{"id":"k3-71860","label":"Cree XLamp XP-E2 Q4 Y2 PC Amber 1500K class, domed","area":3.23,"areaQuote":"The light area with dome is 3.23 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-e2-q4-y2-pc-amber/71860","date":"2022-11-29","pts":[[0.35,99,3.01],[1,228,3.27],[2.2,367,3.57],[3.9,430,3.9]],"warn":"","tr":{"flux":[[0.5,135],[1,228],[1.5,296],[2,350],[2.5,387],[3,412],[3.5,426],[4,429],[4.09,428]],"vf":[[0.5,3.09],[1,3.27],[1.5,3.41],[2,3.53],[2.5,3.63],[3,3.73],[3.5,3.83],[4,3.92],[4.09,3.94]],"lum":null,"from":"chart","name":"XP-E2 PC Amber Q4 Tsp25C","err":4.5,"note":"comparison chart, series XP-E2_PC_Amber_Q4_Tsp25C; axis tick labels partly missing: axis mapped from manually chosen label pixel positions"}},{"id":"k3-71898","label":"Cree XLamp XM-L2 U3 color kit 51 new design, 2022 PCN version, domed","area":7.9,"areaQuote":"The luminous area is 7.90 mm² with dome","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-new-cree-xlamp-xm-l2-u3-color-kit-51-6200-k-design-change-after-pcn-issued/71898","date":"2022-12-03","pts":[[0.7,379,2.8],[3,1369,3.18],[9,3036,3.85],[16.2,3231,4.44],[16.8,3833,4.48]],"warn":"","tr":{"flux":[[1,530],[2,971],[3,1371],[4,1721],[5,2043],[6,2329],[7,2588],[8,2829],[9,3037],[10,3222],[11,3377],[12,3517],[13,3629],[14,3718],[15,3779],[16,3820],[17,3831],[17.15,3829]],"vf":[[1,2.87],[2,3.04],[3,3.19],[4,3.32],[5,3.45],[6,3.56],[7,3.66],[8,3.76],[9,3.85],[10,3.95],[11,4.02],[12,4.11],[13,4.19],[14,4.27],[15,4.34],[16,4.42],[17,4.49],[17.15,4.5]],"lum":[[2.8,36],[8.6,92.1],[16.8,122.8]],"from":"chart","name":"XM-L2 U3 51 new design domed","err":18.3,"note":"comparison chart, series XM-L2_U3_51_new_design_domed; axis tick labels partly missing: axis mapped from manually chosen label pixel positions"}},{"id":"k3-72137","label":"Cree XLamp XP-P U5 color kit E3 5000K typ 65CRI, domeless","area":1.05,"areaQuote":"The square luminous surface is 1.05 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-p-u5-color-kit-e3-5000k-typ-65-cri/72137","date":"2022-12-31","pts":[[1,348,3.07],[3,729,3.51],[4.8,849,3.77]],"warn":"","tr":{"flux":[[1,341],[1.5,470],[2,574],[2.5,659],[3,727],[3.5,779],[4,821],[4.5,843],[4.77,846],[4.8,849]],"vf":[[0.5,2.89],[1,3.06],[1.5,3.2],[2,3.32],[2.5,3.42],[3,3.51],[3.5,3.58],[4,3.66],[4.5,3.72],[4.77,3.75],[4.8,3.77]],"lum":[[0.7,63.5],[2.8,162.6],[4.8,191.4]],"from":"chart","name":"XP-P U5 E3","err":2,"note":"no value at A=[0.5] (curve end / line hidden); left null; comparison chart, series XP-P_U5_E3; axis tick labels partly missing: axis mapped from manually chosen label pixel positions"}},{"id":"k3-219338","label":"Cree XLamp XM-L3 U4 color kit E2 5700K, domed","area":7.75,"areaQuote":"The luminous surface is 7.75 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-xm-l3-u4-color-kit-e2-basically-more-powerful-1st-gen-xm-l2-low-vf-high-light-flux-but-not-so-nice-light-in-optics/219338","date":"2023-07-23","pts":[[5,1952,3.4],[6.6,2349,3.58],[9.4,2798,3.93]],"warn":"","tr":{"flux":[[1,522],[2,946],[3,1327],[4,1661],[5,1955],[6,2216],[7,2438],[8,2627],[9,2759],[9.35,2798],[9.4,2798]],"vf":[[1,2.87],[2,3.03],[3,3.16],[4,3.29],[5,3.4],[6,3.52],[7,3.63],[8,3.75],[9,3.88],[9.35,3.92],[9.4,3.93]],"lum":[[0.7,14.2],[2.8,47.5],[9.4,107.5]],"from":"chart","name":"XM-L3 U4 color kit E2 - basically more powerful 1st gen XM-L2, low Vf, high light flux, but not so nice light in optics","err":0.2,"note":""}},{"id":"k3-223296","label":"Cree XLamp XHP35.2 HI D4 color kit E3 5000K 70CRI, domeless","area":4.95,"areaQuote":"The luminous area is 4.95 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp35-2-hi-d4-e3-5000-k-min-70-cri-just-more-evolution-than-revolution/223296","date":"2024-03-16","pts":[[1.5,1820,13.84],[3.2,2485,15.91]],"warn":"","tr":{"flux":[[0.5,765],[1,1354],[1.5,1815],[2,2152],[2.5,2373],[3,2476],[3.18,2484],[3.2,2485]],"vf":[[0.5,11.99],[1,13.01],[1.5,13.82],[2,14.52],[2.5,15.13],[3,15.7],[3.18,15.89],[3.2,15.91]],"lum":[[0.35,22.2],[0.75,42.9],[3.2,97.6]],"from":"chart","name":"Cree XLamp XHP35.2 HI D4 E3 (≈ 5000 K, min. 70 CRI) - just more evolution than revolution","err":0.3,"note":""}},{"id":"k3-223311","label":"Nichia NVSL219AT-H1 B10 sw45 4500K min 85 CRI","area":4.8,"areaQuote":"The luminous area is 4.8 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-nichia-nvsl219at-h1-b10-sw45-4500-k-min-85-cri-the-first-of-its-kind/223311","date":"2024-03-17","pts":[[1.5,370,3.64],[3.4,536,4.35]],"warn":"","tr":{"flux":[[0.5,157],[1,273],[1.5,369],[2,442],[2.5,497],[3,528],[3.5,534],[3.58,533]],"vf":[[0.5,3.1],[1,3.39],[1.5,3.64],[2,3.85],[2.5,4.04],[3,4.22],[3.5,4.38],[3.58,4.41]],"lum":[[0.35,7],[1.05,17.2],[3.4,31.8]],"from":"chart","name":"Nichia NVSL219AT-H1 B10 sw45 (≈ 4500 K, min. 85 CRI) - the first of its kind","err":0.6,"note":""}},{"id":"k3-224065","label":"Fireflylite FFL351A 3700K 95CRI, domeless","area":4.3,"areaQuote":"The luminous area is 4.3 mm² in size.... The LED chip here is probably 2.0 x 2.0 mm","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-fireflylite-ffl351a-3700-k-95-cri-the-rosy-allrounder/224065","date":"2024-05-09","pts":[[3,802,3.28],[8.4,1385,3.74]],"warn":"","tr":{"flux":[[1,321],[2,584],[3,800],[4,981],[5,1131],[6,1244],[7,1326],[8,1374],[9,1381],[9.17,1377]],"vf":[[1,2.96],[2,3.15],[3,3.28],[4,3.39],[5,3.49],[6,3.57],[7,3.65],[8,3.73],[9,3.79],[9.17,3.8]],"lum":[[0.2,3.7],[2.8,40.7],[8.2,73.8]],"from":"chart","name":"Fireflylite FFL351A (3700 K, 95 CRI) - the rosy allrounder","err":0.6,"note":""}},{"id":"k3-224738","label":"Cree XLamp XP-G4 HI C1 color kit E1 6500K min 70CRI, domeless","area":2,"areaQuote":"The illuminated area is 2.0 mm²","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-g4-hi-c1-color-kit-e1-6500-k-min-70-cri-not-good-looking-beam-and-low-luminance/224738","date":"2024-07-05","pts":[[3,1177,3.33],[10,2200,4.04]],"warn":"","tr":{"flux":[[1,487],[2,862],[3,1173],[4,1430],[5,1649],[6,1828],[7,1975],[8,2081],[9,2162],[9.97,2199],[10,2200]],"vf":[[1,2.96],[2,3.17],[3,3.34],[4,3.47],[5,3.59],[6,3.69],[7,3.79],[8,3.88],[9,3.96],[9.97,4.04],[10,4.04]],"lum":[[0.2,6.7],[2.8,66.7],[10,128.9]],"from":"chart","name":"Cree XLamp XP-G4 HI C1 color kit E1 (6500 K, min 70 CRI) - not good looking beam and low luminance","err":0.3,"note":""}},{"id":"k3-224789","label":"Luminus SST-25 G2 BA 6500K 70CRI, domed","area":5.8,"areaQuote":"The illuminated area is 5.8 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sst-25-g2-ba-6500-k-70-cri-just-a-bigger-sst-20/224789","date":"2024-07-09","pts":[[3.75,1614,3.56],[7.4,2243,4.29]],"warn":"","tr":{"flux":[[1,536],[2,984],[3,1358],[4,1673],[5,1927],[6,2116],[7,2222],[7.57,2236]],"vf":[[1,2.94],[2,3.18],[3,3.4],[4,3.61],[5,3.81],[6,4],[7,4.21],[7.57,4.33]],"lum":[[0.2,5.8],[2.8,61.3],[7.4,110.8]],"from":"chart","name":"Luminus SST-25 G2 BA (6500 K 70 CRI) - just a bigger SST-20","err":1.2,"note":"re-traced 2026-10-08 by Opus: original run took the image border as the plot top (flux read ~13% low); fixed with pinned axis calibration --lcal 1428.5:0,187.5:4000 --rcal 1430.5:2.5,189.5:6.5"}},{"id":"k3-227594","label":"Fireflylite FFL707A 4000K 95CRI, 7070, domeless","area":25.8,"areaQuote":"The illuminated area is 25.8 mm2 in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-fireflylite-ffl707a-4000-k-95-cri-extremely-rosy-but-relatively-high-performance/227594","date":"2025-02-14","pts":[[7.2,3764,6.64],[15.2,5254,7.63]],"warn":"","tr":{"flux":[[1,697],[2,1309],[3,1873],[4,2389],[5,2860],[6,3293],[7,3683],[8,4031],[9,4329],[10,4580],[11,4793],[12,4969],[13,5103],[14,5194],[15,5240],[16,5233],[16.95,5160]],"vf":[[1,5.52],[2,5.76],[3,5.95],[4,6.14],[5,6.31],[6,6.46],[7,6.61],[8,6.75],[9,6.88],[10,7.01],[11,7.13],[12,7.25],[13,7.37],[14,7.49],[15,7.6],[16,7.71],[16.95,7.82]],"lum":[[0.7,6.7],[2.8,23.6],[15.2,75.5]],"from":"chart","name":"Fireflylite FFL707A 4000 K 95 CRI - extremely rosy, but (relatively) high performance","err":0.3,"note":""}},{"id":"k3-227615","label":"Cree XLamp XFL05K High Density 5000K 70CRI, 6V, domed","area":39.8,"areaQuote":"The illuminated area is 39.8 mm2.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xfl05k-high-density-5000-k-70-cri-6-v-similar-performance-to-xhp70-family-but-problematic-beam/227615","date":"2025-02-16","pts":[[15,8660,7.24],[17,8861,7.39]],"warn":"","tr":{"flux":[[1,1052],[2,1985],[3,2798],[4,3620],[5,4330],[6,5028],[7,5620],[8,6176],[9,6674],[10,7129],[11,7524],[12,7884],[13,8191],[14,8442],[15,8637],[16,8773],[17,8843],[18,8830],[18.55,8790]],"vf":[[1,5.53],[2,5.75],[3,5.94],[4,6.1],[5,6.25],[6,6.38],[7,6.5],[8,6.61],[9,6.71],[10,6.81],[11,6.9],[12,6.99],[13,7.08],[14,7.16],[15,7.23],[16,7.31],[17,7.38],[18,7.46],[18.55,7.5]],"lum":[[0.7,5.6],[2.8,19],[17,66.5]],"from":"chart","name":"Cree XLamp XFL05K High Density (5000 K 70 CRI, 6 V) - similar performance to XHP70-family, but problematic beam","err":0.3,"note":""}},{"id":"k3-228242","label":"Luminus CBT-140-WCS cool white 5700K 70CRI, koef","area":14,"areaQuote":"The LED chip ... 14 mm2 circular illuminated area","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-luminus-cbt-140-wcs-expensive-led-with-one-of-the-biggest-led-chips-of-all-time/228242","date":"2025-04-08","pts":[[28,4885,3.89],[53,6206,4.43]],"warn":"","tr":{"flux":[[5,1373],[10,2420],[15,3272],[20,3972],[25,4566],[30,5069],[35,5474],[40,5794],[45,6029],[50,6158],[53.95,6197]],"vf":[[5,3.05],[10,3.32],[15,3.52],[20,3.68],[25,3.82],[30,3.94],[35,4.05],[40,4.16],[45,4.27],[50,4.37],[53.95,4.45]],"lum":[[2.8,25.1],[6,48.4],[52,194.2]],"from":"chart","name":"Luminus CBT-140-WCS - expensive LED with one of the biggest LED chips of all time","err":0.4,"note":""}},{"id":"k3-229647","label":"Lumenpioneer LHP531 1800-6500K, 70CRI, 5050","area":13.5,"areaQuote":"The light-emitting area is 13.5 mm² (1800K: 14.3 mm²).","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-lumenpioneer-lhp531-all-cct-1800-3000-4000-5000-6500-k-70-cri-very-popular-5050-led-with-good-beam-and-very-good-price/229647","date":"2025-08-04","pts":[[9,3298,3.03],[25.4,5952,3.44]],"warn":"","tr":{"flux":[[4,1723],[6,2382],[8,3002],[10,3574],[12,4086],[14,4535],[16,4943],[18,5296],[20,5570],[22,5785],[24,5919],[26,5938],[27.93,5815]],"vf":[[4,2.85],[6,2.93],[8,3],[10,3.06],[12,3.12],[14,3.17],[16,3.22],[18,3.27],[20,3.32],[22,3.36],[24,3.41],[26,3.45],[27.93,3.49]],"lum":null,"from":"chart","name":"LHP531 5000K 70CRI","err":0.3,"note":"no value at A=[2.0] (curve end / line hidden); left null; comparison chart, series LHP531_5000K_70CRI; Vf lines of the 5 CCTs lie within ~0.05 V of each other; Vf per CCT is least reliable"}},{"id":"k3-220791","label":"Luminus SFT-40 cool white 6500K color group 652, N4 bin, domeless","area":4.02,"areaQuote":"The luminous area is 4.02 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sft-40-3000-6500-k-warm-white-thrower-led-with-good-tint-and-perfect-light/220791","date":"2023-10-24","pts":[[8,2521,3.47],[9,2703,3.55],[14.2,3208,3.97]],"warn":"","tr":{"flux":[[1,473],[2,874],[3,1228],[4,1543],[5,1825],[6,2084],[7,2315],[8,2519],[9,2702],[10,2858],[11,2986],[12,3090],[13,3162],[14,3201],[14.95,3192]],"vf":[[1,2.8],[2,2.92],[3,3.03],[4,3.13],[5,3.22],[6,3.31],[7,3.39],[8,3.48],[9,3.56],[10,3.64],[11,3.72],[12,3.8],[13,3.88],[14,3.96],[14.95,4.04]],"lum":[[0.7,24.3],[2.8,82.1],[14.2,218]],"from":"chart","name":"SFT-40 6500K","err":0.3,"note":"comparison chart, series SFT-40_6500K"}},{"id":"k3-220791-2","label":"Luminus SFT-40 warm white 3000K color group HB4, L5 bin, domeless","area":4.02,"areaQuote":"The luminous area is 4.02 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sft-40-3000-6500-k-warm-white-thrower-led-with-good-tint-and-perfect-light/220791","date":"2023-10-24","pts":[[8,1384,3.55],[9,1475,3.64],[13.8,1717,4.08]],"warn":"","tr":{"flux":[[1,281],[2,511],[3,707],[4,878],[5,1028],[6,1166],[7,1281],[8,1381],[9,1473],[10,1552],[11,1613],[12,1662],[13,1697],[14,1717],[14.75,1717]],"vf":[[1,2.8],[2,2.94],[3,3.06],[4,3.17],[5,3.27],[6,3.36],[7,3.46],[8,3.55],[9,3.64],[10,3.73],[11,3.82],[12,3.92],[13,4.01],[14,4.1],[14.75,4.18]],"lum":[[0.7,15.2],[2.8,49.9],[8.6,107.5],[14.8,127.6]],"from":"chart","name":"SFT-40 3000K","err":0.2,"note":"comparison chart, series SFT-40_3000K"}},{"id":"k3-222478","label":"Moonleds MN-S3535 High CRI 6000K typ 97CRI, domed","area":2.2,"areaQuote":"The luminous area is 2.2 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-moonleds-mn-s3535-6000-k-typ-97-cri-r9-r12-min-90-real-daylight-led/222478","date":"2024-01-27","pts":[[1,268,3.04],[1.8,356,3.23]],"warn":"","tr":{"flux":[[0.25,86.8],[0.5,158],[0.75,217],[1,268],[1.25,307],[1.5,336],[1.75,352],[1.98,346]],"vf":[[0.25,2.77],[0.5,2.88],[0.75,2.96],[1,3.04],[1.25,3.1],[1.5,3.16],[1.75,3.22],[1.98,3.26]],"lum":[[0.35,11.6],[0.7,20.4],[1.8,35.6]],"from":"chart","name":"MN-S3535 6000K 97CRI","err":1.5,"note":"comparison chart, series MN-S3535_6000K_97CRI"}},{"id":"k3-222822","label":"Cree XP-G4 B4 2B 5700K min 90CRI, dome","area":4.61,"areaQuote":"The luminous area is 4.61 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-cree-xp-g4-b4-2b-5700-k-min-90-cri-r9-min-50/222822","date":"2024-02-18","pts":[[3,1030,3.29],[10.2,1844,4.01]],"warn":"","tr":{"flux":[[1,430],[2,762],[3,1027],[4,1245],[5,1425],[6,1572],[7,1684],[8,1768],[9,1818],[10,1840],[10.95,1826]],"vf":[[1,2.94],[2,3.13],[3,3.29],[4,3.42],[5,3.54],[6,3.64],[7,3.74],[8,3.83],[9,3.92],[10,4],[10.95,4.08]],"lum":[[0.7,19.4],[2.8,60.9],[6,99.5],[10.2,118.1]],"from":"chart","name":"Cree XP-G4 B4 2B (≈ 5700 K, min 90 CRI / R9 min 50)","err":0.4,"note":""}},{"id":"k3-222962","label":"Luminus SFT-12 F4 BC 6500K typ 70CRI, domeless","area":1.27,"areaQuote":"The luminous area is 1.27 mm² in size.","areaVerified":true,"url":"https://budgetlightforum.com/t/led-test-review-luminus-sft-12-f4-bc-6500-k-typ-70-cri/222962","date":"2024-02-25","pts":[[1.8,605,3.22],[5,1070,3.89]],"warn":"","tr":{"flux":[[0.5,211],[1,380],[1.5,526],[2,652],[2.5,762],[3,857],[3.5,936],[4,1003],[4.5,1049],[5,1068],[5.17,1055]],"vf":[[0.5,2.85],[1,3.01],[1.5,3.15],[2,3.27],[2.5,3.38],[3,3.49],[3.5,3.6],[4,3.7],[4.5,3.8],[5,3.9],[5.17,3.93]],"lum":[[0.7,49.2],[2.8,139.7],[5,173.6]],"from":"chart","name":"Luminus SFT-12 F4 BC (≈ 6500 K, typ. 70 CRI)","err":0.6,"note":""}},{"id":"k3-49020","label":"Cree XLamp XHP70.2 P2 40E 4000K, quad-die flip-chip, 6, domed","area":31.52,"areaQuote":"total LES area of the XHP70.2 is 31.52 mm²","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xhp70-2-p2-40e-4000-k-the-second-generation-of-extreme-overcurrent-and-light-flux-capability/49020","date":"2017-12-28","pts":[[2.1,1876,5.73],[4.8,3810,6.09],[15,8379,6.95],[20,9228,7.29]],"warn":"","tr":{"flux":[[1,964],[2,1802],[3,2579],[4,3281],[5,3934],[6,4545],[7,5116],[8,5636],[9,6132],[10,6579],[11,7000],[12,7380],[13,7765],[14,8095],[15,8379],[16,8615],[17,8827],[18,8992],[19,9157],[20,9240],[20.8,9287]],"vf":[[1,5.53],[2,5.71],[3,5.87],[4,6],[5,6.12],[6,6.22],[7,6.32],[8,6.41],[9,6.49],[10,6.58],[11,6.66],[12,6.73],[13,6.8],[14,6.88],[15,6.95],[16,7.02],[17,7.09],[18,7.16],[19,7.22],[20,7.29],[20.8,7.35]],"lum":[[2.8,22.9],[8.6,56.9],[20,93.3]],"from":"table","name":"Cree XHP70.2 P2 40E (4000 K, domed)","err":0.2,"note":""}},{"id":"k3-49237","label":"Cree XLamp XP-L2 V5 40E 70CRI, domed","area":10.41,"areaQuote":"die 10.41 mm² domed, 5.581 mm² dedomed","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-cree-xlamp-xp-l2-v5-40e-u6-40h-90-cri-high-light-flux-and-low-vf-but-very-huge-spread-in-performance/49237","date":"2018-01-09","pts":[[3,1184.6,3.34],[7.5,2147,3.99],[12,2606,4.39],[13,2438,3.91]],"warn":"","tr":{"flux":[[1,467],[2,851],[3,1181],[4,1476],[5,1723],[6,1948],[7,2131],[8,2294],[9,2420],[10,2521],[11,2581],[12,2601],[13,2559],[14,2431],[15,2197],[16,1866],[17,1491],[18,1169],[18.35,1081]],"vf":[[1,2.92],[2,3.18],[3,3.33],[4,3.48],[5,3.6],[6,3.71],[7,3.83],[8,3.94],[9,4.05],[10,4.16],[11,4.28],[12,4.4],[13,4.53],[14,4.67],[15,4.81],[16,4.98],[17,5.16],[18,5.39],[18.35,5.46]],"lum":[[2.8,37.5],[6,64.8],[12,84.9]],"from":"chart","name":"XP-L2 V5 40E","err":5,"note":"comparison chart, series XP-L2_V5_40E; axis tick labels partly missing: axis mapped from manually chosen label pixel positions"}},{"id":"k3-49328","label":"Lumileds Luxeon MZ 5700K min 90CRI LMZ9-QW57, 3V, quad-die flip, domeless","area":7.92,"areaQuote":"The total LES is 7.92 mm²","areaVerified":false,"url":"https://budgetlightforum.com/t/led-test-review-lumileds-luxeon-mz-5700-k-min-90-cri-3v-finally-high-cri-high-power-beautiful-light/49328","date":"2018-01-15","pts":[[2.8,867.8,2.9],[4.8,1344.6,3],[5.5,1492.6,3.04],[9,2173.6,3.2],[16.8,2909.1,3.48]],"warn":"","tr":{"flux":[[1,358],[2,652],[3,915],[4,1159],[5,1375],[6,1589],[7,1797],[8,1993],[9,2168],[10,2317],[11,2466],[12,2589],[13,2694],[14,2778],[15,2841],[16,2883],[17,2905],[17.35,2905]],"vf":[[1,2.78],[2,2.85],[3,2.92],[4,2.98],[5,3.03],[6,3.08],[7,3.13],[8,3.18],[9,3.22],[10,3.25],[11,3.3],[12,3.33],[13,3.37],[14,3.41],[15,3.45],[16,3.48]],"lum":[[2.8,35.7],[8.6,85.2],[16.8,118.7]],"from":"chart","name":"Lumileds Luxeon MZ 5700 K min. 90 CRI (3V) – Finally! High CRI, High power, beautiful light","err":1,"note":"no value at A=[17.0, 17.35] (curve end / line hidden); left null"}}];
  // DATASHEET one-point presets (10-08, LOW CONFIDENCE): emitting size + ONE datasheet flux point (curve = a straight line from 0), from the
  // Haiku agents' records in tools/source-specs (auto_catalog_1.json, lep_0.json), quoted from the PDFs there.  Lambertian assumed where not stated.
  const DS_1PT = [
    { id: 'kyocera-laserlight-smd1000', label: 'Kyocera SLD LaserLight SMD 1000 (laser-excited phosphor, 6000 K)', w: 0.45, h: 0.55, A: 2.5, lm: 1000, vf: 8.3, maxA: 2.5,
      note: 'Kyocera SLD Laser doc 740-00009 Rev. B (2022): spot 0.45 × 0.55 mm FWHM, 1000 lm typ (950 min) at If 2.5 A, Tcase 50 °C, peak luminance 1300 cd/mm², 318 cd, viewing angle 120°. Vf 8.3 V typ is listed under a 1.65 A footnote (pairing with 2.5 A uncertain). The real spot is peaked, not flat: modelled as a uniform 0.45 × 0.55 mm Lambertian patch (its mean luminance Φ / (π A) = 1290 cd/mm² agrees with the stated peak only because the spot is FWHM-sized). Class 2 laser product (sealed).' },
    { id: 'nichia-ncsw170h', label: 'Nichia NCSW170HT automotive · LES 1.15 mm', w: 1.15, h: 1.15, A: 1.0, lm: 475, vf: 3.25, maxA: 1.5,
      note: 'Nichia STS-DA1-7454C (NCSW170H/131H, AEC-Q102): LES 1.15 × 1.15 mm, 475 lm typ at IF 1000 mA (TJ 25 °C, 0.05 ms pulse — hot DC output is lower), VF 3.25 V typ, IF max 1500 mA. Viewing angle not stated: Lambertian assumed.' },
    { id: 'nichia-ncsw170h-sa', label: 'Nichia NCSW170HT-SA automotive · LES 0.95 mm', w: 0.95, h: 0.95, A: 1.0, lm: 440, vf: 3.25, maxA: 1.5,
      note: 'Nichia STS-DA1-7454C: -SA variant, LES 0.95 × 0.95 mm, 440 lm typ at 1000 mA (TJ 25 °C pulse), VF 3.25 V typ. Lambertian assumed.' },
    { id: 'nichia-ncsw170h-sb', label: 'Nichia NCSW170HT-SB automotive · LES 0.76 mm', w: 0.76, h: 0.76, A: 1.0, lm: 380, vf: 3.25, maxA: 1.5,
      note: 'Nichia STS-DA1-7454C: -SB variant, LES 0.76 × 0.76 mm, 380 lm typ at 1000 mA (TJ 25 °C pulse), VF 3.25 V typ. Lambertian assumed.' },
    { id: 'osram-oslon-bfx-kw4', label: 'Osram OSLON Black Flat X KW4 HPL631.TK (4-chip, 12 V)', w: 2.1, h: 2.1, A: 1.0, lm: 1640, vf: 12.81, maxA: 1.5,
      note: 'ams OSRAM KW4 HPL631.TK v1.2: radiating surface 4.4 mm² typ (4-chip array; its SHAPE is not stated — modelled as a 2.1 × 2.1 mm square of the same area, which a 4-in-a-row array is not), 1640–2040 lm (group BCBH) at IF 1000 mA (1 ms pulse, TS 25 °C) — the bin MINIMUM is used, VF 12.81 V typ, IF max 1500 mA, Lambertian (stated). Not for new design.' },
    { id: 'osram-oslon-bfx-kw3', label: 'Osram OSLON Black Flat X KW3 HNL631.TK (3-chip, 9 V)', w: 1.82, h: 1.82, A: 1.0, lm: 1230, vf: 9.61, maxA: 1.5,
      note: 'ams OSRAM KW3 HNL631.TK: radiating surface 3.3 mm² typ (3-chip array; shape not stated — modelled as a square of the same area), 1230–1595 lm at IF 1000 mA (bin minimum used), VF 9.61 V typ. Lambertian assumed. Not planned for new design.' },
    { id: 'lumileds-altilon-intense-1x1', label: 'Lumileds LUXEON Altilon Intense Gen2 1x1', w: 0.68, h: 0.88, A: 1.5, lm: 395, vf: 3.2, maxA: 1.6,
      note: 'Lumileds ISAL 2023 leaflet: light-emitting area 0.68 × 0.88 mm, 395 lm at 1.5 A and 85 °C, luminance 220 cd/mm² (leaflet only, "for car SOP 2025"); DS321: max DC 1600 mA, 120° viewing angle, Vf bins 2.9–3.8 V (3.2 used). Lambertian assumed.' },
    { id: 'lumileds-altilon-intense-1x2', label: 'Lumileds LUXEON Altilon Intense Gen2 1x2', w: 0.68, h: 1.70, A: 1.5, lm: 790, vf: 6.4, maxA: 1.6,
      note: 'Lumileds ISAL 2023 leaflet: light-emitting area 0.68 × 1.70 mm, 790 lm at 1.5 A and 85 °C, luminance 225 cd/mm² (leaflet only); DS322: max DC 1600 mA, Vf bins 5.8–7.6 V (6.4 used). Lambertian assumed.' },
  ];
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
    ...Object.fromEntries(DS_1PT.map((k) => [k.id, {
      label: k.label + ' · datasheet 1-pt', lowConfidence: true,
      note: 'LOW CONFIDENCE — one datasheet point (' + k.A + ' A, ' + k.lm + ' lm), flux straight from 0. ' + k.note,
      set: { kind: 'planar', shape: 'rect', w: k.w, h: k.h, dist: 'lambertian' },
      drive: { models: { ds1: { label: 'Datasheet point (1-pt, low confidence)', curve: [[0, 0], [k.A, k.lm]], vf: [[k.A, k.vf]], maxA: k.maxA } }, model: 'ds1', ratedA: k.maxA, defaultA: k.A },
    }])),
    ...Object.fromEntries(KOEF3_2PT.map((k) => {
      const pts2 = { label: 'koef3 quoted points (2-pt, low confidence)', curve: [[0, 0]].concat(k.pts.map((p) => [p[0], p[1]])), vf: k.pts.map((p) => [p[0], p[2]]), maxA: k.pts[k.pts.length - 1][0] };
      const t = k.tr, sq = +Math.sqrt(k.area).toFixed(4);
      const areaNote = 'Emitting area ' + k.area + ' mm² (' + (k.areaVerified ? 'his sentence verified in the thread' : 'NOT verified verbatim') + ': “' + k.areaQuote + '”)';
      return [k.id, t ? {
        label: k.label + ' · koef3', measured: true, lowConfidence: !t.lum,
        note: 'koef3’s measurements (BLF/TLF, Cu board, fan-cooled, 25 °C solder point). Flux and Vf ' + (t.from === 'table' ? 'from his raw table' : 'traced off his chart by script (calibrated ~0.3 % against his raw tables; within ' + t.err + ' % of his quoted points)') + '. ' + (t.lum ? 'Die = square of the effective area Φ / (π L) from his luminance table; ' + areaNote + ' is the geometric alternate.' : 'No luminance table — ' + areaNote + ', modelled as a square Lambertian die (LOW CONFIDENCE on luminance).') + ' Max current = where his test stopped. ' + k.url + ' (' + k.date + ').' + (t.note ? ' Trace note: ' + t.note + '.' : ''),
        set: { kind: 'planar', shape: 'rect', w: sq, h: sq, dist: 'lambertian' },
        drive: { models: Object.assign({ koef3: { label: 'koef3 ' + t.from + (t.lum ? ' · effective area from his luminance' : ' · quoted area'), curve: [[0, 0]].concat(t.flux), vf: t.vf, lum: t.lum || undefined, maxA: t.flux[t.flux.length - 1][0] } },
          t.lum ? { die: { label: 'koef3 ' + t.from + ' · quoted area ' + k.area + ' mm²', curve: [[0, 0]].concat(t.flux), vf: t.vf, maxA: t.flux[t.flux.length - 1][0], set: { shape: 'rect', w: sq, h: sq } } } : {},
          { pts2 }), model: 'koef3', ratedA: Infinity, defaultA: k.pts[0][0] },
      } : {
        label: k.label + ' · koef3 2-pt', measured: true, lowConfidence: true,
        note: 'LOW CONFIDENCE — koef3’s quoted points only (' + k.pts.map((p) => p[0] + ' A ' + p[1] + ' lm').join(', ') + '), joined by straight lines from 0; mid-current flux may be off by 10–20 %. ' + areaNote + ', modelled as a square Lambertian die. ' + k.url + ' (' + k.date + ').' + (k.warn ? ' Warning: ' + k.warn + '.' : ''),
        set: { kind: 'planar', shape: 'rect', w: sq, h: sq, dist: 'lambertian' },
        drive: { models: { pts2 }, model: 'pts2', ratedA: Infinity, defaultA: k.pts[0][0] },
      }];
    })),
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
