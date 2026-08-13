---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-08-13T16:13:38.414Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/harness/statbotics.ts |  | STATBOTICS_REFERENCE_FALLBACK per-season values (2022-2026) are unverified best-available estimates (~0.70-0.72), not individually sourced against Statbotics' own published figures — the live endpoint reproducibly 500s (reconfirmed 2026-08-13) and Statbotics' blog page renders numbers client-side from the same broken API, so this pipeline has no way to scrape verified numbers | open |  | 2026-08-13T16:13:38.414Z |  |

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
  }
]
````
