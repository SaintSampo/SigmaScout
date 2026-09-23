# Operating the live-update Worker

`sigmascout-worker` polls TBA once a minute for events that are currently live, advances each
affected team's algorithm state in D1, and rewrites only the artifacts that actually moved in R2.
A tick with nothing live reads one small manifest from R2 and stops there, spending zero TBA
requests — which is what makes ~1,440 invocations a day free during the ten months of the year no
event is running. Everything the browser reads is a precomputed R2 object served over a custom
domain, so page traffic never touches this Worker.

Deployed at `https://sigmascout-worker.jrw4561.workers.dev`. Read path: `https://sigmascout.org`.

> **Plan change, 2026-09-22: the account is on Workers Paid.** Per-invocation CPU is 30 s (was
> 10 ms) and subrequests are 10,000 (was 50); D1 is 50M row writes/month (was 100k/day). R2's free
> tier is separate and unchanged. (KV rose from 1,000 writes/day to 1M/month too, and is now
> irrelevant: quick task 260923-3w4 removed the KV binding entirely — see "Deploying" below.) Most of the CPU-budget
> and subrequest-budget material below this point was written under the free plan and is retained as
> a measurement record — look for dated banners marking which sections describe the retired regime.

---

## Deploying

Deploys are **manual, by hand**. There is no deploy-on-push, deliberately (D-27): an accidental
merge to `main` during a live event must not be able to redeploy the thing currently keeping the
site fresh. Auto-deploy is a recorded deferred idea in `04-CONTEXT.md`, gated on the replay rig
being able to gate it.

```bash
pnpm worker:deploy          # from the repo root
```

or equivalently, from `apps/worker`:

```bash
npx wrangler deploy
```

Confirm afterwards:

```bash
npx wrangler deployments list        # a current deployment at 100%
```

The deploy output must print `schedule: * * * * *` and list **two** bindings — `DB` (D1) and
`ARTIFACTS` (R2). If a binding is missing, stop: the tick will fail every minute against a binding
that is not there.

**There were THREE bindings until 2026-09-23.** `MANIFEST` (KV) was the "small, hot live-windows
manifest pointer" half of the original design, and nothing in this repository ever wrote a value to
it — every tick paid a guaranteed KV miss and then the R2 read `liveWindows.ts` treated as a
fallback (measured directly, 2026-08-22/23; see `publish-budget.md`'s "KV writes per day" row).
Quick task 260923-3w4 removed the binding. A deploy output listing `MANIFEST` means a pre-260923-3w4
`wrangler.toml`, not a healthy deploy. The KV namespace still exists in the account, unbound;
deleting it there is a dashboard action.

**Check the entrypoint before deploying.** `apps/worker/wrangler.toml` must have
`main = "src/scheduled.ts"`.

---

## Secrets

`TBA_API_KEY` is a **Worker secret**, set once against the deployed Worker. The deployed Worker
cannot read the local `.env`, and putting the value in `wrangler.toml` would commit it — that file
is tracked in git.

Set or rotate it without ever rendering the value:

```bash
cd apps/worker
TBA=$(grep -E '^TBA_API_KEY=' ../../.env | cut -d= -f2- | tr -d '\r')
printf '%s' "$TBA" | npx wrangler secret put TBA_API_KEY
unset TBA
```

Piping via stdin matters: passing a secret as a command-line argument puts it in the process list
and your shell history.

Confirm by **name only** — this never prints a value:

```bash
npx wrangler secret list
```

Standing rule: no key ever appears in `wrangler.toml`, a log line, a published artifact, a commit
message, or a test assertion. See `scripts/secrets-boundary.test.ts`, which enforces the local half
of this, and `.claude/CLAUDE.md` § Conventions for why passing that test is not by itself evidence
that secrets were handled correctly.

---

## Database

Migrations live in `apps/worker/migrations/`. Apply to local and remote separately:

```bash
cd apps/worker
npx wrangler d1 migrations apply sigmascout-state --local
npx wrangler d1 migrations apply sigmascout-state --remote
```

**Then confirm the tables actually exist.** This is not optional:

```bash
npx wrangler d1 execute sigmascout-state --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expect `algorithm_state` and `event_cursor` among the results. The reason to check: `wrangler
deploy` and `tsc` both pass cleanly against an empty database. A missing table is not a build
error — it is a tick that fails every minute in production, and nothing upstream of the failure
will have warned you.

---

## Re-baselining

The offline run is the authority for live state (D-12). Re-baselining overwrites whatever the
Worker has accumulated, correcting incremental drift rather than letting it compound across a
season. It is a **manual operation run before and after an event weekend** — see
[`publish-budget.md`](publish-budget.md) for why it is manual rather than scheduled.

**One command (added 2026-09-21):** `pnpm rebaseline` runs the whole chain below in a safe order:
ingest the current season, deploy the Worker, `publish:seasons`, the four seed files with
`seed-cursors.sql` last, a live-manifest check, then a prune of whatever generations the run
superseded. A failed step stops the chain and prints the `--from <step>` that resumes it.
`--skip-ingest`, `--skip-deploy` and `--skip-prune` drop a step. The prune refuses for six hours after
the publish (the recent-write guard has no bypass); run `pnpm rebaseline --from prune` once that
window has passed. The manual commands below are what it runs, kept for when a single step needs redoing by hand.

```bash
# Credentials are read BY THE TOOL, never loaded into the shell.
# Never cat, echo, source, or Read .env.
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --env-file .env --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --env-file .env --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --env-file .env --file reports/publish/seed-spr.sql
npx wrangler d1 execute sigmascout-state --remote --env-file .env --file reports/publish/seed-cursors.sql
pnpm worker:deploy
```

**As of quick task 260920-q75 (2026-09-20), the fourth command above is mandatory, and its position
matters.** `seed-cursors.sql` carries the run's `event_cursor` rows and the per algorithm permission
to fold. Applying it after the three state files, and before the deploy, is what makes the cursor
rewrite and the permission to fold land together. Applying it earlier suspends folding instead of
corrupting state. `pnpm publish:seasons` prints the exact ordered commands for this run into
`reports/publish/SEED-COMMANDS.txt`. Treat that generated file, not this static block, as the
authoritative per run command list, since it always names the current run's actual file paths.

**Incident, 2026-09-20.** Generation `e5cf1304` published at 20:12 UTC into four events that still
held open live windows. The D1 seed for that same generation was applied minutes later. In the
window between the two, tick `tick-1789935145177` folded all four events against the PREVIOUS
generation's state and advanced each one's `event_cursor`. The seed then replaced `algorithm_state`
without touching `event_cursor` at all, so `2026onsca1` ended up two matches ahead of its seeded
state, and `2026tnkno` ended up one match ahead, both permanently missing from live state until the
next re-baseline. Had the seed landed first instead, the tick would have re-folded all seventy
already included `2026cc` qualification matches, corrupting state in the other direction. Both
directions were silent, and neither raised an error anywhere. The next re-baseline under this quick
task's change repairs both, since the cursor rows are now rewritten from the offline run itself
rather than left standing from whatever the live tick did in between.

**As of quick task 260912-ivg (2026-09-12): the third seed file's name is
`seed-spr.sql`, not `seed-bpr.sql`.** The BPR -> SPR cutover is COMPLETE — this block is
once again an ordinary re-baseline, with no transitional caveat attached to it.

**Row-write cost, measured on that run rather than estimated:** applying `seed-spr.sql`
alone reported 61 queries, 6,314 rows read and **25,256 rows written** — the written figure
is roughly 4x the row count because the file leads with a `DELETE ... WHERE algorithm_id`
and D1 counts index maintenance. **Historical:** this used to be budgeted against a free-plan
100k/day write cap using the WRITTEN number, where three seed files at ~75k writes meant one
full three-file pass per day was affordable and a second was not. D1 is 50M row writes/month
on the paid plan since 2026-09-22 — a three-file pass is a rounding error against that, and this
is no longer a real constraint on how often a seed pass can run.

**One wrinkle worth knowing before you retry a failed seed.** `--file` uploads the file and
then imports it as two separate steps. A first invocation can fail during import while
having already uploaded — the output ends in an account-permissions dump rather than an
obvious error. Re-running then prints `File already uploaded. Processing.` and succeeds.
So a seed that appears to have failed may simply need re-running, and **the only proof it
landed is a `GROUP BY algorithm_id` read-back**, never the command's own exit.

**Corrected 2026-09-12.** This block used to open with `set -a; . ./.env; set +a`. That is blocked
in agent environments — correctly, because it is a mechanism for loading secrets into a shell — so
the runbook prescribed a command that could not run, and the 2026-09-12 republish hit it. `wrangler`
takes `--env-file`, which has the tool read the file itself and matches the project's own
`tsx --env-file=.env` convention everywhere else. `pnpm publish:seasons` needs no preamble at all:
its `package.json` entry already carries `tsx --env-file=.env`.

**Row-write budget.** A full three-file seed writes about **66k rows** (measured 2026-09-12:
opr 15,888 / epa 25,140 / bpr 25,256). **Historical:** the D1 free tier's 100k row-writes/day cap
used to mean one seed pass per day was comfortable and two was not. D1 is 50M row writes/month on
the paid plan since 2026-09-22, so that daily ceiling no longer applies — still avoid re-seeding
casually during an event weekend, since a seed pass rewrites live state, not because of the write
count.
As of plan 07-17, `pnpm publish:seasons` includes offseason and preseason events (`--include-offseason`) in both the published set and the walk-forward stream — an operator running this command is entitled to know its scope changed.

Each seed file's name follows the algorithm's own registry id (`publish.ts`'s
`seed-${algorithm.id}.sql`), so the three files track the algorithm id `resolvePublishAlgorithms`
resolves for the run that generated them. **The third file was `seed-vpr.sql` in this runbook until
2026-09-11 and became `seed-bpr.sql`**: VPR is retired and no publish run produces a `vpr` seed any
more. Called out rather than silently swapped, so an operator who remembers the old name
knows it was retired rather than mistyped.

**Quick task 260912-ivg, Stage 1, reopened the same shape for the SAME reason (BPR -> SPR):**
`packages/harness/publishedAlgorithms.ts` now carries TWO id constants rather than one, and this
runbook's commands split across them by which tier they belong to:

- The **`--file`/`wrangler d1 execute` seeding commands below** run against whatever
  `pnpm publish:seasons` most recently generated — the WRITE tier
  (`PIPELINE_ALGORITHM_IDS`). As of this task, that means the third seed file is named
  **`seed-spr.sql`**, not `seed-bpr.sql`.
- **The cutover finished on 2026-09-12 and nothing here is transitional any more.**
  `PUBLISHED_ALGORITHM_IDS` names `spr`, the deployed browser bundle contains zero occurrences
  of the retired id, live D1 holds 6,314 `spr` rows at `3.0.0+baseline` and none under the old
  id, and R2 holds zero objects under it. `verifySubsetPublish` reports 50 entries checked, 0
  failing, with generation uniformity 1 at
  `2c22394b-de85-44f5-b80a-bfdca523ee98`. A seed pass still only lands `seed-spr.sql` in the
  generated-file directory (never tracked in git) and does NOT write live D1 until an operator
  runs `wrangler d1 execute` against it.

Until Stage 3, running the commands below against a freshly generated `seed-spr.sql` is exactly
Stage 3 — do not do it as part of routine re-seeding while Stage 1's source-only change is the only
thing that has landed, or the live D1 will carry `spr` rows before the Worker (Stage 4) or the
client (Stage 5) is ready to read them under that name.

### Secrets, in this runbook's own voice

This is the page someone reads while typing the command, so the rule is repeated here rather
than referenced:

- Load `.env` with `set -a; . ./.env; set +a` and reference variables **unexpanded**.
- **Never** `cat`, `echo`, `head`, `Read`, or otherwise render `.env` or any value from it —
  not into a terminal, a log, a commit message, a test name, or a planning document.
- `wrangler d1 execute --remote --file` **rejects OAuth with error code 10000**. The account id
  must be exported from the loaded environment (`CLOUDFLARE_ACCOUNT_ID`), which `set -a` above
  already does. Do not paste it inline.

This rule exists because it was broken once on this project and a live R2 access key had to be
rotated — and `scripts/secrets-boundary.test.ts` passed the whole time, so passing it is never
evidence that secrets were handled correctly.

### Seed first, deploy second — and the reverse hazard is just as bad

**When a re-baseline also carries a `STATE_SNAPSHOT_SHAPE_VERSION` bump, the seed and the
deploy are a matched ordered pair that belong in ONE window, in that order.**

They are a pair because there is no safe intermediate state, and the hazard runs in **both**
directions — the familiar one is only half of it:

- **Deploy without seeding:** the new Worker reads rows written at the old shape, throws
  `LeagueRowShapeVersionError` on every tick, and live folding is down until the seed runs.
- **Seed without deploying:** the still-old Worker reads rows written at the NEW shape and
  throws exactly the same error. Live folding is down just as hard, in the other direction.

The recovery from either is *the other command*, which costs another pass against the write cap
below. The shape check is deliberately loud precisely so this fails visibly rather than
diverging silently.

#### The state generation refusal (quick task 260920-q75, 2026-09-20)

A tick reads a marker for each live algorithm and compares it against the generation named in the
deployed R2 manifests. When a live algorithm's marker does not match that generation, the whole
tick folds nothing, advances nothing, and writes nothing, and it logs one structured line whose
`msg` field reads `state-generation-mismatch`. Seeing that line in `wrangler tail` means D1 has not
yet been seeded from the generation the manifests now name. Folding is suspended, not broken. The
line carries the manifest generation and each live algorithm's own marker value, so the operator can
read exactly what disagrees straight from the log line.

The fix is always the same command, regardless of which side is stale: apply
`reports/publish/seed-cursors.sql` from the most recent publish run. It is never a redeploy, and it
is never a state file alone, since the marker only lands once the matching state rows are already
present.

State the bootstrap plainly, since it is easy to discover only by reading a tail rather than this
page. Live D1 today holds no marker row at all for any algorithm. The very first deploy of a Worker
built after this quick task refuses to fold, on every tick, until the next seed pass lands
`seed-cursors.sql`. That is consistent with this section's own seed first, deploy second rule above,
and it is worth naming here rather than discovering it as an unexplained `state-generation-mismatch`
line the first time this Worker version runs.

**Outstanding shape obligation as of 2026-09-11.** Live D1 and the deployed Worker are at
**shape 11**. Four bumps have landed in the repository since, none of them seeded or deployed:

| Bump | Landed by | What it added |
|---|---|---|
| 11 -> 12 | quick task `260911-3kc` | EPA's season-boundary carry scale |
| 12 -> 13 | quick task `260911-j2w` | EPA's week-1 calibration |
| 13 -> 14 | quick task `260911-l2k` | EPA's foul rate |
| 14 -> 15 | plan 09-08 (D-21) | the live Worker's ranking-point beliefs |

**All four are closed by the same single seed-and-deploy pass** — this is one pass, not four.
`260911-3kc`'s own plan recorded "No republish runs. No R2 write, no D1 seed, no
publish:seasons, no deploy", and each bump since inherited that debt. Live folding is currently
down-level and latent only because nothing is live.

**Shape 16, 2026-09-14 (quick task `260914-01x`).** The table above is history: the 2026-09-12
seed closed it and live D1 has read shape 15 since. Shape 16 adds `sigmascoutRpMeanShift` to the
**spr league row**: the ranking-point mean shift, a count and a sum per threshold variable. The
Worker resumes it at tick start (`readRpMeanShift` → `RpMeanShiftAccumulator.fromState`), applies it
to fully-warm alliances in `rpFieldsFor`, books each played match's residuals with `observeMatch`
just before `foldObservedRp`, and writes it back beside `withRpBeliefs`. That mirrors
`SigmaScoutLayer` field for field and costs no extra subrequests.

- **Order.** Publish, then seed `seed-spr.sql`, then deploy the Worker. Seed first, deploy second,
  as above. Only `seed-spr.sql` carries the passenger, because opr and epa publish no ranking
  points. The live tier is spr only (`LIVE_ALGORITHM_IDS = "spr"`), so a shape-15 opr or epa row
  never reaches the Worker. (It did reach the read-only CPU probe, which read all three; that probe
  was deleted 2026-09-23 by quick task 260923-3w4.)
- **Why the bump is load-bearing.** A shape-15 row has no passenger. Without the bump the Worker
  would resume a fresh shift and price every live match unshifted while the artifacts it serves
  are shifted, and nothing would error. The bump turns that into `LeagueRowShapeVersionError`.
- **~~The probe is a separate deployment.~~ HISTORICAL — there is no probe to redeploy.** This
  bullet used to say the read-only CPU probe had to be redeployed after the seed or it would report
  `LeagueRowShapeVersionError` against the new rows. Quick task 260923-3w4 deleted that probe
  (2026-09-23), so a seed pass now needs exactly one deploy: the production Worker's.
- **Proof.** `apps/worker/test/scheduled.rp.test.ts`'s mean-shift block folds a generated 120-match
  prior event through the real Worker (at least 200 warm observations per variable) and checks
  that the live rows equal the offline layer's. It was seen failing with the write-back removed,
  and again with the Worker's `apply` removed.

**The D1 write cap — historical.** Roughly **four seed passes used to exhaust D1's 100,000 daily
row-write cap** on the free plan (hit once, 2026-09-10), which was decidedly not benign during an
event, since exhausting it would have rejected the tick's own state writes too. D1 is 50M row
writes/month on the paid plan since 2026-09-22, so this is no longer a real ceiling on how many
seed passes a day can take. The seed files are a byproduct of `pnpm publish:seasons` and are not
produced by any standalone command, so an extra publish is an extra pass.

Skipping it breaks nothing — the site stays up and approximately fresh. It just means any drift
between the Worker's incremental folding and a from-scratch offline replay goes uncorrected until
the next run.

**A re-baseline that also bumps an algorithm's code version orphans the prior generation in R2.**
`pnpm publish:seasons` only ever `PUT`s the keys it is asked to build under the CURRENT
`{id}@{version}` — it has no cascading delete, so a version bump (e.g. a bug fix that changes an
algorithm's `codeVersion`) leaves every object under the OLD version's prefix sitting in R2
unreferenced by the manifest, still counting against the 10 GB free tier. This does NOT require a
Worker redeploy or a D1 re-seed on its own — D1's `algorithm_state` rows are keyed by
`algorithm_id` alone, never `algorithm_id@version`, so they carry over unchanged. It DOES require a
follow-up R2 cleanup pass — `pnpm cleanup:r2-generations` (list-driven; see
`docs/publish-budget.md`'s "Cleaning up superseded generations", and that file's git history for
the dated delete passes). Two full generations
coexisting is not itself a site-breaking problem (the manifest, and therefore every reader,
resolves only the current version), but it is a real, measured 66% chunk of the free tier — worth
reclaiming before the next version bump would push past it.

---

## Live folding tier (quick task 260822-wqt)

**D-04/D-05 (plans 07-16/07-18/07-19) transition — FINISHED, observed rather than declared.** The
tracked config (`LIVE_ALGORITHM_IDS = "vpr"` in `apps/worker/wrangler.toml`) went live on
2026-08-29 when plan 07-19 Task 3 ran `pnpm worker:deploy` — see the new dated deploy record below
for the deployed version id and the deploy output's confirmed vars/bindings. Every reader now
agrees: the publisher writes under `vpr@`, the deployed browser requests `vpr@` exclusively
(07-18), the deployed Worker folds `vpr` live (this record), the algorithms manifest names exactly
three ids with the retired one dropped (`v1/manifest/algorithms.json`, generation
`47d020a4-1a16-4331-bd70-ce2f468bf2d1`, unchanged by the collapse), and the retired identity now
carries zero objects in R2 under its own prefix (before/after stratified census, 07-19 Task 3/4)
and zero rows in remote D1 (`GROUP BY` read-back, 07-19 Task 3/4). The historical measurements below this note,
taken under the pre-rename identity, remain history — new measurements are recorded in their own
dated sections, never overwriting the old ones.

**Only the published algorithm folds live.** `apps/worker/wrangler.toml`'s `[vars]
LIVE_ALGORITHM_IDS` is the single place that is configured — a plain tracked value, visible in
git, following `TBA_BASE_URL`'s own precedent in the same block. Change it there, never anywhere
else.

**Why (historical basis — retired 2026-09-22, and the arithmetic DELETED 2026-09-23).**
`processEvent` used to estimate each event's whole subrequest cost up front: 18 for ONE ordinary 3v3
match with the published algorithm alone vs. 50 with all three, against ~41 subrequests actually
available per tick under the free plan (`SUBREQUEST_CAP` 50, `SUBREQUEST_RESERVE` 4, minus the
tick's own fixed costs). With all three live the event would have deferred every tick, forever —
measured on the deployed Worker during plan 04-07 under the pre-rename identity `sigma1`
[pre-rename] and recorded in [`publish-budget.md`](publish-budget.md)'s "Worker runtime budget
(D-21/D-23, plan 04-07)" section. Workers Paid's 10,000 subrequests per invocation retired that
argument on 2026-09-22, and quick task 260923-3w4 then deleted the estimate, the cap, the reserve
and every deferral path they gated on 2026-09-23, so there is no budget arithmetic left to re-derive
anywhere.

**What still holds the tier at spr is a PUBLISHED-NUMBERS decision, not a budget.** Widening
`LIVE_ALGORITHM_IDS` makes `opr`/`epa` fold live instead of refreshing at the manual re-baseline,
which changes numbers the site has already published, so it needs its own algorithm version bump and
republish. See `apps/worker/wrangler.toml`'s comment above `LIVE_ALGORITHM_IDS` for the same note.

**`opr` and `epa` remain FULLY PUBLISHED** (D-03) — every page and the Compare page still read
them; `packages/harness/publish.ts`, `packages/harness/manifests.ts` and the algorithms manifest
are untouched by this. They refresh only at the manual pre/post-event-weekend re-baseline above,
**not** on the cron. During an event weekend their numbers are as of the last re-baseline — that is
expected behavior, not a bug.

**SPR-only was decided permanent on 2026-09-13 (quick task 260913-ppk), on two reasons, one of
which has since gone.** OPR and EPA were not to be rotated into the live tick because (a) the Worker
could not sustain even SPR alone inside the free plan's 10 ms CPU budget, and (b) the per-event
cursor and the TBA ETag are shared across algorithms, so an algorithm left out of a tick would have
its matches skipped rather than caught up later. Reason (a) is gone — Workers Paid allows 30 s of CPU
per tick. Reason (b) still stands and is not a budget question at all. The full reasoning, and the
design premise any reopening must start from, is in
`.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md`.

**Adding a second id to `LIVE_ALGORITHM_IDS` is pinned** by
`apps/worker/test/liveAlgorithmTier.test.ts`, which asserts the tracked value by EQUALITY. It used
to re-derive `processEvent`'s own budget arithmetic, which quick task 260923-3w4 deleted; an equality
pin is what stops a widened tier from silently going untested. Change the pin deliberately, along
with the version bump and republish the widening needs.

**Verified 2026-08-23, all measurements below under the pre-rename identity `sigma1` [pre-rename] —
plan 07-16 renamed the identity afterward without re-running this verification, since the rename
moves no predicted number and folds no different match** (`apps/worker/test/liveAlgorithmTier.test.ts`'s
tracked-tier assertion flipped to `"sigma1,epa,opr"` [pre-rename] and observed to fail on the
arithmetic-naming message, then reverted — see that test file and its own commit):

- Deployed version `77fca208-753f-4a4b-9f91-98e32c0e1717` (tracked config). `wrangler deploy`'s
  output listed both `env.TBA_BASE_URL` and `env.LIVE_ALGORITHM_IDS ("sigma1")` [pre-rename]
  alongside the `MANIFEST`/`DB`/`ARTIFACTS` bindings and `schedule: * * * * *` (a 2026-08-23
  record — `MANIFEST` was removed 2026-09-23).
- Idle ticks on that version: 3 consecutive `"ok":true`, `eventsConsidered:0`, `subrequestsUsed:1`,
  CPU 5–6 ms — no `live-tier-defaulted` warn line, confirming the tracked var reached the deployed
  Worker.
- A real fold, driven via the replay rig (`--event 2026cmptx --algorithm sigma1` [pre-rename]
  `--match-limit 2 --live-trigger cron`) against version `6cbe6d50-c556-49df-a2f6-551030e4ed01` (the
  rig's fixture-pointed deploy): both matches folded with **zero timeouts** —
  `"eventsAdvanced":1,"eventsDeferred":0` on both advancing ticks, `subrequestsUsed` 24 then 26
  (comfortably under 46), CPU 42 ms then 208 ms (n=2). Freshness: 49,586 ms and 60,083 ms
  end-to-end (fixture reveal → published artifact), median/p95/max reported by the rig as
  49,586/60,083/60,083 ms — this includes the real one-minute cron's own scheduling jitter
  (`--live-trigger cron`), not just write-path latency.
- After the mandatory post-rig re-baseline (`pnpm publish:seasons` + the three seed imports), the
  algorithms manifest still lists `opr`, `epa`, `sigma1` [pre-rename], and an `opr` and an `epa`
  event artifact for `2026cmptx` are both still retrievable from R2 — the published set (D-03) is
  intact.

**A real bug found running this verification, fixed alongside it — also measured under the
pre-rename identity `sigma1` [pre-rename].** Cold-starting the published algorithm alone (no league
row of its own yet, `opr`/`epa` already seeded) deterministically deserialized `opr`'s league row
as its own state and crashed every tick — a pre-existing SQL operator-precedence bug in
`readScopedState` (`apps/worker/src/stateStore.ts`), unrelated to the live-tier filter itself but
only ever exercised by cold-starting one algorithm in isolation, exactly what this task needed to
verify. See that file's own comment and `apps/worker/test/readScopedStateSql.test.ts`
for the fix and its regression test.

Two new rows for this section's symptoms are added to the "When something is wrong" table below.

---

## Live-fold deploy — 2026-08-29, plan 07-19 Task 3 (the transition above, finished)

Deployed version `638da16c-d538-4551-b3a0-a2757a77061f`, confirmed at 100% by `npx wrangler
deployments list`. `pnpm worker:deploy`'s output listed `env.LIVE_ALGORITHM_IDS ("vpr")` alongside
`env.TBA_BASE_URL`, all three bindings of the day (`MANIFEST`, `DB`, `ARTIFACTS` — `MANIFEST` was
removed 2026-09-23), and `schedule: * * * * *`.
Four consecutive post-deploy ticks (taken by the plan orchestrator, immediately after the deploy)
reported `"ok":true`, `eventsConsidered:0`, no `live-tier-defaulted` warn line, and no
`EmptyLiveAlgorithmTierError` — the tracked var reached the deployed Worker and it resolved its
module set against the (still four-entry, at that point) manifest correctly. The manifest was then
collapsed to three entries (`pnpm manifest:algorithms --drop-id sigma1`) and three further ticks
after the collapse were also `"ok":true` — the deployed Worker tolerates the manifest narrowing to
exactly the ids it folds.

**Known issue, discovered re-verifying this record, NOT fixed by plan 07-19 (out of scope — no
`apps/worker` source change is authorized in that plan).** Re-tailing the SAME deployed version
(`638da16c-d538-4551-b3a0-a2757a77061f`) several hours later, on 2026-08-29 at approximately
13:57–20:00 (two separate capture windows), **every single tick observed — 7 of 7 across both
windows — returned `outcome: "exceededCpu"`, `cpuTime: 10` (pinned exactly at the free-plan CPU
budget), and an EMPTY `logs` array**, meaning the tick's own `console.log("tick", ...)` line never
executed. This contradicts the four/three healthy ticks recorded immediately above, taken on the
same version shortly after deploy. Nothing about R2 or D1's state changed between the two
observations in a way that should affect an IDLE tick's cost (an idle tick's early-exit path reads
one live-windows manifest and returns before touching D1 or any algorithm state at all — see
`runTick`'s "Step 1" comment in `apps/worker/src/scheduled.ts`), and no event was live during
either observation window. The most likely explanation, offered here as an unconfirmed hypothesis
rather than a diagnosis: this Worker's bundle (which statically imports all of
the Sigma1 core, several thousand lines grown across Phase 3, since deleted by quick task 260913-it4) has had its
cold-start CPU cost creep upward across Phase 7's accumulated commits, and an isolate evicted after
several idle hours now cold-starts consistently over the 10 ms budget, where the 2026-08-22
baseline measured only an occasional 13–14 ms cold start (itself already close to the limit, and
already flagged there as an open question whether the platform enforces it uniformly). **Routed
forward as a new, high-priority tracked finding** — see
`.planning/todos/pending/worker-tick-exceeds-cpu-budget.md` — rather than fixed or investigated
further here.

### Diagnosed, 2026-08-29 — the two paragraphs above are superseded

The cold-start hypothesis offered above is **wrong**, and so is the premise it rested on. Both are
left in place because the way they misled is itself the lesson. Full investigation:
`.planning/debug/worker-tick-exceeds-cpu-budget.md`.

- **"No event was live during either observation window" was FALSE.** The operator judged liveness
  by "is a real competition happening". The Worker judges it by the live-windows manifest, and the
  deployed manifest said two events were live: `2026azscor` and `2026scsc`. Both were `inferred`
  windows guessed from `start_date` for offseason events with zero matches in the corpus — the
  event was not running and had no schedule, so nothing an operator could see contradicted the
  assumption. **When asking "was anything live?", read the manifest, never the calendar.**
- **"The tick's own `console.log` never executed, so it died before handler code" was an unsound
  inference.** `scheduled.ts` emits its only success line as the LAST statement of the tick. An
  empty `logs` array proves the tick did not FINISH, not that it did not START. A 2026-08-29T21:55Z
  capture then caught a surviving tick logging `eventsConsidered: 2` at `cpuTime: 38` — the tick
  was running the full live path all along.

Root cause was an AND-gate, both legs now fixed:

| Leg | What | Fix |
|---|---|---|
| A (structural, latent) | The tick Zod-validated all 1,581 windows — 1,542 of them permanently closed — before asking whether any was live. 3.4–3.9 ms cold on a desktop; the 5–9 ms this doc already recorded below for an idle tick. A 1-minute cron on the free plan pays the cold price nearly every tick. | `liveWindows.ts` `loadLiveEventsAt` validates the envelope, prefilters on the interval, then schema-parses only live entries. `buildLiveWindowsManifest` also stops emitting windows that had already closed when it ran. |
| B (trigger, data) | `buildLiveWindowsManifest` guessed a 4-day window from `start_date` for any event with zero matches — 200 of them. Two opened on 2026-08-28, so the tick stopped taking its `liveEvents.length === 0` early exit and ran a ~38 ms live path against a 10 ms budget. | `buildLiveWindowsManifest` emits no window for a zero-match event. |

**Operational contract this creates — read before an event weekend.** An event is folded live only
if its matches are in the corpus. There is no longer a blind fallback window, so **ingest an event
before it runs, then `pnpm publish:seasons`.** This is not onerous: TBA publishes match schedules
well ahead of an event, and `sort_time` falls back to `predicted_time ?? time`, so a
merely-scheduled event already produces a real, measured window. The "`eventsConsidered: 0` all
weekend" row in the troubleshooting table below is the symptom to watch for, and re-running
`pnpm publish:seasons` is still the fix.

**SUPERSEDED 2026-09-20 (quick task 260920-lny).** "TBA publishes match schedules well ahead of an
event" is false for offseason play — Chezy Champs 2026 published 86 matches two minutes after its
last manifest publish, with zero matches in the corpus beforehand. A zero-match event now gets a
calendar PROBE window instead of none, safe because the Worker never treats it as foldable without
first proving matches exist. See the "Before an event: probed automatically, and what ingest +
republish still buys you" section below for the current contract; this paragraph is left in place
as outage history, not current operation.

### How the CPU budget is actually enforced — corrected 2026-08-29

> **Plan change, 2026-09-22.** The account moved to Workers Paid; the per-invocation CPU limit is
> now 30 s, not 10 ms. Everything in this section describes the free-plan regime the project
> operated under until then. The isolate-flexibility finding and the "design against the limit,
> never against the flexibility" rule below are kept intact — both are still sound engineering
> advice at any limit, they just apply to 30 s now instead of 10 ms.

This project spent an entire investigation assuming the free plan kills any invocation at exactly
10 ms. **It does not, and that assumption misdirected hours of work.** The constant is right; the
enforcement model was not.

10 ms is the *configured* CPU limit for a Cron Trigger on Workers Free — confirmed by direct fetch
of Cloudflare's [limits page](https://developers.cloudflare.com/workers/platform/limits/) on
**2026-08-29**, and `apps/worker/wrangler.toml` sets no `[limits]` / `cpu_ms` override, so the
platform default applies. But Cloudflare documents, in that same section:

> Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs
> over the configured limit. If your Worker starts hitting the limit consistently, its execution
> will be terminated according to the limit configured.

This Worker's own numbers prove it independently of the docs. Version `638da16c` returned
`outcome: "ok"` at `cpuTime: 38` (21:55:44Z) and was killed at `cpuTime: 10` **sixty seconds
later**, on identical code and an identical manifest. No single threshold explains both.

Everything this Worker has ever recorded:

| outcome | observed `cpuTime` (ms) | where |
|---|---|---|
| `ok` | 5, 6, 7, 8, 9 (median 7, n=10) — plus a **14 ms** cold start in the same run | 2026-08-22, v`5a8e0a6f`, idle |
| `ok` | 5–6 (n=3) | 2026-08-23, v`77fca208`, idle |
| `ok` | **42**, then **208** | 2026-08-23, v`6cbe6d50`, real folds via the replay rig |
| `ok` | **38** | 2026-08-29T21:55:44Z, v`638da16c`, full live path |
| `ok` | 17, 21, 30 | 2026-08-29, v`6c9c93dd`, full live path, post-fix |
| `exceededCpu` | **exactly 10, on all 11 observations** — never 9, never 11 | 2026-08-29, v`638da16c` |

**How to read a `cpuTime` number, given that:**

- A kill always reports exactly 10 because the invocation is *terminated at* the configured limit.
  The reading is consumption truncated by the kill — not a measurement of what the tick wanted.
- **One tick over 10 ms is not a defect.** Infrequent overruns get absorbed. That is all the 14 ms
  cold start and the 42/208 ms rig folds ever were.
- **Every tick over 10 ms is a defect, and it is the one that takes the site down.** The operative
  boundary is not "a tick costs more than 10 ms" but "***every*** tick costs more than 10 ms".
  That is exactly the transition the 2026-08-28 outage made: a week of 5–9 ms idle ticks, then
  every tick on a 38 ms live path, then 100% termination — with no deploy in between.
- Design against 10 ms. **Never design against the flexibility.** Its size, scope and replenishment
  rate are undocumented and unmeasured here, and the 208 ms success is the least-explained reading
  in the table above.

**Startup time is a separate budget — module init is not charged to the invocation.** Cloudflare
allows **1 second** of startup time (limits page, "Worker startup time"), validated at deploy time
as error `10021`; `wrangler deploy` prints the measured value. This Worker reports **76 ms**, well
inside it. The proof that init is not billed to the tick is arithmetic rather than documentary: a
tick completed at `cpuTime: 38`, which is impossible if 76 ms of init came out of the same budget.

---

## Fixed and verified — 2026-08-29, version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`

`pnpm worker:deploy`: upload 933.39 KiB / gzip 154.48 KiB, **Worker Startup Time 76 ms**, triggers
deployed, no upload exception and no `ManifestValidationError` against the artifact already in R2.

Three consecutive ticks on a bounded tail: **all `outcome: "ok"`, `exceptions: []`**, at `cpuTime`
**21 / 30 / 17 ms** (wall 709 / 1250 / 635 ms), two carrying full `"ok":true` log lines with
`subrequestsUsed: 8`.

**Why this verifies the fix and not the calendar.** Every one of those ticks reported
`eventsConsidered: 2` — the two phantom windows were *still in the deployed artifact* and the tick
was *still running the full live path* that measured 38 ms before the fix. Leg B, and the
build-time half of leg A, only land on the next `pnpm publish:seasons`. So the read-path fix
**alone** took a 38 ms path down to 17–30 ms, on live traffic, with the trigger still armed — and
it was captured before the two windows expired on their own (2026-09-01 and 2026-09-02), after
which no observation could have separated the fix from the calendar. **That window is now closed:
this is the only such measurement that will ever exist.**

**Still outstanding, and deliberately not blocking:** `pnpm publish:seasons` republishes the
live-windows manifest, which is what actually removes the 200 `inferred` entries and the 1,542
permanently-closed windows from the artifact. That is *recurrence prevention*, not verification of
the fix. It rides along with the republish already queued for the demo-team exclusion workstream.

---

## Live events need no operator (quick task 260921-5qw)

Nothing has to be done by hand DURING a live event. An event the Worker promotes from a probe window
is complete on its own:

| The page needs | Where it comes from |
|---|---|
| name, dates, week, tier cuts | a STUB event artifact published ahead of time for every probe-window event |
| upcoming-match pricing | the tick completes the `state` block from D1 itself, one read, only when the block is incomplete (`event-state-block-completed` in the log) |
| the event on robot pages | `v1/live-roster/{eventKey}.json`, written by the tick when the roster grows, read by a current-season robot page for windows open now |

- **New events on the calendar:** a full `pnpm publish:seasons` emits the stubs. To get them out
  WITHOUT a full republish (about 109,000 R2 writes), run `pnpm publish:stubs` (about 120). It reads
  the live manifest, never overwrites an existing artifact, and supports `--dry-run`.
- **Looking at a live event afterwards:** Workers Logs is on at 100 percent sampling
  (`[observability]` in `wrangler.toml`), so every tick's `outcome` and `cpuTime` is retained. Nobody
  has to tail during the event.
- **Still an ordinary republish, any time after the event:** making results permanent in the team
  season files. The live rows stay in the event artifact until then.
- **Why `pnpm rebaseline` is NOT scheduled:** it needs the local corpus and rewrites all ten seasons,
  about 109,000 R2 writes a run against a 1,000,000 a month free tier.

## PRE-SEASON GATE (LIFTED 2026-09-22): historical record — do not open a live window until the RP fold fits the CPU budget

> **LIFTED 2026-09-22.** The Cloudflare account moved to Workers Paid, raising the per-invocation
> CPU limit from 10 ms to 30 s and subrequests from 50 to 10,000. This gate's entire basis — an RP
> fold measured against a 10 ms sustained budget and not fitting it — is gone, and there is no
> live-window prohibition in force. `.planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md`
> records the closure: the constraint this gate existed to work around no longer applies, and no
> observation or experiment is owed. Every instruction below this point, including the "Tail the
> first one" ask in the 2026-09-21 update immediately below and the "Do not open a live window"
> sentence further down, is history — none of it is a live instruction any more. It is kept as the
> record of why the gate existed and how the design around it evolved.

> **NO LONGER IN FORCE since 2026-09-21. Read this before anything below.** Jacob locked the
> live-probe design on 2026-09-20 (quick task 260920-lny) so that fall offseason events go live
> without a manual ingest, after Chezy Champs 2026 was missed, and generation `8caca9d2` was then
> published with 40 probe windows in `v1/manifest/live-windows.json`. Worker `6631ba04` probes each
> open window with one conditional TBA request and PROMOTES the event to live folding as soon as
> matches exist. So live windows are open in production and the rule below is history.
>
> **What did NOT change:** `rp-fold-exceeds-worker-cpu-budget` is still open. The last measurement
> had a folding tick in the mid-teens of milliseconds on a reused isolate and 35 to 45 ms on a fresh
> one, against 10 ms sustained. Probe-only ticks cost 2 to 3 ms (observed 2026-09-21, `2026txrm`).
> **No real fold has run in production yet.** Tail the first one: read `outcome`, `cpuTime`,
> `eventsAdvanced`, `eventsFailed` and `stateGenerationMismatch`, and treat `exceededCpu` as the
> 2026-08-28 outage condition. The text below is kept as the record of why the gate existed.

**In force 2026-09-12. This gate is the condition on which Phase 9 sealed without live proof — see
`.planning/phases/09-analytic-ranking-points-browser-side-simulation/09-UAT.md` test 1.**

**[LIFTED 2026-09-22 — see banner at the top of this section] Do not open a live window — do not
ingest an in-progress event, do not let a window appear in `v1/manifest/live-windows.json` — until
`.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` is closed.** (That todo is now in
`.planning/todos/completed/`.)

The measurement, from the deleted CPU probe's first real run (`318caa2f` against live D1,
2026-09-12; the full record is in git history, the probe having been deleted 2026-09-23): a realistic mid-quals tick — 2 newly folded matches,
60 still upcoming — costs **13 ms p50 / 28 ms p90 in Phase A alone**, against a **10 ms sustained**
budget. That excludes Phase B, the TBA poll, the manifest read (from KV then, R2 only since
2026-09-23) and the global rebuild, and it is
for **one** event and **one** algorithm; a regional weekend runs several events concurrently, and
the subrequest budget has a deferral valve while CPU has none.

**Why this is a gate and not a warning.** The budget is not a flat per-invocation ceiling —
termination follows from hitting it *consistently*, which is exactly what a sustained p50 above
budget for a whole event weekend describes. The precedent is 2026-08-28: every tick died
`exceededCpu` for days, and nothing on the site said so. A visitor reads confidently stale numbers
all weekend with no signal. See ["How the CPU budget is actually enforced"](#how-the-cpu-budget-is-actually-enforced--corrected-2026-08-29).

**The upcoming-repricing loop is gone (260915-isq).** The tick no longer predicts, bands or prices
RP for still-upcoming matches: it writes them schedule-only and keeps the SPR event artifact's
`state` block current, and the browser prices the schedule from that block (step 3 of the
browser-pricing direction in the todo above). That removes the dominant term the measurement above
was taken with. **The gate stays in force** until step 4 re-measures the tick without the loop and
the remaining DATA-04 row-parity items land. The measurement above is the dated evidence the gate was
set on; it no longer describes the current tick.

**RE-MEASURED 2026-09-15 (quick task 260915-qgf), and the gate STAYS CLOSED — Jacob, 2026-09-15.**
The probe was re-mirrored to the tick at `7385bad6` and gained a Phase B arm. 9 arms, 30 s spacing,
13 rounds each, reused-isolate stratum:

- **Phase A is fixed.** All RP on now costs 9.6 ms mean (p50 8), 17% of requests over 10 ms, against
  16.2 ms on 2026-09-14. The RP path as a whole is 2.8 ± 1.8 ms and **no longer resolvable**; every
  component is below resolution. Phase A on its own would fit.
- **Phase B is the new blocker, measured for the first time: +64.0 ± 9.3 ms.** With RP fully off it
  is still +52.3 ms. The `allPhaseB` arm's absolute mean is 73.6 ms with **100%** of requests over
  10 ms. The cost is `JSON.parse` + zod validation + `JSON.stringify` of whole artifacts (a 106 KB
  event artifact and 12 team artifacts per tick), not the fold. R2's round trips are I/O and never
  entered `cpuTime`.
- A real tick at ~70 ms against a 10 ms budget on every request is the 2026-08-28 condition, and
  worse than the 13 ms this gate was set on. It was invisible until now because every prior
  measurement was Phase A only.

Full numbers, provenance and the directions worth pricing are in the todo's "RE-MEASURED AFTER
BROWSER PRICING" section. The gate lifts only when Phase B's cost comes down and a re-measurement
(the CPU probe's `phaseB=1` arm existed for exactly this, until quick task 260923-3w4 deleted the
probe along with the budget it measured against) shows a tick that fits.

---

## Before an event: probed automatically, and what ingest + republish still buys you

**Operational contract, corrected 2026-09-20 (quick task 260920-lny).** From 2026-08-29 to
2026-09-20 this section said an event must be in the corpus with at least one match before the
Worker will ever poll it live, "because TBA publishes match schedules days before an event runs."
That premise is FALSE for offseason play: Chezy Champs 2026 (`2026cc`, event_type 99) published 86
real matches whose first `sort_time` landed two minutes AFTER the last manifest publish before it
started — under the old rule it never got a window and was never picked up live. Forty more 2026
offseason events were queued to fail the identical way.

The outage history below is still exactly why a BLIND window is dangerous, and it is still true
that `buildLiveWindowsManifest` never marks a real, measured window `inferred`. What changed is
that a zero-match event now gets a window instead of none — a **probe** window,
`[start_date 00:00 UTC - 12h, +4 days)`, marked `inferred: true` — and the Worker never treats
`inferred: true` as foldable on the strength of the window alone. It answers liveness for a probe
window with exactly ONE conditional TBA request (`apps/worker/src/scheduled.ts`'s `runProbes`) and
does nothing else that tick — no algorithms manifest, no `buildAlgorithmModules`, no D1 batch, no
artifact write — unless that poll actually returns matches. Only then does the event enter the
ordinary live path, at the cost of exactly one more TBA request for that event (never a repeated
poll of the same probe). This is what makes it safe to reintroduce the same field the 2026-08-29
outage's cause B abused: `inferred: true` is now a contract the Worker enforces on the read side,
not a value nothing ever checked.

**Per-tick cost.** `1` (the live-windows manifest read) plus `2` per probe (a cursor read plus the
poll), for EVERY open probe window, EVERY tick. The 40 windows of 2026-09-20's manifest are 81
subrequests, against 10,000 per invocation on Workers Paid.

**No cap and no rotation slice since quick task 260923-3w4 (2026-09-23).** This used to probe at most
`MAX_PROBES_PER_TICK` (6) windows per tick, the slice chosen by a clock-derived offset, so that a busy
offseason weekend could not spend the free plan's ~41 usable subrequests on discovery alone — at the
cap that was `1 + 2*6 = 13`, and nine concurrently-open windows took two ticks to cover. The
operational consequence of removing it: **a newly-started event is discovered on the next cron
minute, not up to `ceil(n/6)` minutes later.** That lag is the same failure mode the whole probe
mechanism exists to prevent — Chezy Champs 2026 posting 86 matches two minutes after the last
manifest publish — so with the cap gone there is no discovery delay left to reason about.

**Two new tail fields.** `eventsProbed` (probe windows this tick answered liveness for, whether or
not they promoted) and `eventsPromoted` (probes that saw real matches and were folded this tick).
`eventsProbed` above zero with `eventsPromoted` at zero is a healthy idle offseason weekend — the
Worker is checking, nothing has started yet. `eventsPromoted` above zero is an event that has
started.

**What a probe does NOT fix.** A promoted event that was never ingested + republished offline still
renders degraded: it has no SPR `state` block, so its upcoming matches cannot be priced in the
browser (see the `event-state-block-missing` bullet below for the symptom); it has no `name`,
`startDate` or `week`; its `teams` rows carry no TBA rank or record; and it does not appear in the
events list, which only the offline publish writes. Ingest + republish stays the way to make an
event a first-class page — the probe only makes its results appear without that step:

```bash
# To give a live-probed event a name, a state block and an events-list row:
pnpm ingest --event <eventKey>     # or a full pass
pnpm publish:seasons               # rebuilds live-windows.json, seeds a state block, adds the list row
```

Check what the Worker currently believes is live, split into measured and probe-only:

```bash
curl -s https://data.sigmascout.org/v1/manifest/live-windows.json | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const n=Date.now();
    const live=j.windows.filter(w=>w.startMs<=n&&n<w.endMs);
    console.log("windows:",j.windows.length,"live now:",live.length,
      "of which probe-only:",live.filter(w=>w.inferred).length);})'
```

A count of `0` live windows is normal out of season — it means no event has a measured or
calendar-probe window covering right now. A non-zero **probe-only** count with the Worker's own
`eventsPromoted` staying at `0` is also normal: it means the Worker is checking a calendar window
that has not started producing matches yet, not that anything is broken.

### Publish with state blocks before the window opens (260915-isq)

**Operational contract.** Before an event's live window opens:

1. The event must be published by code that writes the SPR `state` block (quick task 260915-isq or
   later). An SPR event artifact carries one when it has at least one upcoming match **and** its
   schedule is current: its latest scheduled match is no more than 7 days before the publish
   (`eventScheduleIsCurrent`). Long-finished events whose leftover matches were never played get no
   block. A publish before the event's schedule has passed always qualifies.
2. D1 must be seeded from the **same** publish run (`reports/publish/seed-spr.sql` from that run).
   The block and D1 must describe the same state.
3. Step 3 of the browser-pricing direction must have shipped. Until the web reads event artifacts
   with `LiveEventArtifactSchema`, an artifact the Worker wrote with upcoming matches does not parse
   on the event page, because its upcoming rows are schedule-only (260915-isq DD-1). The web switch
   is quick task 260915-m4j: code-complete at its commit, and live once that web deploy lands.

**Why the pairing matters.** Each tick splices the D1 rows it just wrote into the published block:
touched teams' rows and the league row come from D1, untouched teams' rows stay the publish's copy.
The block is only exact if the publish and D1 started from the same state. The Worker **never
bootstraps a block** from D1; an artifact without one stays without one until the next republish.
Once an event's last match is folded, the block is dropped.

**Reading the tick-log warnings:**

- `event-state-block-missing` (`eventKey`, `algorithmId`, `upcoming`): the SPR artifact the tick
  read carries no block. It was published before 260915-isq, the event had no upcoming matches when
  it was published, or its schedule was more than 7 days stale at publish time. The tick wrote the artifact without a block, so upcoming matches
  cannot be priced in the browser. Republish and re-seed D1 from that run before the next tick.
- `event-state-block-invalid` (`eventKey`, `algorithmId`, `upcoming`, `error`): the block's
  algorithm version or snapshot shape does not match the deployed Worker's rows (for example a
  publish from before an SPR version bump). The tick dropped the block. Republish and re-seed as a
  matched pair.

---

## Pre-event probe — DELETED 2026-09-23 (quick task 260923-3w4)

A separate read-only Worker (`apps/worker/src/stateProbe.ts`, `wrangler.probe.toml`, deployed with
`pnpm --filter worker run deploy:probe`) used to answer two pre-event questions by hand: can the
deployed bundle deserialize the rows now in D1, and what does a folding tick cost in real Workers
CPU time. Its ablation arms (`rp=`, `rpSkip=`, `phaseB=`, `normalize=`, `teams=`, `event=`) existed
to attribute milliseconds against a 10 ms per-invocation CPU budget.

**That budget no longer exists.** The account moved to Workers Paid on 2026-09-22: 30 s of CPU per
cron tick, 10,000 subrequests per invocation. The probe measured a ceiling three orders of magnitude
below the current one, so every number it produced is about a retired regime, and the standing rule
since the plan change is that no CPU-ms bar is proposed again. The whole instrument — source, tests
and its own wrangler config — was deleted under quick task 260923-3w4 on Jacob's decision
(`.planning/quick/260923-1tu-workers-paid-rearchitecture-audit-find-c/260923-1tu-FINDINGS.md`,
item C2).

Its second job, proving the deployed bundle can read live D1 rows, is already covered on the live
path: `STATE_SNAPSHOT_SHAPE_VERSION` makes a shape disagreement a loud `LeagueRowShapeVersionError`,
the generation-mismatch suspension above makes an unseeded generation a `state-generation-mismatch`
line rather than a bad fold, and the seed-first-deploy-second order in
["Seed first, deploy second"](#seed-first-deploy-second--and-the-reverse-hazard-is-just-as-bad) is
what keeps the two sides matched. There is nothing to redeploy after a seed any more, and no
`deploy:probe` script.

The probe's own measurement records are not reproduced here. They are in git history (the file was
present through `08384620`) and in
`.planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md`, which the 2026-09-22 plan change
closed.

---

## Watching it

```bash
cd apps/worker
npx wrangler tail sigmascout-worker --format json
```

Every invocation emits exactly one structured line:

```json
{"msg":"tick","ok":true,"durationMs":152,"eventsConsidered":0,"eventsAdvanced":0,
 "eventsFailed":0,"eventsProbed":0,"eventsPromoted":0,"tbaRequests":0,
 "subrequestsUsed":1,"globalRebuildRan":false}
```

That is a healthy idle tick: nothing live, one manifest read, zero TBA requests. **There is no
`eventsDeferred` field any more** — quick task 260923-3w4 deleted the deferral it counted, so a tick
log from before 2026-09-23 carries one and a current tick does not. `subrequestsUsed` stays: it is
how an event weekend's shape is read without a tail. A tick during an
offseason weekend with an open calendar probe window but no matches posted yet looks the same
except `eventsProbed` is above zero (`eventsPromoted` stays `0` until TBA actually returns
matches) — see "Before an event: probed automatically, and what ingest + republish still buys
you" above. A failing tick logs `"ok":false` with an `error` field and is recorded as a failed
invocation in the dashboard.

Retained logs, CPU time and subrequest counts are in the dashboard under **Workers & Pages →
sigmascout-worker → Observability**. Observability is enabled at `head_sampling_rate = 1.0` in
`wrangler.toml`; at ~1,440 events/day sampling would save nothing worth the blind spots.

Measured idle-tick cost (10 consecutive invocations, 2026-08-22, version `5a8e0a6f`): CPU median
**7 ms**, range 5–9 ms, with a **14 ms** cold start; wall time median 168 ms; 1 subrequest; 0 TBA
requests. All ten returned `ok`.

Two things about that line were missed at the time, and both are worth naming. First, a *do-nothing*
tick spending 5–9 ms of a 10 ms budget is not a healthy baseline — it is a defect with no headroom,
and it was half the 2026-08-28 outage. Second, the **14 ms cold start that returned `ok`** was, under
the flat-ceiling model everyone was working from, an impossible observation; it was written down as
an open question rather than pulled on. It was in fact the first visible evidence of the isolate
flexibility described under ["How the CPU budget is actually enforced"](#how-the-cpu-budget-is-actually-enforced--corrected-2026-08-29)
above. An observation your model says is impossible is the most valuable one you have.

---

## When something is wrong

| Symptom | Likely cause | First thing to check |
|---|---|---|
| Artifacts stale during a live event | Cron not firing, the event is outside its manifest window, or it is still probe-only (TBA has not returned matches for it yet) | `wrangler tail` — are ticks arriving ~60 s apart at all? If yes, check `eventsProbed`/`eventsPromoted` FIRST: `eventsProbed` above zero with `eventsPromoted` at zero means the Worker is checking a calendar probe window but TBA has not returned matches for it yet — this is normal right up until the event's first match posts. Only if `eventsProbed` is also `0` does the live-windows manifest not think anything is live at all (check `eventsConsidered` next) |
| Ticks arriving but `eventsConsidered: 0` and `eventsProbed: 0` all weekend | The live-windows manifest went stale — nothing has republished it, or the event genuinely has no window (measured or probe) covering now | Fetch `https://sigmascout.org/v1/manifest/live-windows.json` and check its `computedAt`. Fix by re-running `pnpm publish:seasons` |
| `"ok":false` in the tick log | A tick is throwing | Read the `error` field first. At 10,000 subrequests per invocation (Workers Paid, since 2026-09-22) the subrequest cap is unlikely to be the cause, and since quick task 260923-3w4 nothing in the Worker refuses work over it — a tick that really exceeded it would throw from the platform. Check `subrequestsUsed` on the surrounding ticks to rule it out, not as the first suspect |
| Predictions look wrong but ticks are healthy | Live state has drifted from the offline authority | Re-baseline (above). The offline snapshot always wins; never hand-edit D1 rows |
| No logs at all in `wrangler tail` | Either nothing is firing, or a version without logging is deployed | `wrangler deployments list` — confirm the current version is at or after `0210df9e`'s deploy. Before that commit the Worker logged nothing, and a silent tail meant nothing either way |
| `opr` or `epa` metrics look stale mid-event while `spr` updates | Expected — only `spr` folds live (see "Live folding tier" above) | `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; refresh via a re-baseline (above) |
| A `live-tier-defaulted` warn line in the tail | `LIVE_ALGORITHM_IDS` did not reach the deployed Worker (e.g. a `--var` deploy that did not carry tracked vars through) | Redeploy from tracked config with `pnpm worker:deploy` and confirm the deploy output lists both `TBA_BASE_URL` and `LIVE_ALGORITHM_IDS` |
| `outcome: "exceededCpu"` with an empty `logs` array on **every** tick | The tick is *consistently* over the CPU budget (30 s per invocation, Workers Paid since 2026-09-22 — was 10 ms on the free plan). It is reaching the handler and dying before its final log line — it is **not** dying in module init (that is a separate 1-second budget) | `eventsConsidered` on any tick that does survive. If non-zero, fetch `https://data.sigmascout.org/v1/manifest/live-windows.json` and see what the Worker thinks is live — **read the manifest, never the calendar**. Read "How the CPU budget is actually enforced" above before drawing any conclusion from a single high `cpuTime` |
| About to run an event; unsure the deployed bundle can read the rows in D1 | Untested since the last seed — a green idle tick does not exercise it | Apply `seed-cursors.sql` from the same publish run and deploy in that order, then watch the first tick for `state-generation-mismatch` or `LeagueRowShapeVersionError`. (The pre-event probe that used to answer this by hand was deleted 2026-09-23 — see "Pre-event probe" above) |
| An `event-state-block-missing` warn line in the tail | The SPR event artifact was published before 260915-isq, or had no upcoming matches at publish time; the Worker never bootstraps a block | Republish and re-seed D1 from the same run before the next tick (see "Publish with state blocks before the window opens") |
| An `event-state-block-invalid` warn line in the tail | The published block's algorithm version or snapshot shape does not match the deployed Worker's rows; the tick dropped it | Read the `error` field, then republish and re-seed as a matched pair |

---

## Rolling back

```bash
cd apps/worker
npx wrangler rollback
```

**Rolling back the Worker does not roll back D1 state.** Code and state are separate: a rollback
reverts the tick logic, but whatever that logic already folded into `algorithm_state` stays folded.
If the state itself is suspect, re-baseline from the offline snapshot — that is the only supported
way to correct it, and it is authoritative by design.

---

## Site hosting and R2 CORS (plan 05-01)

The site (`apps/web`) and the artifact bucket live on **two different hostnames on purpose**
(D-17, amended 2026-08-24). Cloudflare Pages project **`sigmascout-web`**, production alias
`https://sigmascout-web.pages.dev`, custom domains **`https://sigmascout.org`** (canonical) and
**`https://www.sigmascout.org`**. Artifacts are served from **`https://data.sigmascout.org`**, an R2
custom domain with no compute in the path (Phase 4 D-25, which names no hostname and is unaffected).

**Why the apex serves the site.** D-17 originally gave the apex to R2 and put the site on `www`.
That left `https://sigmascout.org` — the address people actually type — returning a Cloudflare 404,
because R2 serves objects by path and has no `/` or `/teams` object. The Blue Alliance and Statbotics
both serve from their apex; matching that convention is worth more than leaving the naked domain
dead. Swapped 2026-08-24, within D-17's own stated reversibility envelope ("DNS + one CORS origin
string").

**Why not one hostname.** An R2 custom domain claims the *whole* hostname it's attached to — it
cannot share a hostname with a Pages project without a proxy Worker sitting in front of every
artifact read, and NAV-06 rules out any compute in that path. Two hostnames costs one CORS policy;
sharing one costs a Worker on every read.

**The CORS policy.** `infra/r2-cors.json` is the tracked source of truth — this file holds no
credential, only public origin strings. `origins` lists the **site's** origins (apex, `www`, and the
Pages production alias) — not the artifact host. Per D-18, a wildcard origin is forbidden even
though the data itself is public. Re-apply it after any change:

```bash
npx wrangler r2 bucket cors set sigmascout-artifacts --file infra/r2-cors.json --force
npx wrangler r2 bucket cors list sigmascout-artifacts   # confirm what R2 actually stored
```

**Preview deploys are deliberately not allow-listed.** Every Cloudflare Pages preview gets its own
per-deployment hostname (`https://<hash>.sigmascout-web.pages.dev`), and CORS origins can't be
wildcarded per D-18 — so a preview's artifact fetches will fail CORS by design. Test a preview
build against a local artifact fixture (`VITE_ARTIFACT_ORIGIN` override, see
`apps/web/src/lib/artifactOrigin.ts`), or measure against the stable production alias instead.

---

## After a web deploy: check the assets are actually servable (quick task 260917-hul)

**This section is about the `apps/web` Pages deploy, not the Worker.** It lives in this file because
the section directly above it already owns the site's hosting — the Pages project, the custom
domains, the CORS policy — and an operator hunting a deploy remedy is already reading here. A
separate one-section web doc would be a doc nobody finds at the moment they need it.

**The failure it catches.** On 2026-09-17 sigmascout.org served a blank page to every real visitor
while `curl` reported a healthy site. The edge held `index.html` (`content-type: text/html`, status
200) under `/assets/index-<hash>.js` and `/assets/index-<hash>.css`, but **only for requests carrying
an `Origin` header**. Browsers always send `Origin` for those files, because Vite emits
`<script type="module" crossorigin>` — so every browser got HTML where a module was expected and
rendered nothing, while every plain `curl` of the same URL seconds later returned the correct file.
`public/_headers` marks `/assets/*` `immutable`, so the bad object stuck. Full reproduction, and why
the routing-level fixes (`_redirects` 404, a top-level `404.html`, Pages Functions middleware) were
all rejected, in `.planning/todos/pending/pages-deploy-can-poison-asset-cache.md`.

**Where it fits.** Run it as the LAST step of any push that deploys the web app, before the live
Playwright suite — it takes seconds and it names the remedy, where a mass e2e failure only tells you
something is wrong. (The e2e suite does detect this: 170/170 → 67 → 160 failures on the day. Treat a
mass e2e failure immediately after a deploy as a live outage until proven otherwise, never as
flakiness.) Give Pages a moment to finish the deploy first; a fresh deploy that has not propagated
is a different failure from a poisoned cache.

```bash
pnpm check:deployed-assets                          # defaults to https://sigmascout.org
pnpm check:deployed-assets -- --base https://sigmascout-web.pages.dev
pnpm check:deployed-assets -- --json                # machine-readable, same verdict
```

It fetches the deployed HTML, extracts every same-origin `/assets/` URL it references, and requests
each one **twice** — once bare, once shaped like a browser (`Origin`, plus `Sec-Fetch-Dest` /
`Sec-Fetch-Mode` / `Sec-Fetch-Site` for that asset's kind). It fails when either variant is served
`text/html`, when the two disagree on content-type, or when they carry different strong `ETag`s, and
it prints `cf-cache-status` and `Age` for both — two different `Age` values on one URL is what proved
there were two distinct cached objects behind it. Exit 0 on PASS, 1 on FAIL.

**It reads nothing but public URLs: GET only, no auth, no `.env`.** Keep it that way — it is meant to
be runnable by anyone, anywhere, including from a machine that has no credentials at all.

The one-line manual form, if you want to check a single asset by hand:

```bash
curl -sI <asset-url> -H "Origin: https://sigmascout.org" | grep -i content-type
```

`text/html` on a `.js` or `.css` URL means poisoned.

**If it reports HTML under an asset URL, or the two variants disagreeing: Cloudflare dashboard →
Caching → Configuration → Purge Everything.** A single-file purge may not be enough — Cloudflare's
own docs say a dashboard single-file purge does not invalidate objects cached with header variants,
and they name `Origin` among those headers. After purging, re-run the check (both variants should
come back `MISS` with correct types) and then re-run the live Playwright suite. The script prints
that remedy only for those cache-shaped failures; a plain 404 or an unreachable host is a different
problem and a purge will not touch it.

`scripts/checkDeployedAssets.ts` takes its `fetch` as an argument, so `checkDeployedAssets.test.ts`
drives every verdict — poisoned, healthy, 404, content-type disagreement, a document referencing no
assets at all — offline, with no network.

---

## Replay rig (plan 04-07)

`scripts/replayRig.ts` drives a real historical event through the deployed `sigmascout-worker`'s
real `scheduled()` path, over HTTPS, to measure freshness (D-20/SC-2) and prove online/offline
equivalence (D-14). It substitutes for TBA with a **second, minimal Worker**,
`apps/worker/src/fixtureServer.ts` / `wrangler.fixture.toml`, deployed separately as
`sigmascout-fixture-rig`, serving real-corpus-derived TBA-shaped JSON from the SAME
`sigmascout-artifacts` R2 bucket under a `fixtures/` prefix.

**The override is a plain, tracked config value, never a back door.** `apps/worker/wrangler.toml`'s
`[vars]` block declares `TBA_BASE_URL`, defaulting to the real TBA base — visible in git, not a
secret. The rig substitutes the fixture Worker's URL for the duration of one measurement run via a
deploy-time flag only, never by editing the tracked file:

```bash
cd apps/worker
npx wrangler deploy --var "TBA_BASE_URL:https://fixture-rig.sigmascout.org"
# ... run the rig ...
npx wrangler deploy   # restores the tracked default — the rig itself does this in a try/finally
```

**The fixture Worker needs its own custom domain, not a `*.workers.dev` URL.** A `fetch()` from
inside one Worker to another Worker's `*.workers.dev` subdomain is intercepted by Cloudflare's own
`workers.dev` zone and returns a bare 404 rather than routing to the target script — discovered
running this plan's own first real rig experiment (see `04-07-SUMMARY.md`). `wrangler.fixture.toml`
routes `sigmascout-fixture-rig` to `fixture-rig.sigmascout.org` instead — a custom domain on the
same zone R2's own custom domain (`sigmascout.org`) already uses, which has no such restriction.

**Deploying/updating the fixture Worker:**

```bash
cd apps/worker
npx wrangler deploy --config wrangler.fixture.toml
```

**Running the rig:**

```bash
npx tsx --env-file=.env scripts/replayRig.ts \
  --event <a real historical event key, e.g. 2026cmptx> \
  --worker-url https://sigmascout-worker.jrw4561.workers.dev \
  --fixture-url https://fixture-rig.sigmascout.org \
  --algorithm opr,epa,vpr \
  --mode both \
  --live-trigger cron \
  --out reports/replay-rig/<name>.json
```

Prefer `pnpm replay:rig -- <flags>` for the identical `tsx --env-file=.env` invocation, spelled once
in `package.json`.

**`--live-trigger manual`'s `/cdn-cgi/handler/scheduled` route did not work against the real
deployed Worker in this project's own testing** (a bare 404, Cloudflare error 1042) — this appears to
be a `wrangler dev --test-scheduled`-only local-development feature, not a route Cloudflare exposes
on a genuinely deployed Worker's public edge. `--live-trigger cron` (the default recommendation for
a real run) is what this project actually uses: it waits for the REAL one-minute cron to pick up
each revealed match, which is also the ONLY run that measures the platform's own scheduling jitter
(D-20's own framing already preferred this run). The `manual` code path is kept in the rig (it warns
and continues rather than failing outright on the 404) in case a future Cloudflare change or account
configuration makes it work — do not delete it as dead code without re-testing first.

**What the rig necessarily mutates on the deployed Worker (and why it is safe):**

- `--event`'s scope in `algorithm_state`/`event_cursor` is reset to a cold start, and the SAME
  event's already-published R2 artifacts (`v1/event/...`, `v1/team/...`) are deleted too — every
  corpus event has already been published once by `pnpm publish:seasons`, so resetting D1 state
  alone is not a cold start: the deployed Worker's merge logic reads the EXISTING published artifact
  first, and a freshness poll would find every match "already there" from the ORIGINAL publish, not
  from anything the rig drove. This was a real bug this plan's own first live run caught.
- The real `v1/manifest/live-windows.json` gains one temporary window for `--event`.
- The production Worker is redeployed twice per session (fixture URL, then the tracked default).

**All of this is undone by the next re-baseline** (`pnpm publish:seasons` + the three `wrangler d1
execute --file` seed imports, see "Re-baselining" above) — a rig session should always be followed
by one, not just for hygiene but as the actual restore mechanism for the manifest and any touched
published artifacts.
