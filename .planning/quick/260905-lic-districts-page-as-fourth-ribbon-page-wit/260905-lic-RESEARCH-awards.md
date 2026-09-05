# Award-Based Qualification, Per Season (2019–2026) — Research

**Researched:** 2026-09-05
**Domain:** FRC district advancement rules — district event → DCMP → FIRST Championship
**Scope:** the seven seasons in the SigmaScout corpus: 2019, 2020, 2022, 2023, 2024, 2025, 2026
**Confidence:** HIGH for Q1/Q2/Q4/Q5; HIGH for Q3 2022–2026, MEDIUM-HIGH for Q3 2019–2020

## Headline: the district-event rule did NOT change across the corpus window

The task brief carried a belief that the district-event award rule "changed over time." **It did not,
anywhere in 2019–2026.** Every one of the seven seasons uses the identical four-criterion structure,
with the identical `(qualifies to compete for the award only)` parenthetical on Engineering
Inspiration and Rookie All Star, and no parenthetical on Chairman's/Impact. The only thing that
changed is the *name* of criterion A (Chairman's → FIRST Impact, in 2023).

Every season below was read from that season's own manual text — not inferred from a neighbour.
No nearest-year fallback is needed for Q1.

---

## Q1 — District event → District Championship, per season

`[VERIFIED]` all seven seasons, verbatim from each season's own game manual.

| Season | Manual § | A. Impact/Chairman's | B. Points | C. Eng. Inspiration | D. Rookie All Star |
|--------|----------|----------------------|-----------|---------------------|--------------------|
| 2019 | §12 "District Championship Eligibility" | `District Chairman's Award Winner` — **FULL** | first 2 home district events | `(qualifies to compete for the award only)` | `(qualifies to compete for the award only)` |
| 2020 | §11.8.2 | `District Chairman's Award Winner` — **FULL** ¹ | same | award-only | award-only |
| 2022 | §11.8.2 | `District Chairman's Award Winner` — **FULL** | same | award-only | award-only |
| 2023 | §11.8.2 | `District FIRST Impact Award Winner` — **FULL** | same | award-only | award-only |
| 2024 | §11.2 | `District FIRST Impact Award Winner` — **FULL** | same | award-only | award-only |
| 2025 | §11.2 | `District FIRST Impact Award Winner` — **FULL** | same | award-only | award-only |
| 2026 | §11.2 | `District FIRST Impact Award Winner` — **FULL** | same | award-only | award-only |

¹ The 2020 item A text sits in a font subset my PDF extractor drops, so item A rendered blank in the
2020 extraction. It is bracketed by identical 2019 and 2022 text (`District Chairman's Award Winner`),
and TBA's implementation treats 2020 identically. `[VERIFIED: 2020 Section11.pdf §11.8.2 — items B/C/D verbatim; item A inferred from the 2019 and 2022 bracket]` — **the single MEDIUM-confidence cell in this table.**

**Verbatim, 2025/2026 (identical wording in 2023/2024):**

> A team competing in a District qualifies for their District Championship by meeting 1 of the following criteria:
> A. District FIRST Impact Award Winner,
> B. District Ranking (based on total points earned at their first 2 home District events as detailed in Section 11.1 District Events),
> C. District Engineering Inspiration winner (qualifies to compete for the award only), and
> D. District Rookie All Star winner (qualifies to compete for the award only).

**Verbatim, 2019** (`Section12.pdf`, note "two"/"one" spelled out and no Oxford-comma list punctuation):

> A team competing in a District qualifies for their District Championship by meeting one of the following criteria:
> A. District Chairman's Award Winner
> B. District Ranking; based on total points earned at their first two home District events …
> C. District Engineering Inspiration winner (qualifies to compete for the award only)
> D. District Rookie All Star winner (qualifies to compete for the award only)

**Semantics to model:**
- **Impact/Chairman's winner at a regular district event → FULL qualification.** Robot competes; the
  team occupies a DCMP capacity slot. No parenthetical restricting it, in any season.
- **EI winner and RAS winner → award-only.** The team attends to be *considered for that award at the
  DCMP* and does **not** get a play slot, and does **not** consume a DCMP capacity slot (Q5 confirms
  TBA models it exactly this way).
- Criterion A is scoped to **regular district events only** (`EventType.DISTRICT`), not to the DCMP
  itself. TBA's `impact_award_winners()` filters `event.event_type_enum == EventType.DISTRICT`.
  `[VERIFIED: TBA district_advancement_helper.py:208-220]`

**Not checked:** 2018 and earlier. The 2018 manual is not at the `firstfrc.blob.core.windows.net`
paths that serve 2019–2026, and 2018 is outside the corpus. If the rule ever did change, the change
is **before 2019** — do not claim a change inside the corpus window.

---

## Q2 — District Championship → FIRST Championship, per season

`[VERIFIED]` all seven seasons. Which awards advance is **constant across 2019–2026**.

| Season | Source of truth | Impact/Chairman's | Eng. Inspiration | Rookie All Star | DCMP Winning Alliance |
|--------|-----------------|-------------------|------------------|-----------------|----------------------|
| 2019 | Game Manual §12.9 | ✅ slot | ✅ slot | ✅ slot | ✅ slot |
| 2020 | Game Manual §11.9 | ✅ slot | ✅ slot | ✅ slot | ✅ slot |
| 2022 | Championship Eligibility page | ✅ slot | ✅ slot | ✅ slot | ✅ slot |
| 2023 | Championship Eligibility page | ✅ slot | ✅ slot | ✅ slot (District may decline to present) | ✅ slot |
| 2024 | Championship Eligibility page | ✅ slot | ✅ slot | ✅ slot (District may decline to present) | ✅ slot |
| 2025 | Championship Eligibility page | ✅ slot | ✅ slot | ✅ slot (judges may decline to present) | ✅ slot |
| 2026 | Championship Eligibility page | ✅ slot | ✅ slot | ✅ slot (judges may decline to present) | ✅ slot |

**Verbatim, 2019 manual** (2020 identical with the year shifted):

> C. 2019 District Championship Qualifying teams
> i. Qualifying Award Winners a) Chairman's Award b) Engineering Inspiration Award c) Rookie All Star winners
> ii. District Championship Winners
> iii. Teams on the final District ranking list, as deep in the ranking list as the District needs to go to fill their allocation.

**Verbatim, 2026 eligibility page** (2023–2025 identical but for the RAS parenthetical):

> The following teams competing in the District model earn a Merit-Based Qualifying slot:
> - District Championship
>   - FIRST Impact Award Winners
>   - Engineering Inspiration Award Winners
>   - Rookie All-Star Winners (the judges can decide if they present this award or not)
>   - Winning Alliance members
> - as many teams in District-points total order to fill the Allocated FIRST Championship slots granted per the table below.

**"if presented" wording drifted, meaning did not.** 2023/2024 say *"the District can decide if they
present this award or not"*; 2025/2026 say *"the judges can decide…"*. Both mean a DCMP may present
zero RAS awards — so an RAS-based Champs slot may simply not exist in a given district-year. Model it
as "present-or-absent", never assume exactly one.

**Per-season difference worth encoding — Regional escape hatch closes in 2023:**
- 2019–2022: a district team attending a Regional *could* earn a Champs slot there, and that slot
  counted against the district's Champs allocation.
  `[VERIFIED: 2019 §12, 2020 §11.8, 2022 eligibility page]`
- 2023+: *"teams who compete in District areas will not be able to advance to the FIRST Championship
  from Regional events."* 2026 adds: *"Teams from Districts are also still not eligible to win the
  FIRST Impact Award, Engineering Inspiration, or Rookie All-Star award at Regional events."*
  `[VERIFIED: 2023 and 2026 eligibility pages, verbatim]`

**"Was EI advancement ever paid-registration-only rather than a slot?" — No, not in 2019–2026.**
Every primary source in the window lists DCMP EI winners as earning a genuine
Merit-Based Qualifying **slot**, in the same list as Impact and Winning Alliance. The current
firstinspires.org award description for Engineering Inspiration says only *"Celebrates a team who
demonstrates outstanding success in advancing respect and appreciation for engineering…"* — no grant,
no paid registration, no all-expenses-paid trip. `[VERIFIED: firstinspires.org/resources/library/frc/team-awards]`
A community wiki (first-robotics.fandom.com) claims an "all-expenses paid trip to the Championship"
for EI; that claim is **not corroborated by any FIRST primary source in 2019–2026** and describes
historical practice at best. `[ASSUMED — do not implement]`

---

## Q3 — FIRST Championship pre-qualification, per season

`[VERIFIED]` for every season. **The lookback N is not 8 throughout — it changed twice.**

| Season | Hall-of-Fame window | Original & sustaining | Prior-yr CMP Winners | Prior-yr CMP EI | Prior-yr CMP Impact Finalists | Prior-yr CMP Impact Winner | Total pre-qual |
|--------|--------------------|-----------------------|----------------------|-----------------|-------------------------------|----------------------------|----------------|
| 2019 | **all HoF members** (no window stated) | ✅ since 1992 | ✅ (2018) | ✅ (2018) | ✅ (2018) | — ² | n/a |
| 2020 | **all HoF members** (no window stated) | ✅ since 1992 ³ | ✅ (2019) | ✅ (2019) | ✅ (2019) | — ² | n/a |
| 2022 | **last 10 years** | ❌ | ❌ ⁴ | ❌ ⁴ | ❌ ⁴ | ❌ ⁴ | 13 |
| 2023 | **last 10 Championships prior to 2022** | ❌ | ✅ (2022) | ✅ (2022) | ✅ (2022) | ✅ (2022) | 14 HoF + 16 |
| 2024 | **last 10 Championships prior to 2023** | ❌ | ✅ (2023) | ✅ (2023) | ✅ (2023) | ✅ (2023) | 14 HoF + 18 |
| 2025 | **last 10 Championships prior to 2024** | ❌ | ✅ (2024) | ✅ (2024) | ✅ (2024) | ✅ (2024) | 14 HoF + 18 (+1 special) = 32 |
| 2026 | **last 8 years** | ❌ | ❌ | ❌ | ❌ | ❌ | **10** |

² 2019/2020 list *Chairman's Award **Finalists*** explicitly; the Championship Chairman's **Winner**
enters the Hall of Fame and is therefore already covered by the HoF row.
³ TBA's `CMP_QUALIFICATION_RULES` sets `ORIGINAL_AND_SUSTAINING` to `year_end=2019`, but the **2020
manual text still lists** *"original and sustaining teams since 1992"* in its prequalified list. **A
genuine conflict — flag, do not silently pick a side.** Low practical impact: the 2020 season was
cancelled mid-season, so no 2020 Champs invitations were ever issued.
`[VERIFIED: 2020 Section11.pdf §11.9]` vs `[VERIFIED: TBA cmp_qualification.py CMP_QUALIFICATION_RULES]`
⁴ 2022 lists Hall of Fame **only** — because the 2021 FIRST Championship was cancelled, so there were
no prior-year Championship results to pre-qualify from. Coherent, not an omission.

**Verbatim, 2019 manual** (2020 identical, year shifted):

> A. Prequalified teams
> i. members of the FIRST Hall of Fame
> ii. original and sustaining teams since 1992
> iii. 2018 FIRST Championship winners
> iv. 2018 FIRST Championship Engineering Inspiration Award winners
> v. 2018 FIRST Championship Chairman's Award Finalists

**Verbatim, 2026 eligibility page:**

> Hall of Fame teams that earned their Championship FIRST Impact Award in the last 8 years are
> pre-qualified teams. These teams are: 5985, 2486, 321, 1629, 503, 4613, 1816, 1902, 1311, 2834.
> One of those teams is not participating in 2026, so that slot goes back into the Regional Pool.

**Verbatim, the change announcement** (`2025-regional-advancement-changes-for-2026.pdf`):

> …Engineering Inspiration Winners, FIA Finalists, FIA Winner, and the last 10 years of FIA Winners
> (Hall of Fame teams). … There are no changes to FIRST Championship pre-qualification for 2025 as
> these teams were already awarded their spots at the 2024 FIRST Championship. **For 2026 and beyond,
> all non-Hall of Fame pre-qualifications slots are being removed. The number of slots for Hall of
> Fame spots are being reduced to the last 8 years.**

### Curated pre-qualified lists (copy these directly — all `[VERIFIED]`)

Hall of Fame, per season, from TBA `cmp_qualification.py` `HALL_OF_FAME_TEAMS_BY_YEAR`
(manual list starts at 2022; `HALL_OF_FAME_MANUAL_LIST_FIRST_YEAR = 2022`). These match the
firstinspires.org eligibility pages team-for-team where both exist:

- **2022** (13): 27, 503, 597, 987, 1114, 1311, 1538, 1816, 1902, 2614, 2834, 3132, 4613
- **2023** (15 in TBA / 14 on the FIRST page ⁵): 27, 359, 503, 597, 987, 1114, 1311, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613
- **2024** (15 in TBA / 14 on the FIRST page ⁵): 27, 321, 359, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613
- **2025** (15 in TBA / 14 on the FIRST page ⁵): 27, 321, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2486, 2614, 2834, 3132, 4613
- **2026** (10): 5985, 2486, 321, 1629, 503, 4613, 1816, 1902, 1311, 2834

⁵ The FIRST page's 2023 list omits 1311 relative to TBA's; 2024/2025 differ similarly by one team.
`[VERIFIED: both sides read this session]` — **prefer TBA's list**, since the same source supplies
`official_advancement_counts` and the two must agree for the slot arithmetic in Q5 to reconcile.

Original & sustaining teams (applies 2019 only per TBA; 2020 disputed per ³):
**20, 45, 126, 148, 151, 157, 190, 191, 250** `[VERIFIED: TBA cmp_qualification.py ORIGINAL_AND_SUSTAINING_TEAMS]`

Prior-year Championship pre-qualifiers, verbatim from the eligibility pages:
- **2023** — 2022 CMP Winners: 1619, 254, 3175, 6672 · 2022 Chairman's Finalists: 1511, 2438, 2468, 6429, 6652 · 2022 EI Winners: 2096, 2341, 2905, 3928, 4329, 5985 · 2022 Chairman's Winner: 1629
- **2024** — 2023 CMP Winners: 1323, 2609, 4096, 4414 · 2023 Impact Finalists: 118, 3284, 5665, 5985, 6865 · 2023 EI Winners: 4, 1156, 1676, 2096, 2486, 3937, 5166, 7565 · 2023 Impact Winner: 321
- **2025** — 2024 CMP Winners: 1690, 4522, 9432, 321 · 2024 Impact Finalists: 2438, 3990, 5614, 5985, 6429 · 2024 EI Winners: 2638, 2642, 3478, 4091, 4403, 6413, 8159, 9008 · 2024 Impact Winner: 2486 · plus **9739** (one-off: *"Due to extreme outside factors that impacted their ability to attend the 2024 FIRST Championship"*)

For 2019/2020 the equivalent lists are **not** enumerated in the manual — it states the *categories*
only. Derive them from TBA awards data (`EventType.CMP_FINALS` + `AwardType.WINNER` / `CHAIRMANS`,
and `EventType.CMP_DIVISION` + `ENGINEERING_INSPIRATION`, prior year), exactly as TBA's
`prior_year_cmp_teams()` does. `[VERIFIED: TBA district_advancement_helper.py:252-262]`

---

## Q4 — TBA `award_type` mapping

`[VERIFIED: the-blue-alliance/the-blue-alliance src/backend/common/consts/award_type.py, read verbatim this session]`

| Award | `award_type` | Enum name |
|-------|-------------|-----------|
| Chairman's / **FIRST Impact** | **0** | `CHAIRMANS` |
| Winner | **1** | `WINNER` |
| Finalist | 2 | `FINALIST` |
| Engineering Inspiration | **9** | `ENGINEERING_INSPIRATION` |
| Rookie All Star | **10** | `ROOKIE_ALL_STAR` |
| Wildcard | 68 | `WILDCARD` |
| Chairman's / Impact Finalist | 69 | `CHAIRMANS_FINALIST` |

**The rename does not change the enum value.** The file's own contract is explicit:

> An award type must be enumerated for every type of award ever awarded.
> **ONCE A TYPE IS ENUMERATED, IT MUST NOT BE CHANGED.**

The rename is a *display-name* overlay applied for 2023+:

```python
NORMALIZED_NAMES_2023 = {
    AwardType.CHAIRMANS: "FIRST Impact Award",
    AwardType.CHAIRMANS_FINALIST: "FIRST Impact Award Finalist",
}
```

**Implication for the implementation:** query `award_type == 0` for *all seven seasons*. Never branch
on the award's `name` string, and never special-case 2023. Present it as "Chairman's Award" for
2019–2022 and "FIRST Impact Award" for 2023+ if the label matters to the reader — that display split
is the *only* place the 2023 boundary belongs.

(Unrelated but adjacent: `NORMALIZED_NAMES_2026` renames `DEANS_LIST` → "FIRST Leadership Award" from
2026. It affects the DCMP award-count tables on the eligibility pages but not advancement.)

---

## Q5 — Slot accounting: do `official_advancement_counts` include award qualifiers?

**Answer: YES for `cmp`, YES for `dcmp` — award qualifiers are counted *inside* the published
capacity, not added on top of it.** Pre-qualified teams (Hall of Fame, prior-year Championship) are
the ones that sit *outside* it.

`[VERIFIED: TBA src/backend/common/helpers/district_advancement_helper.py and src/backend/common/consts/cmp_qualification.py, both read verbatim this session]`

TBA encodes this on a per-method basis via `CmpQualificationRule.eats_district_slot`:

| Qualification method | `eats_district_slot` | Active years |
|----------------------|---------------------|--------------|
| `DISTRICT_POINTS` | **True** | 2009–∞ |
| `DCMP_WINNER` | **True** | 2009–∞ |
| `DCMP_IMPACT` | **True** | 2009–∞ |
| `DCMP_ENGINEERING_INSPIRATION` | **True** | 2009–∞ |
| `DCMP_ROOKIE_ALL_STAR` | **True** | 2009–∞ |
| `REGIONAL_WINNER` / `REGIONAL_IMPACT` / `REGIONAL_EI` / `REGIONAL_WILDCARD` | **True** | 1992–**2025** |
| `HALL_OF_FAME` | False | 1992–∞ |
| `ORIGINAL_AND_SUSTAINING` | False | 1992–**2019** |
| `PRIOR_YEAR_CMP_WINNER` / `_IMPACT` / `_ENGINEERING_INSPIRATION` | False | 1992–**2025** |
| `WAITLIST` | False | 1992–∞ |
| `LATE_REGIONAL_*` (after the DCMP week) | False | 1992–2025 |

Note how the `year_end` values line up exactly with the manual findings above: `ORIGINAL_AND_SUSTAINING`
ends at 2019 (Q3, row ³), `PRIOR_YEAR_CMP_*` ends at 2025 (the 2026 removal), `REGIONAL_*` consuming
ends at 2025. Three independent confirmations of the same per-season boundaries.

### The two formulas to implement

```
DCMP points slots  = max(dcmp_slots − |{district-event Impact winners} ∩ {ranked teams}| , 0)
CMP  points slots  = max(cmp_slots  − |{consuming qualifiers}          ∩ {ranked teams}| , 0)
```

Both come from one function, `calculate_cutoffs(...)`:

```python
invited      = consuming & ranked_teams
points_slots = max(slots - len(invited), 0)
pool = [r for r in rankings
        if r["team_key"] not in consuming and r["team_key"] not in non_consuming]
```

**For DCMP** (`calculate_for_district`), `consuming = impact_award_winners(events)` — Impact/Chairman's
winners at `EventType.DISTRICT` events **only** — and `non_consuming = set()`. **Engineering
Inspiration and Rookie All Star winners are deliberately absent from the DCMP consuming set**, which
is precisely the machine-readable form of the manual's `(qualifies to compete for the award only)`.
They attend, they are not charged a capacity slot, and they do not displace a points-qualified team.

**For CMP** (`cmp_cutoffs`), `slots = official_advancement_counts["cmp"]`, `consuming` is the union of
all `eats_district_slot=True` methods above, and `non_consuming` is the union of the False ones —
excluded from the points pool but **not** charged against the district's allocation.

### The official statement backing it

FIRST's own eligibility page closes the district merit list with:

> — as many teams in District-points total order to **fill the Allocated FIRST Championship slots
> granted per the table below.**

"Fill the allocated slots" — points teams occupy the *remainder* of the allocation after the award
winners. `[VERIFIED: firstinspires.org championship-eligibility-criteria, 2023/2024/2025/2026 verbatim]`

And for the higher-level pool (identical wording 2022 → 2026):

> 'Available slots' are calculated by taking the total number of slots at FIRST Championship and
> subtracting the number of pre-qualified teams.

**One per-season difference here** — 2020 additionally subtracted a waitlist reserve, later dropped:

> 'Available slots' are calculated by taking the total number of slots at each FIRST Championship
> location, subtracting the number of pre-qualified teams assigned to that location, **and also
> subtracting a 10% allowance for waitlisted teams**, as Districts are still allowed to send
> waitlisted teams to the FIRST Championship. `[VERIFIED: 2020 Section11.pdf §11.9]`

| Season | Available-slots formula |
|--------|------------------------|
| 2019 | per-location; pre-qualified subtracted (10% clause **not** present in the 2019 text read) |
| 2020 | per-location; **minus pre-qualified minus 10% waitlist allowance** |
| 2022–2026 | total minus pre-qualified; snapshot taken 3 weeks after initial season payment due |

### Cross-check table: TBA's `FIRST_MANUAL_DISTRICT_ADVANCEMENT_COUNTS`

TBA sources `official_advancement_counts` from a hand-curated per-year table annotated `# From the
manual`. Use it to reconcile the corpus's `districts.dcmp_slots` / `cmp_slots`:

| Year | Districts covered | Notes |
|------|-------------------|-------|
| 2019 | fch fim fin fit fma fnc isr ne ont pch pnw (11) | fim 160/87, ont 80/29 |
| 2020 | same 11 | fim 200/90 — largest DCMP capacity in the corpus |
| 2022 | same 11 | ont cmp collapses to 11 (border/COVID) |
| 2023 | same 11 | ne dcmp 90 |
| 2024 | same 11 | ont dcmp 100 |
| 2025 | + **fsc** (12) | fsc 28/5 — special-cased, see below |
| 2026 | + **ca**, **win** (14) | `ca` = NorCal 60 + SoCal 60 = 120 dcmp / 46 cmp |

**2025 FIRST South Carolina is a documented exception to the whole points model:**

> \* Due to its size, FIRST South Carolina does not have enough Championship slots for this method to
> work. The following teams will receive automatic invitations to the 2025 FIRST Championship from
> the FIRST South Carolina State Championship: Winning Alliance Captain · Winning Alliance First Pick
> · FIRST Impact Award Winner · Engineering Inspiration Award Winner · Next highest District Points

`[VERIFIED: 2025 eligibility page verbatim]` — **this footnote is gone in 2026**, where `fsc` is
allocated 7 slots and uses the standard model. `[VERIFIED: live 2026 eligibility page]` If the Champ
Locks tab renders `2025fsc`, the ordinary cut-line math is **wrong** for that district-year; it needs
the explicit five-invite rule or an honest "special allocation — not modeled" state.

---

## Implementation gap in the current corpus

**The corpus has no awards table.** `packages/corpus/schema.sql` defines `teams`, `events`, `matches`,
`http_cache`, `ingest_runs`, `team_media`, `event_rankings`, `event_alliances`, `districts`,
`district_rankings`, `event_teams` — and nothing else. `[VERIFIED: schema.sql, grep for "award" returns zero hits]`
This matches the quick task's own deferral note: *"Award-level detail (which award) is not ingested —
TBA's `award_points` aggregate suffices."*

Everything in Q1–Q3 needs award-level data that is not present. Modeling award-based qualification
requires a new ingest of `GET /event/{event_key}/awards`, keeping at minimum
`event_key`, `award_type`, `team_key`, `year`, filtered to award types `{0, 1, 9, 10}`.
`district_rankings.award_points` cannot substitute — it is a scalar that cannot distinguish an Impact
win (full DCMP slot) from an EI win (award-only, no slot).

Also note `event_alliances` is already ingested, so DCMP Winning Alliance membership for Q2 is
derivable **without** the new awards ingest — but `AwardType.WINNER` (1) at the DCMP is the more
direct signal and comes free with the same fetch.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | 2020 criterion A reads `District Chairman's Award Winner` | Q1, note ¹ | Very low — bracketed by verbatim 2019 and 2022 text; TBA treats 2020 identically. Would only matter if 2020 uniquely dropped Impact-as-full-qualifier, which no source suggests |
| A2 | 2019/2020 "members of the FIRST Hall of Fame" means *all* HoF members with no year window | Q3 | Moderate — the manual states no window, and TBA derives pre-2022 HoF as every `CMP_FINALS` + `CHAIRMANS` award with `award.year < season`. If a window existed off-manual, 2019/2020 pre-qual counts would be over-generated |
| A3 | The EI "all-expenses paid trip" claim is historical/community lore, not a 2019–2026 rule | Q2 | Low — explicitly contradicted by the absence of any such clause in seven seasons of primary sources. Flagged so it is not implemented |
| A4 | 2018 and earlier are out of scope; no rule change is claimed inside 2019–2026 | Q1 | Low for this corpus. If the user's memory of a change is real, it predates 2019 |

## Open Questions

1. **2020 original-and-sustaining conflict (Q3 note ³).** The 2020 manual lists the category; TBA's
   rule table ends it at 2019. Unresolvable from sources — the 2020 season was cancelled before Champs
   invitations issued, so no ground truth exists. *Recommendation:* follow TBA (`year_end=2019`) so the
   slot arithmetic reconciles against `official_advancement_counts`, and note the discrepancy in-code.
2. **Hall-of-Fame list disagreement, 2023–2025 (Q3 note ⁵).** TBA lists 15 teams where the FIRST page
   lists 14. *Recommendation:* use TBA's list — same provenance as the slot counts.
3. **2019 available-slots formula.** The 10% waitlist allowance is explicit in 2020 and absent from the
   2019 text I read. Not confirmed either way for 2019. Only matters if the implementation recomputes
   allocations from scratch rather than consuming `official_advancement_counts` — which it should not.

## Sources

### Primary — HIGH confidence (fetched and read verbatim this session)

- 2019 Game Manual §12 Tournaments — `firstfrc.blob.core.windows.net/frc2019/Manual/Sections/Section12.pdf`
- 2020 Game Manual §11 Tournaments — `firstfrc.blob.core.windows.net/frc2020/Manual/Sections/Section11.pdf`
- 2022 Game Manual §11 — `.../frc2022/Manual/Sections/2022FRCGameManual-11.pdf` and the HTML mirror `.../frc2022/Manual/HTML/2022FRCGameManual.htm` (the HTML resolved item A where the PDF font subset did not)
- 2023 Game Manual §11 — `.../frc2023/Manual/Sections/2023FRCGameManual-11.pdf`
- 2024 Game Manual §11.2 — `.../frc2024/Manual/HTML/2024GameManual.htm` and `frcmanual.com/2024/district-tournaments`
- 2025 Game Manual §11.2 — `frcmanual.com/2025/district-tournaments`
- 2026 Game Manual §11.2 — `frcmanual.com/2026/district-tournaments`
- FIRST Championship Eligibility, live (2026) — `firstinspires.org/resource-library/frc/championship-eligibility-criteria`
- FIRST Championship Eligibility, archived per season — Wayback snapshots `20220313105230`, `20230331085032`, `20240407045255`, `20250331003512`
- `2025-regional-advancement-changes-for-2026.pdf` — `info.firstinspires.org/hubfs/blog/frc/`
- FIRST team awards descriptions — `firstinspires.org/resources/library/frc/team-awards`
- TBA source, `main` branch: `consts/award_type.py`, `consts/cmp_qualification.py`, `consts/district_advancements.py`, `models/district_advancement.py`, `models/district.py`, `helpers/district_advancement_helper.py`
- SigmaScout repo: `packages/corpus/schema.sql`, `packages/ingest/districts.ts`, `packages/ingest/schemas.ts`

### Tertiary — LOW confidence, used only as a negative finding

- `first-robotics.fandom.com` Engineering Inspiration page — the "all-expenses paid trip" claim, recorded above solely to mark it as uncorroborated and not to be implemented.

## Metadata

**Confidence breakdown:**
- Q1 district-event rules: HIGH — all seven seasons read verbatim from their own manuals; one inferred cell flagged
- Q2 DCMP→CMP: HIGH — all seven seasons; wording drift documented
- Q3 pre-qualification: HIGH 2022–2026 (enumerated team lists), MEDIUM-HIGH 2019–2020 (categories stated, teams not enumerated)
- Q4 award_type: HIGH — read from TBA source with its own no-change contract
- Q5 slot accounting: HIGH — read from TBA's implementation, cross-confirmed by FIRST's "fill the allocated slots" wording and by three independent `year_end` boundary agreements

**Valid until:** stable for 2019–2025 (historical, frozen). 2026 is the live season — re-check the
Championship Eligibility page before relying on 2026 pre-qualified team lists or district allocations.
