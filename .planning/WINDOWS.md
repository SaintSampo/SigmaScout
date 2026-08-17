---
schema_version: 1
open_count: 5
waived_count: 0
fixed_count: 0
total_count: 5
last_updated: 2026-08-17T00:00:00.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/harness/statbotics.ts |  | STATBOTICS_REFERENCE_FALLBACK per-season values (2022-2026) are unverified best-available estimates (~0.70-0.72), not individually sourced against Statbotics' own published figures — the live endpoint reproducibly 500s (reconfirmed 2026-08-13) and Statbotics' blog page renders numbers client-side from the same broken API, so this pipeline has no way to scrape verified numbers | open |  | 2026-08-13T16:13:38.414Z |  |
| 2 | 02 | deviation | packages/harness/statbotics.ts |  | SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io/v3/year/{year} reproducibly returns HTTP 500, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead | open |  | 2026-08-14T04:31:03.405Z |  |
| 3 | 02 | deviation | packages/core/algorithms/epa.ts |  | epa.ts's predict() sums a team's own learned foulsCommitted component directly into that team's own predicted score, rather than adding the OPPOSING alliance's foulsCommitted per D-04 (the cross-alliance attribution 02-04's Sigma1 implements explicitly). Whether this materially skews EPA's predicted scores is unverified and out of scope for plan 02-04 to fix -- observed while implementing Sigma1's own D-04 handling, not investigated further. | resolved | epa.ts predict() now excludes an alliance's own foulsCommitted from its offensive total and adds the opposing alliance's foulsCommitted instead, mirroring sigma1's D-04 handling; regression test added in epa.test.ts. | 2026-08-14T05:13:43.248Z | 2026-08-14T06:40:51.008Z |
| 4 | 03 | unrun-verify | packages/core/algorithms/breakdown/2024.ts |  | 03-07's Task 2 acceptance criterion `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` exits 0 is NOT met: parseBreakdown()'s unconditional Zod parse of self-reported offseason score_breakdown JSON throws uncaught (2024cafb_qm1, missing `adjustPoints`) -- a separate, pre-existing defect in the SCORE-side breakdown schema, unguarded by eventType/compLevel, previously masked by CR-01's earlier RP-guard crash (which occurred at 2024mnst_qm1, position 17029/22099, well before 2024cafb). Out of scope for 03-07, whose files_modified are RP-only; CR-01's own fix is proven correct (the replay progresses 17358 matches past the old crash point, including 329 offseason matches, before hitting this new one). | open |  | 2026-08-17T00:00:00.000Z |  |
| 5 | 03 | unrun-verify | packages/core/algorithms/breakdown/2024.ts |  | 03-07's Task 2 acceptance criterion `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0 is NOT met: the SAME class of defect as ledger #4, but worse -- the event's very FIRST match (2024wvrox_sf1m1, offseason, compLevel sf) fails parseBreakdown() with ~13 missing required score fields, confirming this is systemic to self-reported offseason breakdowns generally, not one bad match. Network + TBA_API_KEY both worked (304 Not Modified on both TBA calls); the crash is data-shape, not connectivity. | open |  | 2026-08-17T00:00:00.000Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "packages/harness/statbotics.ts",
    "line": null,
    "description": "STATBOTICS_REFERENCE_FALLBACK per-season values (2022-2026) are unverified best-available estimates (~0.70-0.72), not individually sourced against Statbotics' own published figures — the live endpoint reproducibly 500s (reconfirmed 2026-08-13) and Statbotics' blog page renders numbers client-side from the same broken API, so this pipeline has no way to scrape verified numbers",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-13T16:13:38.414Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/harness/statbotics.ts",
    "line": null,
    "description": "SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io/v3/year/{year} reproducibly returns HTTP 500, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-14T04:31:03.405Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/core/algorithms/epa.ts",
    "line": null,
    "description": "epa.ts's predict() sums a team's own learned foulsCommitted component directly into that team's own predicted score, rather than adding the OPPOSING alliance's foulsCommitted per D-04 (the cross-alliance attribution 02-04's Sigma1 implements explicitly). Whether this materially skews EPA's predicted scores is unverified and out of scope for plan 02-04 to fix -- observed while implementing Sigma1's own D-04 handling, not investigated further.",
    "status": "resolved",
    "reason": "epa.ts predict() now excludes an alliance's own foulsCommitted from its offensive total and adds the opposing alliance's foulsCommitted instead, mirroring sigma1's D-04 handling; regression test added in epa.test.ts.",
    "recorded_at": "2026-08-14T05:13:43.248Z",
    "resolved_at": "2026-08-14T06:40:51.008Z"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/algorithms/breakdown/2024.ts",
    "line": null,
    "description": "03-07's Task 2 acceptance criterion `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` exits 0 is NOT met: parseBreakdown()'s unconditional Zod parse of self-reported offseason score_breakdown JSON throws uncaught (2024cafb_qm1, missing `adjustPoints`) -- a separate, pre-existing defect in the SCORE-side breakdown schema, unguarded by eventType/compLevel, previously masked by CR-01's earlier RP-guard crash (which occurred at 2024mnst_qm1, position 17029/22099, well before 2024cafb). Out of scope for 03-07, whose files_modified are RP-only; CR-01's own fix is proven correct (the replay progresses 17358 matches past the old crash point, including 329 offseason matches, before hitting this new one).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-17T00:00:00.000Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/algorithms/breakdown/2024.ts",
    "line": null,
    "description": "03-07's Task 2 acceptance criterion `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0 is NOT met: the SAME class of defect as ledger #4, but worse -- the event's very FIRST match (2024wvrox_sf1m1, offseason, compLevel sf) fails parseBreakdown() with ~13 missing required score fields, confirming this is systemic to self-reported offseason breakdowns generally, not one bad match. Network + TBA_API_KEY both worked (304 Not Modified on both TBA calls); the crash is data-shape, not connectivity.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-17T00:00:00.000Z",
    "resolved_at": null
  }
]
````
