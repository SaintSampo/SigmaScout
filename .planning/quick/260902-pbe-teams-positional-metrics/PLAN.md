---
quick_id: 260902-pbe
slug: teams-positional-metrics
date: 2026-09-03
type: execute
mode: quick
worktree: false
autonomous: false
source: payload-budget attribution, 2026-09-02
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/publish.ts
  - apps/worker/src/scheduled.ts
  - apps/web/src/components/teams-table/rowModel.ts
---

# Encode the teams artifact's metrics positionally

## The finding

In `v1/teams/2024/vpr@2.1.0+tuned-2026-08.json` (3,704,776 B, over its 3,500,000
budget), `metrics` is **86.6%** of the artifact — and the metric **key names
alone are 979,248 B, 26.4% of the whole file**, because 17 key strings plus
`"value"`/`"spread"` repeat across 3,549 team rows.

Encoding each row's metrics as a positional array, with the key list carried once
in the preamble, is **lossless** — same numbers, same precision:

| | raw | wire (Brotli) | 5 Mbps venue wifi |
|---|---|---|---|
| now | 3,618 KB | 410 KB | 0.67s |
| positional | 1,233 KB (−66%) | **285 KB (−30%)** | 0.47s |

**Use the −30% figure when judging this change, not −66%.** Brotli already
collapses repeated key names; the raw number flatters. It is still worth doing —
410 KB is heavy for one page on venue wifi — and it clears the budget on merit so
no ceiling moves.

## Scope: the teams artifact ONLY

`MetricsRecordSchema` (`pageArtifacts.ts:288`, `:526`) is **shared** by three
consumers: the teams-table row, the team-season artifact's `seasonStats`, and the
event artifact's per-team standings row. Changing it globally would ripple into
`AlliancesTab`, `BreakdownTab`, `InsightsTab`, `EventSection` and
`metricHistorySeries` for no benefit — an event carries ~40 team rows, where the
key-name overhead is negligible. The entire win is the teams artifact's 3,549
rows.

**So: introduce a positional shape used only by the teams-table row. Leave
`MetricsRecordSchema` and every other consumer untouched.** Verify by diff that
the event and team artifacts' shapes are unchanged.

## Encoding

- Preamble gains the ordered key list (one array, once per artifact).
- Each row's metrics becomes positional, aligned to that list.
- A metric absent for a row, and a metric with no `spread` (OPR/EPA rows carry no
  spread — D-07 says that is normal, not an error), must both round-trip exactly.
  Decide the representation for each and state it; do not let "absent" and
  "present but zero" collapse into the same thing.

## Backwards compatibility — the risk that makes this different from 260902-pbc

The previous task removed a field nobody read, so old artifacts parsed fine.
**This changes the shape of a field the client does read.** Production serves
object-form artifacts and will until the republish, which is a LATER task.

- The schema must accept **both** shapes for the transition, and the client must
  decode both. A client that understands only the positional form breaks the live
  Teams page the moment it deploys ahead of the republish.
- `apps/web` imports the schema from `packages/harness/pageArtifacts.js` — the
  same file, not a copy — so there is one place to get this right.
- Add a test that parses a **real, current-shape** artifact and a positional one
  through the same schema and asserts identical decoded output. That equivalence
  is the whole safety argument.

## The Worker is the highest-risk piece

`apps/worker/src/scheduled.ts` does a **read–modify–write merge** on the teams
artifact (see the merge helper around `:449` and the teams branch around `:945`):
it reads the existing artifact, refreshes touched teams' rows, and preserves the
rest. During the transition it will read an **object-form** artifact and must
write a **positional** one — so it has to decode the old shape and re-encode, not
assume either.

Get this wrong and a live event silently corrupts a season's teams artifact.
Exercise the merge path against an object-form input explicitly in a test.

## Verification

1. `npx vitest run` from the **repo root** — the full 167-file suite, not
   `cd apps/web && npx vitest run` (77 files). Never `timeout <n> pnpm ...`
   (swallows output, exits 0 — project memory).
2. `npx tsc --noEmit` for `packages/**`/`scripts/**` and `apps/web`.
   `apps/worker` has 4 pre-existing errors unrelated to this change — do not fix,
   do not let them mask a new one.
3. Round-trip proof on real data: fetch the live teams artifact, encode it
   positionally, decode it back, and assert deep equality with the original.
   Report the before/after bytes you actually measured.
4. The two `payloadBudget.test.ts` failures **will still fail** — they read
   `docs/publish-budget.md`, which only the later republish re-measures. Do not
   edit that file and do not run `pnpm publish:seasons`. The bar is: no new
   failures, and those two unchanged.

## Commit

One commit.
