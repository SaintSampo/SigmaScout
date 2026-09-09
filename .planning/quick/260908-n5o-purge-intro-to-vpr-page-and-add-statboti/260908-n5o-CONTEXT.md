# Quick Task 260908-n5o: purge Intro to VPR page and add Statbotics EPA vs SigmaScout EPA explainer with published comparison stats - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Task Boundary

Two halves, in order:

1. **Purge** the Intro to VPR page from this project entirely.
2. **Add** a new methodology page explaining how Statbotics' EPA and SigmaScout's
   EPA differ, aimed at high school students in the FRC community, carrying
   real published measurements of how far apart the two ratings actually land.

Out of scope: any change to `epa.ts`, `sigma1/index.ts`, or the rating maths
themselves. This task documents and measures what already exists. It does not
retune, repromote, or alter a model.

</domain>

<decisions>
## Implementation Decisions

### What gets purged (user: "purge the intro to VPR page from this project")

Every artifact of the Intro to VPR page goes, not just the route:

- `apps/web/src/routes/methodology.vpr.tsx`
- `apps/web/src/routes/methodology.vpr.test.tsx`
- `apps/web/src/components/methodology/VprGuide.tsx`
- `apps/web/src/components/methodology/vprGuideContent.ts`
- the `/methodology/vpr` card in `apps/web/src/components/methodology/methodologyCardData.ts`
  (`METHODOLOGY_CARDS[0]`) and its explicit `<Link>` in `MethodologyCards.tsx`
- the `to` union member `"/methodology/vpr"` on `MethodologyCardDescriptor`
- any assertion naming the VPR guide in `methodology.index.test.tsx`

`VprGuide.tsx` owns the ONLY closing `<Link to="/methodology/compare">` outside
the hub, so removing it strands nothing. `MethodologyCards.tsx` destructures
exactly three cards by position and returns `null` if any is undefined — it must
be rewritten to the new card count, not left destructuring a shorter array.

Search the repo for `vpr-guide`, `VprGuide`, `vprGuideContent`, and
`methodology/vpr` before declaring the purge complete. Route trees are
generated, so a stale generated route file counts as a leftover.

### The new page replaces the purged card's slot

The `/methodology` hub keeps three cards. The Intro to VPR card is replaced by
the new EPA comparison card, in the same first position. Do not shrink the hub
to two cards and do not grow it to four.

### Which differences make the page — LOCKED, four of eight

Eight differences are documented in `docs/models/epa-divergences.md`. The user
selected these FOUR and only these four:

1. **Offseason matches** (§7). SigmaScout replays offseason events and lets them
   move a rating; Statbotics never ingests them at all. The single largest
   source of disagreement. Note the 2026-09-08 narrowing: the cross-season carry
   is now taken at a season's last OFFICIAL match, so an exhibition result in
   November no longer seeds the following February. Within-season offseason play
   still moves ratings.
2. **Win-probability scale** (§4). Statbotics divides the score margin by one
   season-level `score_sd` constant. SigmaScout uses an expanding-window SD
   folded match by match, so a Week 1 prediction never borrows variance from
   matches that had not been played yet. This is what makes walk-forward replay
   possible at any point in a season.
3. **Component maps** (§6). SigmaScout built its own per-season score-breakdown
   groupings against its own corpus rather than porting Statbotics'
   `all_keys[year]` table, so the two split a match score into different pieces
   in some seasons (2024 kept five separate note components rather than
   collapsing them).
4. **No per-year tweaks** (§3). Statbotics applies per-season post-processing —
   a 2018 sigmoid, per-year clamps — on top of the raw EWMA. SigmaScout runs the
   raw output with no season-specific patches, as standing policy.

**Explicitly NOT on the page** (user reviewed and left them off — do not add
them back for completeness): fouls handling (§2), EPA carrying no ± of its own
(§5), the now-closed elimination-match divergence (§1), and the
rebuilt-from-scratch-rather-than-copied framing. The acknowledgments page
already carries that last one and keeps it.

### Stats are FETCHED from R2, not baked in — LOCKED

The user chose a published artifact over hardcoded numbers. Follow the existing
five-fetcher pattern exactly:

- key + Zod schema in `packages/harness/pageArtifacts.ts` (`artifactKey`'s
  switch, plus an exported schema and inferred type)
- written in `packages/harness/publish.ts` alongside the other artifacts
- fetched in a new `apps/web/src/lib/api/*.ts` mirroring
  `apps/web/src/lib/api/compare.ts`, which is the closest analog: it is the one
  fetcher with NO algorithm segment and NO version segment, so it needs no
  `useAlgorithmVersion` resolution and no `enabled` gate on an unresolved
  manifest. This new artifact has the same property.

Unlike `v1/compare/{year}.json`, this measurement is a single cross-season
document covering 2022-2026, so it should be ONE key, not year-scoped. Do not
copy Compare's per-year keying by symmetry.

The page needs pending and error states like every other fetching page in this
app (`Skeleton`, `ErrorState` from `StateViews.js`).

### Which stats — LOCKED, all three the user picked

1. **Per-season agreement** — OLS slope, Pearson correlation, mean absolute
   difference, per season, 2022-2026, min-matches(12) arm.
2. **Offseason on vs off** — the same statistics run both ways, so a reader can
   see that one choice explains most of the gap.
3. **Head-to-head accuracy** — winner accuracy and Brier for SigmaScout's EPA
   against Statbotics' own published season figures. Report it honestly:
   Statbotics wins four of five seasons.

### The offseason-excluded arm MUST be re-measured, not copied

This is the one data trap in this task. `docs/models/epa-vs-statbotics.md`'s
offseason-excluded table (slope 0.947-1.012, Pearson 0.99+) was measured under
the retired `epa@2.0.0+baseline` and covers 2022-2025 only. The doc itself flags
it as "the one stale number on this line." The shipping model is
`epa@6.0.0+baseline`. Publishing the stale figures next to freshly measured
offseason-inclusive ones would put two different model versions in one table and
present them as a controlled A/B.

Re-run both arms under the current model before publishing anything. The
offseason-inclusive min-matches(12) figures re-measured 2026-09-08 under 6.0.0
are: 2022 slope 0.886 / Pearson 0.937 / MAD 2.24; 2023 0.845 / 0.928 / 3.14;
2024 0.823 / 0.918 / 2.94; 2025 0.855 / 0.907 / 5.51; 2026 0.963 / 0.976 / 4.76.
The excluded arm has no current counterpart and must be produced.

### Voice — the user's, not an assistant's

The user asked for the page in their own tone and explicitly said not to sound
like AI. Concretely, for this page:

- **No em dashes anywhere in the shipped prose.** The user named this directly.
  Use a period, a comma, or parentheses. `vprGuideContent.ts` was full of them,
  which is part of why it reads the way it does.
- Short declarative sentences. Say the thing, then stop.
- No "it's worth noting", "importantly", "in essence", "at the end of the day",
  no three-item rhetorical lists, no sentence that restates the previous
  sentence with different words.
- Never oversell. Where Statbotics is ahead, say Statbotics is ahead.
- Explain a term the first time it appears, in the same sentence, without
  apologising for using it.

The comparison is neutral. Neither rating is presented as the winner. The page
explains why two honest implementations of the same idea land on different
numbers.

### Claude's Discretion

- Filenames for the new page, component, content module, and fetcher. NOTE the
  Windows case-collision hazard already documented in
  `methodologyCardData.ts`'s header: a data module and its component must not
  differ from each other by case alone, or Rolldown collapses them on this
  machine and the build fails. Follow the established
  `coverageRows.ts`/`DataCoverageTable.tsx` naming shape.
- Section order and headings on the page.
- Table layout for the three stat blocks, and whether the offseason A/B is one
  table or two. Chart-craft rules come from the `sketch-findings-sigmascout`
  skill, which auto-loads for UI work; load it before styling anything.
- Whether the new artifact is produced by extending `scripts/epaVsStatbotics.ts`
  or by a new script that imports `packages/harness/epaStatboticsCompare.ts`.

</decisions>

<specifics>
## Specific Ideas

**Source of truth for every number on the page, in priority order:**

- `packages/harness/epaStatboticsCompare.ts` — the tested statistics module
  (pure, network-free, corpus-free, 14 synthetic-fixture tests)
- `scripts/epaVsStatbotics.ts` — the re-runnable measurement
  (`pnpm compare:epa-statbotics`, credential-free, no `--env-file`).
  `--check` gates against the committed baseline.
- `data/baselines/epa-vs-statbotics-2026-09.json` — the committed tolerance bands
- `docs/models/epa-divergences.md` — the eight documented divergences and why
- `docs/models/epa-vs-statbotics.md` — the measured tables and the SC-2 verdict
- `packages/harness/statbotics.ts` — `fetchStatboticsTeamYears` and the year
  metrics fetch that supplies Statbotics' own published accuracy/Brier

**Operational constraints that have bitten this project before:**

- An executor subagent's sandbox denies ALL network Bash. It cannot run the R2
  publish, and it cannot run any measurement that fetches Statbotics. Those
  steps run from the main context. Plan the executor's work to stop at the code
  and let the orchestrator drive the publish.
- Publish ordering is load-bearing: artifacts before manifest.
- Never `Read`, `cat`, or echo `.env`. Publish scripts take `--env-file=.env`
  and read it themselves.
- Run vitest from the REPO ROOT, not `apps/web` — root sees 167 test files,
  `apps/web` sees 77, and an 8-day red CI once hid in that gap.
- Root `tsc --noEmit` does not cover `apps/web`. Typecheck the web tsconfig too.
- A test that ITERATES a hardcoded season list silently skips a new season.
  Prefer equality pins that fail loudly.

</specifics>

<canonical_refs>
## Canonical References

- `docs/models/epa-divergences.md` — D-13's divergence record, §§1-7
- `docs/models/epa-vs-statbotics.md` — SC-2's measurement, tolerance, verdict
- `.claude/CLAUDE.md` — secrets handling, methodology and provenance constraints
- `sketch-findings-sigmascout` skill — palette, uncertainty display, chart craft

</canonical_refs>
