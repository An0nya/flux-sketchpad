# Cornering lamps and bending/AFS light: what the regulations say

Research only, no code changes. Date: 2026-10-16.

## Sources and what was actually read

- **FMVSS 108 (49 CFR 571.108), US:** fetched from eCFR (renderer endpoint, `current`), converted to text, grepped. Full section present; amendment history ends at 87 FR 10021 (Feb 22, 2022). Note: the eCFR "current" rendering date was not confirmed.
- **UNECE R48 / R119 / R123 / R149:** unece.org returned HTTP 403 for every PDF tried. Not read.
- **EUR-Lex:** search page returned HTTP 202 with an empty body. Not read.
- **Web search (leads only, not primary text):** globalautoregs.com, digitallibrary.un.org WP.29 documents, lexaris.de (an EUR-Lex copy of R119, which says it is incomplete up to Supplement 3 to the 01 series).
- **Our TR report:** `/Users/anya/Projects/flux-sketchpad/.claude/briefs/reports/TR-touge-r2.md`, "Cornering lamps study" section (line ~91).

## Regulation comparison

| Item | US FMVSS 108 | UNECE R48 | UNECE R119 | UNECE R123 / R149 |
|---|---|---|---|---|
| Cornering lamp defined | **Not found.** Grep for "cornering" returned no hits. | Unverified (not fetched). | Unverified text. Secondary copy defines it as supplementary light near the forward corner on the side of the turn. Section number not confirmed. | Not checked. |
| Required or optional | Not found. | Unverified. | Unverified. | Not checked. |
| Colour | Not found. | Unverified. | Unverified. | Not checked. |
| Activation (turn signal, steering, speed) | Not found. | Unverified. A WP.29 drafting document says a cornering lamp may switch on automatically when the direction indicator is on, and that the indicator-linked light must not activate above 40 km/h. Not confirmed as adopted wording. | Unverified. | Not checked. |
| Speed limit | Not found for cornering lamps. For ADB (adaptive driving beam) see S9.4.1.6.4.6: "For vehicle speeds below 32 kph (20 mph), the system must provide only lower beams." | 40 km/h appears in drafting documents, not confirmed as governing text. A 2014 OICA proposal floated keeping cornering lamps on at speeds up to 10 km/h during slow manoeuvres. Its final adopted state is unconfirmed. | Unverified. | Not checked. |
| Angles / photometry | Not found for cornering lamps. ADB photometry: Table XXI (S9.4.1.6.4.2), test S14.9.3.12. | Unverified. | Unverified. A 2014-15 amendment record mentions post-operation photometric checks at 1 and 30 min for non-filament sources. Not verified against the regulation text. | Not checked. |
| Bending / AFS / ADB | Present as **ADB** only, S9.4.1.6 (semiautomatic switching, Option 2), with S9.4.1.6.4.7 (not energised with lower/upper beams except per Table II) and S9.4.1.6.5 (parking lamps required). "Bending light" as such: not found. | Bend-lighting is in R48 drafting (not verified). | Not applicable. | R123 (AFS) and R149 (road illumination) not checked. |

Quotes (each ≤15 words, from the fetched FMVSS 108 text):
- S9.4.1.6.4.6: "For vehicle speeds below 32 kph (20 mph), the system must provide only lower beams."
- S9.4.1.6.4.2: "The adaptive driving beams must be designed to conform to the photometry requirements of Table XXI..."
- Definition: "Adaptive driving beam means a long-range light beam for forward visibility..."

## Our implementation vs regs

Matches / consistent:
- Cornering lamps are default-off and controlled by a button, which is consistent with both regimes being opt-in equipment.
- Speed-dependent gating below about 40 km/h matches the UNECE drafting value and the Ford/Volvo manual descriptions. The 40 km/h value is therefore plausible but **not verified against regulation text**.

Differences / open:
- Our build fades cornering lamps from the **steering or curve signal**. A WP.29 drafting document ties the activation to the **direction indicator**. The indicator-linked behaviour is the one reported in drafting text, so steering-only activation may be an ECE-only or manufacturer-specific choice. Unverified.
- US: FMVSS 108 has no cornering-lamp provision that I could find. So a US-market claim cannot cite FMVSS 108 for cornering lamps. Any US wording must be marked "no FMVSS 108 provision found."
- Our AFS angle (about ±15°, from the HELLA description in the TR report) has no regulatory numeric check here. The only ADB rule I could verify is the 32 km/h lower-beam-only rule (S9.4.1.6.4.6), which applies to ADB in the US. Our 40 km/h cornering threshold is a different rule and should not be compared to it as if it were the same.
- Our 45–60° outboard lamp angle has no source in the regs I read. Mark as unverified.

## Unverified / couldn't fetch

- UNECE R48, R119, R123, R149: all primary PDFs blocked (HTTP 403). Need a manual download of the current consolidated texts and TRANS/WP.29/343 for the status of supplements.
- EUR-Lex: returned HTTP 202 with no body. Retry in a browser.
- Cornering lamp colour, count, mounting, angles, and photometry in every regime: not verified.
- The 40 km/h limit and the indicator-linked activation: found only in drafting documents, not in adopted text.
- The eCFR "current" rendering date for FMVSS 108 was not confirmed.
- TR report figures (Ford Ranger manual, HELLA ±15°) are manufacturer sources, not regulation.

## Summary

1. FMVSS 108 (current eCFR text) contains no cornering-lamp provision; the grep for "cornering" returned nothing.
2. The only verified speed rule in the US text is ADB: lower beams only below 32 km/h (S9.4.1.6.4.6).
3. UNECE R48/R119 text was not reachable; the 40 km/h and indicator-linked activation rules appear only in drafting documents and need primary-text confirmation.
4. Our build's steering/curve activation may differ from the indicator-linked ECE drafting; treat it as a design choice, not a regulation match.
5. Next step: download R48 and R119 consolidated PDFs manually and check the 40 km/h and activation clauses.

## Claude's check (2026-10-16)
- Verified Haiku's fetch is the real full text, not an error page: fmvss108.txt is 277 KB, contains "turn signal" 136×, "cornering" 0×, "J852" 0×. So current FMVSS 108 doesn't regulate cornering lamps at all.
- What does apply in the US: S6.2.1 — "No additional lamp … is permitted to be installed that impairs the effectiveness of lighting equipment required by this standard." Cornering lamps are optional extras under that general rule (SAE J852 is an industry standard, not incorporated in today's 108).
- Retraction: I told Anya from memory that US cornering lamps "come on only with the turn signal, tested to SAE J852". Not supported by the current text; that may be older 108 or SAE practice. Unverified either way.
