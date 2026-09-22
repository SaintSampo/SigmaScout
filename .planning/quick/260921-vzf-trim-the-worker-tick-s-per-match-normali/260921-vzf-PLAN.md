---
quick_id: 260921-vzf
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - A-full-normalize-runs-only-on-matches-past-the-cursor
  - B-output-identical-order-cursor-folded-upcoming-touched-teams
  - C-cursor-lookup-is-not-quadratic
  - D-zod-parse-assessed-and-the-verdict-written-down
  - E-probe-arm-prices-the-change-as-a-within-run-difference
  - F-pre-registered-bar-with-worked-did-not-work-inconclusive
  - G-no-schema-no-version-no-republish-no-algorithm-change
files_modified:
  - packages/ingest/normalize.ts
  - packages/ingest/normalize.test.ts
  - apps/worker/src/matchSplit.ts
  - apps/worker/test/matchSplit.test.ts
  - apps/worker/src/stateStore.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/stateProbe.ts
  - apps/worker/test/stateProbe.test.ts
  - docs/worker-operations.md
  - .planning/todos/pending/tick-normalizes-every-match-every-tick.md
  - .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
estimate:
  tokens: 70000
  raw_tokens: 140000
  tasks: 3
  confidence: med
must_haves:
  truths:
    - "On a tick where TBA returns 200, the full `normalizeMatch` (and therefore the `JSON.stringify` of `score_breakdown`) runs only on played matches strictly after the cursor. Every already-folded match and every still-upcoming match is normalized zero times."
    - "The trimmed path and the normalize-everything path produce deep-equal `orderedMatchKeys`, deep-equal `newlyFolded` (whole `CorpusMatch` objects, breakdown text included), the same `lastFoldedMatchKey`, the same sorted touched-team array, and the same `buildEventScheduledRow` output for every upcoming match — at every cursor position over a ~100-match fixture, per requirement B."
    - "`normalizeMatch(m).winner !== null` and `isPlayed(m)` agree on every match of that fixture. That equivalence is what lets the split run before the normalize, and a test fails the moment it stops holding."
    - "The cursor anchor is located once per tick instead of twice per match, and `hasAlreadyFolded` keeps its exact published behaviour because it is redefined in terms of the same one lookup rather than given a second copy of the rule."
    - "The probe answers `normalize=all` and `normalize=trim` over one synthetic raw TBA match list of realistic byte size, reports `matchesNormalized` / `breakdownsStringified` / `newlyFoldedCount` / `upcomingCount` / `rawBytes` per arm, and both arms return the SAME `identityFingerprint`, so a live measurement pass self-checks identity instead of trusting the unit test alone."
    - "The `normalize=` arm touches D1 zero times: it is routed before discovery and is never handed the binding, so a measurement campaign cannot spend the daily row-read cap and cannot fail a live tick."
    - "No artifact schema, no algorithm version string, no published number and no algorithm code changes; the existing worker suites pass unmodified, which is the proof no republish is owed."
  artifacts:
    - apps/worker/src/matchSplit.ts
    - apps/worker/test/matchSplit.test.ts
    - "`matchOrderFacts` and exported `isPlayed` in packages/ingest/normalize.ts"
    - "`foldedCutoffIndex` in apps/worker/src/stateStore.ts"
    - "`normalize` result block and `resolveNormalizeArm` in apps/worker/src/stateProbe.ts"
    - "the PRE-REGISTERED BAR section in .planning/todos/pending/tick-normalizes-every-match-every-tick.md"
  key_links:
    - "`splitEventMatchesNormalizeAll` is kept as a named, exported reference implementation with no production caller: it is simultaneously the identity oracle the unit test diffs against AND the probe's `normalize=all` baseline arm. Delete it and the change becomes unmeasurable and unverifiable at once."
    - "`runPhaseBAndReport`'s `stillUpcoming` parameter narrows from `CorpusMatch` to `ScheduledMatchFacts`, so the compiler — not a reviewer — proves no trimmed field is read downstream."
    - "`hasAlreadyFolded` and the tick's new one-shot split both resolve the anchor through `foldedCutoffIndex`, keeping the cursor contract at ONE definition exactly as `compareCorpusMatchOrder`'s header demands of the ordering contract."
    - "The probe arm repeats only the split, never the fixture build, so the shared build/parse term does not scale with `normalizeRounds` and the arm difference does."
---

<objective>
Stop the Worker tick from normalizing and re-stringifying every match at the event on every
200. Split on the cursor using cheap raw fields first, run the full `normalizeMatch` only on
matches past it, and build upcoming rows from schedule fields alone — output-identical in
every respect the cursor contract and the published artifacts can see. Then add a probe arm
so the saving can be priced as a within-run difference, and pre-register the bar before any
number exists.

Purpose: this is one of the larger unpriced terms in
`rp-fold-exceeds-worker-cpu-budget.md`. It has never been measured, and the tick is still
over budget.

Output: a trimmed `processEvent`, an exported reference implementation that doubles as the
identity oracle and the probe's baseline arm, a `normalize=` probe arm, and a written bar
with a WORKED / DID NOT WORK / INCONCLUSIVE split.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/tick-normalizes-every-match-every-tick.md

Facts established before planning — do not re-derive them:

1. **`score_breakdown` is already `z.unknown()`** in `packages/ingest/schemas.ts:99`, so
   `tbaMatchListSchema.parse` does NOT walk the breakdown today. The parse's remaining cost is
   ~10 scalar fields plus `alliances` per match, and every one of those fields is read by the
   fold, the sort or the published row. **The zod parse is NOT narrowed by this plan**, and
   task 3 writes that verdict down so nobody re-opens it from the todo's wording.

2. **`normalizeMatch`'s `winner` is non-null exactly when `isPlayed(match)` is true**
   (`packages/ingest/normalize.ts:208-231`: every played branch assigns red, blue, tie or an
   imputed winner; the unplayed branch assigns none). The current split tests `winner !== null`;
   the trimmed split tests `isPlayed`. That equivalence is the whole correctness argument and
   gets its own test.

3. **`compareCorpusMatchOrder` already accepts a light object** — its parameters are
   `Pick<CorpusMatch, "sortTime" | "compLevel" | "setNumber" | "matchNumber" | "matchKey">`.
   No change to that function is needed or wanted; it is the shared cursor-order contract with
   the offline publisher and its header says so.

4. **`stillUpcoming` is only ever read for six fields.** `mergeEventArtifact` hands each row to
   `buildEventScheduledRow` (`artifactMerge.ts:152`), which reads matchKey, compLevel,
   setNumber, matchNumber, redTeams, blueTeams — the exact `ScheduledMatchFacts` alias at
   `artifactMerge.ts:59`. `scheduled.ts:1212` reads redTeams/blueTeams. Nothing reads sortTime,
   winner, scores, RP, the breakdown or the video off an upcoming row. `sortTime` on a published
   upcoming row comes from the EXISTING artifact, never from the normalize.

5. **`hasAlreadyFolded` (`stateStore.ts:267-287`) runs two `indexOf` scans per call and is
   called once per played match**, so the cursor test is O(n²) over the event. Its cursor-absent
   branch degrades to "not yet folded" rather than throwing, and that behaviour is load-bearing.

6. **`rawMatches` stays whole.** `playedRowFactsFor(season, rawMatches, ...)` builds a key map
   over the full parsed list; it is unchanged by this plan.

7. **The probe routes `chunk=teams` before discovery and never passes `env` on**
   (`stateProbe.ts:2789`), which is what makes "prepares zero D1 statements" true rather than
   intended. The new arm copies that placement for the same reason.

@apps/worker/src/scheduled.ts
@apps/worker/src/stateStore.ts
@packages/ingest/normalize.ts
@apps/worker/src/artifactMerge.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: One tick's worth of matches splits on the cursor without normalizing the already-folded ones</name>
  <files>packages/ingest/normalize.ts, packages/ingest/normalize.test.ts, apps/worker/src/stateStore.ts, apps/worker/src/matchSplit.ts, apps/worker/test/matchSplit.test.ts, apps/worker/src/scheduled.ts</files>
  <read_first>packages/ingest/normalize.ts lines 113-256, apps/worker/src/stateStore.ts lines 250-290, apps/worker/src/scheduled.ts lines 826-880 and 1160-1250, apps/worker/src/artifactMerge.ts lines 55-60 and 145-165, apps/worker/test/scheduled.rowParity.test.ts lines 40-135</read_first>
  <behavior>
    - Over a ~100-match raw fixture at cursor = null, the trimmed split and the reference split return deep-equal `orderedMatchKeys`, deep-equal `newlyFolded`, and deep-equal upcoming rows.
    - Same, with the cursor on the first ordered match.
    - Same, with the cursor in the middle of the played prefix (the realistic mid-event tick).
    - Same, with the cursor on the last played match, where `newlyFolded` is empty.
    - Same, with a cursor anchor that is absent from this tick's list — both paths degrade to "nothing folded yet" and fold every played match.
    - The fixture's ordering is exercised, not incidental: it contains a null `actual_time` row driving the composite sortTime fallback, an `sf` set and an `f` match so comp-level play order decides, two rows tying on every field above `matchKey`, and rows deliberately supplied out of order.
    - The fixture's content is exercised: a tie, an empty `winning_alliance` on a non-tied played match (the imputed-winner branch), a null `score_breakdown`, a youtube video after a `tba` video, surrogates and DQs.
    - For every match in the fixture, `normalizeMatch(m, start).winner !== null` equals `isPlayed(m)`.
    - `foldedCutoffIndex` agrees with `hasAlreadyFolded` for every (match, cursor) pair over the fixture, including the null-cursor and absent-anchor cases.
    - The trimmed split normalizes exactly `newlyFolded.length` matches — asserted by counting calls, not inferred.
  </behavior>
  <action>
**1. `packages/ingest/normalize.ts` — cheap order facts, per requirement A.**

Export the existing `isPlayed` and add `matchOrderFacts(match, eventStartDate)` returning a
frozen-shape object with `matchKey`, `compLevel`, `setNumber`, `matchNumber`, `sortTime` and
`played`. It reads raw scalar fields and the two alliance scores only: it must not touch
`score_breakdown`, must not scan `videos`, and must not derive a winner. `sortTime` comes from
the existing `matchSortTime`, unchanged and still private — `matchOrderFacts` is its only new
caller, so the fallback chain keeps one definition.

Give `matchOrderFacts` a doc comment stating fact 2 from `<context>` in substance: the `played`
flag is the same predicate `normalizeMatch` uses to decide whether a winner exists at all, the
split relies on that, the two must never drift, and `normalize.test.ts` fails if they do. Name
the test.

Add the equivalence test to `packages/ingest/normalize.test.ts` over a small table of shaped
matches (played, unplayed, tied, negative score, one side null).

**2. `apps/worker/src/stateStore.ts` — one anchor lookup, per requirement C.**

Add `foldedCutoffIndex(cursor, orderedMatchKeys): number`: the index of the cursor's anchor in
this tick's order, or `-1` when the cursor holds no anchor OR the anchor is absent from this
tick's list. Move fact 5's degrade rationale onto it verbatim in substance — the anchor-absent
case returns `-1` because this tick's list is authoritative and failing loudly there would take
the whole tick down over bookkeeping.

Then REDEFINE `hasAlreadyFolded` in terms of it: keep the throw for a matchKey genuinely absent
from the list, then compare the match index against the cutoff. Do not leave two copies of the
rule in the file, and do not change the exported behaviour of `hasAlreadyFolded` in any case —
its callers and its own header contract stay exactly as they are.

**3. `apps/worker/src/matchSplit.ts` (new) — the split, both ways.**

Export `EventMatchSplit` = `{ orderedMatchKeys, newlyFolded: readonly CorpusMatch[],
stillUpcoming: readonly ScheduledMatchFacts[] }`.

Export `splitEventMatches(rawMatches, eventStartDateIso, cursor)` — THE PRODUCTION PATH:
map each raw match to its order facts keeping a reference to the raw match, sort that array
with `compareCorpusMatchOrder` (imported, never reimplemented), take `orderedMatchKeys` off it,
resolve the cutoff once with `foldedCutoffIndex`, then build `newlyFolded` by running the full
`normalizeMatch` on exactly the played entries positioned after the cutoff, and `stillUpcoming`
by projecting the unplayed entries onto the six `ScheduledMatchFacts` fields (team key arrays
read straight off the raw alliances).

Export `splitEventMatchesNormalizeAll(...)` with the identical signature — THE REFERENCE
IMPLEMENTATION: the current behaviour, lifted as-is (normalize every match, sort the normalized
rows, filter with `hasAlreadyFolded`, project the unplayed rows onto the same six fields so the
two returns are the same type). It has no production caller on purpose. Say in its doc comment
that it exists for two reasons that must both keep being true — it is the oracle
`matchSplit.test.ts` diffs the production path against, and it is the probe's `normalize=all`
baseline arm from task 2 — and that deleting it makes the change simultaneously unverifiable
and unmeasurable.

Put the module's own header on the identity contract: what is guaranteed byte-identical
(order, folded set and their full normalized contents, cursor anchor, touched teams, upcoming
rows) and the one thing that is allowed to differ (work performed for already-folded matches).

**4. `apps/worker/src/scheduled.ts` — call it.**

Replace the parse-then-normalize-everything-then-sort-then-filter block after the zod parse
with a single `splitEventMatches` call, destructuring the three results. The zod parse stays
exactly where and as it is (fact 1). `approxStartDateIso` keeps its comment. `newlyFolded`,
`stillUpcoming`, `orderedMatchKeys`, the `newlyFolded.length === 0` early return, `touchedTeams`
and `lastFoldedMatchKey` all keep their current names and semantics.

Narrow `runPhaseBAndReport`'s `stillUpcoming` parameter from `readonly CorpusMatch[]` to
`readonly ScheduledMatchFacts[]` so the compiler proves fact 4 rather than a reviewer asserting
it. Follow the type through and fix nothing else — if any call site needs a field the narrowed
type lacks, STOP and report it: that is a real finding about the trim, not a typing nuisance to
paper over with a cast.

**5. `apps/worker/test/matchSplit.test.ts` (new).**

Build the fixture with a `tbaMatch(...)` helper modelled on the one in
`apps/worker/test/scheduled.rowParity.test.ts` (do not import from that file; a test fixture is
not an API). Roughly 100 matches: a played prefix, an upcoming tail, plus the ordering and
content rows the `<behavior>` block lists.

Drive both exported splits over that fixture at each of the five cursor positions and assert
deep equality of all three return members, plus the derived `lastFoldedMatchKey` and the sorted
touched-team array computed the way `processEvent` computes them. Assert the upcoming rows
match through `buildEventScheduledRow` as well as directly, since that is the shape that reaches
an artifact.

Count normalizes with a `vi.spyOn` on the normalize module (or a counting wrapper the split
accepts in tests — pick whichever keeps the production signature clean) and assert the trimmed
path's count equals `newlyFolded.length` while the reference path's equals the fixture size.
  </action>
  <verify>
    <automated>cd apps/worker &amp;&amp; npx vitest run test/matchSplit.test.ts &amp;&amp; npx vitest run &amp;&amp; npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>Both splits agree at every cursor position over the ~100-match fixture; the trimmed path normalizes only the matches past the cursor, proven by call count; `npx vitest run` from apps/worker is green including `scheduled.rowParity`, `scheduled.rp` and `scheduled.replay` unmodified; the worker typecheck is clean with `stillUpcoming` narrowed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The probe prices the two paths against each other in one pass</name>
  <files>apps/worker/src/stateProbe.ts, apps/worker/test/stateProbe.test.ts</files>
  <read_first>apps/worker/src/stateProbe.ts lines 1-70, 130-145, 160-230, 340-420, 1040-1120, 1360-1420, 2780-2800, apps/worker/src/matchSplit.ts (as written in task 1)</read_first>
  <behavior>
    - `resolveNormalizeArm(null)` reports the arm off; the probe's existing behaviour is untouched and no counter moves.
    - `resolveNormalizeArm("all")` and `resolveNormalizeArm("trim")` each resolve to their own arm id.
    - An unrecognized value resolves to REFUSED: the arm does not run, the response carries an error naming the rejected value, and neither arm is silently substituted.
    - `normalizeMatches` clamps to its ceiling; `normalizePlayed` clamps to at most `normalizeMatches`; `normalizeRounds` clamps to its ceiling; `normalizeCursor` accepts `start`, `middle`, `all` and a bare integer, and an unrecognized word is refused rather than defaulted.
    - Over the synthetic list, the `all` and `trim` arms report the same `newlyFoldedCount`, the same `upcomingCount`, the same `lastFoldedMatchKey`, the same `touchedTeamCount` and the same `identityFingerprint`.
    - The two arms report DIFFERENT `matchesNormalized` and `breakdownsStringified`, and the trim arm's `matchesNormalized` equals its `newlyFoldedCount`.
    - At `normalizeMatches=100`, `rawBytes` lands inside the realistic band the tick actually sees, and `bytesPerMatch` is reported.
    - A `normalize=` request reports `discovery.queries: 0`, an empty `algorithms` array and every fold counter at rest, with no fold error.
    - A `normalize=` request that also carries `phaseB=1` or `chunk=teams` runs the normalize arm and warns that the other params were parsed but not used.
    - `normalizeRounds=3` reports the same identity values as `normalizeRounds=1`.
  </behavior>
  <action>
Add a `normalize=` arm to the probe, following this file's own established conventions rather
than inventing new ones — read `resolvePhaseBArm` and the `chunk=teams` routing first and mirror
their shape, their doc-comment density and their echo discipline.

**Routing.** Resolve `normalize=` in `parseParams` and route it in the request handler BEFORE
the `chunk` check, before discovery, and without passing `env` on — the same placement and the
same reason as `chunk=teams` (fact 7). A measurement campaign on this arm must be incapable of
spending a D1 row.

**Params**, all echoed under `params`:
  - `normalize` — absent = arm off (the probe behaves exactly as it does today);
    `all` = the reference path; `trim` = the production path. Unrecognized = REFUSED with an
    error block, following the `phaseBVersionRejected` precedent, because a typo that silently
    measured the other path would be indistinguishable in the numbers from the arm you meant.
  - `normalizeMatches` — total synthetic matches. Default 100, clamped to a stated ceiling.
  - `normalizePlayed` — how many of them are played. Default 60. They occupy the ordered prefix.
  - `normalizeCursor` — `start` (nothing folded), `middle` (default: anchor two matches before
    the end of the played prefix, the realistic mid-event tick), `all` (anchor on the last played
    match, nothing newly folded), or a bare integer index.
  - `normalizeRounds` — how many times to repeat the split inside one invocation. Default 1,
    clamped to a stated ceiling.

**The synthetic body.** Build one raw TBA match list in the shape `tbaMatchListSchema` accepts,
deterministically, from the probe's existing `synthesizeBreakdown` extended with enough extra
numeric keys per side that the whole list's serialized size lands in the range a real event's
poll actually carries. Name the filler keys so they cannot collide with anything
`extractRp` or a season rule module reads, and pin the resulting byte range in a unit test
rather than a comment. Report `rawBytes` and `bytesPerMatch`.

The list is built ONCE per request, then `tbaMatchListSchema.parse` runs once — both arms pay
both, so they cancel in the difference exactly the way `playedRowFactsFor` cancels in every
Phase B difference. Say that in the doc comment, and say that this is precisely why
`normalizeRounds` repeats only the split: the shared term does not scale with rounds and the
term under test does.

**The measured region.** Per round, call the arm's split (`splitEventMatchesNormalizeAll` for
`all`, `splitEventMatches` for `trim` — imported from `matchSplit.ts`, the same module the tick
calls, never a copy), derive the touched-team array and `lastFoldedMatchKey` the way
`processEvent` does, and fold the result into a cheap running fingerprint over the ordered keys,
the newly-folded keys and the upcoming keys. Accumulate the fingerprint across rounds so no
round can be eliminated as dead code, and assert every round produced the same value.

**Counters**, in a `normalize` result block beside `fold`, `phaseB` and `chunk`, with a
`NORMALIZE_ZEROS` const spread into every early-return path the way `FOLD_ZEROS` and
`PHASE_B_ZEROS` are: `arm`, `rounds`, `matchesInList`, `matchesPlayed`, `cursorIndex`,
`rawBytes`, `bytesPerMatch`, `matchesNormalized`, `breakdownsStringified`, `newlyFoldedCount`,
`upcomingCount`, `lastFoldedMatchKey`, `touchedTeamCount`, `identityFingerprint`, optional
`error`.

`identityFingerprint` is the point of the block: two arms of one pass that disagree on it are
not a measurement, they are a bug in task 1, and a reader must be able to see that from the
response without re-running the unit test.

**Warnings**, on every `normalize=` response: the breakdown is synthetic and size-matched rather
than a real TBA body, so read the arm difference and never the absolute cpuTime; and, when
`phaseB`/`chunk`/`rp` params were also supplied, that they were parsed but not used.

Add the resolver and counter tests to `apps/worker/test/stateProbe.test.ts` alongside the
existing `resolveRpArm` / `resolvePhaseBArm` suites. Export whatever the tests need to call
directly, matching how the existing resolvers are exported.
  </action>
  <verify>
    <automated>cd apps/worker &amp;&amp; npx vitest run test/stateProbe.test.ts &amp;&amp; npx vitest run &amp;&amp; npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>`normalize=all` and `normalize=trim` return identical fingerprints and identical fold/upcoming/cursor/touched-team counters over the synthetic list while reporting different normalize counts; the arm reports zero discovery queries; an unrecognized value is refused, not defaulted; the whole worker suite and the worker typecheck are green.</done>
</task>

<task type="auto">
  <name>Task 3: Write the bar down before the number exists</name>
  <files>docs/worker-operations.md, .planning/todos/pending/tick-normalizes-every-match-every-tick.md, .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md</files>
  <read_first>docs/worker-operations.md lines 751-880, .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md lines 239-330</read_first>
  <action>
**1. `docs/worker-operations.md`, the "Pre-event probe" section.**

Add the five `normalize*` params to the existing param table, in the table's own voice.

Add a short subsection under it covering: what the arm prices (the per-match normalize and the
breakdown stringify in `processEvent`, nothing else); what it deliberately does not price (the
fold, Phase B, the artifact I/O); that the synthetic breakdown is size-matched rather than a
real TBA body, so only the arm difference is readable; that the arm reads zero D1 rows and
therefore needs neither `teams=` nor `event=` and cannot spend the daily row-read cap — with
`discovery.queries: 0` named as the thing to check in the response; and that `identityFingerprint`
must agree across the two arms of a pass or the pass is reporting a bug rather than a saving.

Repeat the section's existing ordering rule for this arm too: deploy the Worker, deploy the probe
from the SAME commit, then measure.

**2. `.planning/todos/pending/tick-normalizes-every-match-every-tick.md` — the pre-registered bar.**

Append a section titled so it is unmistakably pre-registration, dated 2026-09-21, stating that
no number exists yet. It must carry:

*The rig.* Interleave the two arms in one pass, 30 s spacing, at least 20 measured requests per
arm, analysing the reused-isolate stratum only. The measured query pair, differing in exactly
one character of the arm value:

```
GET /?normalize=all&normalizeMatches=100&normalizePlayed=60&normalizeCursor=middle&normalizeRounds=5
GET /?normalize=trim&normalizeMatches=100&normalizePlayed=60&normalizeCursor=middle&normalizeRounds=5
```

*The quantity.* `delta = mean(cpuTime | all) - mean(cpuTime | trim)` within one pass, and
`perTick = delta / 5`. Never an absolute cpuTime — cite the 2026-09-18 finding in
`rp-fold-exceeds-worker-cpu-budget.md` that this instrument cannot reproduce one to better than
about 5 ms, and that a bar leaning on absolutes was recorded unevaluable for exactly that reason.

*The validity gates*, all three required before the verdict is read:
  - every request's `normalize.identityFingerprint` is equal across both arms;
  - the linearity check — a second, shorter pass at `normalizeRounds=1` yields a delta
    consistent with `perTick`, which is what distinguishes a real per-match term from a
    per-invocation artifact;
  - the analyzer asserts unique `seq` values in the captured tail, per the 2026-09-18 trap.

*The verdict split:*
  - **WORKED** — `perTick >= 1.5 ms`, the 95% CI on `delta` excludes zero, and all three gates
    pass. Record the number in this todo and in `rp-fold-exceeds-worker-cpu-budget.md`, then
    close this todo.
  - **DID NOT WORK** — the CI on `delta` includes zero, or `perTick < 0.5 ms`. **The change is
    KEPT regardless** — it is output-identical, it removes a quadratic cursor scan and it narrows
    a type — but it is recorded as a non-term, and this line of attack on the CPU budget is
    closed rather than iterated on.
  - **INCONCLUSIVE** — `perTick` lands in `[0.5, 1.5)`, or a validity gate fails. A fingerprint
    disagreement is NOT an inconclusive measurement: it is a defect in the split, and the
    measurement stops until it is fixed. For the other cases, re-run once at
    `normalizeRounds=20`; if it is still inconclusive, record it unevaluable, keep the change on
    its non-CPU merits, and do not take a third pass.

*The commands*, exactly, noting that the executor cannot run them (no network) and that the
orchestrator runs them from the main context on a clean tree at the measured commit:

```bash
cd apps/worker
npx wrangler deploy                                 # the Worker
npx wrangler deploy --config wrangler.probe.toml    # the probe, SAME commit
npx wrangler tail sigmascout-state-probe --format json > normalize/tail.json
```

Add the tail-hygiene warning in this file too, since a copy-pasted command is what propagates
it: stop the tail by matching the process command line, not by the PID PowerShell returns for
`npx.cmd`, or an orphan keeps appending to its own file and a later re-read silently joins two
runs.

**3. `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`.**

Add one short entry to its list of terms recording that the per-match normalize term now has an
instrument and a pre-registered bar, with a pointer to this todo. Do not restate the bar and do
not claim a result.

**4. No version bump, and the proof.** State in both todos that no algorithm version moves and
no republish is owed, and name the evidence: `matchSplit.test.ts` proves the folded set, its
normalized contents, the cursor anchor and the upcoming rows are unchanged, and the existing
`scheduled.rowParity` / `scheduled.rp` / `scheduled.replay` suites pass unmodified. Changed
published numbers require a new version; unchanged ones do not, and this is the test that tells
the two apart.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run &amp;&amp; [ "$(grep -v '^\s*[/*]' apps/worker/src/scheduled.ts | grep -c 'rawMatches.map((m) => normalizeMatch')" = "0" ] &amp;&amp; git diff --stat -- packages/core apps/web</automated>
  </verify>
  <done>The probe docs describe the arm and its caveats; the todo carries a dated, pre-registered bar with the exact queries, the three validity gates and a three-way verdict split; the CPU todo cross-references it without claiming a result; the repo-root suite is green and the diff touches no algorithm or web code.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA response to Worker | Third-party JSON crosses here. `tbaMatchListSchema.parse` is the boundary check and this plan moves work AFTER it, never before it. |
| Worker fold state to published artifact | The cursor decides what is folded exactly once. A split that disagrees with the offline publisher's order corrupts state silently. |
| Public probe endpoint to the internet | `sigmascout-state-probe` is unauthenticated; the new arm adds a query-controlled workload to it. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-vzf-01 | Tampering | `splitEventMatches` vs the cursor contract | high | mitigate | A split that reorders or mis-classifies one match drops or double-applies a fold into live D1. Mitigated by keeping `compareCorpusMatchOrder` and `hasAlreadyFolded` as the one definition each, routing both the tick and the new one-shot cutoff through `foldedCutoffIndex`, and diffing the production path against the retained reference implementation at five cursor positions over a fixture built to make ordering decide. |
| T-vzf-02 | Tampering | the `played` predicate replacing the `winner !== null` test | high | mitigate | If the two ever disagree, a played match is silently treated as upcoming and never folded. Mitigated by an explicit equivalence test in `normalize.test.ts` and a doc comment on `matchOrderFacts` naming it. |
| T-vzf-03 | Denial of Service | `normalize=` probe arm, query-controlled workload | medium | mitigate | `normalizeMatches`, `normalizePlayed` and `normalizeRounds` are each clamped to a stated ceiling, so no query string can price unboundedly much work — the same treatment `folded`/`upcoming` already get via `MAX_FOLDED_PLUS_UPCOMING`. |
| T-vzf-04 | Denial of Service | D1 daily row-read cap, account-wide | medium | mitigate | A measurement campaign that spends the cap fails live ticks too. Mitigated structurally: the arm is routed before discovery and never handed the binding, so it reads zero rows; `discovery.queries: 0` is the documented check. |
| T-vzf-05 | Information Disclosure | probe response and new warnings | low | accept | The arm's data is wholly synthetic and built in-process; it echoes only counters, clamped params and a fingerprint. No TBA key, no header and no live match data can reach the response. |
| T-vzf-06 | Repudiation | a measurement reported without its arm | low | mitigate | `params.normalize` and the whole `normalize` counter block are echoed on every response, so a `cpuTime` can never be attributed to the arm it was not measured under — the file's standing echo discipline. |

No package-manager install is performed by this plan, so no legitimacy checkpoint applies.
</threat_model>

<verification>
- `cd apps/worker && npx vitest run` — green, judged by printed output, never by exit code alone.
- `cd C:/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run` — the repo-root suite (the 167-file scope, not the 77-file `apps/web` one).
- `cd apps/worker && npx tsc --noEmit -p tsconfig.json` — the worker tsconfig specifically; a clean root `tsc` does not cover it.
- Never `timeout ... pnpm`; `timeout` swallows the output this plan is judged by.
- `git diff --stat -- packages/core apps/web` is empty: no algorithm and no client code changes.
- No deploy, no push, no publish, no seed. The executor has no network; the orchestrator runs the measurement afterwards.
- Stage by explicit path only — another session holds uncommitted work under `.planning/sketches/`.
</verification>

<success_criteria>
- The tick runs the full normalize only on matches past the cursor, and the count is asserted, not argued.
- The trimmed and reference paths are deep-equal on order, folded set and contents, cursor anchor, touched teams and upcoming rows at five cursor positions over a ~100-match fixture.
- `hasAlreadyFolded` keeps its exact behaviour while the anchor is located once per tick.
- The zod parse is unchanged and the reason is written down where the todo's reader will find it.
- The probe answers both arms with matching identity counters and differing normalize counts, reading zero D1 rows.
- The bar is pre-registered as a within-run arm difference with three validity gates and a WORKED / DID NOT WORK / INCONCLUSIVE split, before any number exists.
</success_criteria>

<output>
Create `.planning/quick/260921-vzf-trim-the-worker-tick-s-per-match-normali/260921-vzf-SUMMARY.md` when done.
</output>
