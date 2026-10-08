LED research report. Scope was partial: the automotive headlamp records are mostly primary-datasheet sourced; the catalog is partial; no BLF/TLF measurements or chart readings were collected. Files are in /private/tmp/claude-501/-Users-anya/e131d530-06e8-45fd-966e-f5141ea2d478/scratchpad/leds/auto/ (datasheet PDFs and text dumps).

```json catalog
[
  {"led": "NOCTIGON NTG35 3V LED", "shop": "intl-outdoor.com (Nanjing YaoQi Photoelectric; Emisar/Noctigon category 'Noctigon NTG Series')", "url": "https://intl-outdoor.com/product/noctigon-ntg35-3v-led/"},
  {"led": "NOCTIGON NTG50 6V/12V LED", "shop": "intl-outdoor.com (Nanjing YaoQi Photoelectric; 'Noctigon NTG Series')", "url": "https://intl-outdoor.com/product/noctigon-ntg50-6v-12v-led/"},
  {"led": "Luminus SBT90.2 / SST-20 / SST-40 (category only, no items shown)", "shop": "intl-outdoor.com", "url": "https://intl-outdoor.com/product-category/led/"},
  {"led": "Nichia (category, no items shown)", "shop": "intl-outdoor.com", "url": "https://intl-outdoor.com/product-category/led/nichia/"},
  {"led": "OSRAM white flat (category, no items shown)", "shop": "intl-outdoor.com", "url": "https://intl-outdoor.com/product-category/led/osram-white-flat/"},
  {"led": "XHP50.3 HI (3V and 6V builds; R70 and R9050 bins)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "XHP70.3 HI (R70, R9050; 6V boost and 12-group variants)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-l21b-black-21700-flashlight"},
  {"led": "XPL HI", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "SST20", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s15-black-18650-flashlight"},
  {"led": "SST40", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "SST70", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-z1-21700-flashlight-zoomable"},
  {"led": "SFT40 / SFT70 / SFT-25R / SFT-42R / SFT-12 / SFT-60 / SFT-90 (Luminus SFT family)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-l21b-black-21700-flashlight"},
  {"led": "SBT90.2", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-l21b-black-21700-flashlight"},
  {"led": "B35AM (2700K to 6500K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s15-black-18650-flashlight"},
  {"led": "719A (2700K to 5000K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "519A (1800K to 5700K; Anduril 1.0 variants)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "LH351D (2700K to 5700K; linear and buck)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "LHP531 (1800K to 6500K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "LHP73B (1800K to 6500K; 20A buck)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-m21f-gray-21700-flashlight"},
  {"led": "F45R (3000K to 6500K; 10A buck)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "F150R (3000K to 6500K; 20A buck)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "W5050SQ5 (3000K to 6500K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-s21e-black-21700-flashlight"},
  {"led": "LMP LML2AW.DC (3000K/4000K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "KW CSLNM1.TG / CSLPM1.TG (already in app)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "KW CULPM1.TG (5700K)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-c8-camouflage-black-18650-flashlight"},
  {"led": "GT FC40 / 'GT LED' red/green/blue (unverified: may be a board, not an emitter)", "shop": "convoylight.com", "url": "https://convoylight.com/products/convoy-m21f-gray-21700-flashlight"}
]
```

```json led_records
[
  {
    "name": "OSLON Black Flat X KW4 HPL631.TK", "manufacturer": "ams OSRAM", "part_number_family": "KW4 HPL631.TK",
    "variants": ["BCBH 1640-2040 lm", "BCBJ 1640-2115 lm", "BDBJ 1700-2115 lm (6L)"],
    "die": {"shape": "rect", "size_mm": "4.4 mm2 radiating surface (typ, 4-chip array); body 7.59 x 3.75 mm", "is": "radiating surface (LES) for the whole device, not per chip"},
    "dome": "flat window (not stated; epoxy package)", "package_size_mm": "7.59 x 3.75 x 0.5",
    "viewing_angle_deg": 120, "lambertian": "stated: 'Typ. Radiation: 120 (Lambertian emitter)'",
    "voltage_class": "~12 V (Vf typ 12.81)", "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [[1.0, "1640 ... 2040 lm (typ, group BCBH; brightness measured in 1 ms pulse, Ts 25C)"]],
    "vf_datasheet": [[1.0, "min 11.20 / typ 12.81 / max 13.50 V (IF 1000 mA, TS 25C)"]],
    "measured": [], "chart_readings": [],
    "status": "'Not for new design' (datasheet v1.2, 2026-03-04)",
    "quotes": {"die": "'Radiating surface Acolor typ. 4,4 mm2'", "viewing_angle_deg": "'Viewing angle at 50% IV 2phi typ. 120 deg'", "flux_datasheet": "'KW4 HPL631.TK-BCBH-4L05M0-AGAE Phi V = 1640 ... 2040 lm (IF = 1000 mA)'", "vf_datasheet": "'Forward Voltage VF min. 11.20 V / typ. 12.81 V / max. 13.50 V' (IF = 1000 mA; TS = 25 C)", "max_current_A": "'Forward current IF max. 1500 mA' (TS = 25 C)", "source": "https://look.ams-osram.com/m/3517cdd5b450c4e9/original/KW4-HPL631-TK.pdf (local: auto/kw4_hpl631.pdf)"}
  },
  {
    "name": "OSLON Black Flat X KW3 HNL631.TK", "manufacturer": "ams OSRAM", "part_number_family": "KW3 HNL631.TK",
    "variants": ["6TTB 1230-1535 lm", "6TTC 1230-1595 lm", "7TTC 1275-1595 lm (6L)"],
    "die": {"shape": "rect", "size_mm": "3.3 mm2 radiating surface (typ); body 6.37 x 3.75 mm", "is": "radiating surface (LES) for device"},
    "dome": "flat window (not stated)", "package_size_mm": "6.37 x 3.75 x 0.5",
    "viewing_angle_deg": 120, "lambertian": "not stated for this part",
    "voltage_class": "~9 V (Vf typ 9.61)", "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [[1.0, "1230 ... 1595 lm (typ, group bins; IF 1000 mA)"]],
    "vf_datasheet": [[1.0, "min 8.40 / typ 9.61 V (IF 1000 mA)"]],
    "measured": [], "chart_readings": [], "status": "'Not planned for new design' (product page)",
    "quotes": {"die": "'Radiating surface Acolor typ. 3,3 mm2'", "flux_datasheet": "'KW3 HNL631.TK-6TTB-4L05M0-JCAB Phi V = 1230 ... 1535 lm (IF = 1000 mA)'", "vf_datasheet": "'Forward Voltage VF min. 8.40 V; typ. 9.61 V'", "source": "https://look.ams-osram.com/m/1ca846470bc3ec/original/KW3-HNL631-TK.pdf (local: auto/kw3_hnl631.pdf)"}
  },
  {
    "name": "OSLON Black Flat X KW2 HML631.TK", "manufacturer": "ams OSRAM", "part_number_family": "KW2 HML631.TK",
    "variants": ["6DT1 820-1060 lm", "6DT2 820-1100 lm", "7DT2 860-1100 lm (6L)"],
    "die": {"shape": "rect", "size_mm": null, "is": "LES not stated in datasheet; body dimension 5.15 x 3.75 mm (product page)"},
    "dome": "flat window (not stated)", "package_size_mm": "5.15 x 3.75 x 0.5",
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~6 V (Vf typ 6.41)",
    "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [[1.0, "820 ... 1100 lm (IF 1000 mA)"]],
    "vf_datasheet": [[1.0, "min 5.60 / typ 6.41 V (IF 1000 mA)"]],
    "measured": [], "chart_readings": [], "status": "'Not planned for new design'",
    "quotes": {"flux_datasheet": "'KW2 HML631.TK-6DT1-4L05M0-SC6B Phi V = 820 ... 1060 lm (IF = 1000 mA)'", "vf_datasheet": "'Forward Voltage VF min. 5.60 V; typ. 6.41 V'", "source": "https://look.ams-osram.com/m/3fba16bcabd7677d/original/KW2-HML631-TK.pdf (local: auto/kw2_hml631.pdf)"}
  },
  {
    "name": "OSLON Black Flat X KW HHL631.TK", "manufacturer": "ams OSRAM", "part_number_family": "KW HHL631.TK",
    "variants": ["5SSA 410-560 lm", "5SSB 410-585 lm", "6SSB 430-585 lm (6L)"],
    "die": {"shape": null, "size_mm": null, "is": "LES not stated in datasheet; body 3.75 x 3.75 x 0.49 mm (product page)"},
    "dome": "flat window (not stated)", "package_size_mm": "3.75 x 3.75 x 0.49",
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~3 V (Vf typ 3.20)",
    "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [[1.0, "410 ... 585 lm (IF 1000 mA); product page single value Phi V 498 lm"]],
    "vf_datasheet": [[1.0, "min 2.80 / typ 3.20 V (IF 1000 mA)"]],
    "measured": [], "chart_readings": [], "status": "'Not planned for new design'",
    "quotes": {"flux_datasheet": "'KW HHL631.TK-5SSA-4L05M0-2686 410 ... 560 lm'", "vf_datasheet": "'VF min. 2.80 V ... typ. 3.20 V'", "source": "https://look.ams-osram.com/m/664c093bf9dbfc73/original/KW-HHL631-TK.pdf (local: auto/kw_hhl631.pdf)"}
  },
  {
    "name": "OSLON Black Flat S KW HHL532.TK", "manufacturer": "ams OSRAM", "part_number_family": "KW HHL532.TK",
    "variants": ["S2S8 355-510 lm", "S2S9 355-535 lm"],
    "die": {"shape": null, "size_mm": null, "is": "LES not stated in datasheet; body 3.75 x 3.75 x 0.49 mm (product page)"},
    "dome": null, "package_size_mm": "3.75 x 3.75 x 0.49",
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~3 V (Vf typ 3.15)",
    "max_current_A": null, "pd_max_W": null,
    "flux_datasheet": [[1.0, "355 ... 535 lm (IF 1000 mA; bins S2-S9)"]],
    "vf_datasheet": [[1.0, "min 2.80 / typ 3.15 V (IF 1000 mA, TS 25C)"]],
    "measured": [], "chart_readings": [], "status": "'Full production' (product page)",
    "quotes": {"flux_datasheet": "'KW HHL532.TK-S2S8-4L07M0-2686 355 ... 510 lm'", "vf_datasheet": "'VF min. 2.80 V; typ 3.15 V (IF = 1000 mA)'", "source": "https://look.ams-osram.com/m/1ab66ac67849479a/original/KW-HHL532-TK.pdf (local: auto/kw_hhl532.pdf, Chinese/English bilingual)"}
  },
  {
    "name": "OSRAM OSTAR Headlamp Pro LE UW U1A2 01", "manufacturer": "ams OSRAM", "part_number_family": "LE UW U1A2 01",
    "variants": ["6P 500-560 lm / 180 cd", "7P 560-630 lm / 200 cd", "8P 630-710 lm / 220 cd", "5Q 710-800 lm / 250 cd"],
    "die": {"shape": null, "size_mm": "Acolor 2.1 mm2 typ (radiating surface); chip layout 1-6 chips per row (configurable)", "is": "radiating surface (LES) for the device as stated"},
    "dome": null, "package_size_mm": "20.0 x 20.0 x 2.41 (product page)",
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~6 V (Vf typ 6.3)",
    "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [[1.0, "500 ... 800 lm (IF 1000 mA, TB 25C; bins 6P-5Q)"]],
    "vf_datasheet": [[1.0, "min 6.0 / typ 6.3 / max 7.2 V (IF 1000 mA)"]],
    "measured": [], "chart_readings": [], "status": "'Not recommended for new design' (datasheet v1.7); product page 'Discontinued'",
    "quotes": {"die": "'Radiating surface Acolor typ. 2.1 mm2'", "flux_datasheet": "'LE UW U1A2 01-6P5Q... 500 ... 800 lm'", "vf_datasheet": "'Forward voltage VF min. 6.0 V; typ 6.3 V; max 7.2 V'", "source": "https://look.ams-osram.com/m/3eb5c9163902d7f8/original/LE-UW-U1A2-01.pdf (local: auto/ostar_le_uw_u1a2.pdf)"}
  },
  {
    "name": "LUXEON Altilon Intense Gen2 1x1", "manufacturer": "Lumileds", "part_number_family": "A1SL-58501EH2...",
    "variants": ["flux bins M-T (340-410 lm, MP)"],
    "die": {"shape": "rect", "size_mm": "0.68 x 0.88 (light-emitting area, from leaflet table)", "is": "light-emitting area per leaflet; not stated in DS321 text"},
    "dome": null, "package_size_mm": null,
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~3 V (Vf bins 2.9-3.8 V)",
    "max_current_A": 1.6, "pd_max_W": null,
    "flux_datasheet": [[1.5, "340-410 lm bins (MP <20 ms, Tc 85C; 'Lumileds maintains a tolerance of +/-6.5%')"], [1.5, "395 lm (leaflet, 'at 1.5 A and 85 C')"]],
    "vf_datasheet": [[1.5, "bin A 2.9-3.2, B 3.2-3.5, C 3.5-3.8 V (MP, binning 1500 mA)"]],
    "measured": [], "chart_readings": [],
    "luminance_stated": [{"value": 220, "unit": "cd/mm2", "condition": "hot operating conditions; leaflet footnote '** for car SOP 2025'", "source": "https://lumileds.com/wp-content/uploads/2023/09/ISAL2023-Leaflet04_LUXEONAltilonIntense.pdf"}],
    "quotes": {"die": "leaflet table: 'Light-emitting area (mm x mm) 0.68 x 0.88'", "luminance": "'Luminance (cd/mm2)** 220'", "flux_datasheet": "DS321 Table 6, 'LUMINOUS FLUX (lm) ... Q 370 380'", "max_current_A": "'Maximum DC Forward Current 1600 mA'", "source": "https://lumileds.com/DS321-LUXEON-Altilon-Intense-1x1-Gen2-Datasheet (local: auto/ds321_intense_1x1_gen2.pdf)"}
  },
  {
    "name": "LUXEON Altilon Intense Gen2 1x2", "manufacturer": "Lumileds", "part_number_family": "A1SL-58502EH2...",
    "variants": ["flux bins M-T per die (340-410 lm); 1x2 product 680-800 lm minimum"],
    "die": {"shape": "rect", "size_mm": "0.68 x 1.70 (light-emitting area, leaflet)", "is": "light-emitting area per leaflet"},
    "dome": null, "package_size_mm": null,
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~6 V (Vf bins 5.8-7.6 V)",
    "max_current_A": 1.6, "pd_max_W": null,
    "flux_datasheet": [[1.5, "790 lm for 1x2 (leaflet: 'Luminous flux at 1.5 A, 85 C (lm) 790')"]],
    "vf_datasheet": [[1.5, "bins A 5.80-6.40, B 6.40-7.00, C 7.00-7.60 V (MP, binning 1500 mA)"]],
    "measured": [], "chart_readings": [],
    "luminance_stated": [{"value": 225, "unit": "cd/mm2", "condition": "leaflet, '** for car SOP 2025'", "source": "https://lumileds.com/wp-content/uploads/2023/09/ISAL2023-Leaflet04_LUXEONAltilonIntense.pdf"}],
    "quotes": {"die": "leaflet 'Light-emitting area (mm x mm) 0.68 x 1.70'", "luminance": "'Luminance (cd/mm2)** 225'", "flux_datasheet": "DS322 Table 6 bins 'M 340 350' ... 'T 400 410' (per die)", "vf_datasheet": "DS322 Table 8 'A 5.80 6.40 / B 6.40 7.00 / C 7.00 7.60'", "source": "https://otmm.lumileds.com/adaptivemedia/566edcc5e6e28b5750535dbf79ab8922964b0713 (DS322, local: auto/altilon_intense_1x2.pdf)"}
  },
  {
    "name": "LUXEON Altilon SMD-A 1x3", "manufacturer": "Lumileds", "part_number_family": "A1SD-58503DH...",
    "variants": ["total flux 1050-1200 lm (per die 350-400)"],
    "die": {"shape": null, "size_mm": null, "is": "not stated in datasheet"},
    "dome": null, "package_size_mm": null,
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~9 V (Vf typ 9.33)",
    "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [], "vf_datasheet": [],
    "measured": [], "chart_readings": [], "status": "DS376 dated 2025-09-22",
    "quotes": {"vf_datasheet": "'A1SD-58503DHxxxxxx 8.70 9.33 10.05' (Vf min/typ/max, MP binning)", "max_current_A": "'Maximum DC Forward Current [1] 1500 mA'", "viewing": "'TYPICAL VIEWING ANGLE 120'", "source": "https://otmm.lumileds.com/adaptivemedia/834cddea217f101ee28b889ad99d1bb6f01b8439 (local: auto/altilon_smd_a_1x3.txt)"}
  },
  {
    "name": "LUXEON Altilon SMD 1x3 Gen8", "manufacturer": "Lumileds", "part_number_family": "A1SC-58503DH...",
    "variants": ["total flux 1020-1230 lm (per die M-T)"],
    "die": {"shape": null, "size_mm": null, "is": "not stated in datasheet"},
    "dome": null, "package_size_mm": null,
    "viewing_angle_deg": 120, "lambertian": null, "voltage_class": "~9 V (Vf typ 9.29)",
    "max_current_A": 1.5, "pd_max_W": null,
    "flux_datasheet": [], "vf_datasheet": [[1.0, "min 8.70 / typ 9.29 / max 10.05 V (MP at 1000 mA, 85C)"]],
    "measured": [], "chart_readings": [],
    "quotes": {"vf_datasheet": "Table 3 'FORWARD VOLTAGE (Vf) MIN 8.70 TYP 9.29 MAX 10.05'", "max_current_A": "'Maximum DC Forward Current [1] 1500 mA'", "source": "https://lumileds.com/DS398-LUXEON-Altilon-SMD-1x3-Gen-8-Datasheet (local: auto/ds398_gen8_1x3.pdf)"}
  },
  {
    "name": "Nichia NCSW170HT / NCSW131HT (standard LES)", "manufacturer": "Nichia", "part_number_family": "NCSW170HT, NCSW131HT",
    "variants": ["color ranks R475/R450/B440/R425/R450 (flux rank 450-500)"],
    "die": {"shape": "square", "size_mm": "1.15 x 1.15 (LES)", "is": "LES, per datasheet 'LES Sizes and Shapes' table"},
    "dome": null, "package_size_mm": "1.8 x 1.45 (outline drawing)",
    "viewing_angle_deg": null, "lambertian": null, "voltage_class": "~3 V (Vf typ 3.25)",
    "max_current_A": 1.5, "pd_max_W": 5.67,
    "flux_datasheet": [[1.0, "475 lm typ (IF 1000 mA, TJ 25C, 0.05 ms pulse, duty 1%)"]],
    "vf_datasheet": [[1.0, "2.90-3.45 V (rank range); typ 3.25 V"]],
    "measured": [], "chart_readings": [], "status": "AEC-Q102; datasheet STS-DA1-7454C (NCSW170H and NCSW131H combined)",
    "quotes": {"die": "'NCSW170HT,NCSW131HT 1.15 x 1.15mm'", "flux_datasheet": "'NCSW170HT, NCSW131HT 475 lm' (IF=1000mA)", "vf_datasheet": "'Forward Voltage VF All 6 part numbers IF=1000mA 3.25 V'", "max_current_A": "'Forward Current IF 1500 mA; Pulse IFP 3000 mA'", "pd_max_W": "'Power Dissipation PD 5.67 W'", "source": "https://led-ld.nichia.co.jp/api/data/spec/led/NCSW170HTx,NCSW131HTx-E(7454C).pdf (local: auto/ncsw170h_131h.pdf)"}
  },
  {
    "name": "Nichia NCSW170HT-SA / NCSW131HT-SA (LES 0.95)", "manufacturer": "Nichia", "part_number_family": "NCSW170HT-SA, NCSW131HT-SA",
    "variants": ["flux ranks D405-R450 (405-475)"],
    "die": {"shape": "square", "size_mm": "0.95 x 0.95 (LES)", "is": "LES"},
    "dome": null, "package_size_mm": "1.8 x 1.45 (outline drawing)",
    "viewing_angle_deg": null, "lambertian": null, "voltage_class": "~3 V (Vf typ 3.25)",
    "max_current_A": 1.5, "pd_max_W": 5.67,
    "flux_datasheet": [[1.0, "440 lm typ (IF 1000 mA, 25C)"]],
    "vf_datasheet": [[1.0, "2.90-3.45 V; typ 3.25 V"]],
    "measured": [], "chart_readings": [],
    "quotes": {"die": "'NCSW170HT-SA, NCSW131HT-SA 0.95 x 0.95mm'", "flux_datasheet": "'NCSW170HT-SA, NCSW131HT-SA ... 440 lm'", "source": "same as NCSW170HT"}
  },
  {
    "name": "Nichia NCSW170HT-SB / NCSW131HT-SB (LES 0.76)", "manufacturer": "Nichia", "part_number_family": "NCSW170HT-SB, NCSW131HT-SB",
    "variants": ["flux ranks C360-R375 etc. (345-400)"],
    "die": {"shape": "square", "size_mm": "0.76 x 0.76 (LES)", "is": "LES"},
    "dome": null, "package_size_mm": "1.8 x 1.45 (outline drawing)",
    "viewing_angle_deg": null, "lambertian": null, "voltage_class": "~3 V (Vf typ 3.25)",
    "max_current_A": 1.5, "pd_max_W": 5.67,
    "flux_datasheet": [[1.0, "380 lm typ (IF 1000 mA, 25C)"]],
    "vf_datasheet": [[1.0, "2.90-3.45 V; typ 3.25 V"]],
    "measured": [], "chart_readings": [],
    "quotes": {"die": "'NCSW170HT-SB, NCSW131HT-SB 0.76 x 0.76mm'", "flux_datasheet": "'NCSW170HT-SB, NCSW131HT-SB ... 380'", "source": "same as NCSW170HT"}
  }
]
```

Notes

Could not reach or fetch:
- intl-outdoor.com product pages (Emisar emitter dropdowns): curl returned 403, WebFetch on a KR4 product page returned 404, and noctigon.com returned 403. The shop's emitter options for Emisar lights were NOT collected. The store name on intl-outdoor is "Nanjing YaoQi Photoelectric technology Co., LTD" (from WebFetch; not verified against any other source).
- "Hank's store": not identified; no URL given in the brief and nothing found.
- Samsung automotive headlamp parts (LEH/LEW named in the brief): not found. Samsung's 3535 LH351B/C/D datasheets are general lighting (outdoor/street), not automotive. Samsung's site has automotive C/U/I series, which I did not open.
- Osram OSTAR luminance: no per-chip cd/mm2 stated in the datasheet. A 2013 press release gives 40 x 10^6 cd/m2 (= 40 cd/mm2), which is a press figure and not in the datasheet, so not used as a field. My own arithmetic from the datasheet (216 cd / 2.1 mm2 ~ 103 cd/mm2) is inference, not a source value; not entered.
- Lumileds Altilon luminance (220 / 225 cd/mm2) comes from the marketing leaflet only, footnoted '** for car SOP 2025' (the footnote text is attached to the flux and luminance rows, so I cannot tell which condition the 220 applies to beyond 'hot'). Also the leaflet text says '220 Mcd/m2' while its table says 'cd/mm2'; the table value is recorded.
- Altilon flux conditions differ: DS321/DS322 bins are monopulse <20 ms at 1500 mA, Tc 85 C; the leaflet's 395 lm and 790 lm are 'at 1.5 A and 85 C' without stating pulse. Treat as different conditions.
- Altilon 1x1 and 1x2 LES (0.68 x 0.88 / 0.68 x 1.70) come from the leaflet table, not the datasheets (the DS321/DS322 text has no LES number; the mechanical drawing is an image).
- OSLON Black Flat X: the datasheets give 'Radiating surface' only for KW3 (3.3 mm2) and KW4 (4.4 mm2). KW2, KW HHL631 and Black Flat S KW HHL532 do not state it; their 'Dimension' values on product pages are package footprints, not LES.
- The ams OSRAM LUW HWQP product page displays a different part (KW HHL532.TK) in its description. Ambiguous; I used the KW HHL532 datasheet only.
- Most OSLON X and OSTAR records are 'not for new design' / discontinued; flagged in status.
- Nichia NCSW170H: viewing angle and Lambertian behaviour are not stated in the datasheet, so null. NCSW131H shares the same flux, Vf and LES in the combined datasheet.
- Nichia NCSW170H: flux is at a 0.05 ms pulse, duty 1%, not a DC/Tj-stated condition.

Convoy-only LEDs not collected (time-limited; no records written): LHP531, LHP73B, F45R, F150R, LMP LML2AW.DC, KW CULPM1.TG, SFT-12, SFT-60, SFT-90, GT FC40. Their manufacturers are not stated in the Convoy listings and I did not guess. Convoy's variant lists are from the product pages (S21E, C8, L21B, M21F, S15, Z1, L6, S12, 4X18A, 6V XHP50.3 HI) and only show LEDs offered on those pages, not the full Convoy catalog.

Noctigon NTG35 3V and NTG50 6V/12V: product pages give only name, price ($2.98 / $3.98) and CCT options ('5000K4200K2700K1800K', run together on the page). A retailer listing (jlhawaii808.com or radiantbulbshop.com; not verified against the page) describes NTG35 as '3535 SMD ... rated voltage 3V ... 4A' with CRI 92 (1800K) / 95 (others). Not entered in the records because it is secondhand. No manufacturer datasheet was found.

Measured data: no BudgetLightForum or TaschenlampenForum measurements were collected for any LED. The measured arrays are empty.

Process mistake: during this run I accidentally created five background-task chips via the spawn_task tool (task_9376e0c9, task_79637fe9, task_606b3ba1, task_1ebd3f9a, task_1ebd3f9a was the 4th; the 5th was an extra call). Each was dismissed with dismiss_task, which reported them as withdrawn. Nothing else was changed outside the scratchpad.

Scratch files: all new downloads are in .../scratchpad/leds/auto/ (PDFs and pdftotext dumps). The leds/ folder also holds files from other agents, which I left untouched.