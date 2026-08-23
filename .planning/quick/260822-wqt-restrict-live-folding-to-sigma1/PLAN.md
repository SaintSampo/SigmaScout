---
phase: quick-260822-wqt
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - apps/worker/wrangler.toml
  - apps/worker/src/env.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/liveAlgorithmTier.test.ts
  - apps/worker/test/scheduled.test.ts
  - apps/worker/test/scheduled.replay.test.ts
  - docs/worker-operations.md
autonomous: true
requirements:
  - DATA-04

estimate:
  tokens: 60000
  raw_tokens: 40000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "The deployed Worker folds ONLY sigma1 during a live event: an ordinary newly-completed 3v3 match (6 touched teams) is APPLIED, not deferred — observed as `eventsAdvanced:1` in `wrangler tail`, never inferred from code (SC-2 / DATA-04)."
    - "All three algorithms remain PUBLISHED (D-03). `packages/harness/publish.ts`, `packages/harness/manifests.ts` and the algorithms manifest are untouched; opr, epa and sigma1 page artifacts all still exist in R2 and the manifest still lists three entries after the change. Only the Worker's live FOLDING narrows."
    - "Which algorithms fold live is readable in tracked config — `apps/worker/wrangler.toml`'s `[vars] LIVE_ALGORITHM_IDS` — not inferred from code, following plan 04-07's `TBA_BASE_URL` precedent in the same block."
    - "Adding a second id to `LIVE_ALGORITHM_IDS` in tracked config FAILS `pnpm test`, with a message naming the measured subrequest arithmetic — the regression gate that stops this defect being rediscovered during an event weekend."
    - "A misconfigured live tier cannot silently fold ZERO algorithms while still advancing the event cursor (which would mark matches folded that were never applied)."
    - "An operator reading `docs/worker-operations.md` learns that opr/epa refresh at the manual pre/post-event-weekend re-baseline (D-12), not per tick — so 'opr looks stale during the event' reads as expected behavior, not a bug."
  artifacts:
    - apps/worker/wrangler.toml
    - apps/worker/src/env.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/liveAlgorithmTier.test.ts
    - docs/worker-operations.md
  key_links:
    - "`wrangler.toml` `[vars] LIVE_ALGORITHM_IDS` -> `Env.LIVE_ALGORITHM_IDS` -> `runTick`'s `parseLiveAlgorithmIds` -> `buildAlgorithmModules`'s filter -> `processEvent`'s `algorithmModules.size` term in `estimatedCost`. Break any link and the tick either folds the wrong tier or reverts to deferring forever."
    - "`estimateEventSubrequestCost` is the ONE formula `processEvent` calls — the budget test must bind to that function, never to a re-typed copy of the arithmetic, or the test proves nothing."
    - "`TICK_FIXED_SUBREQUEST_COST` / `EVENT_PREFLIGHT_SUBREQUEST_COST` are pinned to real observed `subrequestsUsed` by a driven tick, so they cannot drift away from the actual `consume` call sites."
---

# Quick Task 260822-wqt — Restrict the Worker's live folding tier to sigma1

<objective>
Make the deployed Worker fold **only sigma1** during a live event, via a tracked
`LIVE_ALGORITHM_IDS` var, **while keeping all three algorithms published**.

**Why, measured — not derived from code.** `processEvent` in `apps/worker/src/scheduled.ts`
estimates each event's whole subrequest cost up front (scheduled.ts:586-594):

`1` (cursor CAS) + `1` (event-detail fetch) + `algorithmCount * 2` (Phase A state read+write)
+ `algorithmCount * 2 * (1 + touchedTeams.length)` (Phase B event artifact + per-team artifacts)

`SUBREQUEST_CAP` is 50 and `SUBREQUEST_RESERVE` is 4 (`apps/worker/src/subrequestBudget.ts`),
giving a usable 46; the tick's own fixed costs consume 5 more before that check runs (3 in
`runTick` — live-windows manifest, algorithms manifest, tick meta — plus 2 in `processEvent` —
cursor read, TBA poll), leaving **~41 actually available**. For ONE ordinary newly-completed 3v3
match (6 touched teams):

| Live algorithms | estimatedCost | Fits in ~41? | Max touched teams/tick |
|---|---:|---|---:|
| 1 (sigma1) | 18 | yes, 23 spare | ~17 |
| 2 | 34 | yes, 7 spare | 7 |
| 3 | 50 | **NO**, over by 9 | 4 — fewer than one match |

With all three live the event **defers every tick, forever** — confirmed by direct, repeated
observation on the deployed Worker during plan 04-07 and recorded in `docs/publish-budget.md`
§ "Worker runtime budget (D-21/D-23, plan 04-07)". That is DATA-04 / SC-2 (a new result reflected
within ~1-3 minutes) failing outright in production.

**The user's decision:** only sigma1 needs real-time updates. opr and epa may refresh at the
manual pre/post-event-weekend re-baseline — already the documented D-12 authority path
(`pnpm publish:seasons` + the three D1 seed imports). The user explicitly chose this over adding
per-algorithm cursor granularity.

**The distinction that is easiest to get wrong, stated up front:** *published* and *folded live*
are two different sets. D-03's published set stays exactly as it is — opr, epa, sigma1 — because
the Compare page and the per-algorithm pages read those artifacts. If the new filter ever reaches
the published set, artifacts stop **existing** rather than merely going stale, which is a far
worse failure than the one being fixed.
</objective>

<task_1>
**The live tier: tracked config, the filter, and the tests that pin the arithmetic.**

Files: `apps/worker/wrangler.toml`, `apps/worker/src/env.ts`, `apps/worker/src/scheduled.ts`,
`apps/worker/test/liveAlgorithmTier.test.ts` (new), `apps/worker/test/scheduled.test.ts`,
`apps/worker/test/scheduled.replay.test.ts`.

Read first: `apps/worker/src/scheduled.ts` (its module header's atomicity/budget reasoning,
`buildAlgorithmModules` at :131-150, `processEvent`'s `estimatedCost` at :586-594, `RunTickDeps`
at :821-829, `runTick`'s three `consume(1)` calls at :857/:867/:872),
`apps/worker/src/subrequestBudget.ts`, `apps/worker/wrangler.toml`'s existing `[vars]` block.

**1. `wrangler.toml` — add `LIVE_ALGORITHM_IDS = "sigma1"` to the existing `[vars]` block**
(the one that already holds `TBA_BASE_URL`). Follow that value's own precedent exactly: a plain
tracked value, never a secret, with a comment that makes the override point visible in tracked
config rather than an undocumented back door. The comment must record the measured arithmetic
(the table above: 18 fits in ~41, 50 does not), name `docs/publish-budget.md`'s 04-07 measurement
as its source, and state plainly that this narrows only what folds LIVE — the published set
(D-03) is unchanged and opr/epa refresh at the D-12 re-baseline.

**2. `env.ts` — surface it on `Env`.** Declare it **optional** (`readonly LIVE_ALGORITHM_IDS?:
string`), not required. Two reasons, both worth the doc comment: the existing test envs construct
`Env` through an `as Env` cast, and — more importantly — `wrangler deploy --var
"TBA_BASE_URL:<url>"` (the replay rig's own deploy-time override, see the runbook) may or may not
carry the other tracked vars through. An optional type makes the unset branch a real, reachable,
type-checked path instead of dead code the compiler believes cannot happen. Cross-reference this
task's decision on what unset means.

**3. `scheduled.ts` — parse, validate, and filter.** Add, near `buildAlgorithmModules`:

- `DEFAULT_LIVE_ALGORITHM_IDS` — `["sigma1"]`, exported.
- `parseLiveAlgorithmIds(raw: string | undefined): string[]` — split on comma, trim, drop empty
  segments. Import `PUBLISHED_ALGORITHM_IDS` from `packages/harness/manifestSchemas.js` (already
  the Worker-importable module `liveWindows.ts` imports from — never from `manifests.js`) and
  validate each id against it.
- `buildAlgorithmModules(algorithmsManifest, liveAlgorithmIds)` — a second parameter; skip any
  manifest entry whose id is not in the live set. Update `RunTickDeps.buildAlgorithmModules`'s
  signature to match, and `runTick`'s call site.
- Call `parseLiveAlgorithmIds(env.LIVE_ALGORITHM_IDS)` at the **top of `runTick`, before** the
  live-windows manifest read — so a misconfigured deploy surfaces on the very next tick, one
  minute later, in the tail an operator is already watching, rather than lying dormant until an
  event goes live months later.

**The three behaviors, decided deliberately — implement exactly these:**

- **Unset or empty -> fall back to `DEFAULT_LIVE_ALGORITHM_IDS` AND emit one structured warn
  line** (`console.warn(JSON.stringify({ msg: "live-tier-defaulted", ... }))`, matching the
  existing `msg: "tick"` / `msg: "event-failed"` field discipline so Observability can filter on
  it). Defaulting to "all" would reintroduce the exact defect this task fixes; throwing would
  take the site's freshness down over a config omission — including the plausible case where the
  rig's `--var` deploy drops the tracked var. Falling back is safe; the warn line is what stops
  it being silent. Do not log any binding value beyond the ids themselves.
- **An id not in `PUBLISHED_ALGORITHM_IDS` -> throw** a named error (e.g.
  `UnknownLiveAlgorithmIdError`) whose message lists the accepted ids. An unrecognised id is
  unambiguously a typo in tracked config.
- **A filtered module map that comes out EMPTY -> throw** a named error (e.g.
  `EmptyLiveAlgorithmTierError`). State the reason in the error's own doc comment: a tick that
  folds zero algorithms would still claim the cursor and advance it, marking matches folded that
  were never applied to any state — a corruption that is *indistinguishable from health* in the
  one log line the runbook tells an operator to read. This is the failure this guard exists for.

**4. `scheduled.ts` — extract the estimate so a test can bind to the real formula.** Export:

- `TICK_FIXED_SUBREQUEST_COST` — `runTick`'s own three `consume(1)` calls, enumerated in the
  comment.
- `EVENT_PREFLIGHT_SUBREQUEST_COST` — `processEvent`'s cursor read + poll, spent before the
  estimate check.
- `estimateEventSubrequestCost(algorithmCount, touchedTeamCount)` — the existing arithmetic,
  moved verbatim, keeping its current explanatory comment. `processEvent` must **call** this
  function; the inline expression is replaced, not duplicated. A budget test that asserts against
  a re-typed copy of the formula proves nothing, and re-typing it is precisely how this defect
  survived four plans.

**5. New test `apps/worker/test/liveAlgorithmTier.test.ts`.** Node environment, `readFileSync`
via `fileURLToPath`/`resolve` — the same shape `scripts/secrets-boundary.test.ts` already uses to
read a tracked repo file. It must assert:

- **The tracked live tier fits.** Read `apps/worker/wrangler.toml`, drop comment lines before
  matching (a `#`-prefixed line naming the key must not be able to satisfy the match), extract
  `LIVE_ALGORITHM_IDS`'s value, run it through `parseLiveAlgorithmIds`, and assert
  `estimateEventSubrequestCost(ids.length, 6)` is at most
  `new SubrequestBudget().usableCap - TICK_FIXED_SUBREQUEST_COST - EVENT_PREFLIGHT_SUBREQUEST_COST`
  (18 vs 41 today). The failure message must name the measured arithmetic and point at
  `docs/publish-budget.md`'s 04-07 section, so whoever adds a second id reads the reason rather
  than raising a number.
- **The counterfactual that pins WHY.** `estimateEventSubrequestCost(3, 6)` exceeds that same
  usable figure (50 > 41). Comment it explicitly: if this assertion ever fails because Phase B's
  per-team cost shape genuinely improved, that is the signal to re-evaluate `LIVE_ALGORITHM_IDS`
  against a fresh measurement — not to delete the test.
- **The fixed-cost constants are real, not declared.** Drive `runTick` with the existing fake
  D1/R2/KV harness through a tick that considers an event and defers or finds it unchanged, and
  assert `subrequestsUsed` equals `TICK_FIXED_SUBREQUEST_COST + EVENT_PREFLIGHT_SUBREQUEST_COST +
  1` (the tick-meta write). The deployed Worker reported exactly 6 for this shape during 04-07;
  this is what stops the two constants drifting away from the actual `consume` call sites.
- **Only the live tier folds.** With a three-entry algorithms manifest and
  `LIVE_ALGORITHM_IDS: "sigma1"`, a tick that advances an event writes sigma1 event/team
  artifacts and writes **no** opr or epa artifact, and touches no opr/epa `algorithm_state` row.
  Use the `FakeR2Bucket.puts` key inspection and `FakeD1Database.algorithmState` key inspection
  the existing `scheduled.test.ts` tests already use.
- **The three decided behaviors.** Unset -> defaults to sigma1 and emits the warn line (spy on
  `console.warn`); an unrecognised id -> throws; a live id absent from the manifest, leaving the
  map empty -> throws.

**6. Two one-line test-env updates — both load-bearing, neither cosmetic.**

- `apps/worker/test/scheduled.test.ts:224` (`makeEnv`) — add `LIVE_ALGORITHM_IDS: "opr"`. Every
  `makeKv` call site in that file uses the default **opr-only** manifest, so without this the new
  filter yields an empty tier and the whole suite throws. Setting it to `"opr"` keeps all
  existing assertions exercising exactly what they exercise today and makes each test's live tier
  explicit.
- `apps/worker/test/scheduled.replay.test.ts:233` (`makeEnv`) — add
  `LIVE_ALGORITHM_IDS: "opr,epa,sigma1"`. **Do not narrow this one to sigma1.** That test is
  D-14's offline equivalence proof and asserts a matching prediction-stream digest for all three
  algorithms; it already overrides the budget (`subrequestCap: 1000, subrequestReserve: 0`)
  precisely because it is testing the equivalence property, not the deferral mechanism. Narrowing
  it would silently drop opr/epa fold-equivalence coverage while the suite stayed green. Add a
  short comment there saying so.

**Acceptance:**
- `pnpm test` passes (existing count plus the new file's tests; no existing test deleted or
  skipped).
- `pnpm typecheck` clean AND `npx tsc -p apps/worker/tsconfig.json --noEmit` clean.
- `grep -n 'LIVE_ALGORITHM_IDS' apps/worker/wrangler.toml` shows the assignment inside `[vars]`.
- The tracked-tier budget test genuinely binds: temporarily change `wrangler.toml`'s value to
  `"sigma1,epa,opr"`, observe `pnpm test` FAIL on that assertion with the arithmetic-naming
  message, then revert. Do not commit the flipped state. A green suite that would also be green
  with three live algorithms is the failure mode this whole task exists to prevent.
- `git diff --stat` touches no file outside this task's list — in particular
  `packages/harness/publish.ts`, `packages/harness/manifests.ts` and `packages/core/` are
  unmodified.
</task_1>

<task_2>
**Deploy it, observe a real tick folding sigma1 alone, and tell the operator.**

Files: `docs/worker-operations.md`. No source changes in this task.

Read first: `docs/worker-operations.md` (the "Re-baselining", "Watching it", "When something is
wrong" and "Replay rig (plan 04-07)" sections).

**A green test suite is not sufficient here.** Every real bug this phase found was found by
deploying — the `*.workers.dev` interception, the `/cdn-cgi/handler/scheduled` 404, and the
deferral defect itself all passed local tests first.

**1. Deploy and confirm the binding.**

```bash
pnpm worker:deploy
cd apps/worker && npx wrangler deployments list
```

The deploy output must list **both** vars (`TBA_BASE_URL` and `LIVE_ALGORITHM_IDS`) alongside the
`MANIFEST`/`DB`/`ARTIFACTS` bindings, and `schedule: * * * * *`. Record the new version id.

**2. Observe idle health, then a real fold.**

```bash
cd apps/worker && npx wrangler tail sigmascout-worker --format json
```

Confirm several consecutive `"ok":true` idle ticks first (expect `subrequestsUsed:1`,
`eventsConsidered:0`, CPU in the neighbourhood of the recorded 7 ms median, range 5-13 ms). No
`live-tier-defaulted` warn line should appear; if one does, the tracked var did not reach the
deployed Worker — stop and resolve that before continuing, and record what happened.

Then drive one real fold through the deployed Worker with the replay rig, which is this project's
established way to make an event live on demand (there is no live FRC event in August). Use a
**short slice** and the **sigma1** tier — the rig resets and re-derives only the algorithms it is
given, so asking it for opr/epa would be asking about algorithms the Worker no longer folds:

```bash
npx tsx --env-file=.env scripts/replayRig.ts \
  --event 2026cmptx \
  --worker-url https://sigmascout-worker.jrw4561.workers.dev \
  --fixture-url https://fixture-rig.sigmascout.org \
  --algorithm sigma1 \
  --mode freshness \
  --match-limit 2 \
  --live-trigger cron \
  --out reports/replay-rig/260822-wqt-sigma1-tier.json
```

The rig deploys the fixture-URL override and restores the tracked default in a `try`/`finally`
(runbook § "Replay rig"). If its restoring deploy drops `LIVE_ALGORITHM_IDS`, the Worker falls
back to sigma1 and says so in the tail — note whether that happened, since it is exactly the case
Task 1's default-plus-warn decision was chosen for.

**What must be true in the tail, and what to record:**
- At least one tick reports `"eventsAdvanced":1` with `"eventsDeferred":0` for the rig's event —
  the ordinary 3v3 match is now APPLIED, where all three algorithms produced a permanent defer.
- `subrequestsUsed` on that advancing tick is in the low twenties (04-07 measured 24 for the
  structurally identical single-algorithm fold), and comfortably under 46.
- CPU time on the advancing tick, stated with its sample count.
- Every figure recorded names **the run and the deployed Worker version that produced it**. The
  version before this change is `8d1919c6-e8d7-4490-a583-bcb6bb46e691`; the idle-tick baseline
  it is compared against is CPU median 7 ms (range 5-13 ms). Do not restate a 04-07 figure as if
  this run produced it, and do not report a figure for a tick shape that was never observed.

**3. Re-baseline afterwards.** The runbook already requires this after any rig session — it is
the actual restore mechanism for the live-windows manifest and the artifacts the rig deleted:

```bash
pnpm publish:seasons
cd apps/worker
npx wrangler d1 execute sigmascout-state --remote --file ../../reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file ../../reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file ../../reports/publish/seed-sigma1.sql
```

**4. Confirm the published set is intact** — the must-have that is easiest to lose:

```bash
cd apps/worker
npx wrangler r2 object get sigmascout-artifacts/v1/manifest/algorithms.json --remote --file -
```

All three entries (opr, epa, sigma1) must still be listed, and an opr and an epa event artifact
must both still be retrievable from R2. Record the check.

**5. Extend `docs/worker-operations.md`.** Add a short section — place it adjacent to
"Re-baselining", whose D-12 procedure is now doing double duty — that states plainly:

- Only sigma1 folds live; `apps/worker/wrangler.toml`'s `[vars] LIVE_ALGORITHM_IDS` is the
  single place that is configured, and it is tracked in git.
- Why: the measured per-tick subrequest budget cannot fit an ordinary 3v3 match across three
  algorithms (18 vs 50 against ~41 available); point at `docs/publish-budget.md`'s 04-07 section
  rather than restating the whole measurement.
- **opr and epa remain fully published** — every page and the Compare page still read them; they
  refresh at the manual pre/post-event-weekend re-baseline above, not on the cron. During an
  event weekend their numbers are as of the last re-baseline, and that is expected.
- Adding an id to `LIVE_ALGORITHM_IDS` is gated by a test that recomputes the budget; re-measure
  on a deployed Worker before changing it, do not raise the number to make the test pass.

Add two rows to the existing "When something is wrong" table, in its established
symptom / likely cause / first thing to check shape:
- opr or epa metrics look stale mid-event while sigma1 updates -> expected: only sigma1 folds
  live -> check `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; refresh via a re-baseline.
- A `live-tier-defaulted` warn line in the tail -> `LIVE_ALGORITHM_IDS` did not reach the
  deployed Worker (e.g. a `--var` deploy that did not carry tracked vars through) -> redeploy
  from tracked config with `pnpm worker:deploy` and confirm the deploy output lists both vars.

**Acceptance:**
- A deployed version id is recorded, and the deploy output listing both vars is captured.
- A captured tail line shows `"eventsAdvanced":1` for the rig's event, with its `subrequestsUsed`
  and CPU figures attributed to that run and that version.
- The algorithms manifest still lists opr, epa and sigma1, and opr/epa artifacts are still
  retrievable from R2 — checked after the re-baseline, recorded, not assumed.
- `docs/worker-operations.md` contains the new section and both new table rows.
- The Worker is left deployed from tracked config (not the fixture override), and the re-baseline
  has been run.
</task_2>

<non_goals>
State these plainly so an executor does not drift into them. Each is a real, named option that
`docs/publish-budget.md`'s "What would have to change" section lists — and each is deliberately
**not** this task:

- **No per-algorithm cursor granularity.** The user explicitly chose the config filter over this.
- **No `event_cursor` schema change**, and no new migration. The shared-cursor atomicity choice
  documented in `scheduled.ts`'s module header stands exactly as written.
- **No change to `SUBREQUEST_CAP` or `SUBREQUEST_RESERVE`.** Raising the usable budget to make an
  arithmetic problem go away is the failure mode this task's regression test exists to block.
- **No change to Phase B's batching design.** Folding all touched teams into a single per-event
  R2 object is a genuine architectural change and needs its own plan and its own measurement.
- **No change to the published set (D-03).** opr, epa and sigma1 all keep being published.
- **No auto-deploy, no scheduled re-baseline.** Both are recorded deferred ideas in
  `04-CONTEXT.md`; D-24/D-12's tension is unchanged by this task.
</non_goals>

<constraints>
- ONLY these files may be modified: `apps/worker/wrangler.toml`, `apps/worker/src/env.ts`,
  `apps/worker/src/scheduled.ts`, files under `apps/worker/test/`, and
  `docs/worker-operations.md`.
- Do **NOT** modify `packages/harness/publish.ts`, `packages/harness/manifests.ts`,
  `packages/harness/manifestSchemas.ts`, or anything under `packages/core/`. The published set
  and the algorithms manifest are out of scope by design — see the must-have above.
- Do **NOT** modify `apps/worker/src/subrequestBudget.ts`. `estimateEventSubrequestCost` lives in
  `scheduled.ts` next to its only caller, despite `subrequestBudget.ts` being the tidier home,
  because that file is outside this task's blast radius.
- Do **NOT** modify `apps/worker/wrangler.fixture.toml` or `apps/worker/src/fixtureServer.ts` —
  the fixture Worker has its own `Env` and does not fold anything.
- Do **NOT** edit `docs/publish-budget.md`. It is the measurement record of what was observed on
  2026-08-23 under the then-deployed configuration; the forward pointer to this fix belongs in
  `wrangler.toml`'s comment and `docs/worker-operations.md`, which this task does write.
- No secret ever appears in `wrangler.toml`, a log line, a test assertion, or a commit message
  (`.claude/CLAUDE.md` § Conventions). `LIVE_ALGORITHM_IDS` is a plain tracked value, exactly
  like `TBA_BASE_URL`; the `live-tier-defaulted` warn line logs algorithm ids and nothing else.
- Two atomic commits, one per task.
</constraints>
