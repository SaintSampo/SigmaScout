---
phase: quick-260917-mwu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
  - scripts/measureReplayParity.ts
  - scripts/measureReplayParity.test.ts
  - scripts/browserFoldEntry.ts
  - scripts/measureEngineDeterminism.ts
  - scripts/measureEngineDeterminism.test.ts
autonomous: true
requirements: [QT-260917-mwu-A, QT-260917-mwu-B]
user_setup:
  - service: playwright-firefox
    why: "Half B needs a third JS engine (SpiderMonkey). Firefox is NOT in the local Playwright browser cache and the executor has no network."
    dashboard_config:
      - task: "npx playwright install firefox (run from apps/web, @playwright/test 1.62.1)"
        location: "orchestrator's shell, main context — the executor sandbox denies network"

estimate:
  tokens: 130000
  raw_tokens: 65000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A pre-registration section naming the bar exists in the todo and is COMMITTED before the instrument produces its first number."
    - "Arm C (in-process control) reproduces publish.ts's published rows for each chosen event exactly, or the pass is discarded rather than interpreted."
    - "Every field where the from-state-block replay differs from the published row is named as data with an attribution from a pre-registered taxonomy."
    - "The browser harness executes the REAL bundled modules, provably, not a re-implementation."
    - "A missing browser engine is reported as missing, never absorbed into an identical verdict."
    - "The experiment publishes nothing, deploys nothing, signs no request and reads no environment variable."
  artifacts:
    - scripts/measureReplayParity.ts
    - scripts/measureReplayParity.test.ts
    - scripts/browserFoldEntry.ts
    - scripts/measureEngineDeterminism.ts
    - scripts/measureEngineDeterminism.test.ts
    - .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
  key_links:
    - "publishSeasons(dryRun, artifactSink) -> the published rows the parity bar is taken against"
    - "seedStateRows passenger chain -> buildEventStateBlock -> EventStateBlockSchema.parse -> the replayed fold"
    - "esbuild IIFE bundle of the real modules -> page.addScriptTag -> page.evaluate -> IEEE-754 digest"
---

<objective>
Answer two gating questions for the relay architecture, by measurement, and record
the answers against a bar written down before any number exists.

**Half A.** For a set of finished 2026 events: can a browser-safe fold, starting
from the pre-event state block the publisher would ship and replaying only that
event's own matches in order (predict BEFORE update), reproduce `publish.ts`'s
published rows exactly, at the shipped rounding rule?

**Half B.** Is that fold bit-identical across JavaScript engines? `spr.ts` and
the RP marginals path both call `Math.exp`/`Math.log`/`Math.log1p`, which IEEE-754
does not specify to the last bit. If V8, JavaScriptCore and SpiderMonkey differ,
two visitors on different browsers see different ratings.

Purpose: this decides whether the Worker can become a relay. It MEASURES ONLY —
it changes no shipped behavior, publishes nothing, deploys nothing, builds no
relay.

Output: two verdicts against pre-registered bars, plus a written recommendation,
recorded in `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

The four source modules the fold is made of, and the one existing test that
already proves half of it for PRICING (never for FOLDING):

@packages/core/algorithms/spr.ts
@packages/harness/sigmaScoutLayer.ts
@packages/harness/publishedRows.ts
@packages/harness/eventStatePricing.parity.test.ts

The two safety precedents to copy rather than reinvent:

@scripts/priceFrozenEventRow.ts
@scripts/priceFrozenEventRow.test.ts
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Pre-register the bar, then one event end to end in Node</name>
  <files>.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md, scripts/measureReplayParity.ts, scripts/measureReplayParity.test.ts</files>
  <precondition>`data/corpus.sqlite` opens read-only and holds season 2026 (319 events, 2026nyro with 99 played qualification and playoff matches). `better-sqlite3` loads from the repo root — it does not need rebuilding here.</precondition>
  <action>
Do these in order. The order is the point: a bar written after seeing a number is not a bar.

STEP 1 — capture the known-red baseline, before touching anything. Run the repo suite
from the REPO ROOT and record the exact failing-file list and counts into the SUMMARY.
`packages/harness/level1Digest.test.ts` is expected red and is NOT ours: another session
bumped SPR to 5.0.0 without regenerating `data/baselines/level1-digest-2026-09.json`. Do
not fix it, do not touch it, do not regenerate the baseline. Record it so a later "one
failed" cannot be misread as this task's doing. If anything OTHER than that file is
already red, record that too and carry it as baseline.

STEP 2 — pre-register the bar, and COMMIT it, before the instrument produces a number.
Append to `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` a section headed
`## REPLAY PARITY — the bar, pre-registered BEFORE any number (2026-09-17, quick task 260917-mwu)`,
following the house style the todo's two existing pre-registration sections already use
(`LIVE METRIC SIDECAR` and `FROZEN-METRICS EVENT ROW`): state plainly that the section
contains no number produced by this change. It must state, in advance:

  - The three arms and what each one is for (below).
  - The VALIDITY GATE: if arm C is not exact, the pass is discarded, not interpreted.
  - The compared field set and the named exceptions already known before a byte is measured.
  - The attribution taxonomy every mismatching field must be assigned to.
  - IT WORKED / IT DID NOT WORK / INCONCLUSIVE, as three disjoint sets.
  - Half B's bar (Task 3 fills in the engine list actually available; the bar itself is fixed here).
  - The known-red baseline from step 1, named, so a reader cannot mistake it for a result.

The three arms:

  - Arm P, published truth. The real `publishSeasons` over the local corpus with
    `dryRun: true`, `skipState: true`, `includeOffseason: true`, `preScheduleFromSeason: 9999`,
    `algorithms: resolvePublishAlgorithms("spr")`, seasons `[2025, 2026]` (2025 present only as
    warm-up, so 2026 crosses a real season boundary — the arm-B precedent in this same todo),
    a fixed non-UUID marker generation and a fixed `computedAt`, reading every body through
    `publish.ts`'s inert `artifactSink`. This is the ground truth every difference is taken against.
  - Arm C, in-process control and the validity gate. Reproduce `publishSeasons`'s two-pass
    structure directly: `buildSeasonStream` + `WalkForwardSimulator.runAll` with an
    `onMatchComplete` that captures each match's post-update `teamMetrics` and the Sigma talent
    map exactly as `publish.ts` does, then a second chronological pass of
    `SigmaScoutLayer.foldPlayed` over the returned records. Build the target event's rows through
    the same `eventPlayedRow` / `teamSeasonPlayedRow` builders with the same `sortTime`,
    `video` and `actualBonusFlags` lookups. Compare to arm P. Arm C answers only one
    question: is this harness an honest stand-in for the publisher? If it is not exact, nothing
    downstream means anything.
  - Arm R, the replay under test. At the instant before the target event's first match in that
    same pass, build the pre-event state block. Use the publisher's own passenger chain, in the
    publisher's order — `serializeState`, then `withSigmaBeliefs`, `withRpBeliefs`,
    `withSigmaPopulation`, `withRpMeanShift` — then the EXISTING builder
    `buildEventStateBlock(rows, rosterKeys)` over every team key on the event's played and
    upcoming matches, then through the wire exactly as `eventStatePricing.parity.test.ts` sends
    it: `JSON.stringify`, `JSON.parse`, `EventStateBlockSchema.parse`. Only that wire copy is
    replayed. Then fold ONLY that event's own matches, in `sortTime` order, through the
    browser-safe path: `spr.predict` for the row, then `SigmaScoutLayer.foldPlayed`, then
    `spr.update`, then `spr.teamMetrics` for the post-match metrics — predict before update,
    per match, no exceptions. Build rows through the same `publishedRows.ts` builders.

`sigmaBeliefs()` and `rpVariableBeliefs()` hand back references into the live accumulator, so
a mid-stream capture must deep-copy them at the capture instant or the block will silently
carry end-of-season values. Copy them; do not hold the reference.

The attribution taxonomy. Every field that differs gets exactly one of:
  - WIRE — the state block round-trip does not carry it (a passenger is missing or lossy).
  - INTERLEAVE — a league-scoped quantity moved on OTHER events' matches between this event's
    first and last. `spr.ts`'s own header says `scale` is a ~100-match trailing EWMA over the
    globally interleaved match stream; `logTau`, the Sigma population and the RP mean shift are
    league-scoped in the same way. A browser that sees one event cannot see those steps.
  - POPULATION — needs a season-wide ranking pool that one event does not contain.
  - ENGINE — a transcendental difference; Half B's question, not Half A's.
  - BUG — none of the above, i.e. a real defect this experiment found.

Known exceptions, stated before measuring rather than discovered after: a metric-history row's
`metrics[key].percentile` and the published Sigma tier come from season-wide pools
(`withHistoryPercentiles` against `rankingPools`, and `sigmaMetric.ts`'s within-window detrended
mid-rank). Neither is derivable from one event's files. They are POPULATION by construction and
are excluded from the exact-equality set, named here rather than dropped quietly. If the
exception list grows past these two plus one or two well-understood entries, say so — that is
itself the finding.

STEP 3 — build `scripts/measureReplayParity.ts`, and run it on ONE event: `2026nyro`
(Finger Lakes Regional, event_type 0, 99 played, week 1). One event, all three arms,
event-artifact played rows only — the team-season and metric-history field sets come in
Task 2. Copy `scripts/priceFrozenEventRow.ts`'s safety construction exactly: no import of
`packages/harness/r2Client.ts`, no S3 or signing SDK, no `fetch`, no environment variable read
(so it never needs and must never be given `--env-file`), `skipState: true` so no seed SQL is
written, `--write-budget` never passed. Write the machine-readable report to
`reports/replay-parity/` (already gitignored) and print a console table beside it.

Comparison is exact. Use `toStrictEqual`-grade equality on the parsed row objects — key presence
included, since an absent key and an explicit `null` are different published claims throughout
this codebase. No tolerance, anywhere, for any field.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureReplayParity.test.ts --reporter=verbose</automated>
    <automated>npx tsx scripts/measureReplayParity.ts --events 2026nyro</automated>
  </verify>
  <done>The pre-registration section is committed and its commit precedes the instrument's first run. `scripts/measureReplayParity.test.ts` passes and covers: the static safety scan (no r2Client, no signing SDK, no fetch, no env read), the passenger-chain deep-copy, and the row comparator's key-presence strictness. The instrument runs on 2026nyro and prints arm C's verdict (exact or discarded) and arm R's field-by-field result with every difference attributed.</done>
</task>

<task type="auto">
  <name>Task 2: All three events, the full field set, and Half A's verdict</name>
  <files>scripts/measureReplayParity.ts, scripts/measureReplayParity.test.ts, .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md</files>
  <action>
Extend the instrument to the full compared field set and the three chosen events, then
record Half A's verdict against the bar Task 1 committed.

The events, and why each was chosen — record these reasons in the report and the todo:

  - `2026arc` (Archimedes Division, event_type 3, 141 played). The large championship
    division. It is the maximum INTERLEAVE stress in the corpus: seven sister divisions
    (`2026dal`, `2026gal`, `2026hop`, `2026joh`, `2026new`, `2026cur`, `2026mil`) run
    concurrently at 139-140 played matches each, so roughly a thousand other matches step the
    league-scoped quantities between this event's first and last match. It also has the largest
    roster, so the block carries the most team rows.
  - `2026nyro` (Finger Lakes Regional, event_type 0, 99 played, week 1). The regional, and
    deliberately the earliest one: at week 1 `scale`, `scaleCount` and `logTau` are least
    converged and moving fastest, and cold-start rows are most likely, so any WIRE loss in the
    league row shows up here at its largest.
  - `2026auwarp` (West Australian Robotics Playoffs, event_type 99, offseason, 65 played). The
    demo/offseason quirk event: 64 of its 65 played matches carry at least one Off-Season Demo
    Team slot (233 demo slots) and 29 have a fully-demo alliance, which `spr.update` skips
    outright. It exercises `isFullyDemoAlliance`, `remapDemoTeams`, `DEMO_PSEUDO_TEAM_KEY`'s
    membership in `stateBlockScopeKeys`, and an RP-INELIGIBLE event type — `event_type` 99 has
    no `EVENT_TYPE_TIERS` entry, so no RP field is produced at all and the RP half of the
    comparison is vacuous there. Say that in the report rather than letting three green RP
    columns imply RP was tested.

The full compared field set, all at the shipped rounding rule:

  - Event artifact played rows: `predictedWinner`, `pRedWin`, `predictedRedScore`,
    `predictedBlueScore`, `redScoreVarianceOwn`, `blueScoreVarianceOwn`,
    `redMatchBandVariance`, `blueMatchBandVariance`, `redRpPmf`, `blueRpPmf`,
    `matchOutcomePmf`, `redBonusRpPmf`, `blueBonusRpPmf`, `redBonusRp`, `blueBonusRp`,
    `actualRedBonusRp`, `actualBlueBonusRp`, `coldStart`, and the corpus-passthrough
    `actualWinner`/`actualRedScore`/`actualBlueScore`/`actualRedRp`/`actualBlueRp` (kept in
    the set precisely because they should be trivially equal — a difference there is a
    plumbing bug worth catching).
  - Team-season artifact match rows for every team on that event's roster, restricted to that
    event's matches: the same fields plus `variance` and the identity stamps.
  - Metric-history rows for those teams at that event: `metrics[key].value`,
    `metrics[key].spread`, and `metrics.sigma.value` — the values the metric-history chart
    plots. `percentile` and the Sigma tier stay out, as POPULATION, per Task 1's
    pre-registration.

Report per event and per field: identical or not; if not, the count of differing rows, the
largest absolute difference, whether the difference survives `roundTo` at `ROUNDING_RULE`, the
first diverging match key, and the attribution. Report the per-match trajectory of the first
diverging field too — whether the difference is present at match 1 or appears later and grows
tells INTERLEAVE apart from WIRE without a separate arm.

Add one conditional diagnostic, run ONLY for fields arm R fails: arm R', identical to arm R
except that the pre-event state is handed over as the in-process object rather than through
`buildEventStateBlock` and the wire. Arm R' isolates serialization-and-roster-filter (WIRE)
from everything else: a field that arm R' also fails is not a serialization loss.

Then write the verdict into the todo under a new section, `## REPLAY PARITY — the numbers`,
judged against Task 1's committed bar and nothing else. State the verdict first. If the result
falls between the two sets, report it as INCONCLUSIVE and name what would resolve it; do not
report an inconclusive pass as a win.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureReplayParity.test.ts --reporter=verbose</automated>
    <automated>npx tsx scripts/measureReplayParity.ts --events 2026arc,2026nyro,2026auwarp</automated>
  </verify>
  <done>All three events run. Arm C's gate result is stated for each. Every field in the compared set is either exactly equal or carries an attribution from the pre-registered taxonomy with its magnitude and its survival-under-rounding. Half A's verdict is recorded in the todo against the committed bar.</done>
</task>

<task type="auto">
  <name>Task 3: Cross-engine determinism in real browsers, and the recommendation</name>
  <files>scripts/browserFoldEntry.ts, scripts/measureEngineDeterminism.ts, scripts/measureEngineDeterminism.test.ts, .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md</files>
  <precondition>The local Playwright browser cache (`%LOCALAPPDATA%\ms-playwright`) holds `chromium-1234` and `webkit-2336` but NO `firefox-*` build, and the executor has no network. Run whatever is present; never let an absent engine be absorbed into an "identical" verdict.</precondition>
  <action>
Run the SAME replay Task 2 ran, inside real browser engines, and compare digests.

Which transcendentals are actually at risk, established by reading rather than assumed —
put this enumeration in the report, because it is what makes the result interpretable:
`spr.ts` calls `Math.exp` four times (`normPdf`, its Abramowitz-Stegun `erf`, and
`Math.exp(state.logTau)` in both `predict` and `update`), `Math.log` four times (the `tau0`
seed in `initState`/`carrySeason` and the two clamp bounds in `update`), `Math.sqrt` six times,
and `x ** 2` six times; `packages/core/rankingPoints/marginals.ts`, reached through
`analyticRpPmf`, is heavier still with fifteen `Math.log`, six `Math.exp`, one `Math.log1p`,
four `Math.sqrt` and its own `erf`. `Math.sqrt` is correctly rounded by IEEE-754 and is
therefore bit-identical everywhere; `Math.exp`, `Math.log` and `Math.log1p` are not specified
to the last bit and are where engines are known to differ. Enumerate these mechanically over
the bundle's actual import graph rather than trusting this list.

Why folding is a harder test than the pricing parity already shipped: `logTau` is a RUNNING
accumulator stepped once per folded match, so a one-ulp difference in `Math.exp(logTau)` feeds
`pRed`, feeds `grad`, feeds the next match's `logTau`. Differences compound across the fold
instead of staying put. A clean cross-engine result for `priceUpcomingFromState` would not
transfer, which is why this measurement exists.

Build the harness so it provably runs the REAL modules:

  - `scripts/browserFoldEntry.ts` — a thin entry that imports the real `spr.ts`,
    `sigmaScoutLayer.ts`, `stateSnapshot.ts`, `sigmaScore.ts`, `publishedRows.ts` and the real
    2026 rule module, and exposes one function taking the serialized pre-event block and the
    event's match stream and returning both the FULL UNROUNDED intermediate values and the
    rounded published-shape rows. It re-implements nothing.
  - Bundle it with the repo's own `esbuild` (`node_modules/.bin/esbuild`) as a single
    `--format=iife --platform=browser` file into `reports/replay-parity/`. Chosen over the dev
    server and over the app's own lazy chunk for three reasons, stated in the file header: the
    executor has no network and no server, `about:blank` imposes no CSP or module-resolution
    problem, and a bundle built from those exact source paths is checkable — assert the built
    bundle contains a distinctive marker string from each source module, so a silently empty or
    tree-shaken bundle fails loudly instead of measuring nothing.
  - Drive it with Playwright directly (`chromium`, `webkit`, `firefox` from `@playwright/test`,
    version 1.62.1 in `apps/web`), NOT through `apps/web/playwright.config.ts` — that config's
    projects all point at the deployed `https://sigmascout.org` origin and start a `webServer`,
    both wrong and both needing network here. Per engine: launch, `page.goto("about:blank")`,
    `page.addScriptTag({ content: <bundle> })`, `page.evaluate` the fold, read the result back.
  - Include Node's own V8 as a fourth arm. Node-V8 against Chromium-V8 is a free control: if
    those two disagree, the harness is wrong, not the engines.

Digest the full unrounded output losslessly: emit every float as its IEEE-754 bit pattern
(`DataView.getBigUint64` over a `Float64Array` view) and hash the canonical sequence. A decimal
rendering would hide exactly the last-bit difference this task exists to find. Digest the
rounded published-shape rows separately.

Report: identical or not, per engine pair, for both digests. If not identical, the magnitude of
the largest divergence, its ulp distance, the first diverging match, and whether it survives the
publisher's rounding rule — `ROUNDING_RULE.probability` is 4 decimals, `metric` and `score` 2,
`variance` 4, `pmf` 5. Rounding may absorb it; that is the question, not the assumption, so
measure the answer and also report how close the nearest surviving value came to a rounding
boundary.

Firefox: it is not installed and cannot be installed without network. Run Chromium, WebKit and
Node, report the SpiderMonkey arm as NOT RUN with the reason, and hand the orchestrator the
exact command — `npx playwright install firefox`, from `apps/web` — plus the single command
that adds the arm once it exists. The script must detect the missing executable and say so in
its output; a two-engine agreement reported as three would be the worst possible outcome here.

Finally, write into the todo, under `## REPLAY PARITY — the numbers`, Half B's verdict and then
a written recommendation on whether the relay architecture is viable on this evidence, drawing
on both halves. Name what the evidence does NOT say as carefully as what it does. Do NOT start
building the relay.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureEngineDeterminism.test.ts --reporter=verbose</automated>
    <automated>npx tsx scripts/measureEngineDeterminism.ts --events 2026nyro</automated>
  </verify>
  <done>The bundle is built and its per-module markers are asserted. Chromium, WebKit and Node arms run and their unrounded and rounded digests are compared pairwise. Firefox is reported as NOT RUN with the reason and the exact command to add it. Both verdicts and the recommendation are recorded in the todo.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo -> transcript | `.env` holds the live TBA key and the R2 token pair; rendering it into any output stream is the documented Phase-4 failure |
| repo -> R2 / network | `publishSeasons` can sign and upload; this task must never reach that path |
| corpus -> instrument | `data/corpus.sqlite` is opened read-only; a write would corrupt shared state other sessions depend on |
| bundle -> browser page | an esbuild bundle evaluated in a real browser engine |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mwu-01 | Information disclosure | `.env` secrets reaching a subagent transcript | critical | mitigate | The instruments read no environment variable and are never invoked with `--env-file`; `measureReplayParity.test.ts` scans their source for env access, mirroring `priceFrozenEventRow.test.ts`. Never `Read`, `cat` or echo `.env`. |
| T-mwu-02 | Tampering | an accidental real publish or R2 write | high | mitigate | `dryRun: true` and `skipState: true`, no `r2Client.ts` import, no signing SDK, no `fetch`, `--write-budget` never passed, and a fixed non-UUID marker generation that could not be mistaken for a real one. Asserted by the static scan, not by care. |
| T-mwu-03 | Tampering | corpus mutation | medium | mitigate | `openCorpusReadOnly` only; no write statement anywhere in either instrument. |
| T-mwu-04 | Spoofing | an empty or tree-shaken browser bundle measuring nothing and reporting agreement | high | mitigate | The bundle must contain a distinctive marker from each source module, asserted before any engine runs. |
| T-mwu-05 | Repudiation | a bar chosen after seeing its own numbers | high | mitigate | The pre-registration section is committed in Task 1 step 2, before the instrument's first run, and the two commits are ordered. |
| T-mwu-06 | Information disclosure | a missing engine silently absorbed into an "identical across three engines" claim | high | mitigate | The engine arm detects the missing executable, reports NOT RUN with the reason, and names the command that would add it. |
| T-mwu-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package is installed. Every tool used — `esbuild`, `@playwright/test`, `tsx`, `vitest`, `better-sqlite3` — is already in `node_modules`. The one network action (`npx playwright install firefox`) downloads a browser build, not a package, and is handed to the orchestrator rather than taken here. |
</threat_model>

<verification>
Run from the REPO ROOT, never from `apps/web` — a run scoped to `apps/web` sees 77 test files
against the root's 167 and has hidden a red suite here before.

```
npx vitest run
npx tsc --noEmit
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json
```

Verify by OUTPUT, not by exit code, and never wrap these in `timeout` — `timeout <n> pnpm <cmd>`
swallows all output and exits 0 on this machine.

`packages/harness/level1Digest.test.ts` is expected RED and is not ours: another session bumped
SPR to 5.0.0 without regenerating `data/baselines/level1-digest-2026-09.json`. Do not fix or touch
it. Task 1 step 1 records the exact baseline so a "one failed" result at the end is measured
against it rather than misread.

Stage by explicit path only. Another session shares this checkout, and a `git add -A` here has
absorbed foreign edits before. No CRLF in any new file. Every mutation this task makes outside the
six files listed in `files_modified` is reverted before the final commit.
</verification>

<success_criteria>
- The pre-registration commit precedes the first measurement commit in `git log`.
- Arm C's exactness is stated per event; where it fails, the pass is reported as discarded.
- Every compared field is either exactly equal or attributed, with magnitude and survival-under-rounding.
- Half B reports per-engine-pair digest agreement for both the unrounded and the rounded output, with Firefox named as NOT RUN and the command to add it.
- Both verdicts and a written recommendation are in `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`.
- No relay code exists. Nothing was published, deployed or uploaded.
</success_criteria>

<output>
Create `.planning/quick/260917-mwu-replay-parity-can-the-browser-fold-repro/260917-mwu-SUMMARY.md` when done.
</output>
