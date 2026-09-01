---
id: regenerate-published-artifacts-post-is2
created: 2026-09-01
source: quick task 260901-is2 (cross-cutting) — deferred at plan time, filed by Task 6
resolves_phase:
priority: high
---

# Regenerate published R2 artifacts, the algorithms manifest, and the compare-page figures

## What changed

Quick task 260901-is2 changed **all three** algorithms' observable output in one sitting, and
changed the scoring rule every accuracy figure on the site is computed under. Every version
string moved (D-13 — no version string may stand for two different computations):

| algorithm | before | after | commit | why |
|---|---|---|---|---|
| `epa` | `1.1.0+baseline` | `2.0.0+baseline` | `8886e72c` | D-Q1: attributes the alliance ERROR, not the alliance total |
| `opr` | `3.1.0+baseline` | `4.0.0+baseline` | `9e23d18a` | D-Q4: expanding-window alliance-score SD ÷ 1.1 replaces the fixed logistic scale of 10 |
| `vpr` (`SIGMA1_CODE_VERSION`) | `2.1.0` | `3.0.0` | `3b3c0dbf` | D-Q2: R estimated from innovations |

And separately, D-Q3 (`cd1e1edb`) changed the **winner-accuracy denominator for every
algorithm**: a no-call (`pRedWin === 0.5`) against a decided match now enters the denominator
and is counted incorrect. Ties stay excluded.

The two promoted parameter files were retired and re-promoted in the same commit as the code
that produced them: `data/algorithm-versions/vpr@2.1.0+{tracer-check,tuned-2026-08}.json` are
gone, replaced by `vpr@3.0.0+tracer-check.json` and `vpr@3.0.0+tuned-2026-08.json`.

## What is now stale

**Everything published.** Nothing was republished as part of 260901-is2 — it was explicitly
out of scope.

1. **Every R2 object key is stale by construction.** Artifact keys embed
   `{algorithmId}@{version}` — e.g. `v1/teams/2024/vpr@2.1.0+tuned-2026-08.json`,
   `v1/team/frc3538/2024/vpr@2.1.0+tuned-2026-08.json`. Those versions no longer exist in the
   repo, so every live object is keyed under a retired identity **and** carries numbers
   computed by retired code.
2. **`v1/manifest/algorithms.json`** names exactly one version per algorithm and is what the
   Worker and every client resolve through. Until it is republished it points at
   `epa@1.1.0`, `opr@3.1.0`, `vpr@2.1.0+tuned-2026-08` — none of which the code can now
   reproduce.
3. **Every accuracy number on the Compare page moves**, and not by rounding. D-Q3's
   denominator change alone drops **OPR 2025 quals from ≈ 72.3% to ≈ 66.1%**: OPR declines
   ~7% of every season (1,012–1,305 matches — its event-scoped, quals-only design matrix has
   no rank at each event's start), and those matches used to be excluded from its denominator
   entirely. VPR and EPA are ≈ 0 no-calls after 2022 and barely move on D-Q3 — but EPA moves a
   lot on D-Q1 (2025 quals Brier 0.1950 → 0.1589, accuracy 72.5% → 77.5%) and OPR moves again
   on D-Q4 (Brier improves 4.1%–18.8%). This is the intended effect: the old denominator was
   scoring OPR on a strictly easier population than VPR and EPA, which made every OPR-vs-VPR
   accuracy comparison on the site invalid.
4. **`apps/web/src/routes/__fixtures__/compare-{2022..2026}.json`** are byte-pinned in tests
   and must be re-committed from the new publish run, or the compare-page tests will pin the
   retired figures.
5. **`STATE_SNAPSHOT_SHAPE_VERSION` is now 3** (was 2 — `packages/harness/stateSnapshot.ts:100`).
   D-Q4 added `allianceScoreStats` to `OprState`, which is a league-scoped field on the
   serialized league row. **Seeded D1 algorithm state must be re-seeded from a fresh publish
   run before the Worker can fold another match.** This is load-bearing, not ceremony:
   `apps/worker/src/stateStore.ts`'s `readScopedState` filters by `algorithm_id` only and
   never by `algorithm_version`, so a stale league row IS reachable after a version bump — the
   shape check is the only thing that turns "deserialized `allianceScoreStats` as `undefined`"
   into a loud `LeagueRowShapeVersionError` instead of a silent wrong answer. Expect the
   Worker to fail loudly against the old rows until re-seeded; that is the designed behaviour.

## What "done" looks like

1. `pnpm publish:seasons` (`--seasons 2022-2026 --include-offseason`) completes against the
   new code — roughly 56k PUTs, ~25 min based on the last full run — writing every artifact
   under the new `{algorithmId}@{version}` keys.
2. `pnpm manifest:algorithms` republishes `v1/manifest/algorithms.json` naming
   `epa@2.0.0+baseline`, `opr@4.0.0+baseline`, `vpr@3.0.0+tuned-2026-08`.
3. D1 algorithm state is re-seeded from that publish run, and a Worker tick is observed
   folding a real match without a `LeagueRowShapeVersionError`.
4. `apps/web/src/routes/__fixtures__/compare-*.json` re-committed from the new run; the
   compare-page tests pass against them.
5. The Compare page's published accuracy figures are re-read from the site and spot-checked
   against the expected direction — in particular OPR 2025 quals is ≈ 66%, not ≈ 72%. **If OPR
   still reads ≈ 72.3%, the republish did not take.**
6. The accuracy-record documentation states, in a dated note, that OPR's published accuracy
   dropped because the denominator changed (D-Q3) and **not** because OPR got worse — a
   reader who remembers the old number must be able to find out why without reading git log.
7. `docs/publish-budget.md` re-measured off the same run: version strings appear in every
   `largestKey`, so at minimum those change, and the artifacts themselves grew/shrank with
   the algorithm changes. See [[payload-budget-teams-and-team-page-overage]] — that overage
   predates this task and should be resolved by, or explicitly carried through, this
   republish.
8. `pnpm cleanup:retired-objects` run for the retired `epa@1.1.0` / `opr@3.1.0` /
   `vpr@2.1.0+*` keys, once the manifest no longer names them.

## Related

- `.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/CONTEXT.md` — D-Q1
  through D-Q4 with the full before/after measurement tables
- [[retune-sigma1-under-innovation-r]] — **sequencing:** if the re-tune is going to happen
  soon, do it FIRST. It changes every published number again and one republish should serve
  both.
- [[remeasure-baseline-fingerprint-post-is2]] — same trigger, separate artifact
