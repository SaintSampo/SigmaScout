---
id: rolling-origin-hyperparameter-tuning
created: 2026-08-30
source: 08-CONTEXT.md discussion — user challenged the tune/holdout split's necessity
resolves_phase:
priority: medium
---

# Rolling-origin hyperparameter tuning — remove the tune/holdout split at its source

## What the user said

During `/gsd-discuss-phase 8`, presented with three ways to display tune versus holdout
seasons on the Compare page:

> "I want to revisit the nessecity of tune vs holdout seasons. I really feel like there
> should be no difference. I get that it is a check on overfitting, but I really want a
> more clever solution."

Chose **"New phase after v1.0"** when offered new-phase / backlog / drop.

## The proposal

Replace the fixed split (`TUNE_SEASONS = [2022, 2023, 2024]`,
`HOLDOUT_SEASONS = [2025, 2026]` in `packages/harness/score.ts:17-19`) with rolling-origin
tuning — tune only on seasons strictly *before* the season being scored:

| Scored season | Tuned on |
|---|---|
| 2023 | 2022 |
| 2024 | 2022–2023 |
| 2025 | 2022–2024 |
| 2026 | 2022–2025 |

Every scored season then becomes genuinely out-of-sample. This lifts the project's
existing match-level discipline — predict strictly before you update — up to the
hyperparameter level, which is the one place that rule currently does not reach: the
current hyperparameters were chosen knowing all of 2022–2024.

## The ceiling, stated and accepted at decision time

**No temporally honest scheme can make all five seasons headline-eligible.** 2022 has
nothing before it. 2023 would be tuned on a single season, which is thin. So the realistic
gain is **2 headline seasons → 3 or 4**, not 5. The user accepted this before choosing.

## Known costs

- **Four hyperparameter searches instead of one.** Phase 3's two-stage screen (9 of 20
  params survive `SCREEN_SURVIVAL_THRESHOLD = 1e-4`) plus a joint search over the
  survivors, run four times. Offline Node — wall-clock, not money.
- **Four parameter sets, which collides with the versioning contract.**
  `data/algorithm-versions/vpr@2.1.0+tuned-2026-08.json` is a single promoted set whose
  prediction-stream digest is enforced as a CI gate (`packages/harness/promote.ts`). Either
  four versions or one version whose params vary by season — either way the promote path
  and the digest gate need rework. **This is the biggest single cost and the reason this is
  its own phase rather than a tweak.**
- **Downstream re-measurement:** SC-3's 8/8 verdict (last re-measured 2026-08-30, see
  `docs/models/offseason-inclusion-remeasurement.md`), every published artifact, and
  `docs/models/sigma1-tuning-results.md`.
- **A new decision:** which param set the live 2027 site runs on. Presumably the
  2026-evaluation set (tuned on 2022–2025), but that is not currently decided.

## Why it was not urgent

The data shows the fixed split is not flattering VPR. Tune-season Brier 0.1592 / 0.1687 /
0.1761 versus holdout 0.1617 / 0.1501 — holdout sits *inside* the tune range and the single
best season (2026) is a holdout one. If the split were hiding overfitting, holdout would be
visibly worse. Phase 8 therefore ships a uniform five-season Compare table with a
methodology note (08-CONTEXT.md D-08), which resolves the reader-facing problem without
this work.

This todo is the *methodology* upgrade, not the presentation fix. It strengthens the site's
central claim — measurably better than the baselines — by widening the out-of-sample
evidence base.

## Acceptance criteria

1. Hyperparameter selection for a scored season uses only seasons strictly preceding it;
   a test proves a search cannot read a season at or after its evaluation target.
2. The number of headline-eligible seasons increases from 2 to at least 3, and
   `seasonLabel`/`headlineEligible` in `CompareSliceSchema` reflect the new scheme.
3. The algorithm-version digest CI gate still passes under whatever multi-param-set
   representation is chosen.
4. SC-3's comparisons are re-measured and the verdict restated, pass or fail, in a dated
   document alongside the existing ones.
5. `docs/models/sigma1-tuning-results.md` describes the shipped scheme, not the retired one.

---

## Decision briefing (added 2026-09-01 — read before starting; nothing below has been executed)

Everything else from the 2026-08-31 sweep is done; this is the one item left open. Four decisions
gate it, with the facts gathered so far:

### The measured costs

- **One full-corpus joint search ≈ 50 min** on this machine (03-05 ran two in parallel at ~50 min
  each); the screen stage is similar. Four rolling searches (2023←{22}, 2024←{22-23},
  2025←{22-24}, 2026←{22-25}) have *shrinking* tune sets, so expect **~2–3.5h total**, backgroundable.
- **The full cascade after the searches:** re-tuned params change every 2023–2026 prediction, so:
  full harness re-run for the accuracy record → **another full republish** (~56k PUTs, ~25 min) →
  re-commit `apps/web/src/routes/__fixtures__/compare-*.json` (byte-pinned in tests) → re-measure
  SC-3 (dated doc, pass or fail) → re-measure the rewind gap (its 10.85% figure came from the
  current promoted set; `rewindGap.ts` mirror + caption depend on it) → rewrite
  `docs/models/sigma1-tuning-results.md`.

### Decision 1 — go/when
Options: implement + run searches immediately; implement code only and run compute later; defer
whole. (Deferred 2026-09-01 by user.)

### Decision 2 — versioning representation (the todo's own "biggest single cost")
Artifact keys embed one `{algorithmId}@{version}` and `v1/manifest/algorithms.json` names exactly
one version per algorithm — Worker and clients resolve through it.
- **One version, per-season sets** (`vpr@3.0.0+rolling-YYYY-MM` carrying `paramSetsBySeason` +
  one prediction-stream digest over the full replay): manifest/Worker/client contracts unchanged;
  only `promote.ts`'s file shape and the digest definition change. *Recommended.*
- **Four promoted versions**: matches promote.ts's current one-set-per-file shape, but manifest,
  Worker, and every client must learn per-season version resolution — much wider blast radius.

### Decision 3 — what the live site runs in 2027 (until 2027 data exists)
- **The 2026-eval set (tuned on 2022–2025)** — the todo's own presumption; most recent honestly
  evaluated set. *Recommended.*
- A fifth search tuned on all 2022–2026 — more data for live, but that set is never honestly
  evaluable (nothing is out-of-sample for it).

### Decision 4 — is 2023 headline-eligible on a one-season prior?
- **Not eligible** → headline = 2024/2025/2026 (meets the ≥3 acceptance); 2023 labeled "tuned on
  one season", 2022 runs untuned defaults, also non-headline. *Recommended (stricter honesty).*
- Eligible → 4 headline seasons; thinness carried in the methodology note.

### Also implied (implementation detail, no decision needed)
`CompareSliceSchema.seasonLabel` is `z.enum(["tune","holdout"])` — the enum needs a new vocabulary
(e.g. `rolling`/`thin-prior`/`untuned`) which is a published-contract change riding the same
republish. A leakage test (acceptance 1) proves a search cannot read a season ≥ its target.
