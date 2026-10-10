# Operating the live-update Worker

`sigmascout-worker` polls TBA once a minute for events that are currently live, advances each
affected team's algorithm state in D1, and rewrites only the artifacts that actually moved in R2.
A tick with nothing live reads one small manifest from R2 and stops there, spending zero TBA
requests — which is what makes ~1,440 invocations a day free during the ten months of the year no
event is running. The one exception (quick task 261009-tx6): for 24 hours after a district event's
window closes, a tick with nothing live still does district work on the minutes that are a multiple
of 5, and looks harder on the multiples of 15 — see "The district refresh pass" below. Everything the browser reads is a precomputed R2 object served over a custom
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
`--skip-ingest`, `--skip-deploy` and `--skip-prune` drop a step. The prune refuses a version written in
the last hour (the recent-write guard has no bypass); run `pnpm rebaseline --from prune` once that
window has passed. A same-version republish overwrites its keys in place and leaves nothing to prune. The manual commands below are what it runs, kept for when a single step needs redoing by hand.

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
  as above. Only `seed-spr.sql` carries the passenger, because opr and epa have no layer-priced
  ranking points (EPA's own bonus RP slots ride its ordinary team and league rows since shape 18,
  2026-09-29). **This bullet used to add that a shape-15 opr or epa row never reaches the Worker, because
  the live tier was spr only. That is no longer true** — since 2026-09-23 (quick task 260923-3w8) all
  three fold live and the Worker deserializes every one of their league rows, so all three must be at
  the current `STATE_SNAPSHOT_SHAPE_VERSION` or they raise `LeagueRowShapeVersionError` on every
  tick. In practice they are: `serializeState` stamps the current shape unconditionally, so a
  `pnpm rebaseline` (which seeds all three plus the cursors file) leaves nothing behind at an old
  shape. The hazard is a PARTIAL seed — applying `seed-spr.sql` alone after a shape bump now leaves
  opr and epa unfoldable rather than merely unread.
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

**Shape 17, 2026-09-28 (quick task `260928-p8i`, SPR 9.0.0).** The spr league row gains
`sigmascoutRpPopulation`: the RP cold-team prior's population summary, a count, a mean and a sum of
squared deviations per threshold variable, tagged with its season. The Worker always resumes the
RP accumulator with the prior on (`readRpPopulation` → `RpMomentsAccumulator.fromBeliefs` with
`{ population }`), grows the summary with every alliance `foldObservedRp` folds, and writes it back
beside `withRpMeanShift`, at zero extra subrequests. Another season's summary, or a malformed one,
resumes as an empty population.

- **Order hazard.** Every Worker deserializes all three algorithms' league rows, and
  `deserializeState` refuses any shape but the current one. Between a shape-17 Worker deploy and the
  shape-17 seed, every fold attempt fails with `LeagueRowShapeVersionError`; the reverse order fails
  the old Worker the same way against the new rows. The state-generation-mismatch guard only covers
  the stretch after the publish flips the manifest, not this one. Keep the window short, and check
  the live windows manifest before starting: with nothing real live, the gap costs nothing.
- **Why the bump is load-bearing.** A shape-16 row has no population. Without the bump the Worker
  would resume an empty population and price cold and thin teams differently from the artifacts it
  serves, with no error anywhere.
- **Proof.** `apps/worker/test/scheduled.rp.test.ts`'s population block folds a generated prior
  event through the real Worker, with two teams left thin (one observation each), then a live event
  one played match per tick; the live played and upcoming rows equal an offline prior-on
  `SigmaScoutLayer` replay and differ from a prior-off one, and the D1 league row ends holding the
  offline layer's summary. It was seen failing with the write-back removed.
- **Debut teams (quick task 260928-spa).** The played-row partial-roster gate checks that every
  roster team's state was LOADED this tick (`rpLoadedTeams`: the touched and scheduled teams), not
  that it already has an RP belief. So a team making its season debut gets its first played-row pmf
  live, priced from the population exactly as offline. The same test file's debut case was seen
  failing against the old belief-based gate.

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

## Live folding tier (quick tasks 260822-wqt, 260923-3w8)

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

**THE OPERATIONAL CONTRACT, as of 2026-09-23: all three published algorithms fold live.**
`LIVE_ALGORITHM_IDS = "opr,epa,spr"`. Every page's opr, epa and spr numbers advance within a cron
minute of a result being posted; none of them waits for a re-baseline any more. Quick task
260923-3w8 made the change on Jacob's decision (`260923-1tu-FINDINGS.md` item C6), shipping
`opr@6.0.0+baseline` and `epa@13.0.0+baseline` to pay for it — those two algorithms' published
numbers now move during an event, and the project rule is that changed published numbers ship under
a new version rather than being overwritten in place. SPR's version did not change. Everything from
here to the end of this section is the history of why the tier used to be narrower, kept because an
operator reading an old tail or an old deploy record needs it.

**Where it is configured.** `apps/worker/wrangler.toml`'s `[vars] LIVE_ALGORITHM_IDS` is the single
place — a plain tracked value, visible in git, following `TBA_BASE_URL`'s own precedent in the same
block. Change it there, never anywhere else. `DEFAULT_LIVE_ALGORITHM_IDS` in `scheduled.ts` equals
it deliberately, so a deploy that fails to carry tracked vars through cannot silently narrow the
tier; the `live-tier-defaulted` warn line is what tells you that happened.

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

**~~What still holds the tier at spr is a PUBLISHED-NUMBERS decision, not a budget.~~ HISTORICAL,
2026-08-22 to 2026-09-23 — and the decision was TAKEN, not reversed.** This paragraph said that
widening `LIVE_ALGORITHM_IDS` would make `opr`/`epa` fold live instead of refreshing at the manual
re-baseline, changing numbers the site had already published, so it needed its own algorithm version
bump and republish. All of that was correct and all of it still is; it was never an argument against
widening, only a price. Quick task 260923-3w8 paid it — `opr@6.0.0+baseline`,
`epa@13.0.0+baseline`, one `pnpm rebaseline`.

**`opr` and `epa` remain FULLY PUBLISHED** (D-03) — every page and the Compare page read them;
`packages/harness/publish.ts`, `packages/harness/manifests.ts` and the algorithms manifest are
untouched by any of this. **Until 2026-09-23 they refreshed only at the manual
pre/post-event-weekend re-baseline and not on the cron, so during an event weekend their numbers
were as of the last re-baseline. That is no longer the case** — they fold on the cron like spr, and
opr or epa standing still mid-event is now a symptom to investigate rather than expected behavior.
One thing is still SPR's alone: the ranking-point LAYER (the RP moments accumulator, the mean shift
and the pre-event filler). ~~OPR and EPA publish no RP odds, no Match Band and no pre-schedule
simulation sidecar.~~ **Since 2026-09-29 (quick task 260929-mat, `epa@14.0.0+baseline`) EPA
publishes its own RP odds** from Statbotics' bonus RP slots, which fold live inside `epa.update` on
every tick and persist through D1 as part of EPA state: `rpSlotOffsets` on each epa team row and
`rpLeague` on the epa league row, `STATE_SNAPSHOT_SHAPE_VERSION` 18. EPA also gets pre-schedule
sidecars, priced from its own `predict`. OPR still publishes no RP odds, and neither OPR nor EPA
publishes a Match Band. **The shape 18 bump needs a reseed from a fresh publish**: until the four
seed files land, a Worker at shape 18 refuses every shape 17 league row with
`LeagueRowShapeVersionError`, so an event with new matches logs `event-failed`, reverts its cursor
claim and retries next tick, writing nothing.

**~~SPR-only was decided permanent on 2026-09-13 (quick task 260913-ppk).~~ HISTORICAL — both of its
reasons are now answered.** OPR and EPA were not to be rotated into the live tick because (a) the
Worker could not sustain even SPR alone inside the free plan's 10 ms CPU budget, and (b) the
per-event cursor and the TBA ETag are shared across algorithms, so an algorithm left out of a tick
would have its matches skipped rather than caught up later. Reason (a) went with the free plan —
Workers Paid allows 30 s of CPU per tick, and the measured cost of three algorithms is roughly
200 ms per event tick (`260923-1tu-FINDINGS.md` item C6). Reason (b) is still true and is the reason
the tier is ALL THREE rather than a rotation: a shared cursor makes rotating algorithms across ticks
unsafe, and folding every published algorithm on every tick is precisely the configuration that
never leaves one behind. Do not reintroduce a rotation. The full reasoning, and the design premise
any change here must start from, is in
`.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md`.

**The tracked value is pinned by EQUALITY** in `apps/worker/test/liveAlgorithmTier.test.ts`, and
every fold assertion in that file derives its expectation from the pinned value rather than naming
ids a second time. It used to re-derive `processEvent`'s own budget arithmetic, which quick task
260923-3w4 deleted — and deleted the equality pin with it, so the deployed value went untested for
part of 2026-09-23 until 260923-3w8 restored it. Change the pin deliberately, along with the version
bump and republish that moving published numbers requires.

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

## Live events need no operator (quick task 260921-5qw, simplified by 260923-3w6)

Nothing has to be done by hand DURING a live event. An event the Worker promotes from a probe window
is complete on its own:

| The page needs | Where it comes from |
|---|---|
| name, dates, week, tier cuts | a STUB event artifact published ahead of time for every probe-window event |
| upcoming-match pricing | the tick prices every still-upcoming match itself, in Phase B, from the state it read for the fold |
| the event on robot pages | the team's own `v1/team/{teamKey}/{year}/...` artifact, which the tick writes on every fold and which names the event |

Two of those three rows used to name an extra mechanism. Until quick task 260923-3w6 the tick could
not afford to price upcoming matches or to write a team artifact (a 10 ms CPU budget), so it spliced a
`state` block of D1 rows into the event artifact for the browser to price from, and wrote a
`v1/live-roster/{eventKey}.json` object so a robot page could discover an event no team file named.
Workers Paid gives the tick 30 s; both mechanisms are deleted, and so are the
`event-state-block-missing` / `event-state-block-invalid` warn lines an operator used to have to act
on. Quick task 260923-3w7 then deleted the browser halves — the pricer, the team-season overlay, the
live-windows/roster discovery pair and the derived standings — so a robot page is ONE fetch of its own
team file again, polled every 60 s, and an event page parses what the tick wrote with nothing in
between. **A team that is on the schedule but has played nothing yet still has no row for the event in
its own file** — that is the one thing the roster object covered and the team file cannot, and it heals
at that team's first match.

**The rarity TIER on a live-folded row survives that deletion**, and how it does is worth one line for
an operator. A row the tick appended carries a metric value and no `percentile`, so its tier comes from
the per-(algorithm, season) `tierCuts` block rather than from a number on the row. That block used to
ride only the event artifact, which briefly left the robot page's event-section tiles untiered during a
live event (quick task 260923-3w7, closed by 260923-3x0). The publisher now writes THE SAME block to
every team-season artifact as well, so the robot page tiers those tiles from the one file it already
fetches. **It takes one republish per (algorithm, season) to populate the key**: a team file published
before 260923-3x0 carries no block, parses fine, and renders a live-folded row untiered until that
season and algorithm are republished. Since quick task 260927-uen, the team page header's Total tile,
phase tiles and World rank card tier from that same block too, not only the event page's tiles. The
percentile NUMBER is a separate question, accepted rather than open —
`.planning/todos/completed/live-merges-drop-percentiles.md`.

- **New events on the calendar:** a full `pnpm publish:seasons` emits the stubs. To get them out
  WITHOUT a full republish (about 109,000 R2 writes), run `pnpm publish:stubs` (about 120). It reads
  the live manifest, never overwrites an existing artifact, and supports `--dry-run`.
- **Looking at a live event afterwards:** Workers Logs is on at 100 percent sampling
  (`[observability]` in `wrangler.toml`), so every tick's `outcome` and `cpuTime` is retained. Nobody
  has to tail during the event.
- **Still an ordinary republish, any time after the event:** it is what fills in a live-merged row's
  missing percentile number, the TBA rank/record/RP on the event's standings, the events-list row and
  the season-final tiers. The live results themselves are already in the team season files — the tick
  writes them there (260923-3w6); they no longer wait in the event artifact for a republish.
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

**The upcoming-repricing loop was removed by 260915-isq and REINSTATED by 260923-3w6.** For the eight
days between them the tick wrote still-upcoming matches schedule-only and kept an SPR `state` block
current for the browser to price from, which removed the dominant term the measurement above was taken
with. That whole trade was against a 10 ms budget; with 30 s the tick prices the schedule itself again.
Both the measurement above and this paragraph are history.

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
renders degraded: it has no `name`, `startDate` or `week`; its `teams` rows carry no TBA rank or
record; and it does not appear in the events list, which only the offline publish writes. Its
upcoming matches DO price — the tick prices them itself since quick task 260923-3w6, from the state
it read for the fold, with no block and no operator step. Ingest + republish stays the way to make an
event a first-class page:

```bash
# To give a live-probed event a name, dates and an events-list row:
pnpm ingest --event <eventKey>     # or a full pass
pnpm publish:seasons               # rebuilds live-windows.json, adds the list row
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

### State blocks before the window opens — HISTORICAL (260915-isq, reversed by 260923-3w6, reader deleted by 260923-3w7)

**There is no state-block contract any more, and nothing to pair.** This section held an operational
contract an operator had to satisfy before every live window: publish with code that writes the SPR
`state` block, seed D1 from the *same* run so the block and D1 described the same state, and ship the
web switch that let the event page parse an artifact whose upcoming rows were schedule-only. It also
held the two warn lines — `event-state-block-missing` and `event-state-block-invalid` — that told an
operator the pairing had failed and a republish-plus-reseed was owed mid-event.

There is not even a second schema to switch any more: quick task 260923-3w7 deleted
`LiveEventArtifactSchema` and the `state` key with it, so one `EventArtifactSchema` is read and written
by the publisher, the Worker and the web alike, and a schedule-only upcoming row now FAILS validation
rather than parsing. A stale `state` block on an artifact published before the reversal still parses
and is dropped (zod strips undeclared keys; a test pins that no schema is `.strict()`), so nothing is
owed for the artifacts already in R2.

All of it is deleted. The tick prices upcoming matches from the state it reads for the fold, so there
is no second copy of that state to keep honest, no publish-and-seed pairing to get wrong, and no warn
line to act on. **The one thing that survives from this section is the ordinary re-baseline rule that
outlived it:** a publish and its `seed-*.sql` files must still be applied as a matched set, because
the tick resumes folding from D1 and the `state-generation-mismatch` suspension will (correctly) stop
it if the generation markers disagree. That rule is documented under "Re-baseline" and
`state-generation-mismatch`, not here.

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

## The district refresh pass (phase 10, plan 10-05, added 2026-09-25; rewritten by quick task 261009-tx6, 2026-10-09; the finality rule, the awards flag and the winner hold by quick task 261009-vp9, 2026-10-10; a championship whose rows arrive one event at a time by quick task 261010-66y, 2026-10-10)

**Quick task 261009-vp9 changes the verdict pass and the awards flag, both inside the Worker
bundle. The Worker must be deployed for them to take effect.** No district republish is owed:
every finished event reads exactly as it did (the publisher comparison over the 109 local district
seasons is clean). Deploy while no district or championship event sits between playoffs done and
awards posted: at such an event the first tick under the new rule can raise rivals' ceilings.

The tick has a fourth job since phase 10: keeping a district's published points current between
offline republishes. `apps/worker/src/districtRefresh.ts` holds the pass. It is reached from three
places in the tick: after the event loop and the global rebuild and before `writeTickMeta` (a tick
that folded or promoted something), from the probe only return, and from the return when nothing
is live at all. It is not reached from the state generation mismatch return.

**Which districts the pass looks at: the watch set.** The pass learns that a district exists from
the live windows manifest the tick already read, where every window entry carries a `districtKey`
(null for a non district event). It is handed two lists from that one read:

- the windows the tick actually processed this tick (foldable, or promoted this tick). Their events
  are the district's live members.
- every district window that is live, or that ended within the last 24 hours
  (`DISTRICT_AWARDS_WATCH_MS` in `packages/harness/manifestSchemas.ts`). An entry the tick did not
  process is a watched member.

An event is watched for 24 hours after its window closes because its awards, and the award points
that go with them, reach TBA after its last match, often after the one hour pad on its window has
run out.

**The offline manifest builder keeps a district window for those same 24 hours.**
`buildLiveWindowsManifest` drops a non district window the moment it closes, as before, and keeps a
district window, measured or calendar, until 24 hours after it closed. Both sides read the one
constant and use the same half open bound, so a manifest rebuilt inside the watch does not end it.
A kept closed window is never live: nothing folds, probes or promotes on it, and it needs no stub
artifact.

**A calendar window needs proof.** A watched member whose window is `inferred` (a calendar guess
for an event the corpus held no match for) is kept only when the event's own match cursor row
shows a folded match. Without that proof it is dropped, and a district left with no member is not
processed. Such a district costs its share of the pass's one D1 cursor read and no district
request. A probe window that never promoted therefore still does not spend a district's TBA
request.

**The two cadences.** They are read off the UTC minute of the tick. Nothing is stored for them, so
a cron tick that is skipped only delays that look to the next mark.

- A district with a live member is processed every tick.
- Any other watched district is processed only on a minute that is a multiple of 5. On every other
  tick it costs nothing: no D1 read and no request.
- **The forced look.** On a minute that is a multiple of 15, every processed district's rankings
  are asked with no `If-None-Match` and the gate below is passed unconditionally. This applies to
  live districts too. It is what reads the settle time without any waiting marker, merges again
  after an offline republish replaced the artifact, gives an awards cursor row to an event that has
  none, and repairs a failed cursor write. Nothing stays stuck for more than 15 minutes while its
  district is watched.

**Suspension.** A state generation mismatch suspends every live write, districts included. The
main call site sits below the mismatch return. The two idle call sites hand the pass a check that
answers the same question. It is made at most once, only after a district is due and proven, and
before any TBA request. When it says suspended, or fails, the pass does nothing that tick and logs
one `district-pass-suspended` warn.

**What it does, per processed district, in this order:**

1. One `GET /district/{key}/rankings`, sending `If-None-Match` from the district's own cursor. On a
   forced look no `If-None-Match` is sent. This comes FIRST, before any R2 read.
2. One conditional `GET /event/{key}/awards` for every member event, live or watched, that has an
   awards cursor row, sending the ETag that row holds (a row holding a null ETag is asked with
   none). A 200 means the event's awards list changed. A 304 means no awards news from that event.
3. **The gate.** The district goes on when the rankings changed, or a member event has a match
   observation this tick, or an awards list changed, or this is a forced look. Otherwise nothing
   moved: the district is counted unchanged and **zero** R2 reads are made. A quiet district
   therefore costs one conditional rankings request plus one conditional awards request per event
   with a cursor row.
4. The published `v1/district/{key}.json` is read back from R2.
5. **The catch up, on a forced look only.** The artifact's own rows name older events whose state
   says the playoffs are done and the awards are not posted, and that are not members this tick:
   events whose awards or points landed after their watch ended. Their awards cursor rows are read
   in one D1 read (90 keys per statement). At most 8 are chosen per district per forced look: an
   event never asked first, then the one asked longest ago, ties by week (a null week last), then
   by event key. Each chosen event is asked once with no `If-None-Match`, and its row is always
   written afterwards with `lastPolledAt` set to that tick, whatever the answer. The order
   therefore rotates, and events that can never post cannot keep a newer one from being asked. An
   event key read off the artifact is checked against the event key pattern before it becomes a
   URL segment or a cursor key.
6. For each member event with no list in hand, one `GET /event/{key}/awards` with **no**
   `If-None-Match`, in three cases. First, its flag still waits, its playoffs are done, and its
   request in step 2 answered 304 or it has no cursor row yet. Second, on a forced look, its flag
   still waits and its window has ended, whatever its published state says about the playoffs: an
   event whose playoffs ran past its measured window is asked this way. Third, its flag is already
   true and it has no cursor row (the offline publisher set the flag), which gives it a row. A
   member whose window is still open and whose state says the playoffs are open is never asked.
7. The shared merge (`packages/harness/districtRankingsMerge.ts`) applies the new rankings and the
   per event state facts, then the awards step, then recomputes the `locks.ts` verdicts. The Worker
   has no corpus, so it can only merge into what the offline publisher already wrote: a **missing**
   district artifact is skipped with a `district-artifact-missing` warn and never created, and an
   **empty** rankings payload throws inside the merge before any row is touched, so a published
   district can be neither invented nor blanked.
8. The candidate is compared with the existing object by serialization, with the existing
   artifact's own generation and timestamp held constant. Equal means nothing moved and nothing is
   written. That is the usual outcome of a forced look.
9. Cursors are written **last**, only after the put that earns the right to stop asking. The awards
   cursors are written before the rankings cursor: if an awards cursor write throws, the rankings
   cursor is left unwritten, so the next tick's rankings request is a 200 again and the district
   passes the gate again.

**When an event's awards read as posted (quick task 261009-vp9).** `awardsPosted` turns true only
once all of these hold:

- the awards list holds an award other than Winner and Finalist;
- some team's row at that event carries award points in the rankings as merged that tick;
- some team's row at that event carries playoff points above 0 in those same rankings. A true
  flag closes every category of the event at once, so it must not rise while the playoff points
  are still to land;
- the list holds EVERY consuming award the event gives, and has not changed for 60 minutes
  (`AWARDS_SETTLE_MS`). A district tier event gives Impact. A District Championship that is not a
  division gives Impact, Winner, Engineering Inspiration and Rookie All Star. A division gives
  none, so a division keeps the plain 60 minute rule.

Where one of those awards is NOT listed, the flag waits instead until the list has not changed for
12 hours (`AWARDS_SETTLE_WITHOUT_IMPACT_MS`). A list that has stood that long without the award is
read as an event that gave none: 12 district events since 2022 list judged awards and no Impact.
A published true stays true. The rule lives in `packages/core/districts/eventAwards.ts`. The
offline publisher reads the same function, where either of the first two facts alone is enough
because the corpus is ingested after the event.

The hour exists because TBA can list an event's awards in batches. Without it the flag turned true
at the first judged award whose points were in, which released the slot held for that event's
Impact award while a later batch could still bring it.

Waiting for the awards by name exists because an hour can pass with the Impact still missing.
Replayed on the 2026 PNW fixture with the award arriving two hours after the rest of its list, the
old hour rule lost 24 held places over twelve walks: `frc5920` went from held to eliminated at
`2026orore`, `2026orsal`, `2026orwil`, `2026wasam` and `2026wasno`, and at `2026pncmp` a late
Impact took three held places and a late Engineering Inspiration or Rookie All Star two each.
Waiting for Impact alone at the championship still lost the last two pairs, so a championship
waits for every consuming award it gives. Under this rule the same twelve walks lose none.

**The Worker measures, the merge decides.** The event's awards cursor row holds the ETag of the
last list the pass merged and, in `lastAdvancedAt`, the time that ETag last changed. The pass
reads that one row at two lengths and hands the merge two sets: the events whose list has stood
for 60 minutes, and the events whose list has stood for 12 hours. It adds no request, no D1 read
and no D1 write for the second. The merge knows the event's tier, whether it is a division and
which award types the list holds, and asks the rule. A list reads as changed now, and the row is
stamped with the tick's time, when no row exists, when the ETag differs, or when the row holds an
ETag and no usable time (the row a Worker before 261009-tx6 wrote). A list whose response carried
no ETag never reads as settled at either length. A failed awards request restarts the clock only on
a tick that passes the gate, because that is the only tick that writes the retry marker. A failed
request on a tick that does not pass the gate writes nothing and leaves the clock alone.

**The limits of the flag's rule.** Each is the flag turning true before an award that then takes a
held place. In each the award is still recorded on the tick its list changes.

1. A further recipient of a consuming award type that is already listed, listed more than an hour
   after the list last changed: a second Impact at a championship, a fourth member of a winning
   alliance. The list already holds the type, so the flag does not wait for the further recipient.
2. An event that lists none of an expected award for 12 unchanged hours and then lists it.
3. The 24 hour watch and the catch up are unchanged: see "The limits that remain".

**The winners are written in the same put.** Every awards list that reaches the merge is merged,
whether or not the flag turns true that tick: each recipient that is a team of the district gets
its `qualifyingAwards` entry, built by the same function the offline publisher uses. So the flag,
the winner records, `districtLock` and `champLock` land in one R2 write. Entries are appended and
never removed. A District Championship division records nothing, as in the publisher.

**A recorded winner is read only once its own event says the award is given.** The record is
written at once. The verdict pass counts it only when the award's own event says so: every judged
award once `awardsPosted` is true, and a District Championship Winner once the playoffs are final
as the rule below reads them (`playoffsDone` true AND the winner's playoff points in the rows, or
`awardsPosted` true). Until then the event still holds its slot back and the recorded winner takes
none, so an event is reserved for or counted and never both. An award at an event whose rows carry
no state block counts as it always has. Before 261009-tx6 the published verdict counted the winner
and held the slot at once, and a team it had locked on points read contending until the points
arrived.

**The winner hold (quick task 261009-vp9).** The four places held for a championship's winning
alliance are released only once its Playoffs are final AND a Winner is recorded there. Playoffs
final alone is not enough: TBA can post the playoff points before it lists the Winner, and for
those ticks the four places would be neither reserved for (the Playoffs read final) nor counted
(no winner is known), which hands the points race four slots the winners then take. On a synthetic
championship whose winners sit far down the standings that order lost 13 held places in the
published verdict and 13 on the Champ Locks tab. With the hold it loses none. A Winner recorded at
another championship of the same district releases nothing. The Champ Locks tab applies the same
hold, but only while that championship's own flag is not yet true at Now, so a rewound stop of a
finished season reads as it always has.

**A category counts as finished only when its points are in (quick task 261009-vp9).** An event's
state block (qualification matches played, alliances picked, playoffs done) comes from the match
feed and moves within a minute. Each team's points come from TBA's district rankings, a different
feed that can lag. Read from the state alone, a category closed before its points were in: a rival
lost a ceiling it could still fill, a team read Locked, and the points arriving took the Locked
back. The rule, for one event, reading the artifact's own rows at that event:

- **Awards** are final when `awardsPosted` is true.
- **Playoffs** are final when Awards are, or `playoffsDone` is true AND some row carries the
  winner's playoff value (30 at a district event, 90 at a championship or a division, in 2026;
  the finals champion value at a divisioned championship's finals event).
- **Alliance selection** is final when Awards are, or `alliancesPicked` is true AND some row
  carries alliance points above 0. Playoffs final does NOT close it.
- **Qualification** is final when Alliance selection is. TBA shows provisional qualification
  points during an event, so their presence proves nothing.

**Only the awards flag cascades down. Alliance selection and Playoffs each need their own
points.** The district rankings are one feed with four layers, and nothing proves the layers
always land in the order the event is played. Walked on `2026orore` with every other event
finished, before this was hardened: playoff points landing before the alliance points took back 4
published district, 2 published champ, 4 District Locks and 2 Champ Locks, and award points with a
settled list landing before the playoff points took back 1 of each. Both orders now take back
none. The flag may cascade because the live flag itself waits for award points and playoff points
at the event and for a settled list.

**The assumption that remains.** TBA computes an event's point categories together. Two things
follow from it, and neither is verified against a live event:

1. The qualification points are final once alliance points appear. Qualification has no proof of
   its own, so alliance points close it. If alliance points ever landed before the corrected
   qualification points, the corrected points arriving afterwards could take a lock back (walked
   on `2026orore`: 2 published district and 2 on the District Locks tab).
2. Playoff points carried by a payload that also carries award points include the deciding match.
   The flag asks only for some playoff point above 0, not the winner's value, because an event
   whose winners carry no row never shows that value.

The rule only ever reads a category OPEN where the state alone reads it final. It never closes one
early, and a rankings row alone closes nothing. It lives in
`packages/core/districts/categoryCorroboration.ts`. It applies in two places: the verdict pass,
through `publishedCategoryFinality` (the ceilings, the floors, the pooled pool, the Winner gate and
both reservations), and on both Locks tabs, where it decides which cells are grey and everything
the lock math reads.

**The two readings, never mixed.** What has happened on the field is the state alone. It keeps
driving the tabs' simulation run, the published alliances and the played bracket the run is
conditioned on, the bracket facts, the timeline and the milestone rail. Whether a category's
number is final is the rule above. It drives the grey cells and the lock math. The run takes TBA's
own playoff and award points as known only once they are final, and reads the played bracket
until then. So nothing live goes dark while points lag. Only finality waits.

**An event whose winners carry no row.** At 3 of 418 district events since 2023 (`2026njtab`,
`2026mawor`, `2026waahs`) the winning alliance's full playoff value sits on no row, because a
team's third district event earns no row. There the Playoffs read open at the live position from
the playoff points landing until the awards flag turns true, which then closes every category at
once. That is the open side: a Locked shown later, never one taken back.

**When TBA posts points during an event is not verified.** No live district weekend has been
observed under this rule. Both cases are covered by tests and neither is asserted:

- If the points lag by minutes, finality waits minutes.
- If they arrive only when an event ends, the tabs show predictions conditioned on the field all
  event and no category reads final until then.

**The published ceilings count what is still open at an event a team has already played.** Before
261009-tx6 `maxRemainingDistrict` was the sum of a team's remaining events and nothing else, so an
event a team already had a points row for was worth nothing more to it while its award points were
still to come. The verdict pass now applies the District Locks tab's own rule to every points row
whose event carries a state block. For each category that is not yet final:

- that category's ceiling at the row's tier is added to the team's ceiling (district tier rows into
  `maxRemainingDistrict`, both tiers into `maxRemainingChamp`), and
- the points the row already carries in that category leave the floor the lock test and the cut
  line read. `pointTotal` on the wire is unchanged.

So `maxRemainingDistrict` and `maxRemainingChamp` are larger while an event is open, and a point
landing in an open category moves no verdict. A row whose event carries no state block adds
nothing and removes nothing, so a finished season republishes to exactly what it was (measured over
the 109 local district seasons: zero artifacts differ). Three things to know:

- **It is the tab's rule without its settled playoffs refinement.** The pass has no bracket facts,
  so an alliance already knocked out keeps the whole playoff ceiling until the category is final.
  A published status in the middle of the playoffs can therefore be weaker than the tab's (a
  Locked shown later), never stronger.
- **A newcomer's seed lasts until the next offline republish.** A team that arrives in TBA's
  rankings with no row in the artifact is given one district event's maximum as its ceiling. That
  seed is now carried on every later tick, on a rankings 200 and on a 304 alike. Before, it was
  lost on the next rankings 200.
- **Whether a championship is still ahead is read off the artifact as it was read from R2,** before
  anything is merged into it, with what is open at a team's own championship row subtracted. A
  team playing its championship is therefore never read as a team granted a hypothetical one, and
  a rankings 200 tick and a 304 tick give the same ceilings.

**What "no Locked is taken back" covers.** Four things, each held by a test that fails with its
rule removed:

- **The three earlier categories.** Qualification done, alliances picked and playoffs done, each
  while TBA's district rankings have not caught up with the match results.
  `scripts/districtLocksStagedReplay.test.ts` walks all eight 2026 PNW district events over ten
  ticks through the shared merge and the District Locks status code. With the rule switched off
  inside the test the same walk takes 32 published `districtLock`, 9 published `champLock` and 32
  District Locks Locked back. With the rule: none. The same file walks both cases about when TBA
  posts points, with the played bracket handed to the tabs at every tick.
- **The award stage.** Winner and Finalist listed, the judged list, the award points, the hour of
  quiet, the settle. `apps/worker/test/scheduled.district.test.ts` walks it for all eight events
  through the real tick, at both tiers.
- **A late consuming award.** A late Impact at every one of the eight district events, and at
  `2026pncmp` a late Impact, Engineering Inspiration, Rookie All Star and Winner, through the pure
  merge in the replay file, and `2026wasam`, `2026wasno` and the three judged `2026pncmp` variants
  through the real tick in the Worker test file.
- **A Winner listed after the playoff points.** Two synthetic single championships in both tick
  orders, in the replay file.
- **A later layer of points landing before the layer below it.** Playoff points before alliance
  points, with and without the final qualification points, and award points with a settled list
  before playoff points, on `2026orore` in the replay file. Not covered, and stated as the
  assumption above: alliance points before the final qualification points.

The published side is the tab's rule without its settled playoffs refinement, so in the middle of
the playoffs a published status can be weaker than the tab's, never stronger.

**A failed awards request is not fatal.** A request that throws, answers a status other than 200
or 304, or returns a body that fails the schema costs one `district-awards-poll-failed` warn and
nothing else: that event has no awards news this tick, its flag is unchanged, it is not asked a
second time, and the rankings merge for the district goes ahead. `districtsFailed` is not
incremented. When the event's flag is not yet true, its awards cursor row is written with a null
ETag at the end of the tick (created if absent). The next tick asks that row with no ETag before
the gate, so the retry passes the gate by itself. An event whose flag is already true keeps its
row: its next conditional request is the retry.

**Every step for one district sits inside that district's own error isolation**, and every awards
request sits inside its own within that. The pass's cursor read and its suspension check each sit
inside their own too. One bad district costs one warn line and one failed count; it cannot cost
the tick its other districts, and it cannot cost the tick its rotation offset. The pass never
throws and never simulates.

**What a tick costs, at worst, in subrequests.** Every request and every D1 read or write of the
pass is counted. With M member events and C catch up events (C at most 8) in one district:

| Tick | At most |
|---|---|
| A forced look | 3M + 2C + 5: one rankings request, one artifact read, one put, one rankings cursor write, one catch up cursor read (one more for each further 90 candidates), two awards requests and one cursor write per member, one awards request and one cursor write per catch up event |
| Not a forced look, the district passes the gate | 3M + 4 |
| Not a forced look, the district does not pass the gate | M + 1 |
| No district is due | nothing |

On top of that the pass as a whole makes one cursor read statement per 90 keys, and from an idle
call site two more subrequests for the suspension check (the algorithms manifest and the tick
state, which a busy tick has already paid for). A test holds a tick with ten watched events and
eight catch up events under 55. In TBA requests, a forced look costs one unconditional rankings
request per processed district, which is one full rankings body per watched district every 15
minutes, plus at most two awards requests per waiting member and one per catch up event.

**Two reserved `event_cursor` key shapes** are written by this pass, and an operator reading the
`event_cursor` table will meet both:

| Key shape | Holds |
|---|---|
| `__district_rankings__:{districtKey}` | the district rankings ETag |
| `__event_awards__:{eventKey}` | `tba_etag`: the ETag of the last awards list the pass merged, whatever the flag says. A null ETag is a retry marker left by a failed request, and is asked with no ETag. `last_advanced_at`: the time that ETag last changed, which the 60 minute settle time and the 12 hour wait are both counted from. `last_polled_at`: the time the row was last written, which for a catch up event is the time it was last asked |

Both are refused by `emitCursorSeedSql`, so a D1 seed cannot clobber either. Neither is owed before
a deploy: the tick writes them itself and they are meant to be absent until it runs. A row left by
a Worker before 261009-tx6 holds an ETag and no change time. It continues as a conditional request,
and the first list read against it restarts its hour.

**Log lines to filter on:** `district-refreshed` (`districtKey`, `bytes`, `teams`),
`district-refresh-failed` (`districtKey`, `error`), `district-artifact-missing` (`districtKey`,
`key`), `district-key-rejected` (`districtKey`), `district-awards-poll-failed` (`districtKey`,
`eventKey`, `reason`), and two added by 261009-tx6: `district-pass-suspended` (`districts`, and
`error` when the check itself failed) and `district-cursor-read-failed` (`districts`, `error`).

### The limits that remain

**Awards or points that land more than 24 hours after an event's window closed wait for the catch
up.** The catch up runs the next time the district is watched, which is when any of its events is
live or inside its own 24 hours, 8 events per forced look. Until then the flag stays false, so the
reservations stay held and no team reads Locked on a slot an award could still take. The next
offline republish resolves them too. The reader facing statement of this is on
`/methodology/district-points`, in the limits table.

**A further recipient of an award type already listed, more than an hour after the list last
changed, lands after the flag. So does an expected award first listed after 12 unchanged hours.**
See "The limits of the flag's rule" above. A first Impact, Winner, Engineering Inspiration or
Rookie All Star listed late no longer does: the flag waits for it.

**An event whose winning alliance carries no row at the winner's playoff value** keeps its
Playoffs open at the live position until its awards flag turns true. See "An event whose winners
carry no row" above.

**When TBA posts points during an event is not verified.** See the paragraph of that name above.

**That TBA computes an event's point categories together is assumed, not verified.** See "The
assumption that remains" above.

**An event whose window is still open and whose state says its playoffs are open is not asked for
awards.** An award cannot have been given out there yet.

**A published `playoffsDone` that a republish from an older corpus set back to false** is not
repaired by the pass. The event is still asked once its window has ended (step 6), and its flag
can still turn true. A District Championship Winner there stays reserved for until the flag turns
true, and is counted from then. The offline publisher refusing to overwrite newer live facts is a separate quick task
(261009-ul3).

**No real district event has exercised this pass yet.** The first real observation is the first
2027 district event. Until then the replay test named above stands in for it.

### The offline district publish reads what is live first (quick task 261009-ul3)

Before it uploads anything, `pnpm publish:districts` reads the published
`v1/district/{districtKey}.json` of every district of the run. It reads twice: once right after the
artifacts are composed, and once immediately before the first upload, because the Worker writes
every minute and the bake takes minutes. It refuses the whole run when the upload would take back a
fact that is live. There are six such facts, each read per event: alliances picked, playoffs done
or awards posted reading true live and not true in this run, fewer qualification matches played in
this run, a recorded award winner (team, event, award type) gone, and a team's points row at an
event gone. Only an event both artifacts name is compared. A missing object is a first publish. A
published object that no longer parses is a shape change, and it is skipped with a line saying so.
Any other read failure refuses the run. A refusal uploads nothing, writes no local file, prints one
line per fact (district, event, team where it applies, the live value, this run's value) and exits
1. The remedy is to bring the corpus up to date and publish again. Three ingest passes feed the
district artifact: the matches (`pnpm ingest --years 2026-2026`), the alliances
(`pnpm ingest:alliances --years 2026-2026`), and the districts pass for rankings, registrations and
award recipients (`pnpm ingest:districts --years 2026-2026`, one contiguous range per run).
`pnpm publish:districts` is its own command: `pnpm rebaseline` runs neither it nor the districts
ingest pass. `--allow-regress` prints the same list, says it was overridden and publishes anyway.
It is right in two cases: TBA itself took a fact back, or the publish is a deliberate `--as-of`
one. A read failure is not overridable. A dry run reads nothing from R2 unless `--check-live` is
added. That run needs the credentials, prints the list and never fails:

```bash
npx tsx --env-file=.env scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --no-bake --check-live
```

What remains: the Worker can still write between the second read and that district's own upload, a
window of seconds, and closing it fully needs a conditional put.

### The offline district publish skips a district while one of its events is live (quick task 261010-jyn)

The Worker owns a district's file while it is watching one of that district's events. So
`pnpm publish:districts` skips that district: it uploads neither its `v1/district/{districtKey}.json`
nor its sidecars, writes no local file for it, and publishes every other district of the run. The
run ends with exit 0. Two rules decide which districts are skipped.

**The clock rule covers an event and the day after its last match.** The same builder that builds
the live windows manifest is asked on the corpus at the wall clock, never at `--as-of`. An event's
window comes from its match times with an hour either side. When the corpus holds no match for the
event, it runs from 12 hours before its start date to 4 days after it. A district is skipped while
one of its events is inside that window or in the 24 hours after it. District events, District
Championships and their divisions are covered alike. The rule is checked twice: before anything is
read from R2, and again just before the first upload, because a window can open during the bake. A
district it lists is neither read nor compared by the check of the subsection above.

**The evidence rule covers the rest of the Worker's watch.** The Worker can be reading an older
manifest that holds an event's calendar window, and that window stays open about a day longer than
the window from its matches. For an event still inside its calendar window plus 24 hours, the
publisher compares what it is about to upload with the published file it has just read, and skips
the district on either of two differences. One: this run would write awards posted true where the
published file does not hold it true. Two: this run would write a lower value than the published
one in the qualification, alliance, playoff, award or total points of a row both files hold. It
reads nothing extra. Past that window nothing changes: the flag is raised at the hindsight vantage
and a lower value is not a regression, as before.

**What is printed.** One line per live event (district, event, window, watched until). One line per
piece of evidence. One line per skipped district, with its reason. A last line with how many
districts were skipped and how many were published, and what to do: run the publish again later, or
pass `--allow-live`.

**The index keeps the published row.** The row of a skipped district in `v1/districts/{year}.json`
is taken from the index that is published now. The Worker changes the detail file's team count and
keeps its slot counts as last published, so a row composed from the corpus could disagree with the
file the Worker owns. The Worker never writes the index. When the published index is missing or
cannot be read, the run is refused before any upload. When every district of a season is skipped,
nothing of that season is uploaded.

**`--allow-live`** prints the same lines and one more saying it was overridden, and publishes the
listed districts too. The check of the subsection above still runs on them.

**Why it is dangerous.** Two facts. First, the publisher sets the awards flag at its hindsight
vantage: a judged award listed or award points, either one. The Worker's live rule needs a judged
award and award points and playoff points and a settled list (60 minutes when every expected award
is listed, 12 hours when one is not). So a publish during the Worker's watch can raise a flag the
Worker would still hold false, and a lock the page showed can be withdrawn. Second, the corpus's
points can be older than what the Worker has merged. A floor can then drop, or a finished category
can read open again, until the Worker's next forced look, up to 15 minutes.

**When it is right.** A listed event was cancelled or never played: an event with no match in the
corpus reads live from 12 hours before its start date for its whole calendar window. The season has
never been published. Or the Worker did not follow the event and the corpus is known to be the
newer side.

**Dry runs, and the check that cannot run.** A `--dry-run` prints the clock rule's lines as a
notice, skips nothing and never fails. It shows the evidence rule's lines only with `--check-live`,
because a plain dry run reads nothing from R2. A run with nothing to skip prints nothing new. A
clock check that cannot run refuses a run that uploads, also with `--allow-live`.

**What is still not covered.**

- Past an event's calendar window plus 24 hours nobody watches it, and a publish raises its flag at
  the hindsight vantage as before. Awards or points that land later than that can still take a lock
  back. This is the limit "The limits that remain" already states.
- An older snapshot in which a value is higher than the Worker's, because TBA lowered it in
  between, cannot be told from a newer one and is published.
- A manifest in R2 built from an older corpus can hold a window that neither of today's two
  windows contains, for an event whose date or schedule moved.
- The evidence rule compares only a published file that parses, so a first publish and a shape
  change are not compared.
- The Worker can write, and an event's window can open, in the time between the second read and a
  district's own upload. That time now includes the index read.
- A plain dry run shows the clock rule only.

### A championship whose rows arrive one event at a time (quick task 261010-66y, 2026-10-10)

The district artifact carries no event list. It learns a District Championship key only when a team
row names it: a points row once TBA posts points there, or a registration the offline publisher
wrote. So at a live championship played in divisions (FIM, NE, ONT, TX), or in a district with two
championships (2026 California), the pass can hold one event's rows and nothing of the others for
some ticks. Four things changed in the shared verdict pass
(`packages/harness/districtRankingsMerge.ts`). The Worker's own code under `apps/worker/src` is
unchanged.

**A championship's first rows read open.** The pass still drops the state of an event the artifact
it read carried no row for (step 5, `districtRefresh.ts`), so a championship's first rows land
with no state block and the state follows one tick later. A row with no state block used to read as
a hindsight row everywhere: its points earned, nothing more expected. For that one tick every team
at the event lost its whole championship ceiling. Walked on the 2026 artifacts with no championship
row first: 10 published `champLock` taken back at PNW, and 50 to 161 teams per district whose
`maxRemainingChamp` dropped and came back. On the two live entry points
(`applyDistrictRankings`, `applyDistrictEventState`) a dcmp tier row with no state block now reads
wholly open while the championship is still ahead: its four ceilings on the ceiling, its points out
of the floor. A district tier row, and the offline publisher's first pass, read as before.

**Every division team carries the finals.** TBA writes a finals row only for a team it pays there,
so before the finals are played no row names them. Every team with a live division row now carries
the finals Playoffs maximum (60 at four divisions, 30 at two, and the whole 90 while the field is
not proven) until the finals' Playoffs are final, finals row or no finals row. The finals' Awards
add no ceiling for anyone: a points paying award at a finals event is Impact, Engineering
Inspiration or Rookie All Star, which the champ reservation already holds a place for. A team whose
only championship row is the finals row gains no ceiling from it.

**The field proof.** One rule, `packages/core/districts/dcmpFieldProof.ts`, says whether the
championship field is proven: every field fixing key (every dcmp key but a finals key) has started,
every one carries a posted row, and the field is complete by capacity (the posted teams number at
least `dcmpSlots` minus half the largest posted key), by a posted finals row, or, in a season that
is over, by Awards final. While some field fixing key has started and the field is not proven:

- the champ reservation holds back the championships that may not have been seen yet, whole, beside
  the known ones (the capacity divided by the largest posted key, less the keys known);
- a team with no championship row that could still attend carries the whole Playoffs ceiling for a
  finals on top of its one hypothetical championship, which is what it carries the moment its
  division's rows land.

Both Locks tabs read the same rule, so the tabs and the published verdicts agree.

**What is asserted.** `scripts/champFieldStagedWalk.test.ts` walks a championship's rows arriving
one event at a time through the two entry points, on two synthetic championships and on the real
2026 FIM, NE, ONT, TX, CA and PNW artifacts, from two starts (no dcmp row first, and every attending
team registered first), through the finals, and again with each event's points arriving only as it
ends. No published `champLock` is taken back and no `maxRemainingChamp` drops and then rises on any
of them. Run it with `REQUIRE_LOCAL_DATA=1` so a missing local artifact fails instead of skipping.

**The limits that remain here.**

- The pass still writes a championship's first rows with no state block. The reading above makes
  that harmless in the verdict pass.
- A team the district tier reads eliminated carries no hypothetical championship, registered at the
  championship or not, and a few attend all the same (8 in 2026 NE, 9 in ONT, 4 in TX, 4 in CA, 1 in
  PNW). Its ceiling appears when its row lands. No lock was taken back by one on any walk.
- A current season whose championship never fills two thirds of its published capacity, or
  publishes none, reads not proven until the year ends. That delays a Locked and revokes none.
- That TBA posts one event's points rows for all of its ranked teams together is assumed, not
  verified.

**A Worker deploy is owed**, because the shared merge changed and the Worker bundles it. Deploy it
while NO District Championship is live. On the first tick after the deploy a championship row with
no state block changes from a hindsight row to an open one, which is right from then on but would
take published locks back once at a championship already under way. No district republish is owed:
every finished season recomputes to the same artifact.

---

## The ingest log (quick task 261004-uyc)

The tick keeps a durable, queryable record of what it saw and when, in the D1 table `ingest_log`
(`apps/worker/migrations/0003_ingest_log.sql`). It exists so a finished live event can be analysed
afterwards: when TBA posted each result, when the tick saw it, when it was folded, when the page
could show it, where the event moved between phases, and what failed. It is D1 and not Workers Logs
because logs expire and an event must stay queryable for as long as anyone wants to ask why a page
was late.

**Four kinds of row.** A tick that saw nothing new (every poll answered 304) writes none, so the
table grows with what TBA did and not with the cron's cadence.

| `kind` | One row per | `subject` | Notable columns |
|---|---|---|---|
| `endpoint` | TBA endpoint that answered with a changed body | the endpoint name (`matches`, later `rankings`, `alliances`, `teams`) | `tba_last_modified` is TBA's own header, `observed_at` is when the tick saw it, `published_at` is when the artifacts were written, `detail` holds the played and scheduled counts |
| `match` | newly folded match | the match key | `tba_actual_time` and `tba_post_result_time` as TBA states them (epoch seconds), then the tick's `observed_at`, `folded_at` and `published_at`: the whole latency chain on one row |
| `phase` | change of the event's phase | the new phase | `detail` holds the previous phase |
| `failure` | stage the tick swallowed | the failing stage (`phase-b`, `event`, `live-event-pass`) | `detail` is the error message cut to 300 characters |

Rows carry ids, counts, times and that truncated message, never a TBA key, a header dump, an
artifact body or an environment value. The `phase` column is the event's phase at the time of the
row.

**The seven phases**, derived by a pure function from the match list the tick already holds
(`apps/worker/src/eventPhase.ts`):

| Phase | The event is here when |
|---|---|
| `no-schedule` | TBA lists no match for it |
| `schedule-posted` | a qualification schedule exists and nothing is played |
| `quals-in-progress` | some, not all, qualification matches are played |
| `quals-complete` | every qualification match is played and alliances are not known yet |
| `alliances-posted` | a playoff row names both alliances, or the alliances endpoint has answered with some |
| `playoffs-in-progress` | a playoff match is played and the event is not over |
| `complete` | every playoff row is played and one colour has two wins in the same finals set |

A phase can move backward: TBA creates the next playoff row after a result, so a `complete` event
that gains an unplayed row derives `playoffs-in-progress` again. The phase is remembered across
ticks in `event_cursor`, under the reserved key `__live_ingest__:{eventKey}` (a JSON blob in
`last_folded_match_key`), so a tick that answered 304 for everything still knows it. The
cursor seed refuses that key shape, like the other reserved ones. The row is written only when the
phase changes.

**Reading it.** From the repo root, after the event:

```bash
pnpm live:report 2026vari                    # reads D1 through the logged in wrangler session
pnpm live:report 2026vari --from-json rows.json
pnpm live:report 2026vari --json             # the report object instead of text
```

It prints, in order: the timeline of every row; the four intervals per folded match (post to seen,
seen to folded, folded to published, post to published); the median and worst post to published
delay overall and per phase (matches TBA gave no `post_result_time` for are counted apart and
measured from `actual_time` instead, never mixed into the median); the lag between TBA's
`Last-Modified` and the tick per endpoint; the gaps (folded but unpublished matches, matches TBA
showed played that no row ever folded, and any quiet stretch over fifteen minutes while matches
should be arriving); every failure; and the time spent in each phase.

**Retention.** The tick prunes rows older than 60 days when an event reaches `complete`. To prune on
demand: `pnpm live:report --prune-before 2026-08-01`.

**Apply the migration before the Worker that writes to it is deployed**, with the same
`migrations apply` command the Database section gives, then confirm with
`SELECT COUNT(*) FROM ingest_log`. A Worker running against a missing table loses only this log:
the flush never throws, it warns `ingest-log-flush-failed` once per changed tick and the fold goes
on, so skipping the order costs rows and nothing else.

**A `--command` D1 call must run without the `.env` token.** `pnpm live:report` already passes no
env file flag. Do not add `--env-file .env` to a hand run of the same query: that token is accepted
by `--file` imports and refused by `--command`, and the logged in wrangler session is the one that
works.

**New log lines to filter on:** `ingest-log-flush-failed` (`rows`, `error`), `phase-b-failed`
(`eventKey`, `error`; Phase B's artifact writes used to fail silently) and `live-event-pass-failed`
(`eventKey`, `error`). The tick line gains `ingestRowsWritten`.

---

## Official rankings and alliances (quick task 261004-uyc, plan 02)

The tick asks TBA for an open event's own standings and alliance selection and writes them onto
**every** live algorithm's event artifact. It used to count the standings itself and never fetched
alliances, so a Worker promoted event showed a counted order, an empty Alliances tab and, on an event
with no counted rank, the "no official TBA ranking" banner.

**Which phase polls which endpoint** (`apps/worker/src/eventPhase.ts`, `endpointsToPoll`):

| Phase | `/event/{key}/rankings` | `/event/{key}/alliances` |
|---|---|---|
| no schedule, schedule posted | no | no |
| quals in progress | yes | no |
| quals complete, alliances posted | yes | yes |
| playoffs in progress | only while it changed in the last 30 minutes | yes |
| complete | only while it changed in the last 30 minutes | only while it changed in the last 30 minutes |

Both are conditional GETs. The ETag lives in the event's `__live_ingest__:<eventKey>` cursor row, so an
unchanged answer is a 304 that costs one request and writes nothing. The polls run from the **stored**
phase when the tick fetched no match list for the event, which is how an alliance selection is picked up
while no match is being played, and for a probe window event whose `/matches` answered 304.

**What the artifact carries.** TBA's rank, record and Ranking Score on each ranked team row, and the
alliances with their playoff records. An artifact holding TBA's ranks has **no `standings` marker**; the
marker means "counted by the tick", so its absence beside ranks means "official" (the Insights tab
derives its notice from exactly that). A later fold never counts over official ranks
(`hasOfficialStandings`), and a retry only writes artifacts that differ from what is already there, so a
rewrite is never a no-op put.

**Counting is the gap filler.** Until TBA's first rankings response the tick counts record and Ranking
Score from the played qualification rows. Each row credits its alliance's `actualRedRp` /
`actualBlueRp` once: that value is TBA's reported ranking points for the match, the total including win
or tie points. It is ranked only when every played qualification row carries a number on both sides. A
mid event republish is safe because the offline publisher writes TBA's own ranks and the tick then never
counts over them.

**When the ETag is not stored.** A state generation mismatch, a live algorithm with no event artifact
yet, a refused Ranking Score vocabulary and any failed write all leave the ETag unstored, so the next
tick asks again. A published algorithm id whose artifact does not exist at all (an unpublished version
named by the algorithms manifest) therefore re-fetches that endpoint every tick until it is published:
one request a tick, not a failure.

**Log lines and rows.** `official-data-failed` (`endpoint`, `eventKey`, `error`) and a `failure` ingest
log row whose subject is `rankings` or `alliances`. A write logs one `endpoint` row with that subject, TBA's
Last-Modified and a published time, so `pnpm live:report` now shows when TBA's standings changed and how
long the site took to carry them. The tick line gains `officialDataPolled` and `officialDataWritten`.

## Offseason ranking points and the live Sigma (quick task 261004-uyc, plan 03)

**Offseason is a base tier ranking point event.** TBA event type 99 is mapped to the `base` tier in
`EVENT_TYPE_TIERS` (`packages/core/rankingPoints/constants.ts`), and every ranking point gate in the system
reads that one table through `isRpEligibleEventType`: the offline layer, the publisher's rows, the upcoming
pricer, EPA, and the tick's `rpFieldsFor` and `foldObservedRp`. So an offseason qualification match is
priced with the base thresholds, live and offline alike, under SPR and under EPA. OPR prices no ranking
points anywhere. A played offseason row carries its actual per bonus flags when the breakdown parses under
the season's rules and an explicit `null` when it does not (offseason breakdowns are self reported, and every
parse site is inside a try and catch). The rank simulation runs at an offseason event from those rows.

**Offseason folds into the ranking point state, and none of it carries to the next season.** An offseason
match folds into the RP beliefs, the RP population summary, the RP mean shift and EPA's bonus slots exactly
as it folds into ratings. No ranking point state crosses a season boundary at all (the layer's only
cross season output is the Sigma carry, and every resume path discards another season's RP state), which
`packages/harness/offseasonRpCarry.test.ts` pins. One consequence worth knowing: an offseason event that
precedes official play in the same season (`2026isrtp`, 2026-04-03) teaches the 2026 official events after
it. SPR went to 10.0.0 for this and the RP calibration was re-measured as
`data/baselines/rp-calibration-2026-10a.json`.

**Offseason events still get no pre schedule sidecar.** `buildPreScheduleSidecarForEvent` skips event type 99
with a log line, because baking a sidecar for each of roughly 111 offseason events a season is hours of
publish time. The Simulation tab at an offseason event runs from its posted schedule's rows.

**The live Sigma.** Under SPR the tick writes a Sigma on the event row for a team that has none, from the
`SigmaScoreAccumulator` it already resumed (`scoreFor`, so a team with no Sigma belief gets none). It is a value
with no percentile, which the page renders as an untiered pill: the Worker holds no rating window pool, so
it cannot tier a Sigma. A published entry that has a percentile is never replaced; an entry with none is
one an earlier tick wrote and is refreshed each tick. The next publish writes the tiered figure. The
team page already gets the per match Sigma through its metric history, so the team season artifact is
unchanged.

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
 "subrequestsUsed":1,"globalRebuildRan":false,"districtsConsidered":0,
 "districtsRefreshed":0,"districtsUnchanged":0,"districtsFailed":0}
```

That is a healthy idle tick: nothing live, one manifest read, zero TBA requests. A tick with
nothing live is NOT always that cheap any more (quick task 261009-tx6): while a district event is
inside the 24 hours after its window, the tick whose minute is a multiple of 5 asks that district's
rankings and awards, so `tbaRequests`, `subrequestsUsed` and `districtsConsidered` are above
their idle values on those ticks and back at them on the minutes in between. **There is no
`eventsDeferred` field any more** — quick task 260923-3w4 deleted the deferral it counted, so a tick
log from before 2026-09-23 carries one and a current tick does not. `subrequestsUsed` stays: it is
how an event weekend's shape is read without a tail.

**The four district fields appeared on 2026-09-25** (phase 10, plan 10-05), so a tick log from
before that date carries none of them and a current tick carries all four. They are stated here for
the same reason the deleted field is: a reader of an old tail should not have to guess which side of
a change it came from.

| Field | What it counts |
|---|---|
| `districtsConsidered` | districts the pass processed this tick (since quick task 261009-tx6): a district with a member event the tick processed, on every tick, and a district that only has an event inside its 24 hour watch, on a minute that is a multiple of 5. `0` on a tick where no district is due, and against any live-windows manifest published before phase 10, which is the correct answer for a manifest that carries no district information |
| `districtsRefreshed` | districts whose artifact this tick republished |
| `districtsUnchanged` | processed districts with nothing to write: conditional requests only and no R2 read, or (the usual outcome of a forced look on a multiple of 15) the artifact read and the merge changing nothing |
| `districtsFailed` | districts that threw, were refused by the key pattern, or had no published artifact to merge into, and every due district when the pass's own cursor read failed |

A tick during an
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
| `opr` or `epa` metrics look stale mid-event while `spr` updates | **A real symptom since 2026-09-23, not expected any more** — all three fold live. Most likely the deployed `LIVE_ALGORITHM_IDS` is narrower than tracked config (check the tail for `live-tier-defaulted`, and the deploy output for the var), or opr/epa state is missing from D1 / at a retired snapshot shape (`LeagueRowShapeVersionError`, `state-generation-mismatch`) because a seed pass applied `seed-spr.sql` alone | Redeploy from tracked config with `pnpm worker:deploy`; if D1 is the cause, reseed all three plus `seed-cursors.sql` (`pnpm rebaseline --from seed`) |
| A `live-tier-defaulted` warn line in the tail | `LIVE_ALGORITHM_IDS` did not reach the deployed Worker (e.g. a `--var` deploy that did not carry tracked vars through) | Redeploy from tracked config with `pnpm worker:deploy` and confirm the deploy output lists both `TBA_BASE_URL` and `LIVE_ALGORITHM_IDS` |
| `outcome: "exceededCpu"` with an empty `logs` array on **every** tick | The tick is *consistently* over the CPU budget (30 s per invocation, Workers Paid since 2026-09-22 — was 10 ms on the free plan). It is reaching the handler and dying before its final log line — it is **not** dying in module init (that is a separate 1-second budget) | `eventsConsidered` on any tick that does survive. If non-zero, fetch `https://data.sigmascout.org/v1/manifest/live-windows.json` and see what the Worker thinks is live — **read the manifest, never the calendar**. Read "How the CPU budget is actually enforced" above before drawing any conclusion from a single high `cpuTime` |
| About to run an event; unsure the deployed bundle can read the rows in D1 | Untested since the last seed — a green idle tick does not exercise it | Apply `seed-cursors.sql` from the same publish run and deploy in that order, then watch the first tick for `state-generation-mismatch` or `LeagueRowShapeVersionError`. (The pre-event probe that used to answer this by hand was deleted 2026-09-23 — see "Pre-event probe" above) |
| Earned district points not moving on `/districts` during a live district weekend | The district refresh pass is not seeing the district as live, is failing on it, or has nothing published to merge into | Read `districtsConsidered`, `districtsRefreshed`, `districtsUnchanged` and `districtsFailed` on the tick line, in that order. `districtsConsidered: 0` on EVERY tick of a live district event means no member event's window carries a `districtKey` — the live-windows manifest predates phase 10 or has gone stale, so re-run `pnpm publish:seasons`. (`0` on most ticks and `1` on the minutes that are a multiple of 5 is the healthy shape for a district that only has an event in its 24 hour watch.) A `district-pass-suspended` warn means a state generation mismatch is holding the pass back, and a `district-cursor-read-failed` warn means its D1 read failed that tick. Non-zero considered with `districtsFailed` above zero: grep the tail for `district-refresh-failed` and `district-artifact-missing` (the Worker never CREATES a district artifact, so a district the offline publisher has not published yet fails every tick). All considered and all unchanged is the healthy answer when TBA's rankings have genuinely not moved |
| An `upcoming-pricing-failed` warn line in the tail | The tick could not price the event's remaining schedule — the priced row failed `EventUpcomingMatchSchema` (a pmf that does not sum, a band that is not finite). The event's state is durable in D1; its artifacts lag until the next tick | Read the truncated `error` field and the `upcoming` count on the line. It is a model-output problem, not a config one: the offline publisher would fail the same parse on the same state, so reproduce it with a replay rather than by redeploying |
| The page was late, or a result took a long time to show | Anything between TBA posting the result and the artifact landing: TBA itself, the cron cadence, a tick that skipped the event, a Phase B write that failed | Run `pnpm live:report <eventKey>` and read the median and worst post to published delay by phase, then the gaps and the failures (see "The ingest log" above). A large `Last-Modified` to observed lag is TBA or the cron; a `phase-b` failure row is the artifact write; a gap is a tick that never saw the event |

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
