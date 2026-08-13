# Phase 1: Data Foundation & Evaluation Harness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-12
**Phase:** 1-Data Foundation & Evaluation Harness
**Areas discussed:** Harness output format, Corpus scope, Offseason & quirk policy, Tune/holdout split

---

## Harness output format

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown + JSON (Recommended) | Human-readable report + machine JSON that later feeds the Compare page | |
| HTML report | Self-contained HTML with embedded charts | ✓ |
| Terminal output only | Score tables printed per run, nothing persisted | |

**User's choice:** HTML report
**Notes:** JSON artifact still produced underneath (EVAL-05 requires it); HTML renders from it.

| Option | Description | Selected |
|--------|-------------|----------|
| Charts + data (Recommended) | Rendered calibration plots + binned data in the JSON artifact | ✓ |
| Data only | Binned data only, no offline rendering | |

**User's choice:** Charts + data

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, static reference (Recommended) | Hardcode Statbotics' published per-season accuracy as a labeled reference row | ✓ |
| No, wait for EPA | Compare only algorithms we run until Phase 2 | |

**User's choice:** Yes, static reference

---

## Corpus scope

| Option | Description | Selected |
|--------|-------------|----------|
| Raw + totals (Recommended) | Store full raw score_breakdown; normalize totals/winner/RP awards only | ✓ |
| Full normalization now | Per-season component extraction for all five games in Phase 1 | |
| Totals only | Skip storing raw breakdowns entirely | |

**User's choice:** Raw + totals

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Claude's discretion at research/planning time | ✓ |
| SQLite | Single-file queryable database | |
| JSON files | Per-event/per-season JSON files | |

**User's choice:** You decide (corpus storage format)

---

## Offseason & quirk policy

| Option | Description | Selected |
|--------|-------------|----------|
| Ingest + flag (Recommended) | Stored and flagged, excluded from ratings/eval by default | ✓ |
| Exclude entirely | Don't ingest offseason events | |
| Count them | Offseason matches update ratings | |

**User's choice:** Ingest + flag

| Option | Description | Selected |
|--------|-------------|----------|
| Rate yes, record no (Recommended) | Surrogate match updates ratings but not the team's official record | |
| Skip for surrogates | Surrogate's participation excluded from ratings too | ✓ |

**User's choice:** Skip for surrogates — surrogate appearances update nothing for the surrogate team.

| Option | Description | Selected |
|--------|-------------|----------|
| Final result only (Recommended) | Replay outcome is the one canonical result, flagged | ✓ |
| Keep both, flagged | Original and replay stored as separate records | |

**User's choice:** Final result only

---

## Tune/holdout split

| Option | Description | Selected |
|--------|-------------|----------|
| Tune 22-24, hold 25-26 (Recommended) | Fixed split; recent seasons are the untouched exam | ✓ |
| Every season examined (leave-one-out) | Rotate holdout across all five seasons, ~5× compute | |
| Hybrid | Fixed split daily + occasional full rotation | |

**User's choice:** Tune 22-24, hold 25-26
**Notes:** User initially answered "I dont understand this quesrtion" — the tune/holdout concept was explained in plain language (practice test vs final exam; data-snooping risk), after which they chose the recommended fixed split.

| Option | Description | Selected |
|--------|-------------|----------|
| Brier primary (Recommended) | Calibration-rewarding score as headline | |
| Accuracy primary | Winner accuracy as headline, Brier alongside | ✓ |

**User's choice:** Accuracy primary — winner accuracy is the community's intuitive comparison; Brier and calibration curves still always reported.

| Option | Description | Selected |
|--------|-------------|----------|
| All matches (Recommended) | Quals + elims scored, reported separately and combined | ✓ |
| Quals only | Headline from quals; elims unscored | |

**User's choice:** All matches

---

## Claude's Discretion

- Local corpus storage format (SQLite vs JSON vs other)
- OPR solver details, harness CLI shape, module layout, testing specifics
- Surrogate-slot handling in alliance observations (within the no-update constraint)

## Deferred Ideas

None — discussion stayed within phase scope.
