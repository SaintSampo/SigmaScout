# Phase 1: Data Foundation & Evaluation Harness - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

<domain>
## Phase Boundary

An offline pipeline and library: TBA API v3 ingestion into a normalized local 2022–2026 corpus (quirks handled explicitly), a walk-forward evaluation harness that scores any algorithm with Brier score, winner accuracy, and calibration curves under predict-before-update sequencing, and OPR as the first scored baseline. No UI, no deployment, no Sigma1 — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### Harness output format
- **D-01:** The primary human-facing output of a harness run is a **self-contained HTML report** with embedded charts (score tables per algorithm per season, calibration plots). — **Reversibility:** reversible
- **D-02:** A **machine-readable JSON artifact** is produced underneath the HTML report from day one — EVAL-05 later requires the Compare page to display exactly these numbers, so the JSON is the canonical output and the HTML renders from it. — **Reversibility:** costly — the JSON schema becomes the contract the Phase 8 Compare page consumes; changing it later touches the site and the harness.
- **D-03:** Calibration curves are both rendered as charts in the HTML report and stored as binned data in the JSON artifact.
- **D-04:** Reports include a clearly-labeled **static reference row of Statbotics' published per-season accuracy** from day one, so every report shows the target before our EPA reimplementation exists (Phase 2).

### Corpus scope
- **D-05:** Ingestion stores each match's **full raw score_breakdown JSON as-is**; Phase 1 normalizes only totals, winner, and RP awards. Per-season component extraction is deferred until a model or UI tab needs it (Phase 3 RP rules, Phase 7 Breakdown tab). Nothing should ever need re-fetching from TBA because we kept raw payloads. — **Reversibility:** reversible — normalization can be extended over stored raw data at any time.

### Offseason & quirk policy
- **D-06:** Offseason events are **ingested and flagged**, excluded from ratings and accuracy scoring by default. Rationale: keeps eval clean while enabling Phase 4's live freshness test against fall 2026 offseason events. — **Reversibility:** reversible
- **D-07:** **Surrogate appearances are excluded from ratings entirely** — a surrogate team's participation does not update that team's rating and does not count toward its record. (Note for researcher/planner: this leaves a modeling question of how to treat the surrogate's slot in the alliance observation for the other five teams — e.g., predict with the surrogate's current rating but skip its update. Resolve at research/planning time within this decision's constraint: no rating update, no record impact for the surrogate.)
- **D-08:** Replayed matches keep **only the final (replay) result** as the canonical outcome, with a flag noting a replay occurred; the original result is not stored as a scoreable record.

### Tune/holdout split
- **D-09:** **Fixed split: 2022–2024 are tune seasons, 2025–2026 are holdout.** The optimizer may only ever see 2022–2024; headline accuracy claims come exclusively from 2025–2026, which no optimization loop touches. — **Reversibility:** costly — changing the split after tuning has run invalidates published holdout claims; a widened split can only be adopted with a fresh tuning run and re-stated claims.
- **D-10:** The **headline metric is winner accuracy** (what the FRC community intuitively compares), with Brier score always reported alongside it. Calibration curves guard against the overconfidence that accuracy alone hides.
- **D-11:** **All matches count in accuracy scoring — quals and elims** — reported separately and combined. Elims predictions are visible on the site, so they must be measured.

### Claude's Discretion
- Local corpus storage format (SQLite vs JSON files vs other) — research/planning picks based on query patterns and tooling.
- OPR solver details, harness CLI shape, module layout, testing framework specifics.
- Exact handling of the surrogate slot in alliance observations (within D-07's constraint).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & constraints
- `REBUILD_SPEC.md` — Full product spec, clean-slate mandate (do NOT consult pre-v3 code/models/values), and the failure log this phase directly answers (no eval harness, outcome leakage, recompute-per-request)

### Research (Phase-1-relevant findings)
- `.planning/research/SUMMARY.md` — Synthesis; build order and the shared predict/update pure-function contract recommendation
- `.planning/research/PITFALLS.md` — Evaluation-methodology traps (leakage, data snooping, calibration), TBA data quirks (surrogates, replays, missing breakdowns, offseason), with prevention strategies mapped to this phase
- `.planning/research/ARCHITECTURE.md` — Component boundaries: ingestion / harness / algorithm contract split; offline-vs-online compute split that this phase's code must respect (the same core later runs in a 10ms-CPU Worker)
- `.planning/research/STACK.md` — Node/TypeScript pipeline tooling recommendations, TBA ETag client pattern, testing framework (Vitest)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — the repo is a deliberate clean slate (only planning docs, REBUILD_SPEC.md, and CI config exist). Pre-v3 code at git tag `v2-poc` is off-limits per the clean-slate mandate.

### Established Patterns
- None yet — this phase establishes them. Whatever module/contract patterns this phase sets (algorithm interface, corpus schema, artifact schema) become the project's founding patterns.

### Integration Points
- A TBA API key exists in the untracked `.env` at repo root.
- `.github/workflows/deploy.yml` is stale (describes the deleted v2 build) and will be replaced in a later phase — not this one.

</code_context>

<specifics>
## Specific Ideas

- The harness report should feel like a scoreboard against Statbotics: every run shows our algorithms' numbers next to Statbotics' published accuracy (D-04), making "measurably better" visible from the first OPR run.
- Predict-before-update must be structurally enforced (shared pure predict/update contract + a test proving reading a result before predicting fails) — locked at roadmap level, reflected in Phase 1 success criteria 3 and 4.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Data Foundation & Evaluation Harness*
*Context gathered: 2026-08-12*
