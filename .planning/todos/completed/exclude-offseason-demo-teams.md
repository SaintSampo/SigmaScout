---
id: exclude-offseason-demo-teams
created: 2026-08-29
source: 07-19 orchestrator investigation (developer-directed)
resolves_phase:
priority: high
---

# Exclude FRC "Off-Season Demo Team" entries (9970-9999) from the model and every published surface

## Decision (developer-directed, 2026-08-29)

FRC team numbers **9970-9999 are not real teams and must be excluded from both the model and every
published surface.** TBA itself names all 30 as `Off-Season Demo Team {n}`. Nothing else exists in
the 9900s. This scope was chosen explicitly over a surfaces-only alternative (hiding them in the
UI only), because the contamination is in the RATINGS themselves, not just in what a page renders —
a surfaces-only fix would leave every real team's OPR/EPA/VPR rating still folding these fake
opponents' fake results.

## Measured blast radius (from `data/corpus.sqlite`, read-only queries)

- **30 demo teams**, `frc9970`-`frc9999`; **138 demo team-seasons** would stop publishing (×3
  algorithms ≈ 414 objects), plus a `teams/{year}` regeneration for every affected season.
- **6,285 matches** contain at least one demo team — 6,120 played, 165 scheduled-only — across
  **254 distinct events**. By year: 2022: 1,027, 2023: 1,233, 2024: 1,505, 2025: 1,885, 2026: 635.
- **6,245** of those matches are at offseason events; **40 are at NON-offseason events.**
- Of those 40: **36 are played `qf`/`sf` matches at real regionals/district events where an ENTIRE
  alliance is demo teams** — forfeit/no-show playoffs that the model currently reads as a real
  alliance dominating three opponents. Affected events: `2022arli`, `2022bcvi`, `2022hiho`,
  `2022mokc3`, `2022waspo`, `2022wayak`, `2023gaalb`, `2024vapor`, `2025ncash`, `2026mefal`,
  `2026txfor`, `2026txmca` (one match, `2026txmca_sf6m1`, has BOTH alliances fully demo). The
  remaining 4 are unplayed, scheduled-only preseason matches at `2025srsd`.
- **The fix must be team-level, not match-level.** Only **428 alliances** are fully demo, while
  **7,684 alliances are mixed** (a demo team filling one slot beside real robots). Dropping every
  match that merely CONTAINS a demo team would discard ~6,000 matches of genuine information about
  the real teams sharing those alliances — the exclusion has to remove the demo teams' own columns
  and ratings, not the matches they happened to appear in.

## Explicit non-goal — this does NOT fix the payload ceiling

`.planning/WINDOWS.md` ledger #15 (the `team/{teamKey}/{year}` absolute-ceiling crossing) **stays
open regardless of this fix.** The current max `team` page is `frc9999/2024` (282 played matches,
821,938 bytes), but the largest REAL team-season is `frc3538/2024` at 234 played matches — roughly
**~682,000 bytes estimated**, still over BOTH the 375,000-byte committed budget and the 600,000-byte
absolute structural bound `payloadBudget.test.ts` enforces. Removing the demo teams lowers the
measured maximum by roughly 19% and clears **neither** ceiling. This is stated plainly here so
nobody later mistakes this todo for a budget fix — ledger #11 and #15 need their own resolution,
separately.

## Cost

Excluding these teams changes every published rating (any real team that ever played a demo team,
which is most of the corpus given 6,285 contaminated matches), so it requires a **full republish**
(~27 min wall clock, ~57k PUTs, per this document's own measured publish cadence). [[
remeasure-accuracy-record-offseason-inclusion ]] (07-17's own routed finding) already opened an
un-closed divergence between the published model and the accuracy record measured in `docs/models/`
and `data/baselines/` — folding this exclusion in BEFORE that re-measurement means the accuracy
record is re-measured once against the final, demo-team-free, offseason-inclusive model, rather
than twice (once now, again after this exclusion lands).

## Sequencing (developer-directed)

Land after phase 07 plan 07-19 completes and **BEFORE 07-20**, so 07-20's backstop e2e evidence
runs against genuinely final pages — not against pages that will change again once these fake teams
are pulled out.

## Acceptance

- The 30 `frc9970`-`frc9999` team keys are excluded from the model's design matrix / state folding
  for every algorithm (OPR, EPA, VPR) — not merely hidden client-side.
- A full republish confirms: 138 fewer team-season objects; every affected real team's rating moves
  (expected, and the point); the 36 forfeit/no-show playoff matches at real events no longer inflate
  any real alliance's apparent dominance.
- `docs/publish-budget.md` re-measured post-exclusion, explicitly stating the new `team/{teamKey}/{year}`
  maximum and confirming (not assuming) whether it is `frc3538/2024` or another real team-season,
  and confirming ledger #11/#15 remain open with their own (unchanged) figures if still applicable.
- The accuracy re-measurement in [[remeasure-accuracy-record-offseason-inclusion]] runs against the
  post-exclusion model, not before it.

## Related

- `.planning/WINDOWS.md` ledger #11, #15 (payload ceilings — explicitly NOT fixed by this todo)
- [[remeasure-accuracy-record-offseason-inclusion]] — sequence this exclusion BEFORE that
  re-measurement, per the "Cost" section above
- 07-19 developer gate discussion, 2026-08-29 (source of this todo)
