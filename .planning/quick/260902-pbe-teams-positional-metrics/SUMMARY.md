---
quick_id: 260902-pbe
slug: teams-positional-metrics
date: 2026-09-03
status: complete
tasks_completed: 1
source: payload-budget attribution, 2026-09-02
---

# Summary — the teams artifact's metrics are encoded positionally

## Commits

| SHA | What a user would have seen |
|---|---|
| `b75b49cf` | Nothing today — production serves the object form until the republish. Afterwards the 2024/vpr teams artifact drops 3,704,776 → **1,489,187 B raw (−59.8%)**, clearing its 3,500,000 budget with room; the compressed page drops 304,710 → 271,731 B (**−11.8%** at Brotli q11). |

## Design: two schemas, decode at the boundary

- **`TeamsArtifactWireSchema`** validates the shape as written to and read from
  R2 — `metrics` is either the pre-existing object record *or* the new positional
  array. It does not decode. The publisher and the Worker validate against this,
  because its output is exactly what gets stringified to R2.
- **`TeamsArtifactSchema`** wraps it in a `.transform()` that decodes either shape
  to the one canonical `Record<string, TeamMetric>` every consumer already
  expects.

The payoff: `apps/web`'s `fetchTeamsArtifact` and `rowModel.ts`'s
`buildTeamRows` needed **zero functional change**. Decoding happens once, at the
schema boundary.

Encoding: `null` (metric absent), `[value]`, `[value, spread]`, or
`[value, spread|null, tier]` — length disambiguates, so an absent metric, a
genuine zero spread, and a tier-without-spread can never collapse into each
other. That was the specific correctness risk in this change.

## Scope held

`MetricsRecordSchema` is shared by the team-season `seasonStats` and the event
artifact's standings row. It was **wrapped in a union at the teams row, not
replaced** — verified by diff. The event and team artifact shapes are unchanged,
and the five client components that read `.metrics` from them were untouched. An
event carries ~40 team rows where this saves nothing; the entire win is the teams
artifact's 3,549.

## Two decisions worth recording

**`PAGE_ARTIFACT_SCHEMA_VERSION` not bumped — for a different reason than the
previous task's.** `PagePreambleSchema.schemaVersion` is
`z.literal(PAGE_ARTIFACT_SCHEMA_VERSION)`, and every teams artifact in R2 carries
`schemaVersion: 1`. Bumping would make the schema **reject every artifact already
in production** until the republish — immediate breakage, strictly worse than the
bounded staleness risk of leaving it. 260902-pbc reached the same answer via
D-02's precedent; this one reaches it via the literal.

**A blocking bug caught outside the plan's file list.** `artifactWriter.ts`'s
`SCHEMA_BY_PAGE.teams` pointed at the *decoding* schema, so every Worker write —
including `runGlobalRebuild` — would have validated and then decoded straight back
to object form immediately before stringifying, silently discarding the entire
saving on the one live path that writes a teams artifact before the republish.
Repointed at the wire schema.

## The measured win is smaller than the attribution predicted

The attribution estimated −30% on the wire. The shipped encoding measures
**−11.8%** at Brotli q11. The orchestrator re-measured independently and found
the discrepancy is mostly a **compression-quality error in the attribution**: it
used q5, where the saving is −30.4%; at q9 it is −27.9%; at q11 — what a CDN
serves — it is −18.7% for the simple two-element encoding, and −11.8% for the
shipped three-element one.

A fixed-width 3-tuple control compressed almost identically (272,952 B), so the
variable-length scheme is not the cause. Brotli's back-references already capture
most of the value in deduplicating 17 repeated key strings across 3,549 rows, so
removing that textual redundancy nets far less compressed than the raw saving
implies.

**The verdict stands anyway**, because the binding goal was the raw budget, and
3,704,776 → 1,489,187 B clears 3,500,000 comfortably. But the honest user-facing
win is ~12–19%, not 30%, and the attribution in the todo has been corrected.

## Verification

- Round-trip proven on the **live** artifact, not a fixture: encode → decode →
  deep-equal against the original. Lossless.
- Full repo suite from the root: **166/167 files, 2,891 passing**, with exactly the
  two pre-existing `payloadBudget.test.ts` failures — confirmed byte-identical to
  before via `git stash`. No new failures.
- `tsc --noEmit` clean for `packages/**`/`scripts/**` and `apps/web`;
  `apps/worker`'s 4 pre-existing errors confirmed unchanged and untouched.
- New tests: object-form/positional equivalence, the absent-vs-zero and
  tier-without-spread edge cases, and — the important one — a Worker test that
  seeds an **object-form** R2 artifact and asserts the rebuilt write is positional
  with an untouched row's metrics intact. That is the read-modify-write path that
  could have corrupted a season's artifact mid-event.
