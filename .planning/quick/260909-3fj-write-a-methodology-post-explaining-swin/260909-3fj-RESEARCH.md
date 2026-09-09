# 260909-3fj Research — Swing Factor and the match band

**Gathered:** 2026-09-09
**Status:** Complete. Planning was interrupted before PLAN.md was written. Resume at "Next step" below.

Task as given: *"write a methodology post to describe what is swing score and what is match band. It should be highly visual, efficient visual communication, written for highschoolers, not sound like ai, no hyphens."*

All facts below were verified against HEAD on 2026-09-09 by two exploration agents plus direct reads. **Do not re-research.** Re-deriving this cost roughly 180k subagent tokens.

---

## Two corrections to the task's framing

1. **"Match band" is an interval, not a classification.** There is no Toss-up / Lean / Likely / Lock tiering anywhere in this repo. A tree-wide grep for `toss.?up`, `lean (red|blue)`, `likely (red|blue|win)`, `"lock"`, `safe bet` returns zero hits outside a throwaway sketch fixture. Match win probability renders as a bare percentage with no tier label (`MatchTable.tsx:394-399`). The post must not invent a tiering.
2. **"Swing score" is called Swing Factor.** Three live names for one quantity: `Swing Factor` (product/UI), `swingFactor` (wire schema), `swingScore` (React prop on `MetricValue` and the teams-table row model).

The two topics are one story: Swing Factor is per robot, the match band is what you get when you combine three of them.

---

## Source of truth

`packages/harness/swingFactor.ts`. Computed at **publish time**, not in the browser.

A fourth, older, superseded module still exists at `packages/core/algorithms/sigma1/swing.ts` (VPR internal, squares about zero rather than centring). **The site no longer reads it.** Its deletion is deferred to the next Sigma1 params major, tracked in `.planning/todos/pending/remove-swing-from-sigma1-core.md`. Do not describe it as current.

`.planning/quick/260908-5wd-*/SUMMARY.md` is **stale on three central points** (it describes a browser estimator, squaring about zero, under a published-wins merge; all three are now false). Do not quote it for the formula.

---

## The chain, in order

1. FRC never records what a single robot scored. TBA publishes alliance totals only. This is the project's Assumption A1, and it is why every per robot number here is inferred rather than measured.
2. Per match deviation for one team = `(actualScore − predictedScore) / rosterSize`. That team's even share of its alliance's miss. (`swingFactor.ts:239-248`)
3. Collect a team's deviations oldest first. Weight by recency: `decay = 0.5 ** (1/6)` ≈ 0.8909; an observation `age` matches back carries `decay ** age`. Half life is **6 matches**. (`SWING_FACTOR_HALF_LIFE_MATCHES = 6`, line 62)
4. Take the weighted spread of those deviations **about the team's own weighted mean** (centred), with an effective sample size denominator (`weight − weightSquares / weight`). **Two passes**, not the algebraic `E[x²] − E[x]²` one pass form, which cancels catastrophically here: five identical deviations of 3 returned `9.05e-8` instead of `0` through the one pass form.
5. Multiply by **`SWING_FACTOR_SCALE = 1.92`** for a points readable figure. (line 88)
6. Returns `undefined` below **two** observations. One point cannot separate model bias from robot swing; its spread about its own mean is `0/0`, not zero.
7. Alliance band variance = **sum of the three teams' squared Swing Factors** (`allianceSwingBandVariance`, lines 173-185). Three robots at ±10 give **±17.32, never ±30**. All or nothing: if any roster member lacks a Swing Factor there is no band at all. Quotable: *"Better no band than a band that is too tight."*
8. Walk forward: the band for match N uses only matches 1..N−1. Predict before update. Not reset between events.

Exactly `0` is a legitimate output: a robot the model misses by a constant is perfectly consistent, and the constant is the model's problem. Non finite input throws rather than coercing to zero.

## Why centring matters (strong story beat)

A model that misses a team by the same amount every match has shown no evidence of swing. Squaring about zero would report that steady bias as wild inconsistency. Measured on OPR before centring, one team's figure came out **±298.92 against a rating of 322.42**, nearly all of it Einstein bias.

## Measured provenance ("we measured it, we did not pick it")

- **Half life 6**: swept walk forward over **275,172 team matches**, 2024 to 2026. Top of a plateau spanning roughly 4 to 12. Decay beats a flat average by only **2.3%**, and the file says so honestly.
- **Scale 1.92**: measured non circularly on **86,844 alliance observations**, regressing observed alliance residual magnitude on the three robots' unscaled RMS deviations. Re validated 2026-09-08 walk forward over **31,142** alliance observations of 2026: a textbook 1σ scale would be 1.99 (VPR) and 2.06 (EPA), so 1.92 carried over rather than being refit.
- The **first attempt at the scale was circular** (regressed a team's deviation on its own past deviations, duly recovered ~1.0) and is recorded in the file so nobody repeats it. Good honesty beat.
- Both constants are **permanently excluded from parameter tuning** (`searchSpace.ts` `SEARCH_EXCLUSIONS.swingScale` / `swingHalfLifeMatches`): a display quantity the Brier objective is structurally blind to. Tuning cannot chase a better looking ±.

## Honest limits the post MUST state plainly

- **Ceiling r ≈ 0.59** for predicting a team's actual deviation in its next match. The data's limit, not the formula's shortfall, because FRC records no per robot score.
- **The band is deliberately conservative.** At 1.92 it covers about **76%** of actual scores for VPR and EPA and about **87%** for OPR, where a true 1σ Gaussian band covers **68.3%**. A coverage calibrated scale would be 1.68 / 1.71 / 1.13. Deliberately NOT adopted: three per algorithm constants would need re measuring on every model change, which is exactly the kind of stale number this project's failure log is about.

  **VPR RETIREMENT CORRECTION (checked 2026-09-10).** `PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "bpr"]` (`packages/harness/publishedAlgorithms.ts:51`); the site default is `bpr` (`searchParams.ts:42`); VPR was retired by commit `eae2defb`. The coverage and re validation figures above were measured when VPR was live, and no BPR specific coverage number exists. **The post must not name VPR.** Phrase coverage as "about 76% to 87% depending on which rating you are looking at, against 68.3% for a textbook one sigma band", and phrase the 2026 re validation as "the scale that would make the band a textbook one sigma came out near 2.0". Both are true and neither names a retired algorithm. Same rule for the live `frc254` figures below: quote OPR, EPA and BPR, drop the VPR row.
- Independent audit over **36,805 alliance observations across 216 events** (`.planning/todos/pending/match-band-calibration-and-the-broken-additivity-identity.md`): RMS z = 0.920, within ±1σ = 75.2%, ±2σ = 96.3%, ±3σ = 99.5%. Mean z = +0.1197 (alliances score slightly above prediction). Residual skew +0.0825, so a reader is about 21% more likely to be surprised high than low.
- Needs two played matches before it says anything.

## Where a reader sees these today

- Swing Factor renders as a grey `±` beside a metric value (`MetricValue.tsx:107-116`), two decimals, on the **team page Total tile** (`SeasonHeader.tsx:139,143,257`) and the **Teams table Total column** (`columns.tsx:385`, `rowModel.ts:134`) only. No label, no tooltip anywhere.
- A `±` toggle in the ribbon turns every `±` on the site off at once (`SwingFactorToggle.tsx:28,36`; default on, persisted to localStorage).
- The match band is drawn on the team page and event page match tables as a soft bar per alliance on ONE shared score axis, solid tick at the predicted score, donut dot at the actual. `MatchTable.tsx:443-445` takes `Math.sqrt` of the published variance and deliberately does not fall back to the algorithm's own variance ("Absent means absent").
- Wire fields: `redSwingBandVariance` / `blueSwingBandVariance` on three schemas (`pageArtifacts.ts:409-411, 600-602, 754-756`); `swingFactor` at `:1114, :1283`.
- Computed once at publish time for **every** algorithm (OPR, EPA, BPR) from nothing but predicted score, actual score and roster. Same number on the team page and the event page, byte identical, pinned by `publish.test.ts:4116-4150`.
- Design doctrine worth echoing in plain language: the overlap between the two bands is the win probability, drawn rather than asserted.

Live verified figures, `frc254` 2026, republish generation `40e7277d`, 2026-09-08: OPR 273.09, EPA 58.63, VPR 59.12, BPR 76.42.

## The gap this page fills

**There is currently no user facing explanation of either concept anywhere on the site.** The old prose lived on an Intro to VPR page purged on 2026-09-08 (commit `250959ce`). The only text a reader sees today is the ribbon toggle's `aria-label`.

Deleted prose worth reusing as a starting point (`git show 307670ce -- apps/web/src/components/methodology/vprGuideContent.ts`), still accurate in its framing:

> "It's tempting to read the ± as 'how sure SigmaScout is about the rating.' That's not what it measures. The ± is how much a robot's contribution swings from match to match, weighted so recent matches count more than old ones."
>
> "A robot with a small ± plays about the same every match. A robot with a large ± might dominate one match and barely show up in the next. Two robots can carry the exact same rating and a completely different ±."

Two of its paragraphs are now out of date: the browser no longer computes it (the pipeline does), and the Teams table **does** now show it.

Also good source material, not duplicated in the harness module: `packages/core/algorithms/sigma1/swing.ts:16-45` carries the **three user stories** that justify the metric's shape. A top seed picking first wants a LOW swing (a robot that turns up the same every match). A low seed hunting an upset wants a HIGH swing (it needs variance to have any shot). Mid quals, a team judging whether its partner can be relied on. This is the best "why does this exist" material in the repo.

---

## Voice rules (binding, enforce by test)

1. **No hyphen characters at all.** No `-` (U+002D), no `–` (U+2013), no `—` (U+2014). Write compounds open: "half life", "walk forward", "match to match", "predict before update", "per robot". Year ranges as "2024 to 2026". This is stricter than `epaComparisonContent.test.ts`, which bans only the em dash.
2. High schooler audience. Short declarative sentences. Explain a term the first time it appears, in the same sentence.
3. Must not sound like AI. Forbid hedging openers ("it's worth noting", "importantly", "in essence", "essentially", "simply put"), sentences that restate the previous one, "not only ... but also", and a closing summary paragraph that repeats the page. Prefer a real number or a concrete example over an adjective.
4. Numbers carry units and sample size.
5. Invent no number. Every figure comes from this document.

The house pattern for all of this is `epaComparisonContent.ts` + `epaComparisonContent.test.ts`. Read both.

---

## Planned figures (inline SVG, hand authored, no chart library, no fetch)

Five, each carrying one idea. Trim or merge if one proves redundant; do not add a sixth. Each needs a `<title>` and an `overflow-x: auto` wrapper.

- **F1 — Where the number starts.** One alliance: predicted 150, actual 168, miss of +18, split three ways into +6 each. Shows the even split, and by construction shows why the number is inferred.
- **F2 — One team's deviations.** About ten deviation dots on a horizontal zero axis, oldest to newest, opacity or size rising toward the newest so recency weighting is visible. Mark the team's own weighted mean and shade the spread about it. Carries centring AND recency at once, so it is the most important figure.
- **F3 — Same rating, different swing.** Two teams, identical Total, very different ±. Tight cluster versus scattered. The "why a scout cares" figure.
- **F4 — Squares add.** Three robots at ±10 combining to ±17.3, shown against a wrong ±30. Short and blunt.
- **F5 — The match band.** Two or three stacked match rows on ONE shared score axis, red and blue soft bars with solid ticks at the predicted score, going from heavy overlap to clean separation.

Binding design constraints (`.claude/skills/sketch-findings-sigmascout/`, references `uncertainty-display.md` and `chart-craft.md`):

- Every colour is a custom property. Never a literal hex in component code. Tokens: `--alliance-red` `#DC2626`, `--alliance-red-soft` `rgba(220,38,38,.3)`, `--alliance-blue` `#2563EB`, `--alliance-blue-soft` `rgba(37,99,235,.3)`, `--loser-ink` `#94A3B8`.
- ONE shared axis per figure. Never two scales in one figure.
- Derive coupled geometry from named constants. Never hand tune two numbers that must agree (sketch 003 drifted 4.5px doing this).
- Green is ink not paint. The accent means interactive only, and nothing in these figures is clickable.
- Label the axis when a figure is zoomed rather than zero anchored.

---

## Implementation surface (verified)

| File | Change |
|---|---|
| `apps/web/src/components/methodology/swingContent.ts` | NEW. Content as data, house pattern per `acknowledgmentsContent.ts` / `epaComparisonContent.ts`. |
| `apps/web/src/components/methodology/swingContent.test.ts` | NEW. Voice gate across all three dash characters; pin the section id list **by equality, not iteration**. |
| `apps/web/src/components/methodology/SwingPage.tsx` | NEW. Page body plus the inline SVG figures. Takes no props, fetches nothing. |
| `apps/web/src/routes/methodology.swing.tsx` | NEW. Route at `/methodology/swing`. |
| `apps/web/src/routes/methodology.swing.test.tsx` | NEW. Route test per `methodology.acknowledgments.test.tsx`. |
| `apps/web/src/components/methodology/methodologyCardData.ts` | EDIT. Extend the `to` union type AND add the descriptor. |
| `apps/web/src/components/methodology/MethodologyCards.tsx` | EDIT. Add a fourth explicit `<Link>` (it destructures positionally and cannot map, for typed search reasons documented in the file) and widen the grid from `md:grid-cols-3`. |

Notes:
- `routeTree.gen.ts` is generated by the TanStack router vite plugin from the filename. `methodology.tsx` already nests children. No manual registration.
- `methodology.index.test.tsx:49` derives its link count from `METHODOLOGY_CARDS.length`, so it needs no edit.
- The page is fully static. No `useQuery`, no artifact, no network.

## Verification

```
cd apps/web && npx vitest run
cd apps/web && npx tsc --noEmit -p tsconfig.json
```

Do **not** use `timeout ... pnpm ...`; this repo has a documented false green where that swallows output and exits 0. Judge by printed output, not exit code alone.

**Baseline captured 2026-09-09 before any change: 99 test files, 1552 tests, all passing.**

---

## Next step on resume

Spawn `gsd-planner` (quick mode, model opus) with this document as its research input to write `260909-3fj-PLAN.md` (a single plan, 3 tasks: content module plus test, page component plus figures plus route plus route test, hub card wiring). Then spawn `gsd-executor` (`workflow.use_worktrees` is `false`, so sequential on the main tree). Then STATE.md row plus docs commit per the quick workflow's steps 7 and 8.

The `.planning/quick/260909-3fj-.../` directory already exists. Nothing has been committed for this task yet and no source file has been touched.
