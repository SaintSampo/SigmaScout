---
id: remeasure-baseline-fingerprint-post-is2
created: 2026-09-01
source: quick task 260901-is2 (cross-cutting, D-13 version bumps) — filed by Task 6
resolves_phase:
priority: medium
---

# Re-measure the baseline fingerprint under the post-260901-is2 algorithm versions

## What changed

All three algorithms the offseason-inclusive fingerprint covers changed their observable
output in quick task 260901-is2, and each carries a D-13 version bump in the same commit as
its change:

| algorithm | fingerprint records | code now ships |
|---|---|---|
| `opr` | `3.1.0+baseline` | `4.0.0+baseline` |
| `epa` | `1.1.0+baseline` | `2.0.0+baseline` |
| `vpr` | `2.1.0+tuned-2026-08` | `3.0.0+tuned-2026-08` |

Separately, D-Q3 changed the winner-accuracy denominator for every algorithm (a no-call is
now a miss), so the fingerprint's `winnerAccuracy` figures were computed under a scoring rule
the code no longer implements. Its `brierScore` figures and `predictionStreamSha256` digests
were computed by algorithm code that no longer exists.

## What is now stale

`data/baselines/sc3-offseason-inclusive-2026-08.json` — the SC-3 offseason-inclusive
re-measurement, generated `2026-08-30T19:52:51Z` over seasons 2022–2026 by
`packages/harness/cli.ts --seasons 2022-2026 --algorithm opr,epa,vpr --include-offseason`.
Every number in it, and all three `predictionStreamSha256` digests, describe retired code
under a retired scoring rule.

**This file must NOT be edited in place.** It is a historical record of a measurement that
actually happened on 2026-08-30, exactly like the three other committed fingerprints beside
it (`opr-event-scoped-2026-08.json`,
`opr-season-pooled-published-tuned-v3.json`, `opr-season-pooled-retired-2026-08.json`). Its
recorded versions are facts about which code produced those digests; rewriting them to the
new version strings would attach a real digest to code that never produced it — falsifying a
measurement record, which is precisely the failure mode this project's failure log names.
A digest whose provenance is a lie is worse than no digest.

For the same reason, `packages/harness/baselineFingerprint.test.ts`'s assertions at L262–264
(`opr` → `3.1.0+baseline`, `epa` → `1.1.0+baseline`, `vpr` → `2.1.0+tuned-2026-08`) were
**deliberately left alone** by 260901-is2. Only the surrounding prose was corrected, because
the test's title and doc comment claimed the fingerprint carried "current post-fix versions",
which stopped being true the moment the bumps landed. That test now says it asserts the
versions the fingerprint was *measured under* — and it cross-references this todo.

## What "done" looks like

1. A **new** fingerprint file is written to `data/baselines/` (e.g.
   `sc3-post-is2-2026-09.json`) by `pnpm fingerprint` against the current code, over the same
   seasons and the same `--include-offseason` methodology, so the two are comparable.
   The 2026-08-30 file stays on disk, untouched.
2. Its `sourceNote` names quick task 260901-is2 and lists the four input changes that landed
   together (D-Q1 EPA error-split, D-Q2 innovation-based R, D-Q3 no-call-is-a-miss, D-Q4 OPR
   expanding scale) — none isolated, exactly as the 2026-08-30 note lists its own three.
3. `baselineFingerprint.test.ts`'s "contains exactly 4 committed fingerprints" assertion (L240)
   is updated to 5, and a new case asserts the new file carries `opr@4.0.0+baseline`,
   `epa@2.0.0+baseline`, `vpr@3.0.0+tuned-2026-08` — a parallel record, not a replacement.
   The existing L254 case keeps asserting the historical versions.
4. **SC-3's verdict is restated, pass or fail**, in a dated document alongside
   `docs/models/offseason-inclusion-remeasurement.md`. The comparison materially changes: OPR's
   accuracy drops ≈ 6 points on D-Q3 alone (2025 quals ≈ 72.3% → ≈ 66.1%) while EPA's rises
   (2025 quals 72.5% → 77.5%), so a verdict that held before may not hold now, and may hold
   for a different reason than before. **Do not carry the old verdict forward.**
5. The write-up states explicitly that OPR's drop is a denominator change, not a regression in
   OPR — otherwise the next reader compares two numbers measured under different rules.

## Related

- `.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/CONTEXT.md`
- `packages/harness/baselineFingerprint.test.ts` L247–264 — the prose corrected by 260901-is2
  Task 6, and the assertions deliberately left as a historical record
- `docs/models/offseason-inclusion-remeasurement.md` — the SC-3 write-up to supersede
- [[regenerate-published-artifacts-post-is2]] — same trigger; the fingerprint run and the
  republish read the same corpus and can share a session
