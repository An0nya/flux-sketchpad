LED spec collection, partial. Everything below is from datasheets I downloaded (scratch dir: /private/tmp/claude-501/-Users-anya/e131d530-06e8-45fd-966e-f5141ea2d478/scratchpad/leds/, 58 Luminus PDFs, extracted as .txt) or from forum pages I fetched and checked. Items that came only from search-result summaries are listed separately as unverified leads, not as data.

Key findings up front:
- There is no "SST-70" in the Luminus datasheets. The part is SST-70X (WS Gen2 and W).
- There is no "SBT-90.2" in the Luminus datasheets either. The Gen2 datasheet is "SBT-90-WxS" (PDS file SBT-90-Gen2). "SBT-90.2" is the forum name for it. I did not find a source that explicitly equates the two. Treat the equivalence as inference.
- No measurement of SBT-90.2 at ~40 A was verified. Datasheets stop at 18 A continuous. The forum thread I fetched (budgetlightforum.com/t/lumintop-power-sbt90-2/225229/15) contains opinion and hypothetical figures ("3V >20A", "1 x SBT90.2 @25A") but no measured current/lumen/Vf table.
- "MZ" is the Lumileds LUXEON MZ (not Luminus), confirmed from the Lumileds datasheet DS136 (fetched from otmm.lumileds.com). It is a 3 V (Q-prefix) quad-die, undomed emitter. Die dimensions are not stated in DS136. Emisar/Noctigon links were not confirmed.

```json
[
 {"name":"SST-20-WxH","manufacturer":"Luminus Devices","part_number_family":"SST-20","variants":["2700K/3000K/3500K/4000K, CRI>95 (H code)"],
  "die":{"shape":null,"size_mm":null,"basis":"'20: 2.0 mm2' is the light emission area code in the part-number nomenclature; no mm dimensions found in text","quote":"S: Dome Lensed  20: 2.0 mm2"},
  "dome":"domed (S: Dome Lensed)","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"not labelled; Vf 2.5–3.1 V at 350 mA suggests 3 V class (inference)",
  "max_current_A":2.0,"pd_max_W":7,
  "flux_datasheet":[{"A":0.35,"lm_min":93,"lm_max":100,"bin":"J2","cond":"350 mA, Tj=85°C, binned (datasheet note 1: measured 25°C, correlated to 85°C)"}],
  "vf_datasheet":[{"A":0.35,"V_min":2.5,"V_typ":2.71,"V_max":3.1,"cond":"If=350 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 2 A","pd_max_W":"Power Dissipation Pd 7 W","viewing_angle_deg":"Viewing Angle (FWHM) 2θ1/2 120 Degree","vf_datasheet":"Forward Voltage (If=350 mA, Tj=85°C) Vf 2.5 2.71 3.1 V","flux_datasheet":"J2 93 100 104 171 232 320 396"},
  "source":"https://download.luminus.com/datasheets/Luminus_SST-20-WxH_Datasheet.pdf (PDS-002964 Rev 11, 2023)"},

 {"name":"SST-20-WxS (Gen1)","manufacturer":"Luminus Devices","part_number_family":"SST-20","variants":["2700K-6500K range, CRI min 65 typ 70 (S code)"],
  "die":{"shape":null,"size_mm":null,"basis":"'20: 2.0 mm2' nomenclature only","quote":"S: Dome Lensed  20: 2.0 mm2"},
  "dome":"domed","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"3 V (Vf 2.7–3.3 V at 1500 mA)",
  "max_current_A":3.0,"pd_max_W":10,
  "flux_datasheet":[],"vf_datasheet":[{"A":1.5,"V_min":2.7,"V_typ":3.0,"V_max":3.3,"cond":"If=1500 mA, Tj=85°C"}],
  "measured":[],
  "chart_readings":[],
  "ambiguous":"Flux bin table is garbled in pdftotext (row L3 reads '560 585 180 157 297 700 941'; the 180 is below the min, so column alignment is unclear). I did not record flux values for this variant.",
  "quotes":{"max_current_A":"Maximum Drive Current: 3 A","pd_max_W":"Power Dissipation 10 W","vf_datasheet":"Forward Voltage (@ If=1500 mA, Tj=85°C) Vf 2.7 3.0 3.3 V","measured_condition_note":"LEDs are measured at 25°C ambient temperature with 1500 mA 20ms single pulse. The measured values are correlated to 1500 mA at 85°C junction temperature"},
  "source":"https://download.luminus.com/datasheets/Luminus_SST-20-WxS_Datasheet.pdf"},

 {"name":"SST-20-WS Gen2","manufacturer":"Luminus Devices","part_number_family":"SST-20 Gen2","variants":["5000K/5700K/6500K binned, CRI min 65 typ 70 (WS); WH Gen2 is CRI>95 variant with separate datasheet"],
  "die":{"shape":null,"size_mm":null,"basis":"'20: 2.0 mm2' nomenclature only","quote":"S: Dome Lensed  20: 2.0 mm2"},
  "dome":"domed","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"3 V (Vf 2.7–3.3 V at 1500 mA)",
  "max_current_A":3.0,"pd_max_W":null,
  "flux_datasheet":[{"cond":"binned @1500 mA, Tj=85°C (min flux bin); 'Minimum Flux' column footnoted as correlated values","bins":{"F8":"610 lm min","F9":"640 lm min","G1":"680 lm min (WS50 kits)"}}],
  "vf_datasheet":[{"A":1.5,"V_min":2.7,"V_typ":3.0,"V_max":3.3,"cond":"If=1500 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 3 A","vf_datasheet":"Forward Voltage (If =1500 mA, Tj = 85°C) Typical Vf typ 3.0 V (min 2.7, max 3.3)","flux":"F8 610 lm, F9 640 lm (Minimum Flux Bin / Minimum Flux)"},
  "ambiguous":"Pd not extracted for this file. Mixed bin column layout not fully parsed.",
  "source":"https://download.luminus.com/datasheets/Luminus_SST-20-WS_Gen_2_Datasheet.pdf (044)"},

 {"name":"SST-40-W (Gen1)","manufacturer":"Luminus Devices","part_number_family":"SST-40","variants":["5000K/5700K/6500K bins; CRI min65 typ70 (S code)"],
  "die":{"shape":null,"size_mm":null,"basis":"'40: 4.0 mm2' nomenclature only","quote":"S: Dome Lensed  40: 4.0 mm2"},
  "dome":"domed (S: Dome Lensed)","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"3 V (Vf 2.6–3.1 V at 1500 mA)",
  "max_current_A":6.0,"pd_max_W":20,
  "flux_datasheet":[{"A":1.5,"cond":"measured 25°C, 1500 mA 20 ms pulse, correlated to 85°C junction","bins":{"5000K N4":594,"5000K N5":634,"6500K N5":634,"6500K P2":673}}],
  "vf_datasheet":[{"A":1.5,"V_min":2.6,"V_typ":2.9,"V_max":3.1,"cond":"If=1500 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 6 A","pd_max_W":"Power Dissipation Pd 20 W","vf_datasheet":"Forward Voltage (@ If=1500 mA, Tj=85°C) Vf 2.6 2.9 3.1 V","flux_note":"LEDs are measured at 25°C ambient temperature with 1500 mA 20ms single pulse. The measured values are correlated to 1500 mA at 85°C junction temperature"},
  "ambiguous":"Flux column header reads 'Flux (lm)' without min/max label; I recorded values as given.",
  "source":"https://download.luminus.com/datasheets/Luminus_SST-40-W_Datasheet.pdf"},

 {"name":"SST-40-WSxx Gen2","manufacturer":"Luminus Devices","part_number_family":"SST-40 Gen2","variants":["5000K/5700K/6500K; CRI min 65 typ 70"],
  "die":{"shape":null,"size_mm":null,"basis":"'40: 4.0 mm2' nomenclature only","quote":"S: Dome Lensed  40: 4.0 mm2"},
  "dome":"domed","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"not extracted",
  "max_current_A":6.0,"pd_max_W":22,
  "flux_datasheet":[{"A":1.5,"cond":"binned @1500 mA, Tj=85°C (min/max); Tj=25°C min also listed; correlated values at 700/3000/5000/6000 mA are 'calculated and for reference only'","bins":{"F8":{"min":610,"max":640,"tj25_min":683},"F9":{"min":640,"max":680,"tj25_min":717},"G1":{"min":680,"max":720,"tj25_min":762},"G2":{"min":720,"max":760,"tj25_min":806},"G3":{"min":760,"max":815,"tj25_min":851}}}],
  "vf_datasheet":[],"measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 6 A","pd_max_W":"Power Dissipation PD 22 W","flux":"F8 610 640 683 305 1104 1647 1885 (Tj85 min, max, Tj25 min, then correlated 700/3000/5000/6000 mA)"},
  "source":"https://download.luminus.com/datasheets/Luminus_SST-40-WSxx_Gen2_Datasheet.pdf (054)"},

 {"name":"SST-70X-W (Gen1)","manufacturer":"Luminus Devices","part_number_family":"SST-70X","variants":["6V (LA/H bins, 6500K WCS CRI65–70); 12V variant on same sheet"],
  "die":{"shape":null,"size_mm":null,"basis":"'70X: 7.0 mm2' nomenclature only","quote":"70X: 7.0 mm2"},
  "dome":"domed (S: Dome Lensed on WS variant; W variant domed per family)","package_size_mm":null,"viewing_angle_deg":135,"lambertian":"not stated",
  "voltage_class":"6 V and 12 V variants",
  "max_current_A":{"6V":5.25,"12V":2.625},"pd_max_W":38,
  "flux_datasheet":[{"A":1.5,"V_cond":"6V","cond":"measured 25°C, 1500 mA 6V 20ms, correlated to 85°C","bins":{"LA 6500K":1200}}],
  "vf_datasheet":[{"A":1.5,"V_min":5.25,"V_typ":5.72,"V_max":6.25,"cond":"6V variant, If=1500 mA, Tj=85°C"},{"A":0.75,"V_min":10.5,"V_typ":11.4,"V_max":12.5,"cond":"12V variant, If=750 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 5.25 A (6 V), 2.625 A (12 V)","pd_max_W":"Power Dissipation Pd 38 W","vf_datasheet":"Forward Voltage (6V, @ If=1500 mA, Tj=85°C) Vf (6V) 5.25 5.72 6.25 V","viewing":"Viewing Angle (FWHM) 2θ1/2 135 Degree","thermal":"Rthjs-EL 0.6 °C/W"},
  "rth_jc_C_per_W":0.6,
  "source":"https://download.luminus.com/datasheets/Luminus_SST-70X-W_Datasheet.pdf (057)"},

 {"name":"SST-70X-WS Gen2","manufacturer":"Luminus Devices","part_number_family":"SST-70X Gen2","variants":["6500K WS65 etc; CRI min 65 typ 70"],
  "die":{"shape":null,"size_mm":null,"basis":"'70X: 7.0 mm2' nomenclature only","quote":"S: Dome Lensed  70X: 7.0 mm2"},
  "dome":"domed","package_size_mm":null,"viewing_angle_deg":null,"lambertian":"not stated",
  "voltage_class":"6 V and 12 V variants",
  "max_current_A":{"6V":5.25,"12V":2.625},"pd_max_W":38,
  "flux_datasheet":[{"cond":"6500K bin H2, footnoted flux; condition from footnote: 750 mA (12 V) and 1500 mA (6 V), 20 ms pulse, 25°C, correlated to 85°C","bins":{"H2 6500K":1290}}],
  "vf_datasheet":[],"measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 5.25 A (6 V), 2.625 A (12 V)","flux":"H2 1290 lm"},
  "source":"https://download.luminus.com/datasheets/Luminus_SST-70X-WS_datasheet.pdf (056)"},

 {"name":"SBT-90 (Gen1, 'SBT-90')","manufacturer":"Luminus Devices","part_number_family":"SBT-90","variants":["White (SBT-90-W); Red variant also in datasheet"],
  "die":{"shape":"square","size_mm":"3.0 x 3.0","basis":"'Emitting Area 9.0 mm2' and 'Emitting Area Dimensions 3x3 mm' (datasheet does not say chip vs LES)","quote":"Emitting Area 9.0 9.0 mm2 / Emitting Area Dimensions 3x3 3x3 mm"},
  "dome":"not stated in extracted text","package_size_mm":null,"viewing_angle_deg":null,"lambertian":"not stated",
  "voltage_class":"not labelled; Vf 3.5 V at 1.0 A/mm2 (9 A)",
  "max_current_A":13.5,"pd_max_W":null,
  "flux_datasheet":[{"A":9.0,"cond":"binned at 9 A (flux bin condition header not captured)","bins":{"NA":"1590–1710 lm","NB":"1710–1830 lm"}}],
  "vf_datasheet":[{"A":9.0,"V_typ":3.5,"cond":"current density 1.0 A/mm2 (9 A)"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Current 13.5 A (White) / 'SBT-90 devices can be driven at currents ranging from 1 A to 13.5 A'","vf":"Forward Voltage VF 3.5 V (current density j 1.0 A/mm2)","tj":"Maximum Junction Temperature Tj-max 150 (White) 125 (Red) °C","bins":"NA 1,590 1,710 / NB 1,710 1,830"},
  "source":"https://download.luminus.com/datasheets/Luminus_SBT-90_Datasheet.pdf (023)"},

 {"name":"SBT-90-WxS (Gen2; forum name 'SBT-90.2' - equivalence is inference, not stated in datasheet)","manufacturer":"Luminus Devices","part_number_family":"SBT-90 Gen2","variants":["WDS (White Daylight Standard CRI typ 70) flux bins RB, SA, SB, TA, TB, UA, UB"],
  "die":{"shape":"square","size_mm":"3.0 x 3.0","basis":"'Emitting Area AE 9.0 mm2' / 'Emitting Area Dimension 3.0 x 3.0 mm'","quote":"Emitting Area AE 9.0 mm2  Emitting Area Dimension 3.0 x 3.0 mm x mm"},
  "dome":"not stated in extracted text (forum says no dome, flat glass lens; not confirmed from datasheet)","package_size_mm":null,"viewing_angle_deg":null,"lambertian":"not stated",
  "voltage_class":"3 V (Vf min 2.8, typ 3.1, max 3.8 at 9 A)",
  "max_current_A":{"CW":18,"note":"'Sustained operation at maximum current will result in shortened lifetime'; 'designed and optimized for operation near 9 A'"},"surge_A":27,"pd_max_W":null,"tj_max_C":150,"topr_max_C":85,
  "flux_datasheet":[{"A":9.0,"Tc_C":25,"cond":"'Binning @ 9 A, Tc = 25°C'; peak flux 3100 lm at 9 A, Tc 25°C (Ref. duty 100%)","bins":{"RB":"2600–2780 lm","SA":"2780–2990","SB":"2990–3200","TA":"3200–3400","TB":"3400–3680","UA":"3680–3955","UB":"3955–4230"}}],
  "vf_datasheet":[{"A":9.0,"V_min":2.8,"V_typ":3.1,"V_max":3.8,"cond":"If=9 A, Tc=25°C"}],
  "rth_jc_real_C_per_W":0.35,
  "measured":[],"chart_readings":[{"url":"https://download.luminus.com/datasheets/Luminus_SBT-90-Gen2_Datasheet.pdf","what":"relative flux vs current, Vf vs current, Vf vs temperature curves","values":null,"precision_note":"Not extracted (image charts)"}],
  "quotes":{"flux":"Binning @ 9 A, Tc = 25°C","peak":"Peak Luminous Flux 3,100 lm (If = 9.0 A, Tc = 25°C)","max":"Forward Current (CW) If CW max 18 A; Forward Surge Current (Pulsed) IS 27 A (Duty cycle < 10%, t = 10 ms)"},
  "source":"https://download.luminus.com/datasheets/Luminus_SBT-90-Gen2_Datasheet.pdf (021)"},

 {"name":"SST-90-W","manufacturer":"Luminus Devices","part_number_family":"SST-90","variants":["White"],
  "die":{"shape":"square","size_mm":"3.0 x 3.0","basis":"'Emitting Area 9.0 mm2', 'Emitting Area Dimensions 3x3 mm'","quote":"Emitting Area 9.0 mm2 / 3x3 mm"},
  "dome":null,"package_size_mm":null,"viewing_angle_deg":110,"viewing_angle_note":"datasheet unit printed as '°C' (typo; presumed degrees)","lambertian":"not stated",
  "voltage_class":"3 V class (Vf 2.5–3.9 V)",
  "max_current_A":{"CW":18,"surge":27,"surge_cond":"25 ms, D≤0.1, Tc≤40C"},"pd_max_W":null,
  "flux_datasheet":[],
  "vf_datasheet":[{"A_per_mm2":0.35,"V_typ":3.25},{"A_per_mm2":1.0,"V_typ":3.87,"V_min":2.5,"V_max":3.9}],
  "ambiguous":"Vf min/max row does not clearly say which current density it applies to.",
  "measured":[],"chart_readings":[],
  "quotes":{"max":"Maximum Current (CW) 18 A; Absolute Maximum Surge Current 27 A","viewing":"Viewing Angle (Typical) 2 θ1/2 110 °C"},
  "source":"https://download.luminus.com/datasheets/Luminus_SST-90-W_Datasheet.pdf (058)"},

 {"name":"CFT-90 (proxy only, not an SBT-90.2 measurement)","manufacturer":"Luminus Devices","part_number_family":"CFT-90","variants":["W (no dome) per forum; datasheet not extracted"],
  "die":{"shape":"square","size_mm":"3.0 x 3.0","basis":"forum: '9mm^2 Die, no dome'; datasheet not parsed","quote":"9mm^2 Die, no dome and is rated for up to 27A"},
  "dome":"domeless (per forum post)","package_size_mm":null,"viewing_angle_deg":null,"lambertian":"not stated",
  "voltage_class":"not extracted","max_current_A":27,"pd_max_W":null,
  "flux_datasheet":[],"vf_datasheet":[],
  "measured":[
    {"who":"sma (German TaschenlampenForum test, as quoted in BLF thread)","url":"https://budgetlightforum.com/t/luminus-cft-90-testing-the-mother-of-all-leds/48040","date":"not captured","setup":"not captured; poster notes 'I don't know what temperature the LED had in sma's test'",
     "flux":[[40,5700]],"vf":[[40,4.86]],"luminance_cd_mm2":[[40,230]],"intensity_cd":null,"max_tested_A":45,
     "note":"Quote: 'At 40A, 4.86V, 194W it produced 5700 Lumens'; 'It managed up to 230cd/mm^2'. Poster also lists: 'CFT-90 - 38A - 3.81V - 5600lm @ ??°C without dome - 228cd/mm^2 - 39lm/W' (poster's own table, temperature unknown)."}
  ],
  "chart_readings":[],
  "ambiguous":"The 38 A row is the poster's summary, not sma's own table. Secondhand, and the poster says 'The real values might be a bit different.'"
 },

 {"name":"SFT-40-WxS","manufacturer":"Luminus Devices","part_number_family":"SFT-40","variants":["WxS, CRI min65 typ70 (WxE CRI70); 5000K/6500K bins"],
  "die":{"shape":null,"size_mm":null,"basis":"'40: 4.0 mm2' nomenclature only","quote":"F: Flat Window  40: 4.0 mm2"},
  "dome":"flat window","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"3 V (Vf 2.6–3.1 V at 1500 mA)",
  "max_current_A":8.0,"surge_A":10,"pd_max_W":null,
  "flux_datasheet":[{"A":1.5,"cond":"measured 25°C, 1500 mA 20 ms, correlated to 1500 mA at 85°C","bins":{"5000K N3":554}}],
  "vf_datasheet":[{"A":1.5,"V_min":2.6,"V_typ":2.8,"V_max":3.1,"cond":"If=1500 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 8 A","vf":"Forward Voltage (@ I f=1500 mA, Tj=85°C) Vf 2.6 2.8 3.1 V","flux":"N3 554"},
  "source":"https://download.luminus.com/datasheets/Luminus_SFT-40-WxS_Datasheet.pdf (033)"},

 {"name":"SFT-40-WxH","manufacturer":"Luminus Devices","part_number_family":"SFT-40","variants":["WxH, CRI>95, 2700K bin D7 etc."],
  "die":{"shape":null,"size_mm":null,"basis":"'40: 4.0 mm2' nomenclature only","quote":"F: Flat Window  40: 4.0 mm2"},
  "dome":"flat window","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"3 V (Vf 2.5–3.1 V at 1500 mA)",
  "max_current_A":4.0,"pd_max_W":null,
  "flux_datasheet":[{"A":1.5,"Tj_C":85,"cond":"'Flux Bin1 If=1500 mA, Tj=85°C'","bins":{"D7 2700K":355}}],
  "vf_datasheet":[{"A":1.5,"V_min":2.5,"V_typ":2.8,"V_max":3.1,"cond":"If=1500 mA, Tj=85°C"}],
  "measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 4 A","vf":"Forward Voltage (If =1500 mA, Tj = 85°C) Vf min 2.5 typ 2.8 max 3.1","flux":"D7 355 lm (2700K bin)"},
  "source":"https://download.luminus.com/datasheets/Luminus_SFT-40-WxH_Datasheet.pdf (032)"},

 {"name":"SFT-40-WExx Gen2","manufacturer":"Luminus Devices","part_number_family":"SFT-40 Gen2","variants":["WExx, CRI>65, Gen2"],
  "die":{"shape":null,"size_mm":null,"basis":"'40: 4.0 mm2' nomenclature only","quote":"F: Flat Window  40: 4.0 mm2"},
  "dome":"flat window","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"not extracted",
  "max_current_A":8.0,"surge_A":10,"pd_max_W":29,
  "flux_datasheet":[{"cond":"binned, footnote 1: 1500 mA 20 ms, 25°C, correlated to 85°C","bins":{"F8":"610 lm (min)"}}],
  "vf_datasheet":[],"measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 8 A","pd_max_W":"Power Dissipation PD 29 W","flux":"F8 610 lm"},
  "source":"https://download.luminus.com/datasheets/Luminus_SFT-40-WExx_Gen2_Datasheet.pdf (031)"},

 {"name":"SFT-70X-WES (Gen2)","manufacturer":"Luminus Devices","part_number_family":"SFT-70X","variants":["WES CRI>65/70; 6V and 12V"],
  "die":{"shape":null,"size_mm":null,"basis":"'70X: 7.0 mm2' nomenclature only","quote":"70X: 7.0 mm2"},
  "dome":"not stated (S = surface mount code in nomenclature)","package_size_mm":null,"viewing_angle_deg":120,"lambertian":"not stated",
  "voltage_class":"6 V and 12 V variants",
  "max_current_A":{"6V":7.0,"12V":3.5},"pd_max_W":50,
  "flux_datasheet":[{"cond":"binned; footnote: 750 mA (12V) and 1500 mA (6V), 20 ms, 25°C, correlated to 85°C","bins":{"G9":"1135 lm (min)"}}],
  "vf_datasheet":[],"measured":[],"chart_readings":[],
  "quotes":{"max_current_A":"Maximum Drive Current: 7 A (6 V), 3.5 A (12 V)","pd_max_W":"Power Dissipation PD 50 W","flux":"G9 1135 lm"},
  "source":"https://download.luminus.com/datasheets/Luminus_SFT-70X-WES_Datasheet.pdf (035)"},

 {"name":"LUXEON MZ (Lumileds, 'MZ' LED)","manufacturer":"Lumileds (not Luminus)","part_number_family":"LUXEON MZ (LMZx-Sxxx 12V, -Rxxx 6V, -Qxxx 3V)","variants":["White 2700K–6500K CRI 70/80/90 (3V: LMZ7/8/9-Qxxx); Royal Blue LMZ0-Qxxx"],
  "die":{"shape":null,"size_mm":null,"basis":"not stated in DS136 text (Figure 8 mechanical drawing not parsed)","quote":null},
  "dome":"domeless / undomed (DS136: 'LUXEON MZ is an undomed multi-die LED')","package_size_mm":null,"viewing_angle_deg":120,"viewing_angle_note":"typical viewing angle (half-intensity), Table 2","lambertian":"not stated",
  "voltage_class":"3 V (Q): Vf min 2.63 typ 2.80 max 3.00 V",
  "max_current_A":{"Q_3V_DC":4.8,"Q_3V_pulsed":5.5},"tj_max_C":135,"pd_max_W":null,
  "flux_datasheet":[{"A":2.8,"Tj_C":85,"cond":"Table 1a, test current 2800 mA, Tj=85°C, minimum/typical lm","bins":{"LMZ7-QW30 3000K CRI70":"805/840","LMZ8-QW30 3000K CRI80":"730/781","LMZ9-QW30 3000K CRI90":"600/640","LMZ9-QW57 5700K CRI90":"700/770"}}],
  "vf_datasheet":[{"A":2.8,"V_min":2.63,"V_typ":2.8,"V_max":3.0,"cond":"Tj=85°C (Table 3)"}],
  "thermal_resistance_C_per_W":1.25,
  "measured":[],"chart_readings":[],
  "quotes":{"undomed":"LUXEON MZ is an undomed multi-die LED designed to enable outdoor and industrial applications","test":"LUXEON MZ LEDs are tested and binned with a drive current of ... 2800mA for LUXEON M 3V at a junction temperature, Tj, of 85ºC","vf":"LMZx-Qxxx 2.63 2.80 3.00 V","max":"4800mA for LMZx-Qxxx (DC)"},
  "ambiguous":"Datasheet text says 'LUXEON M 3V' at 2800 mA (apparent typo for MZ). Die size and Lambertian statement not found in text. Emisar/Noctigon use not verified.",
  "source":"https://otmm.lumileds.com/adaptivemedia/e980f4cddc049f20c2fa8582774bcefbc720759b (Lumileds DS136 LUXEON MZ Product Datasheet, 20151125)"}
]
```

Not found in datasheets or verified sources:
- SBT-90.2 / SBT-90 Gen2 measurements at 20–40 A: none verified. Datasheet max is 18 A CW, and forum data at those currents is absent from the pages I fetched.
- The SBT-90.2 thread (budgetlightforum.com/t/lumintop-power-sbt90-2/225229/15) has no measured current table. A search summary claimed a 17.3 A / 217 kcd reading and a 20 A test with 21 mV lead drop, but I could not find either in the page I fetched. I did not record them.
- koef3 measurements: I searched for SST-20, SST-40, SBT-90 and SFT-70 threads and found nothing I could verify. Search summaries mention a Koef3 SST-40 test (dedomed, bond wires failed at ~9.5 A) and an SST-40 current/lumen table up to 8.4 A. I did not fetch those pages, so they are unverified leads, not data. Lead: budgetlightforum.com/node/... "SST-40-W" thread via search, not checked.
- taschenlampen-forum.de: no SBT-90 or SST measurement page was found through search. Not fetched directly.
- zeroair and djozz: no 40 A SBT-90.2 data found in what I searched.
- Die size in mm for SST-20/40/70X and SFT-40/70X: the datasheets give the LES only as a code (e.g. "2.0 mm2", "4.0 mm2"). I did not find mm dimensions in the text. Package sizes were not extracted for any part.
- Flux bin table for SST-20-WxS is garbled in pdftotext; I did not record flux values for it.
- Lambertian distribution: not stated in any datasheet I read.
- Vf vs current curves and relative-flux curves are charts; not read.
- SFT-70X-WE CRI70 and High-CRI sheets returned 404 (not downloaded). SFT-25R, SFT-12R, SST-12, SST-20F/V, SFT-42R, CFT-90 datasheets were downloaded but not parsed (budget). Presets for SFT-40 (W and cool white), SFT-25R, SFT-70 (3000K 95 CRI) and SFT-70-X 6500K were not checked beyond the SFT-40/SFT-70X sheets above.

Ambiguous: the "SST-70" and "SBT-90.2" names are community or shorthand names, not Luminus part numbers. The SBT-90.2 equivalence to SBT-90-WxS (Gen2) is inference.