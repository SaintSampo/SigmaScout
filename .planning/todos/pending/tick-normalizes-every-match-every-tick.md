---
id: tick-normalizes-every-match-every-tick
created: 2026-09-21
source: tick inventory during quick task 260921-q2s (Jacob's staleness and Worker CPU push)
priority: medium
---

# The tick normalizes and re-stringifies every match at the event, not just the new ones

On every tick where TBA returns a 200, `processEvent` (`apps/worker/src/scheduled.ts`, around the
`tbaMatchListSchema.parse` call) parses the whole 150 to 400 KB match list, then maps
`normalizeMatch` over ALL of it. `packages/ingest/normalize.ts` runs
`JSON.stringify(match.score_breakdown)` per match, so roughly 80 to 120 breakdowns are
re-stringified each tick, including every match already folded. `foldObservedRp` then
`JSON.parse`s the raw breakdown again for the newly played ones.

**None of this has ever been measured.** The state probe covers Phase A and Phase B only; the CPU
todo says so ("no TBA parse"). At the roughly 15 microseconds per KB cold that the event half
measured, this could be several milliseconds, comparable to terms that got whole quick tasks.

## Direction

Output-identical: split on the cursor using cheap raw fields first, and run the full normalize
(and the breakdown stringify) only on matches past the cursor. Upcoming rows need schedule fields
only. The sort contract (`compareCorpusMatchOrder`) must still see every match key and time.

## How to prove it

Add a probe arm that feeds a realistic raw TBA body through the current and the trimmed path, and
pre-register the bar as a within-run difference between the two arms (absolute `cpuTime` is not
reproducible on this instrument). This is not a browser move; it is on the list because it may be
one of the larger unpriced terms in `rp-fold-exceeds-worker-cpu-budget`.

## THE TRIM IS SHIPPED AND THE BAR IS PRE-REGISTERED; NO NUMBER EXISTS YET (2026-09-21, quick task 260921-vzf)

**This section contains no number produced by this change.** It was written and committed before the
probe was deployed and before a single arm was run. Everything below is a threshold chosen in
advance. Read it before reading any result, and do not edit a threshold after seeing one.

### What shipped

`processEvent` no longer normalizes every match TBA returns. `apps/worker/src/matchSplit.ts`'s
`splitEventMatches` orders the event from `matchOrderFacts` — raw scalar fields and the two alliance
scores only, never `score_breakdown` and never `videos` — resolves the cursor anchor ONCE through
`foldedCutoffIndex`, runs the full `normalizeMatch` on exactly the played matches after it, and
projects the unplayed ones onto the six schedule fields a published upcoming row carries.
`hasAlreadyFolded` is redefined in terms of the same `foldedCutoffIndex`, which also ends the two
`indexOf` scans per played match that made the cursor test O(n²) over an event.

The previous behaviour is RETAINED, exported, and has no production caller:
`splitEventMatchesNormalizeAll`. It is simultaneously the oracle `matchSplit.test.ts` diffs against
and the probe's `normalize=all` baseline arm. **Deleting it makes this change unverifiable and
unmeasurable at the same time.**

### The zod parse is NOT narrowed, and this is why

`score_breakdown` is already `z.unknown()` (`packages/ingest/schemas.ts`), so
`tbaMatchListSchema.parse` does not walk the breakdown today. What it does walk is ~10 scalar fields
plus `alliances` per match, and **every one of those is read by the fold, the sort or the published
row**. There is nothing to trim there. This paragraph exists so the todo's own wording above ("parses
the whole 150 to 400 KB match list") does not get re-opened as a second lead: the parse is cheap
because the expensive field was already opaque to it, and the stringify was the whole cost.

### The rig

Interleave the two arms in ONE pass, 30 s spacing, at least 20 measured requests per arm, analysing
the **reused-isolate stratum only** (`isolateRequest > 1`). The measured query pair differs in
exactly one character of the arm value:

```
GET /?normalize=all&normalizeMatches=100&normalizePlayed=60&normalizeCursor=middle&normalizeRounds=5
GET /?normalize=trim&normalizeMatches=100&normalizePlayed=60&normalizeCursor=middle&normalizeRounds=5
```

### The quantity

`delta = mean(cpuTime | all) − mean(cpuTime | trim)` **within one pass**, and `perTick = delta / 5`.

**Never an absolute `cpuTime`.** `rp-fold-exceeds-worker-cpu-budget.md`'s 2026-09-18 finding is the
reason: that instrument cannot reproduce an absolute `cpuTime` to better than about 5 ms between
runs on unchanged code, and a bar written in absolutes was recorded **unevaluable** for exactly that
reason. That file's standing rule — pre-register in within-run differences between arms measured in
the same pass — is what this bar obeys.

### The validity gates, all three required BEFORE the verdict is read

1. **Identity.** Every request's `normalize.identityFingerprint` is equal across both arms. A
   disagreement is not a weak measurement, it is a defect (see the verdict split).
2. **Linearity.** A second, shorter pass at `normalizeRounds=1` yields a `delta` consistent with
   `perTick`. This is what distinguishes a real per-match term from a per-invocation artifact: a
   term that is genuinely per-match must scale with the round count, and one that does not scale is
   fixed overhead wearing the arm's name.
3. **Tail hygiene.** The analyzer asserts **unique `seq` values** in the captured tail, per the
   2026-09-18 trap recorded in `rp-fold-exceeds-worker-cpu-budget.md`.

### The verdict split

- **WORKED** — `perTick >= 1.5 ms`, the 95% CI on `delta` excludes zero, and all three gates pass.
  Record the number here and in `rp-fold-exceeds-worker-cpu-budget.md`, then close this todo.
- **DID NOT WORK** — the CI on `delta` includes zero, or `perTick < 0.5 ms`. **THE CHANGE IS KEPT
  REGARDLESS.** It is output-identical, it removes a quadratic cursor scan, and it narrows a type so
  the compiler proves no trimmed field is read downstream — none of which depends on a CPU saving.
  It is recorded as a **non-term**, and this line of attack on the CPU budget is CLOSED rather than
  iterated on.
- **INCONCLUSIVE** — `perTick` lands in `[0.5, 1.5)`, or a validity gate fails. **A fingerprint
  disagreement is NOT an inconclusive measurement**: it is a defect in the split, and the
  measurement stops until it is fixed. For the other cases, re-run **once** at
  `normalizeRounds=20`; if it is still inconclusive, record it unevaluable, keep the change on its
  non-CPU merits, and **do not take a third pass**.

### No version bump, and no republish is owed

**No algorithm version moves and nothing is republished.** The evidence, not the intention:

- `apps/worker/test/matchSplit.test.ts` diffs the trimmed path against the retained reference
  implementation at five cursor positions over a ~100-match fixture, asserting deep equality of the
  event order, the newly-folded set **and its full normalized contents including the
  `scoreBreakdownRaw` text**, the derived `lastFoldedMatchKey`, the derived touched-team array, and
  the upcoming rows both directly and through `buildEventScheduledRow`.
- `scheduled.rowParity`, `scheduled.rp` and `scheduled.replay` pass **unmodified**.

Changed published numbers require a new version; unchanged ones do not, and those tests are what
tell the two apart.

### The commands

**The executor cannot run these** — it has no network. The orchestrator runs them from the main
context, on a clean tree, at the measured commit:

```bash
cd apps/worker
npx wrangler deploy                                 # the Worker
npx wrangler deploy --config wrangler.probe.toml    # the probe, SAME commit
npx wrangler tail sigmascout-state-probe --format json > normalize/tail.json
```

**Tail hygiene, repeated here because a copy-pasted command is what propagates the trap.** Stop the
tail by **matching the process command line** (`Win32_Process`), never by the PID PowerShell returns
for `npx.cmd` — that kills the cmd wrapper and leaves the wrangler child attached, appending to its
own file. A later re-read then silently joins two runs' records together, with no parse error.
