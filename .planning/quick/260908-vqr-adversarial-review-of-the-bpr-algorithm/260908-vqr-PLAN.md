---
task: adversarial-review-of-the-bpr-algorithm
quick_id: 260908-vqr
status: in-progress
date: 2026-09-08
type: analysis
depends_on:
  - 260908-b4t-fresh-2023-blind-model
  - 260908-pcm-bpr-display-only-phase-components
autonomous: true
read_only_model: true
must_haves:
  truths:
    - "Every hypothesis in this plan is classified CONFIRMED / PLAUSIBLE / KILLED in REVIEW.md — none is dropped silently."
    - "Each CONFIRMED finding carries either a file:line or a measured number that proves it."
    - "Each finding carries a severity stated as its effect on the headline: does 78.05% or the ~3pp lead move, and by roughly how much."
    - "A like-for-like four-algorithm recount over ONE identical match set exists, with per-algorithm denominators printed side by side."
    - "The constructive half (what would make BPR genuinely better) is ranked, priced, and respects the spent-holdout / no-ensemble / Rule-A constraints."
    - "BPR's parameters, frozen-params.json, and published artifacts are unchanged by this task."
  artifacts:
    - ".planning/quick/260908-vqr-adversarial-review-of-the-bpr-algorithm/260908-vqr-REVIEW.md"
    - ".planning/quick/260908-vqr-adversarial-review-of-the-bpr-algorithm/SUMMARY.md"
    - "reports/260908-vqr-fourway/artifact.json (the like-for-like recount)"
  key_links:
    - "REVIEW.md findings ↔ the recount artifact and jsonl the numbers came from"
    - "Every severity claim ↔ the specific number it would move"
---

# Adversarial review of BPR

BPR was frozen on 2016–2022 evidence, evaluated once on a sealed 2023–2026
holdout at **78.05%** (69,511 matches), published 2026-09-08, and now leads EPA
and VPR on every published season by roughly **3 percentage points** — while
being the only one of the three that was *not* tuned on those seasons.

That ordering is backwards from what tuning should buy. It is the reason for
this review.

**One scoring asymmetry in BPR's favour has already been found and fixed**
(`260908-b4t` Addendum 2: `normCdf(0)` returned `0.5000000005`, so BPR never
landed on the exact-0.5 no-call boundary that costs OPR/EPA/VPR a D-Q3 miss —
it was collecting credit on 275 coin flips its competitors were charged for).
That one was real. This task's job is to hunt systematically for the others,
and then to say what would make the model genuinely better.

## What this task is and is not

- **It is** an analysis. The deliverable is a review document plus, where a
  script can settle a question cheaply, measured evidence.
- **It is not** a model change. Do not retune, do not touch
  `packages/bpr/frozen-params.json`, do not republish, do not spend the holdout.
- Throwaway analysis scripts live under this task's directory. **One** exception
  to the no-production-edit rule is granted in Task 1 and it is a registry line,
  not model code.

## Leads already established (do not re-derive these — verify or kill them)

These came out of planning reconnaissance. Each is a *lead*, not a finding.

1. **`bpr` is absent from the shared scoring harness.**
   `packages/harness/cli.ts:107` registers `ALGORITHMS` as
   `{opr, epa, vpr, vpr-defaults, vpr-seasonsd, vpr-normalcdf}` — no `bpr`.
   `packages/harness/publish.ts:131` `BASE_PUBLISH_ALGORITHMS` *does* carry it.
   So `pnpm harness --algorithm ...,bpr` currently throws `Unknown algorithm`,
   and BPR's published comparison numbers have never passed through the code
   path that produced every historical OPR/EPA/VPR comparison.
2. **Two live scoring conventions.** `packages/bpr/evaluate.ts:40` credits a
   no-call **0.5**; `packages/core/scoring/brier.ts:97-104` (`accuracyCall`)
   counts it a **miss** (D-Q3). Brier/log-loss denominators look consistent
   (`evaluate.ts` divides by `s.n` which includes ties, matching `scoreSet`'s
   `count`) — confirm that rather than assume it.
3. **Two match-ordering rules.** `packages/bpr/data.ts:58-75` selects with bare
   SQL and orders `sort_time ASC, match_key ASC` — a **lexicographic** tiebreak,
   so `qm10` sorts before `qm2`. `packages/corpus/db.ts:525` explicitly
   documents `sort_time` alone as ambiguous and `:563` orders by comp-level play
   order, then `set_number`, then `match_number`. `data.ts` also reads no
   surrogates and no DQ state, where the shared path has `packages/core/
   algorithms/dq.ts` and `packages/harness/score.ts:126`'s explicit exclusion
   reasons.
4. **The carryover-asymmetry hypothesis is probably dead.** EPA has
   `carrySeason` via `packages/core/algorithms/carryover.ts`; VPR has
   `packages/core/algorithms/sigma1/carryover.ts`. Verify and record it as
   KILLED rather than dropping it — "BPR alone carries state across seasons" is
   the most natural explanation for the 3pp and it deserves an explicit burial.
5. **A holdout-year filename sits in the design-era directory.**
   `.planning/quick/260908-b4t-fresh-2023-blind-model/SLICE-2023-wk0-1.txt`.
   The design era ends at 2022. Open it. Also present: `round1..round5-full.json`,
   `validation-tune-1619.json`, `candidate-hetero.json`, `hetero-seed.json`,
   `fair-reset-control.json`, `parsimonious-seed.json`, `CARRYOVER-STUDY.txt`.
6. **`foulOn: false` in the frozen params.** The summary credits "+0.30pp
   foul-adjusted signal", but the foul adjustment is not a parameter — it is
   baked into `data.ts:92-93` (`redOut = red_score - redFoul`) and toggled by
   `evaluate.ts:88-90`'s `useRawScore`. Check the ablation labelled
   "foul-adjusted signal" measured the thing it is named after.
7. **The bootstrap material already exists.** `reports/*/predictions-YYYY.jsonl`
   rows carry `matchKey, season, eventKey, compLevel, algorithmId, pRedWin,
   actualWinner` — everything an event-clustered block bootstrap needs.
   `reports/full-2016-2026/` (run 2026-09-07) has opr/epa/vpr but predates BPR.

## Repo traps that will otherwise cost an hour

- Run vitest **from the repo root**, never from `apps/web` (root sees 167 files,
  `apps/web` sees 77 — an 8-day red CI once hid in that gap).
- **Never** wrap a run in `timeout <n> pnpm <cmd>` — it swallows output and
  exits 0. Use `npx vitest run <path>` and judge by the printed output, not the
  exit code.
- Root `tsc --noEmit` does not cover `apps/web`; irrelevant here unless you touch
  web code, which you should not.
- CLAUDE.md secrets rule is absolute: never `Read`/`cat`/`echo` `.env` or any
  value from it. `pnpm harness` runs under `tsx --env-file=.env` — let the tool
  read the file; you never do.
- The corpus is `data/corpus.sqlite`, read-only for this task.

---

## Task 1 — Like-for-like recount and port fidelity (angles A, F)

**Goal:** settle, with measured numbers rather than argument, whether the ~3pp
lead survives when all four algorithms are scored by ONE harness over ONE
identical match set under ONE convention.

**Files (analysis outputs):**
`.planning/quick/260908-vqr-adversarial-review-of-the-bpr-algorithm/260908-vqr-REVIEW.md`,
`reports/260908-vqr-fourway/`,
throwaway scripts under the task directory.

**Action:**

1. **Baseline green.** From the repo root run
   `npx vitest run packages/bpr packages/core/algorithms/bpr.test.ts packages/core/scoring`
   and read the printed summary. Record pass/fail counts in REVIEW.md. If
   anything is red, note whether it is red in isolation or only under full-suite
   contention (`260908-b4t` and `260908-pcm` both report contention-only
   failures) — a red baseline changes what later conclusions are worth.

2. **Register `bpr` in the shared harness.** Add `bpr` to `ALGORITHMS` in
   `packages/harness/cli.ts:107`, importing from
   `packages/core/algorithms/bpr.js` exactly as `publish.ts:131` does. This is
   the single permitted production edit: it adds no model code, changes no
   parameter, and touches no artifact. Commit it on its own with a message
   saying why it is needed. If it turns out to break an existing test, revert it
   and fall back to a throwaway driver under the task directory that imports
   `packages/harness/score.ts`'s scoring entry point — **do not** hand-roll the
   exclusion rules, since re-deriving them is the exact asymmetry under test.

3. **The recount.** Run the four-way replay over the real gapped season list:
   `pnpm harness --seasons 2016-2020,2022-2026 --algorithm opr,epa,vpr,bpr --out reports/260908-vqr-fourway`
   Run it in the background with output tee'd to a log; it is a long run. Do not
   read a quiet log as a dead process — check the artifact's mtime and growth
   (see the repo's long-running-ingest lesson).

4. **Read the recount adversarially.** From
   `reports/260908-vqr-fourway/artifact.json`, build a table per season and per
   `compLevelView` with, for **each** algorithm: `winnerAccuracy`, `brierScore`,
   `count`, `tieCount`, `noCallCount`. Then answer, in REVIEW.md:
   - Are the `count` denominators **identical** across all four for the same
     slice? Any difference is a different population and invalidates the
     comparison until explained.
   - How does BPR's recounted accuracy compare to the **published** compare
     artifact's figures (`260908-b4t` addendum: 2024 .7671 / 2025 .7854 /
     2026 .8041 vs EPA .7354/.7745/.7944 and VPR .7321/.7641/.7874)? If the
     recount and the publish path disagree for the same algorithm-season, the
     publish path is the finding.
   - Does the ~3pp lead survive? State the surviving margin per season with its
     denominator.
   - Are VPR/EPA being run with their **promoted per-season** parameter sets
     here, or with baseline? BPR ships one parameter set for all ten seasons.
     If VPR is running un-promoted, the comparison flatters BPR.

5. **Convention diff.** Write out, side by side, exactly how
   `packages/bpr/evaluate.ts` and `packages/core/scoring/brier.ts` +
   `packages/harness/score.ts` differ on: no-call credit, tie handling,
   accuracy denominator, Brier denominator, and which matches are excluded from
   scoring at all. Quantify the no-call convention's effect using the recount's
   `noCallCount` per algorithm. State plainly which of the two numbers in
   circulation — the sealed **78.05%** and the published per-season figures —
   was produced under which convention.

6. **Port fidelity.** Run `packages/bpr/equivalence.ts` (it exists precisely to
   ask whether `packages/core/algorithms/bpr.ts` reproduces
   `packages/bpr/model.ts`; it pins `KNOWN_DESIGN = 73.081` and
   `KNOWN_HOLDOUT_ALL = 78.05`). Record the numbers it prints. Then check
   whether `260908-pcm`'s "152,757 matches, 0 mismatches" claim covers the
   **port** or only the phase refactor of the port against itself — read that
   summary's own wording. Note the one deliberate divergence the equivalence
   header already discloses (lazy vs eager `carrySeason`) and say whether it can
   move accuracy.

**Verify:**
- `reports/260908-vqr-fourway/artifact.json` exists and its `algorithms` array
  contains all four ids.
- REVIEW.md contains a per-season, per-algorithm table with `count` printed for
  every cell.

**Done:** A reader can see, from one table, whether the ~3pp lead is real under a
single harness — and if it shrank, by how much and because of what.

---

## Task 2 — Leakage, firewall, and statistical honesty (angles B, C, E)

**Goal:** establish whether BPR's number is honestly earned — no state leak, no
holdout contamination — and whether the error bars it was selected under are
right.

**Files:** REVIEW.md (append); throwaway scripts under the task directory.

**Action:**

1. **Causality trace beyond the ratings.** The existing walk-forward test
   (`packages/bpr/model.test.ts:55`) flips one match's result and asserts
   earlier predictions are bit-identical. Determine what state that test
   actually covers. Then trace, by reading, whether each of these is strictly
   pre-match at prediction time:
   - the online point scale (`bpr.ts:455` `stepScale`, `state.scale`,
     `state.scaleCount`) — note that `update` normalizes this match's
     observation by the scale **stepped with this same match** (`:431/:440`
     phase path, `:455-456` total path). Confirm that stepped value cannot reach
     `predict`, which reads `state.scale` at `:300`.
   - the link temperature (`state.logTau`, read at `:293`, written at
     `:464-471`).
   - the league / cold-start prior and `rookieMean`.
   - `carrySeason` (`:498`) — does anything it carries depend on matches after
     the boundary?
   If the flip-one-result test only inspects rating state, write a throwaway
   probe that flips a result and diffs the **whole serialized state** (there is
   a `serializeBprState`/`deserializeBprState` pair) for every prediction up to
   and including that match. That closes the gap the existing test leaves.

2. **Ordering audit.** Measure how many matches `packages/bpr/data.ts`'s
   `sort_time ASC, match_key ASC` orders differently from
   `packages/corpus/db.ts`'s `selectMatchesChronological`. Report: total
   inversions, how many are **within one event** (the ones that matter), and
   whether any inversion puts a later-played match's update before an earlier
   match's prediction. A pure SQL/JS diff of the two orderings settles this
   cheaply. Also record what `sort_time` is derived from — scheduled or actual
   time — since a schedule-time ordering during a delayed event is a different
   risk than a mis-tiebreak.

3. **Population differences.** Confirm or kill: does `data.ts` include matches
   the shared path excludes (surrogates, DQs, replays, void/unplayed) or vice
   versa? Compare the row count `data.ts` returns per season against
   `selectMatchesChronological`'s, and characterize any difference. If BPR's
   research population is easier (e.g. drops matches the others must predict),
   that is a headline-moving finding.

4. **Firewall forensics.** Verify the three refusals actually fire — run each
   and capture the error text, do not read the source and assume:
   - `tune.ts` with `BPR_TUNE_YEARS` naming a holdout year (`tune.ts:34-37`)
   - `score.ts` with a holdout year argument (`score.ts:23-25`)
   - `holdout.ts` without `--break-seal`, and with a dirty params path
     (`holdout.ts:17-50`)
   Then do the git forensics:
   - `git log --follow --oneline` on
     `.planning/quick/260908-b4t-fresh-2023-blind-model/HOLDOUT-RESULT.txt` and
     `packages/bpr/frozen-params.json` — was the holdout evaluated **once**?
     More than one `HOLDOUT-RESULT.txt` revision, or a `frozen-params.json`
     revision *after* the first holdout run, is contamination.
   - Open `SLICE-2023-wk0-1.txt` in that directory and establish what produced
     it, when, and whether it fed any design decision. A 2023 artifact in the
     design directory is either an innocent post-seal check or the review's
     biggest finding; decide which, with the timestamp and the commit that
     introduced it.
   - Assess the disclosed 2026 schema glance (`autoPoints`/`teleopPoints`
     renames) — the summary argues it was strictly conservative because it
     *removed* a design family. Test that argument rather than accepting it.
   - Assess whether the post-seal `normCdf(0)` fix constitutes tuning on the
     holdout. The addendum claims 2023–2026 contain zero dead-even matches, so
     78.05% is unchanged. Verify that census independently from the recount's
     per-algorithm `noCallCount` for 2023–2026.

5. **Honest error bars.** The 0.30pp standard error and the 0.31pp (2 s.e.)
   selection threshold both assume independent matches. They are not
   independent: the same ~3,700 teams recur all season, so the effective sample
   size is far below 69,511. Compute an **event-clustered block bootstrap**
   (resample whole `eventKey` blocks with replacement, ≥1,000 draws) over the
   per-match records in `reports/260908-vqr-fourway/predictions-*.jsonl` and
   report:
   - a clustered SE on BPR's holdout-era accuracy, next to the naive 0.30pp;
   - the design effect (clustered SE ÷ naive SE);
   - a clustered CI on the **BPR − VPR** and **BPR − EPA** accuracy differences,
     paired by `matchKey` (paired resampling, since all four saw the same
     matches — this is much tighter than comparing two independent CIs);
   - whether the parsimony decision still holds: the frozen model beat the full
     23-knob variant by −0.238pp against a pre-registered 0.31pp bar. Under a
     clustered SE that bar widens; state whether the decision flips, stays, or
     becomes undecidable. Note honestly that recomputing the *design-era*
     ablation gap exactly would need a design-era re-run — if the bootstrap can
     only bound it, say so and mark the finding PLAUSIBLE, not CONFIRMED.
   - Winner accuracy depends only on the **sign** of the predicted margin. Using
     the jsonl `pRedWin` values, report what fraction of BPR's decided calls sit
     within a hair of 0.5 (say |p − 0.5| < 0.01) — that is the margin-flip noise
     floor for every claimed improvement.

**Verify:** REVIEW.md carries, for each of B/C/E, an explicit
CONFIRMED / PLAUSIBLE / KILLED verdict with its proof (file:line, command
output, commit hash, or bootstrap number).

**Done:** The firewall's integrity and the headline's error bars are settled
claims rather than assertions inherited from the sealed summary.

---

## Task 3 — Attribution critique, constructive proposals, and the verdict (angles D, G)

**Goal:** finish the destructive half, then deliver the constructive half Jacob
explicitly asked for — and write the document.

**Files:** REVIEW.md (append + verdict section); SUMMARY.md.

**Action:**

1. **Component attribution (angle D).** For each claim, decide CONFIRMED /
   PLAUSIBLE / KILLED:
   - *"An independent search on 2016–2019 alone rediscovered w2=0.7 and w3=0.5
     exactly."* 2016–2019 is a **subset** of the 2016–2022 design era — same
     seasons, same teams, largely the same matches. Quantify the overlap
     (matches in 2016–2019 as a fraction of design-era matches) and say what
     "independent" can honestly mean here. Note that `tune.ts:77-78`'s grid for
     `w2`/`w3` is coarse (`w2 ∈ {0.6,0.7,0.85,1.0,1.15}`, `w3 ∈ {0.2,0.35,0.5,
     0.6,0.75,1.0}`), so "exactly" means "the same grid point", which is a much
     weaker coincidence than it reads as.
   - *"+3.22pp over a naive additive baseline (69.86 → 73.08)."* Establish what
     the baseline actually was. If it was denied cross-season carryover — worth
     +1.80pp on its own — then more than half the headline margin is the
     baseline's handicap, not the model's structure. Say so with the arithmetic.
   - *"Five ideas rejected, each under 0.1pp."* Given Task 2's clustered SE, was
     the search powered to distinguish 0.1pp from zero at all? Check the frozen
     inert settings (`frozen-params.json`: `foulOn:false`, `elimWeight:1`,
     `defPriorVar:0`, `defQ:0`, `huberK:1e9`, `biasLr:0`) against `tune.ts`'s
     grid to confirm each really was searched rather than pinned. Cross-check
     the elim result against the repo's own prior negative
     (`project_elim_r_negative_result`: elim weighting closed negative
     2026-09-05, 6/6 keep-incumbent) — agreement there is corroboration worth
     recording.
   - The `foulOn: false` / "+0.30pp foul-adjusted signal" naming mismatch from
     lead 6.

2. **What would make BPR genuinely better (angle G).** This is not an
   afterthought; give it real weight. Produce a **ranked** table: proposal,
   mechanism, expected effect (with the evidence for that expectation), cost,
   and what it would spend. Every proposal must respect:
   - **The 2023–2026 holdout is spent.** Any proposal needing 2023+ for tuning
     must say so and price it — the next honest out-of-sample is 2027. Prefer
     proposals evaluable on 2016–2022, or on a rolling-origin design-era scheme.
   - **No ensembling.** Jacob's standing rule: improve BPR itself. No EPA+VPR+BPR
     blends, no parameter bloat. A new knob must be inert at its default and earn
     promotion.
   - **Rule A acceptance:** ship only when accuracy **and** Brier both improve.
   - **Do not re-propose a trained GBDT.** GBR lost the 2026 holdout to VPR and
     was shelved by Jacob 2026-09-08.
   - **The `compare` artifact is at 93.2% of its 20,000-byte ceiling.** A fifth
     algorithm breaches it; a proposal that adds one must price the ceiling work.
   - Include, as first-class entries, any *fix* the review found: a scoring
     asymmetry to close, an ordering rule to unify, a population to align. Those
     are the cheapest genuine improvements available and they cost no holdout.
   - Where the review found BPR's structure genuinely load-bearing
     (anti-additivity is the candidate), say what the natural next move on that
     axis is — e.g. whether the rank weights should be learned per-season, or
     conditioned on something observable — and price it honestly.

3. **Write `260908-vqr-REVIEW.md`.** Structure:
   - **Verdict** (≤10 lines): is 78.05% honest? Is the ~3pp lead real, and what
     is the corrected margin?
   - **Findings table:** ID, angle, hypothesis, classification
     (CONFIRMED / PLAUSIBLE / KILLED), proof (file:line or number), **headline
     impact** (does 78.05% or the ~3pp move, and by roughly how much).
   - One section per angle A–F with the working.
   - **What would make it better:** the ranked table from step 2.
   - **What this review could not settle** and what it would cost to settle.
   Every hypothesis listed in this plan appears in the table. A hypothesis
   checked and found harmless is recorded as KILLED with its proof — that is a
   result, not a blank.

4. **Write `SUMMARY.md`** in the house style of the sibling quick tasks:
   frontmatter (`task`, `status`, `date`, `depends_on`, plus the headline
   verdict as a field), then the verdict, the findings that move the number, and
   the top three constructive proposals. Keep it short — REVIEW.md carries the
   working.

5. **Confirm the read-only guarantee.** Before finishing, run `git status` and
   confirm: `packages/bpr/frozen-params.json` untouched, no model file modified
   beyond the Task 1 registry line, no artifact republished. State this in
   SUMMARY.md as a checked fact.

**Verify:**
- `260908-vqr-REVIEW.md` exists; every hypothesis from angles A–G appears in the
  findings table with a classification and a headline-impact column.
- `SUMMARY.md` exists and its verdict is consistent with the findings table.
- `git status` shows no change to `frozen-params.json` and no unexpected
  production edits.

**Done:** Jacob can read one page and know whether to trust 78.05%, what the
honest margin over VPR/EPA is, and what to do next.

---

## Not in scope

- Retuning BPR, editing `frozen-params.json`, or any change that spends the
  2023–2026 holdout.
- Republishing artifacts or touching R2.
- Re-proposing the shelved GBDT/GBR model.
- Proposing any EPA/VPR/BPR ensemble or blend.
- UI or web changes.

## Notes for the executor

- Prefer a measured answer over a clever argument. Where a script settles a
  question in minutes, run the script; where it would take hours, say so and
  classify the finding PLAUSIBLE rather than inventing a number.
- Do not launch a multi-hour retune. The Task 1 four-way replay is the one long
  job this plan authorizes.
- A hypothesis you checked and found harmless is a **finding**. Write it down as
  KILLED with its proof. Silence reads as "not checked".
- Severity is always about the headline. "This is ugly" is not a severity;
  "this moves 2024 accuracy by 0.4pp in BPR's favour" is.
