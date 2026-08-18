---
phase: quick-260818-inm
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - packages/core/algorithms/breakdown/index.ts
  - packages/core/algorithms/types.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/epa.ts
  - packages/harness/cli.ts
  - packages/core/algorithms/breakdown/breakdown.test.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/carryover.test.ts
  - .planning/WINDOWS.md
autonomous: true
requirements:
  - T-03-18b
  - WINDOWS-4
  - WINDOWS-5

estimate:
  tokens: 95000
  raw_tokens: 63000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "`pnpm harness --season 2024 --algorithm sigma1 --include-offseason` runs to completion and exits 0 (WINDOWS #4)."
    - "`pnpm harness --event 2024wvrox --algorithm sigma1` runs to completion and exits 0 (WINDOWS #5)."
    - "A score_breakdown that is present but fails its season Zod schema degrades to the existing D-05 fallback path with inflated measurement noise — never a silent drop, never a coerced zero."
    - "Every such degradation is counted on algorithm state and printed by the harness CLI for both the --season and --event paths."
    - "An error that is NOT a schema/JSON parse failure (an unmapped season, a non-finite assertion, any future non-Zod defect in a season module) still propagates and aborts the run loudly (T-03-21)."
    - "Both committed `predictionStreamSha256` values in `data/algorithm-versions/` reproduce bitwise — the guard is provably inert on the 2022 official-event digest slices (T-03-19 / SC-5)."
  artifacts:
    - "`tryParseBreakdownPair` + `isRecoverableBreakdownParseError` exported from `packages/core/algorithms/breakdown/index.ts`"
    - "`BreakdownParseTelemetry` + `breakdownParseFailureCountOf` exported from `packages/core/algorithms/types.ts`"
    - "`breakdownParseFailureCount` field on `Sigma1State` and `EpaState`"
    - "`reportBreakdownParseFailures` in `packages/harness/cli.ts`, called from both `runSeason` and `runEventMode`"
    - "Regression suites with positive controls in `breakdown.test.ts`, `sigma1.test.ts`, `epa.test.ts`"
    - "`.planning/WINDOWS.md` entries 4 and 5 in a terminal, non-open status with a recorded reason"
  key_links:
    - "`sigma1/index.ts` update() -> `tryParseBreakdownPair` -> `usedFallback` -> `FALLBACK_NOISE_MULTIPLIER` + `fallbackObserved` (the already-tested null path)"
    - "`epa.ts` update() -> `tryParseBreakdownPair` -> `fallbackObserved` (identical shape, `fallbackSkipped` untouched)"
    - "`WalkForwardSimulator.runAll().finalStates` -> `breakdownParseFailureCountOf` -> `reportBreakdownParseFailures` (the surfacing path for both CLI modes)"
  prohibitions:
    - "No season breakdown schema field may become `.optional()` or otherwise be weakened (`breakdown/2022.ts` through `breakdown/2026.ts`)."
    - "No catch broad enough to swallow a non-parse exception."
    - "`.planning/phases/03-tuning-ranking-points-versioning/03-SECURITY.md` is not modified by this plan."
    - "A moved `predictionStreamSha256` is fixed in the guard, never by re-promoting or refreshing a fixture."
    - "No file under `data/algorithm-versions/` or `packages/harness/fixtures/` is modified."
---

<objective>
Close security threat **T-03-18b** (high, the only open threat blocking phase 3): an unconditional
Zod parse of third-party `score_breakdown` JSON aborts the entire harness batch when it meets
self-reported offseason data.

`parseBreakdown()` is called unguarded at `packages/core/algorithms/sigma1/index.ts:735-736` and
`packages/core/algorithms/epa.ts:432-433`. `packages/harness/replay.ts:117-119` and `:161-163` call
`predict`/`update` with no `try`/`catch`, so one throw kills every season and every algorithm in the
run. Measured against the live corpus during the phase-03 security audit: **1,004 of 4,757** 2024
offseason matches carrying a breakdown (**21.1%**) fail the parse; `2024wvrox_sf1m1` throws with
**20** Zod issues, `2024cafb_qm1` with 2 (`red.adjustPoints`, `blue.adjustPoints`).

Purpose: restore the availability property T-03-18b asserts — *`update()` does not abort the harness
on untrusted corpus data* — without weakening any integrity control, and unblock `/gsd-secure-phase 3`.

Output: a narrow, shared, counted guard mirroring the codebase's own precedent at
`packages/harness/identifiability.ts:239-249`; both WINDOWS.md #4/#5 commands exiting 0; both
committed prediction-stream digests still reproducing bitwise.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/WINDOWS.md
@.planning/phases/03-tuning-ranking-points-versioning/03-SECURITY.md

@packages/harness/identifiability.ts
@packages/core/algorithms/breakdown/index.ts
@packages/core/algorithms/breakdown/constants.ts
@packages/core/algorithms/breakdown/2024.ts
@packages/core/algorithms/types.ts
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/epa.ts
@packages/harness/cli.ts
@packages/harness/replay.ts
@packages/core/algorithms/sigma1/sigma1.test.ts
</context>

<design_decisions>

Two decisions the brief demanded be made deliberately and recorded rather than by reflex. Both must
also appear as source comments at the code they govern, not only here.

## D-Q1 — ONE shared helper, both call sites, parsing the two alliances as a PAIR

`sigma1/index.ts:735-736` and `epa.ts:432-433` are textually identical two-line pairs feeding an
identical `redParsed ?? fallbackObserved(...)` shape. The part that must never drift between them is
precisely the narrow-catch classification (D-Q3). Duplicating that in two files is how the two copies
eventually disagree. One helper, `tryParseBreakdownPair(season, scoreBreakdownRaw)`, lives beside
`parseBreakdown` in `breakdown/index.ts`.

`parseBreakdown` itself is **not** changed. `identifiability.ts:239-249` and
`breakdown/reconciliation.test.ts` deliberately want the loud version, and a guard installed inside
`parseBreakdown` would silently degrade every caller including a genuinely broken season module.

Parsing both sides in one call is exactly equivalent to today's behavior, not a semantic change:
each season map's `parse` validates the WHOLE payload (`Breakdown2024Schema.parse(rawBreakdownJson)`
covers `red` and `blue` together) before selecting `side`, so the two sides already succeed or fail
together. Pairing removes a duplicated `JSON.parse` of the same string and makes it structurally
impossible for a future season map to produce a half-parsed / half-imputed alliance vector with no
noise inflation.

## D-Q2 — A SEPARATE counter, `breakdownParseFailureCount`, on both states

Plan 03-07 shared one `rpSkippedMatchCount` because both of its skip reasons meant the same thing
("RP fold skipped") *and* had the same expected magnitude. Neither holds here, so the same reasoning
points the other way:

1. **Different event, different data, different consequence.** The RP-side skip is a ranking-point
   bookkeeping event. This is a score-side observation-quality event that changes how the Kalman
   measurement is formed.
2. **Rate separation is the entire diagnostic value.** `rpSkippedMatchCount`'s documented population
   (breakdown absent) is 0.00%–0.12% across 2022–2026. The new population (breakdown present, fails
   its schema) is 21.1% of 2024 offseason matches carrying one. Folding a 21% anomaly into a counter
   whose documented expectation is ~0.1% destroys the signal in both numbers.
3. **Nothing is lost by adding it.** A malformed breakdown sets `usedFallback`, so
   `rpSkippedMatchCount` *still* increments through the existing `if (usedFallback || ...)` branch.
   The two counters deliberately overlap: one records the **effect** (RP fold skipped), the new one
   the **cause** (score breakdown failed its schema). Say exactly that in the source comment.
4. **EPA's `fallbackSkipped` must not be reused.** It is a permanently-zero, test-asserted invariant
   (`breakdown.test.ts:181-204`) meaning "a breakdown-less match reached a code path that dropped
   it." Incrementing it would flip a green invariant test red and silently redefine the field.
5. **The versioned-shape cost is bounded and mechanical**: 14 hand-written state literals (3
   `Sigma1State`, 11 `EpaState`) plus two `carrySeason` returns, all enforced by `tsc --noEmit`. No
   persisted artifact carries algorithm state — `data/algorithm-versions/*.json` records params and
   digests, never state — so there is no on-disk schema to version.
6. **Identical field name on both states** is what lets one CLI reader print both without
   per-algorithm branching.

Semantics: cumulative over the algorithm's whole lifetime, **never reset by `carrySeason`** — the
same choice `rpSkippedMatchCount` and `allianceScoreStats` already make. Note EPA's `carrySeason`
resets `fallbackSkipped` to 0; the new field does **not** follow that, so both algorithms' counters
mean the same thing to the one CLI reader.

## D-Q3 — Narrowness is an extracted, directly testable predicate (T-03-21)

T-03-21 closed only because the CR-01 guard was a positive membership test rather than a
`try`/`catch`. Here a `try`/`catch` is unavoidable, so the narrowness gets its own testable seam,
mirroring how `isRpEligibleEventType` was extracted for CR-01:

`isRecoverableBreakdownParseError(err: unknown): boolean` returns true **only** for a `ZodError`
(imported from `zod`, the same 4.4.3 dependency every season module already uses) or a `SyntaxError`
(malformed corpus JSON text — the same class of untrusted third-party payload). Everything else is
rethrown. `componentMapForSeason(season)` is resolved **outside** the `try` entirely, so an
unregistered season stays fatal. Consequences that must remain loud and are asserted by test:
`assertFiniteComponents`'s plain `Error`, `componentMapForSeason`'s unmapped-season `Error`, and any
future non-Zod defect inside a season module.

This is one control **stronger** than the `identifiability.ts:239-249` precedent, whose bare `catch`
would swallow all three.

The `malformed` outcome carries `issueCount` (the ZodError's issue count; 0 for a `SyntaxError`) and
deliberately carries **no message text**, so no third-party payload content reaches a log line.

</design_decisions>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end guarded parse on the Sigma1 path — one algorithm, wired through every layer</name>
  <files>packages/core/algorithms/breakdown/index.ts, packages/core/algorithms/types.ts, packages/core/algorithms/sigma1/index.ts, packages/harness/cli.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/core/algorithms/sigma1/params.test.ts</files>
  <precondition>`data/corpus.sqlite` exists locally (gitignored, ~351MB) and `TBA_API_KEY` is set in `.env` — the Task 1 verify command fetches `2024wvrox` from TBA and replays it from the corpus.</precondition>
  <action>
Wire ONE path — a malformed 2024 offseason breakdown reaching Sigma1's `update()` — from the parse
boundary through algorithm state to a printed CLI line, proving the whole architecture before EPA is
touched. Production quality, not a prototype: this is the code that ships.

In `packages/core/algorithms/breakdown/index.ts`, beside the existing `parseBreakdown` (which stays
byte-for-byte unchanged, per D-Q1), add two exports. First
`isRecoverableBreakdownParseError(err: unknown): boolean`, returning true only when `err` is an
instance of `ZodError` (add `import { ZodError } from "zod"`) or of `SyntaxError`, and false for
everything else including `null` and non-object values. Second
`tryParseBreakdownPair(season: number, scoreBreakdownRaw: string | null)`, returning a readonly
discriminated union on `kind`: `"absent"` when `scoreBreakdownRaw` is null; `"parsed"` carrying
`red` and `blue` as `ParsedComponents`; `"malformed"` carrying a numeric `issueCount`. Resolve
`componentMapForSeason(season)` BEFORE the `try` so an unregistered season still throws. Inside the
`try`, `JSON.parse` once and call the map's `parse` for each side off that single parsed value. In
the `catch`, rethrow immediately unless `isRecoverableBreakdownParseError(err)` is true; otherwise
return the malformed outcome with `issueCount` taken from a `ZodError`'s issues length, or 0 for a
`SyntaxError`. Carry no error message or payload text on the outcome. Head the helper with a doc
comment naming T-03-18b, naming `identifiability.ts:239-249` as the precedent it generalizes, and
stating why the narrowing predicate exists (T-03-21).

In `packages/core/algorithms/types.ts`, add the telemetry seam: an exported
`BreakdownParseTelemetry` interface declaring `readonly breakdownParseFailureCount: number`, and an
exported `breakdownParseFailureCountOf(state: unknown): number | null` that returns the field when
the value is an object carrying a finite number under that key and `null` otherwise. `null` means
"this algorithm does not track it" (OPR) and must be distinguishable from a genuine 0, so a reporter
never prints a fabricated zero.

In `packages/core/algorithms/sigma1/index.ts`, have `Sigma1State` extend `BreakdownParseTelemetry`;
seed the field to 0 in `initState`; carry it forward unchanged in `carrySeason` (never reset — see
D-Q2) alongside the existing `rpSkippedMatchCount` line; and include it in `update()`'s returned
state. Replace the two `parseBreakdown` calls with a single `tryParseBreakdownPair` call. Derive
`redParsed` and `blueParsed` from the outcome so every downstream line — `usedFallback`,
`measurementNoiseMultiplier`, `fallbackObserved`, `assertFiniteComponents`, the RP fold's
`usedFallback ||` branch — is reached exactly as it is today: `usedFallback` becomes true for BOTH
`"absent"` and `"malformed"`, so a malformed payload takes the already-tested `FALLBACK_NOISE_MULTIPLIER`
path. Increment `breakdownParseFailureCount` by exactly 1 only for `"malformed"`. Extend the existing
D-05 comment block above `usedFallback` to state both reasons and, per D-Q2 item 3, that the
malformed case deliberately increments BOTH counters — the new one recording the cause,
`rpSkippedMatchCount` the effect.

In `packages/harness/cli.ts`, add `reportBreakdownParseFailures(algorithms, finalStates)` modeled on
the existing `reportUpdateTiming` helper: for each algorithm, read
`breakdownParseFailureCountOf(finalStates.get(algorithm.id))`, skip the algorithm when it is null,
and otherwise `console.log` one line naming the algorithm id, the count, that the figure is
cumulative across the invocation, and that the affected matches were folded through the D-05
fallback with inflated measurement noise rather than dropped. Print it even when the count is zero,
so an official-season run yields affirmative evidence rather than silence. Call it from
`runSeason` immediately after the existing per-algorithm "matches replayed / scorable / excluded"
loop, where `records.finalStates` is already in scope, and from `runEventMode` immediately after
`simulator.runAll(...)` returns and before the `Wrote ...` lines.

Update the three hand-written `Sigma1State` literals the new required field breaks
(`sigma1.test.ts:272`, `sigma1.test.ts:612`, `params.test.ts:488`) with
`breakdownParseFailureCount: 0`. Let `tsc --noEmit` find any literal this list missed rather than
searching by hand.

Do not touch `epa.ts` in this task, do not touch any season breakdown module, and do not touch
`parseBreakdown`'s own body.
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm test packages/core/algorithms/sigma1/ &amp;&amp; pnpm harness --event 2024wvrox --algorithm sigma1; echo "EXIT=$?"</automated>
  </verify>
  <done>
`pnpm typecheck` passes. `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0 (WINDOWS #5's
command, whose very first match `2024wvrox_sf1m1` previously aborted the run) and its output includes
a breakdown-parse-failure line for `sigma1` with a count greater than 0. Existing Sigma1 suites,
including the four CR-01 tests at `sigma1.test.ts:719-819`, still pass unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Expand the guard to EPA and lock the whole boundary behind regression tests with positive controls</name>
  <files>packages/core/algorithms/epa.ts, packages/core/algorithms/breakdown/breakdown.test.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/core/algorithms/epa.test.ts, packages/core/algorithms/carryover.test.ts</files>
  <behavior>
Helper unit tests (`breakdown.test.ts`):
- `tryParseBreakdownPair(2024, null)` yields kind `absent`.
- A well-formed 2024 payload yields kind `parsed` with all 13 canonical components present on both sides.
- A payload missing `adjustPoints` on both sides (the real `2024cafb_qm1` shape) yields kind `malformed` with `issueCount` 2.
- A payload carrying only `autoLeavePoints` per side (the `2024wvrox_sf1m1` shape) yields kind `malformed` with a double-digit `issueCount`.
- Text that is not JSON yields kind `malformed` with `issueCount` 0.
- An unregistered season (1999) throws — `componentMapForSeason` stays outside the guarded region.
- `isRecoverableBreakdownParseError` is true for a `ZodError` captured from a real failing schema parse and for a `SyntaxError`; false for `Error`, `TypeError`, `RangeError`, `null`, `undefined`, and a plain string. This is the direct narrowness proof for T-03-21.

Sigma1 regression tests (`sigma1.test.ts`, new describe block in the shape of the CR-01 block at 719-819):
- `update()` on a match with `hasScoreBreakdown: true` and the missing-`adjustPoints` payload does not throw, and `breakdownParseFailureCount` increments by exactly 1.
- That same call still folds the score side — all six teams gain beliefs with finite means and `matchCount` 1 — proving the fallback ran rather than the match being dropped; and `rpSkippedMatchCount` also increments by 1, the documented D-Q2 overlap.
- The severely truncated `2024wvrox_sf1m1`-shaped payload behaves identically: no throw, counter plus 1.
- `update()` on a match whose event key names an unregistered season still throws, proving the catch did not swallow the season-registry defect.
- POSITIVE CONTROL, non-negotiable: a well-formed `rawBreakdown2024Uniform(UNIFORM_PER_COMPONENT)` payload leaves `breakdownParseFailureCount` at 0 AND leaves `rpSkippedMatchCount` at 0 — the latter is reachable only when the parse actually succeeded, since any fallback also skips the RP fold — AND every team's parsed component set includes `foulsCommitted`. Without this, a helper that reported malformed unconditionally would silently disable real component parsing across the whole project and still pass every test above.

EPA regression tests (`epa.test.ts`):
- The missing-`adjustPoints` payload does not throw, `breakdownParseFailureCount` increments by 1, team components move off cold start, and `fallbackSkipped` remains 0 — the permanently-zero invariant is untouched.
- POSITIVE CONTROL: a well-formed payload leaves `breakdownParseFailureCount` at 0 and each team's component means equal the expected parsed per-team shares, proving the full parse path still runs.
  </behavior>
  <action>
Apply the identical D-Q1/D-Q2/D-Q3 treatment to `packages/core/algorithms/epa.ts`: `EpaState`
extends `BreakdownParseTelemetry`, `initState` seeds `breakdownParseFailureCount` to 0, `update()`
replaces its two `parseBreakdown` calls (`:432-433`) with one `tryParseBreakdownPair` call and
increments the counter by 1 only on `"malformed"`, and `carrySeason` carries the field forward
unchanged. Note in a source comment at `carrySeason` that this field is carried while the adjacent
`fallbackSkipped` is reset to 0, and why: `fallbackSkipped` is a per-lifetime zero invariant about a
code path that must never run, while `breakdownParseFailureCount` is a cumulative data-quality
counter that one shared CLI reader prints for both algorithms and therefore must mean the same thing
on both states. Leave every existing `fallbackSkipped` line, including its reset, exactly as it is.

Update the eleven `EpaState` literals the new required field breaks (`epa.test.ts` at 103, 129, 202,
233, 273, 336, 366 and `carryover.test.ts` at 107, 185, 222, 238) with
`breakdownParseFailureCount: 0`, letting `tsc --noEmit` catch any this list missed.

Write the tests described in `<behavior>`. Build the malformed fixtures by deriving from the existing
`rawBreakdown2024Uniform` helper rather than hand-typing a second payload, so the malformed and
well-formed cases provably differ only in the removed fields. Give the two Sigma1 fixtures names that
cite the real matches they reproduce (`2024cafb_qm1`, `2024wvrox_sf1m1`) and comment each with the
issue count the security audit measured on the live corpus.

Do not modify any season breakdown module, and do not weaken any schema field to satisfy a test.
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm test packages/core/algorithms/</automated>
  </verify>
  <done>
`pnpm typecheck` passes and every test in `packages/core/algorithms/` passes, including the new
helper unit tests, both positive controls, the unmapped-season throw assertions, and the untouched
`fallbackSkipped` zero-invariant tests at `breakdown.test.ts:181-204`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Prove both blocked commands, prove digest inertness, resolve WINDOWS #4 and #5</name>
  <files>.planning/WINDOWS.md</files>
  <precondition>`data/corpus.sqlite` exists locally and `TBA_API_KEY` is set in `.env`; the 2024 full-season replay reads only the corpus, the `--event` run additionally reaches TBA (a 304 is the expected response).</precondition>
  <action>
Run the two commands the phase-03 security audit recorded as unmet, in this order, capturing exit
code and the printed breakdown-parse-failure line for each:

First `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` (WINDOWS #4). Then
`pnpm harness --event 2024wvrox --algorithm sigma1` (WINDOWS #5). Record both observed counts
verbatim in the SUMMARY. Sanity-check the season run's figure against the audit's independently
measured population of 1,004 failing matches out of 4,757 carrying a breakdown; the count is an
observation to report, not a threshold to assert, since the corpus may have grown. A count of zero on
the season run is a FAILURE signal, not a pass: it would mean the guard never fired and the exit code
proves nothing — investigate before proceeding.

Then run `pnpm test packages/harness/digest.test.ts`. Both committed `predictionStreamSha256` values
must reproduce bitwise. Both digest slices are 2022 official events (`event_type 0`, `is_offseason 0`)
where every breakdown parses, so the guard is structurally inert there and a moved digest means the
guard is wrong — fix the guard. Re-promoting a version, refreshing
`packages/harness/fixtures/digest-slice.json`, or hand-editing a committed digest is prohibited
(inherited from plans 03-01/03-05/03-06/03-07).

Then run the full `pnpm test` and confirm no existing suite regressed.

Only after all of the above pass, resolve the ledger with the GSD tool rather than by hand:
`node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows fixed 4` then the same for id 5. The tool
rewrites the markdown table and the JSON block together and recomputes the front-matter counts
atomically, which hand-editing cannot. Note the tool's terminal status for a repaired defect is
`fixed` and `markFixed` accepts no reason argument, so after both commands make ONE targeted edit
adding the same reason text to the `reason` cell and the JSON `reason` field for ids 4 and 5 only —
keeping the two representations identical. The reason states that both commands now exit 0, cites the
observed failure counts from this task's runs, and names the guard as the fix. Finish by running
`node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows status` to prove the file still parses and
that `open_count` dropped by two.

Do not modify `.planning/phases/03-tuning-ranking-points-versioning/03-SECURITY.md` — re-running
`/gsd-secure-phase 3` is what updates it.
  </action>
  <verify>
    <automated>pnpm harness --season 2024 --algorithm sigma1 --include-offseason &amp;&amp; pnpm harness --event 2024wvrox --algorithm sigma1 &amp;&amp; pnpm test &amp;&amp; node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows status</automated>
  </verify>
  <done>
Both harness commands exit 0. `pnpm test` passes in full, including `packages/harness/digest.test.ts`
reproducing both committed `predictionStreamSha256` values bitwise. `windows status` parses the
ledger successfully, ids 4 and 5 are no longer `open` and each carries a reason naming the observed
counts, and `open_count` is two lower than before. `03-SECURITY.md`, `data/algorithm-versions/`, and
`packages/harness/fixtures/` are unmodified in `git status`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA / corpus -> `parseBreakdown` | Third-party `score_breakdown` JSON, self-reported for offseason events, crosses into algorithm state here |
| `WalkForwardSimulator.run`/`runAll` -> algorithm `predict`/`update` | No `try`/`catch` at `replay.ts:117-119`, `:161-163` — a single throw is a whole-batch abort |
| algorithm state -> harness CLI stdout | The new counter's reporting surface; must carry no third-party payload text |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-18b | Denial of Service | `sigma1/index.ts:735-736`, `epa.ts:432-433` — untrusted breakdown data aborting the harness run | high | mitigate | Task 1/2 route both call sites through `tryParseBreakdownPair`; a schema failure degrades to the existing tested `usedFallback` path with `FALLBACK_NOISE_MULTIPLIER`. Task 3 re-runs both previously-aborting commands to exit 0 and records the observed counts — the verification clause 03-07 left unmet |
| T-03-19 | Tampering | the guard silently perturbing a committed prediction-stream digest, voiding SC-5 | high | mitigate | The guard is a pure no-op on the success path; both digest slices are 2022 official events where every breakdown parses. Task 3 executes `digest.test.ts` and requires both `predictionStreamSha256` to reproduce bitwise. Prohibition: a moved digest is fixed in the guard, never by re-promoting or refreshing the fixture |
| T-03-21 | Spoofing | a catch broad enough to swallow an unrelated exception, masking a real defect as a skip | medium | mitigate | Narrowness is an extracted, directly unit-tested predicate (`isRecoverableBreakdownParseError`, true only for `ZodError`/`SyntaxError`); `componentMapForSeason` sits outside the `try`; tests assert an unmapped season and non-Zod errors still throw. Strictly stronger than the bare `catch` at `identifiability.ts:243` |
| T-03-01 / T-03-20 | Tampering | pressure to weaken a season schema to make the failure go away | high | mitigate | Explicitly prohibited by this plan's `must_haves.prohibitions` and repeated in every task action: no season breakdown field becomes `.optional()`. Finding F-4 records `breakdown/2024.ts:84-87` already carries the `Object.create(null)` + allowlist controls of its `breakdown/2026.ts:103` precedent and must not be made weaker. The availability fix lives entirely outside the schemas |
| T-03-26 | Repudiation | a degraded match folded silently, leaving a quietly-wrong model with no record | high | mitigate | `breakdownParseFailureCount` on both states (D-Q2), never reset by `carrySeason`, printed by `reportBreakdownParseFailures` from both `runSeason` and `runEventMode` including when zero; the SUMMARY records the observed count for both commands. Never a silent drop, never a coerced zero |
| T-03-27 | Information Disclosure | third-party payload content reaching a log line or report through the new error path | low | mitigate | The `malformed` outcome carries only a numeric `issueCount` — no error message, no field values, no payload fragment. The CLI line prints the algorithm id and the count only |
| T-03-28 | Tampering | a guard that over-skips, silently disabling real component parsing project-wide | high | mitigate | Positive controls in both `sigma1.test.ts` and `epa.test.ts` (the CR-01 pattern at `sigma1.test.ts:781-818`): a well-formed payload must leave the counter at 0, leave `rpSkippedMatchCount` at 0 (reachable only via a successful parse), and produce exact parsed component values |
| T-03-SC | Tampering | npm/pip/cargo installs (supply chain) | high | accept | No package is installed by this plan. `ZodError` comes from the already-present `zod@4.4.3` root dependency; `pnpm-lock.yaml` is unmodified. Inherits AR-03-01 |
</threat_model>

<verification>
1. `pnpm typecheck` passes.
2. `pnpm test` passes in full — no existing suite regressed, including the CR-01 block
   (`sigma1.test.ts:719-819`), the `fallbackSkipped` zero-invariant tests
   (`breakdown.test.ts:181-204`), and `breakdown/reconciliation.test.ts`.
3. `pnpm test packages/harness/digest.test.ts` reproduces BOTH committed `predictionStreamSha256`
   values bitwise.
4. `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` exits 0, printing a non-zero
   breakdown-parse-failure count for `sigma1`.
5. `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0, printing a non-zero count.
6. `git status` shows no modification to `03-SECURITY.md`, `data/algorithm-versions/`,
   `packages/harness/fixtures/`, or any `packages/core/algorithms/breakdown/{year}.ts`.
7. `gsd-tools windows status` parses the ledger; ids 4 and 5 are non-open with a recorded reason.
</verification>

<success_criteria>
- T-03-18b's asserted property holds on the tree: `update()` does not abort the harness on untrusted
  corpus data, for either algorithm, on either CLI path.
- The degradation is counted and printed, and the SUMMARY records the observed count for both
  commands.
- Narrowness is proven by test, not asserted by comment: a non-parse error still aborts loudly.
- Both committed prediction-stream digests are bitwise unchanged.
- WINDOWS.md #4 and #5 are closed with a reason, by tool, only after the two commands passed.
- `/gsd-secure-phase 3` can be re-run to move T-03-18b to `closed` and `threats_open` to 0.
</success_criteria>

<output>
Create `.planning/quick/260818-inm-guard-parsebreakdown-against-self-report/260818-inm-SUMMARY.md` when done.
Record in it: the exact observed `breakdownParseFailureCount` for each of the two commands, both exit
codes, the two reproduced `predictionStreamSha256` values, the D-Q2 counter decision as shipped, and
confirmation that no season schema field was weakened.
</output>
