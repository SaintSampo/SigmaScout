---
schema_version: 1
open_count: 3
waived_count: 0
fixed_count: 0
total_count: 3
last_updated: 2026-08-14T05:13:43.248Z
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
  }
]
````
