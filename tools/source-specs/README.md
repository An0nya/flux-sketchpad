# source-specs — light-source data collected 2026-10-08 (Haiku 5.5 agents, checked by Opus)
Raw agent output: every number carries a verbatim quote + source; null = not found. NOT yet loaded as presets except where js/source-presets.js says so.
- `r37_agent_records.json` (+ r37_0.json, r37_report.md): UN R37 filament lamps, from a 2014 Supplement 42 text (lexaris.de mirror). 97 % of quoted cells
  verified verbatim against the downloaded text. Orientation/diameters came from Anya's R037r7e.pdf drawings instead (see the H-presets' notes).
- `luminus_0.json`: Luminus SST/SFT/SBT/CFT (datasheets; SBT-90.2 = SBT-90 Gen2 by inference; no verified > 18 A data) + Lumileds LUXEON MZ.
- `nichia_samsung_0.json`: Nichia 219C, 519A, 719A, B35AM, E17A, E21A, Optisolis (757G-F1), Samsung LH351D (+ koef3 / djozz measurements quoted).
- `auto_catalog_0.json` (Convoy LED options, partial; Emisar/Noctigon blocked) and `auto_catalog_1.json` (automotive: OSLON Black Flat X/S, OSTAR Headlamp Pro, LUXEON Altilon, Nichia NCSW170H).
- Pending at writing: Cree group, LEP group.

## koef3 chart traces (2026-10-08)
- `koef3/traces.json`: 175 records read by a Sonnet subagent from koef3's BLF/TLF charts (images on lychee.lichtundstrom-blog.de): 101 flux/Vf curves (pixel-traced by script), 10 raw tables (exact, from the thread JSON), 64 luminance tables (digits transcribed from table images).
- Calibration: traces vs koef3's raw tables ~0.3 % mean flux error, ~0.01 V Vf; traces vs his quoted text points within ~1 % for 33/36 presets.
- Fixed by hand: SST-25 G2 (224789) — frame detector took the image border as the plot top, flux read ~13 % low; re-traced with pinned calibration (noted in the record's `problems`).
- Not read: 51980 and 49788 charts are dead (abload.de, HTTP 410); 49788 stays a 2-pt preset.
- `koef3/merge-traces.js [--write]` attaches the best trace + a CCT-matched luminance table to each `KOEF3_2PT` entry in `js/source-presets.js`. Presets with a luminance table size the die by effective area Φ/(πL) (same as the hand-entered koef3 presets) and keep the quoted area and the old quoted points as alternate models.
