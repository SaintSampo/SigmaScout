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

## Decisions — ANSWERED 2026-09-03 (all four; none open)

All four decisions below were answered by the user in quick task `260903-230` on
2026-09-03. **No decision in this todo is open.** The measured costs and rejected
alternatives are kept underneath as recorded rationale for why each answer holds up, not
as a menu still to choose from.

### The measured costs

- **The rolling-origin searches** run in the shape measured in
  `retune-sigma1-rolling-origin`: one ~41-min screen at the earliest origin's window, plus
  six concurrent joint runs (3 origins x 2 adaptation arms) at ~70 min wall clock — see that
  todo for the full cost table rather than restating it here. Offline Node — wall-clock, not
  money.
- **The full cascade after the searches:** re-tuned params change every 2023–2026
  prediction, so: full harness re-run for the accuracy record → **one republish** (~56k
  PUTs, ~25 min; not two — see D-1) → re-commit
  `apps/web/src/routes/__fixtures__/compare-*.json` (byte-pinned in tests) → re-measure SC-3
  (dated doc, pass or fail) → re-measure the rewind gap (its 10.85% figure came from the
  current promoted set; `rewindGap.ts` mirror + caption depend on it) → rewrite
  `docs/models/sigma1-tuning-results.md`.

### D-1 — Go/when: ANSWERED — sequence onto the re-tune

This todo's labeling and versioning change lands together with the promotion and republish
produced by `retune-sigma1-rolling-origin`. One republish (~56k PUTs, ~25 min), not two, and
the season labels get written knowing which origins actually cleared the D-T7 acceptance
bar.

**Rejected:** doing the labeling standalone now (costs a second republish, and writes
labels before the acceptance verdicts exist); keeping the whole thing deferred.

### D-2 — Versioning representation: ANSWERED — one version, per-season sets

`vpr@6.0.0+rolling-YYYY-MM` carries `paramSetsBySeason` plus one prediction-stream digest
over the full replay. Seasons whose origin returned `keep-incumbent` fall back to the
incumbent set. `v1/manifest/algorithms.json`, the Worker, and every client keep their
current one-version-per-algorithm contract unchanged; only `promote.ts`'s file shape and
the digest definition move.

**Version-number correction:** this todo originally proposed `vpr@3.0.0+rolling-YYYY-MM`,
written back when 2.1.0 was the current promoted set. The promoted set is now
`data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json`, so 3.0.0 would be a downgrade. The
target is **6.0.0**.

**Rejected:** three promoted version files (one per origin) — matches `promote.ts`'s
current one-set-per-file shape, but forces the manifest, the Worker, and every client to
learn per-season version resolution.

### D-3 — What the live site runs in 2027: ANSWERED — the 2026-origin set

Selected on 2022–2025; the most recent set that was also honestly evaluated out-of-sample.
If the 2026 origin returns `keep-incumbent`, the incumbent stands and serves live.

**Rejected:** an extra search over all 2022–2026 (more data, but never honestly evaluable —
nothing is out-of-sample for it, so it could never carry a headline claim); deferring the
decision until after the re-tune reports.

### D-4 — Is 2023 headline-eligible on a one-season prior: ANSWERED — not eligible

Headline seasons are **2024 / 2025 / 2026** — three, which meets acceptance criterion 2's
">= 3" bar. 2022 and 2023 are labeled selection-only/untuned and carry no headline claim.
This ratifies what the shipped tuner already does rather than changing it: `tune.ts`'s
origins are 2024/2025/2026 with 2022–2023 as the earliest selection window, so no 2023
parameter set exists to score.

**Rejected:** adding a 2023 origin tuned on 2022 alone — four headline seasons, but two
more joint search runs, and it weakens the one-screen leak-free argument the current run
shape rests on.

**Open sub-question, surfaced by D-4 (2026-09-03): which parameter set scores 2022 and
2023?** All five seasons are published and displayed on Compare today —
`compare-2022.json` through `compare-2026.json` all exist, and every 2022/2023/2024 slice
currently carries `seasonLabel: "tune"`. Under the decided scheme neither 2022 nor 2023 has
an origin, so neither has an honestly out-of-sample parameter set: any set that scores them
was selected having already seen them. D-4 correctly removes their headline claim, but it
does NOT say which set produces the numbers still shown for them. That must be decided
before the republish, and it is not decided here.

### Also implied

`CompareSliceSchema.seasonLabel` is `z.enum(["tune","holdout"])` — the enum still needs a
new vocabulary (e.g. `rolling`/`thin-prior`/`untuned`), which is a published-contract
change; per D-1 it rides the re-tune's republish rather than shipping standalone. The
leakage test this section used to describe as pending (acceptance criterion 1: a test
proving a search cannot read a season at or after its evaluation target) already shipped in
`260901-trz`.
