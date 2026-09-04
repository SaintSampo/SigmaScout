---
id: rolling-origin-hyperparameter-tuning
created: 2026-08-30
source: 08-CONTEXT.md discussion — user challenged the tune/holdout split's necessity
resolves_phase:
priority: high
---

# Rolling-origin hyperparameter tuning — remove the tune/holdout split at its source

> **Status: all four gating decisions ANSWERED** (see "Decisions — ANSWERED 2026-09-03" at
> the end of this file). Per D-1, this work is sequenced onto `retune-sigma1-rolling-origin`
> and rides its promotion and republish — it is not to be run standalone.
>
> **D-5 was added the same day:** Compare displays only origin seasons, so 2022 and 2023
> come off the accuracy tables entirely. That closes D-4's open sub-question and turns the
> `seasonLabel` enum migration into a deletion.
>
> **D-3 was revised later the same day** and now defines the scheme's steady state: the live
> season always runs its own origin set, so 2027 is tuned on 2022–2026 and origins become
> 2024/2025/2026/2027. Read D-3 in full before running the re-tune — it changes that todo's
> run shape by one origin.

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
| 2023 | 2022 — not an origin (D-4) |
| 2024 | 2022–2023 |
| 2025 | 2022–2024 |
| 2026 | 2022–2025 |

The rolling-origin selection machinery this table proposes **already shipped** in quick
task `260901-trz` (`--origin` mode in `packages/harness/tune.ts` with four leakage gates,
plus `packages/harness/acceptance.ts`'s D-T7 bar). What remains in this todo is the
scoring, labeling, and versioning half: `TUNE_SEASONS`/`HOLDOUT_SEASONS` at
`packages/harness/score.ts:16-19`, `SeasonLabel` at `score.ts:14`, and the `seasonLabel`
enum at `artifact.ts:51` and `pageArtifacts.ts:1219`.

Every scored season then becomes genuinely out-of-sample. This lifts the project's
existing match-level discipline — predict strictly before you update — up to the
hyperparameter level, which is the one place that rule currently does not reach: the
current hyperparameters were chosen knowing all of 2022–2024.

## The ceiling, stated and accepted at decision time

**No temporally honest scheme can make all five seasons headline-eligible.** 2022 has
nothing before it. 2023 would be tuned on a single season, which is thin. So the realistic
gain is **2 headline seasons → 3 or 4**, not 5. The user accepted this before choosing.

## Known costs

- **The rolling-origin searches**, not four sequential full searches as originally
  estimated here. `retune-sigma1-rolling-origin` measured the shipped run shape: one
  ~41-min screen at the earliest origin's window, plus six concurrent joint runs (3 origins
  x 2 adaptation arms) at ~70 min wall clock. Offline Node — wall-clock, not money. See that
  todo for the full cost table.
- **Four parameter sets (origins 2024/2025/2026/2027 — see D-3), which collides with the versioning contract.**
  `data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json` is a single promoted set whose
  prediction-stream digest is enforced as a CI gate (`packages/harness/promote.ts`). Either
  three versions or one version whose params vary by season — either way the promote path
  and the digest gate need rework. **This is the biggest single cost and the reason this is
  its own phase rather than a tweak** — D-2 is the answer to it, not a refutation; the
  collision is resolved, not open.
- **Downstream re-measurement:** SC-3's 8/8 verdict (last re-measured 2026-08-30, see
  `docs/models/offseason-inclusion-remeasurement.md`), every published artifact, and
  `docs/models/sigma1-tuning-results.md`.
- **A new decision:** which param set the live 2027 site runs on. Decided — see D-3.

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

1. **SATISFIED (260901-trz)** — Hyperparameter selection for a scored season uses only
   seasons strictly preceding it; a test proves a search cannot read a season at or after
   its evaluation target. Met by `tune.ts`'s leakage gates and `tune.test.ts`.
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

### D-3 — What the live site runs in 2027: ANSWERED — the 2027-origin set, tuned on 2022–2026

**Revised 2026-09-03 by the user, same day, before any of it was executed.** The answer
first recorded here was "the 2026-origin set (selected on 2022–2025)". It is superseded by
the rule below; the original and the reason it was replaced are kept as rationale.

The live season always runs **its own origin set**: season S is served by the set tuned on
2022…S−1, committed to disk before S's first match. For 2027 that is a **2027 origin
selecting on 2022–2026**. 2026 is a completed season — its last official match was in the
spring of 2026 — so including it costs nothing in honesty, and it is the most informed set
available.

The user's stated reason was year-round maintainability. It holds on honesty grounds too:

- It **deletes the special case.** There is no longer a "live params" question distinct from
  an "evaluation params" question. The answer is always "season S's origin set", every year,
  with no annual decision to re-make.
- It is **temporally honest by construction.** No 2027 match informs a set selected on
  2022–2026, so serving 2027 from it is not a leak, and scoring 2027 with it afterwards is
  genuine out-of-sample scoring.
- It makes 2027 a **headline season automatically** once it completes, because the set was
  committed before the season — which is exactly what a headline claim requires. The count
  goes 3 → 4 with no extra work, and grows by one every year after.

**The annual maintenance loop this defines:**

1. Preseason of S: run one origin-S search, selecting on 2022…S−1.
2. Commit the winner to `paramSetsBySeason[S]` **before** any S match is played.
3. Serve live S from it.
4. When S completes, score S with that same set — honest headline season, no extra step.
5. **Never re-tune a past origin.** Re-selecting a committed origin with hindsight is the
   exact construct rolling origin exists to prevent.

One search per year (~70 min, in preseason) and one new entry in the version file. This fits
D-2's `paramSetsBySeason` shape with no change to it.

**The tradeoff, stated rather than buried: the preseason set ships UNGATED.** D-T7's
acceptance rule compares a candidate against the incumbent *on the origin season*, and the
live season has not been played yet — there is no data to run the gate against. So the
season-S set is promoted as the best-on-prior-seasons winner, without a validated
improvement over the incumbent. The accepted handling is that **the gate applies
retroactively**: when S completes, score it, record whether the set actually beat the
incumbent, and let that verdict inform the S+1 preseason search. The rejected alternative —
hold out S−1 to validate, then refit on 2022…S−1 — restores the gate but reintroduces
exactly the fixed-split complexity this todo exists to remove.

**This makes gate 4 load-bearing.** For the back origins (2024–2026), "winner written to disk
before any origin-season evaluation" is a belt-and-braces check with the acceptance gate
behind it. For the live season it is the *only* thing making the eventual score honest. A
refactor that relaxes gate 4 silently invalidates every future headline season.

**Consequence for the run shape:** origins become **2024 / 2025 / 2026 / 2027**.
`retune-sigma1-rolling-origin`'s cost table covers the first three. The 2027 origin adds one
further search whose selection window is 2022–2026 and which has **no origin-season
evaluation step**, since 2027 has not been played — so it produces a winner and a promotion,
but no acceptance verdict until the season is over.

**Rejected:** the 2026-origin set (the original answer — one season staler than necessary,
and it left a separate live-versus-evaluation question to re-answer every year); deferring
the decision until after the re-tune reports.

### D-4 — Is 2023 headline-eligible on a one-season prior: ANSWERED — not eligible

Headline seasons are **2024 / 2025 / 2026** — three, which meets acceptance criterion 2's
">= 3" bar. 2022 and 2023 are labeled selection-only/untuned and carry no headline claim.
This ratifies what the shipped tuner already does rather than changing it: `tune.ts`'s
origins are 2024/2025/2026 with 2022–2023 as the earliest selection window, so no 2023
parameter set exists to score.

**Not a permanent ceiling (added 2026-09-03 with D-3's revision).** Three is the count
*today*. D-3's rule adds one origin per season from here, so 2027 joins the headline set the
moment it completes, 2028 the year after, and so on. Only 2022 and 2023 are permanently
stranded — no amount of future data can put a season *before* them. The "2 → 3 or 4, not 5"
ceiling stated further up this file is therefore a statement about the back catalogue, not
about the scheme.

**Rejected:** adding a 2023 origin tuned on 2022 alone — four headline seasons, but two
more joint search runs, and it weakens the one-screen leak-free argument the current run
shape rests on.

**Sub-question surfaced by D-4, and CLOSED by D-5 below (2026-09-03).** All five seasons
are published and displayed on Compare today — `compare-2022.json` through
`compare-2026.json` all exist, and every 2022/2023/2024 slice currently carries
`seasonLabel: "tune"`. Under the decided scheme neither 2022 nor 2023 has an origin, so
neither has an honestly out-of-sample parameter set: any set that scores them was selected
having already seen them. D-4 removed their headline claim but did not say which set
produces the numbers still shown for them. **D-5 answers it by removing the numbers rather
than sourcing them.**

### D-5 — What Compare displays: ANSWERED — only origin seasons

**Decided 2026-09-03 by the user**, closing the sub-question above.

Compare displays **only seasons that have an origin** — i.e. only seasons the project can
honestly score. Today that is **2024 / 2025 / 2026**, with 2027 joining under D-3. The
non-origin seasons 2022 and 2023 are not displayed on Compare at all, so no parameter set
needs to be nominated to score them and the sub-question above does not need an answer.

**Reading of "tune seasons", stated because the word is overloaded.** This means seasons
with **no origin** — 2022 and 2023. It does NOT mean the currently-shipped
`seasonLabel: "tune"` set, which also contains 2024. 2024 is an origin under the decided
scheme and is headline-eligible; it stays on Compare.

**This SIMPLIFIES the contract change D-1 carries, rather than adding to it.** If every
displayed slice is an origin season, then `seasonLabel` and `headlineEligible` are constant
across everything published — every slice is eligible. The "Also implied" note below
originally called for migrating `z.enum(["tune","holdout"])` to a new three-value
vocabulary. Under D-5 the right move is **deletion, not re-vocabularization**:

- `CompareSliceSchema.seasonLabel` and `headlineEligible` (`artifact.ts:51-53`,
  `pageArtifacts.ts:1219-1220`) lose their reason to exist.
- `report.ts`'s two-tone styling (`holdout-row`/`tune-row` at :81, `bar-holdout`/`bar-tune`
  at :188, the label badge at :82) collapses to one tone.
- `apps/web/src/components/compare/MethodologyNote.tsx` loses its subject — it exists to
  explain the tune-versus-holdout distinction to readers.

**The cost, which is NOT "delete two rows".** `COMPARE_SEASONS` is not its own list; it is
derived from the site-wide `SEASONS` constant, and `apps/web/src/lib/api/compare.ts:43-48`
states the invariant in as many words: *"There is therefore exactly one source of 'which
seasons exist' in this codebase; a `CURRENT_SEASON` bump automatically reaches this page."*
D-5 **deliberately breaks that invariant**: Compare needs its own, narrower list of origin
seasons, separate from the site-wide list. This is intentional and must not be "fixed" back
— the site legitimately still has 2022 and 2023 data on team and event pages, and only the
*accuracy comparison* is restricted to seasons that can be honestly scored. Whoever
implements this should leave a comment at that seam saying so.

**What does NOT change.** 2022 and 2023 stay in the corpus and stay load-bearing as
*selection* seasons — they are what the 2024 origin is tuned on. They also stay on team and
event pages. D-5 scopes to the Compare page's accuracy tables only.

**Why the user judged the coverage loss acceptable:** the corpus is planned to extend back
to 2016, at which point the stranded seasons are 2016–2017 rather than 2022–2023 and the
displayed set grows to roughly eight seasons. That backfill was **not tracked anywhere** as
of 2026-09-03 and is now filed as `extend-corpus-to-2016`, including the 2020/2021
complication that affects it.

**Rejected:** nominating a parameter set to score 2022/2023 and displaying them with a
caveat (keeps two seasons on the page, but every such number is in-sample by construction —
the exact thing this todo exists to remove); displaying them greyed out or below a fold
(same problem, more UI).

### Also implied

`CompareSliceSchema.seasonLabel` is `z.enum(["tune","holdout"])`. This note originally
called for migrating it to a new three-value vocabulary (`rolling`/`thin-prior`/`untuned`).
**Superseded by D-5:** since only origin seasons are displayed, the field and its derived
`headlineEligible` are constant across every published slice and should be **deleted**, not
re-vocabularized. It is still a published-contract change, and per D-1 it still rides the
re-tune's republish rather than shipping standalone. The
leakage test this section used to describe as pending (acceptance criterion 1: a test
proving a search cannot read a season at or after its evaluation target) already shipped in
`260901-trz`.


---

## PROGRESS 2026-09-03 (later the same day) — D-4 SUPERSEDED, D-5 partially landed

### D-4's verdict on 2023 is superseded by the corpus backfill

D-4 ruled 2023 ineligible on a one-season prior. That was correct **against a 2022-2026 corpus**.
`extend-corpus-2019-2020` changed the inputs, not the rule: 2023 now has 2019, 2020 and 2022 before
it. The thin-prior rule is preserved and simply no longer excludes it.

### D-5 partially landed, in three quick tasks

- `260903-krp` — deleted `SeasonLabel`/`TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit` and replaced
  them with a corpus-relative rule. This was what blocked every scoring path on 2019/2020.
- `260903-n2o` — made eligibility **provenance-aware** after an adversarial review found the
  ordering-only rule asserts a property of the OPTIMIZER while reading only a list of years.
- `260903-tk6` — closed the four review findings that survived refutation.

### The honest eligible set TODAY

| algorithm | selected on | headline-eligible |
|---|---|---|
| `vpr` | 2022, 2023, 2024 (from `provenance.tuneSeasons`) | **2025, 2026** |
| `epa`, `opr`, `vpr-adapt` | nothing (never tuned) | 2022-2026 |

**VPR is unchanged from what live artifacts already carry.** The 2 -> 5 expansion this todo
anticipates is real but arrives **with the re-tune**, not before it — and it will arrive by itself,
because the rule reads `provenance.tuneSeasons` and a promotion rewrites that field. There is no
season list left for anyone to remember to edit.

### Still open here

`seasonLabel` remains OPTIONAL rather than deleted in `CompareSliceSchema`, so the client tolerates
both today's 5.0.0 artifacts and the post-republish shape. Deleting it outright still rides the
republish, per D-1.
