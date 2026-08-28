# Operating the live-update Worker

`sigmascout-worker` polls TBA once a minute for events that are currently live, advances each
affected team's algorithm state in D1, and rewrites only the artifacts that actually moved in R2.
A tick with nothing live reads one small manifest from KV and stops there, spending zero TBA
requests — which is what makes ~1,440 invocations a day free during the ten months of the year no
event is running. Everything the browser reads is a precomputed R2 object served over a custom
domain, so page traffic never touches this Worker.

Deployed at `https://sigmascout-worker.jrw4561.workers.dev`. Read path: `https://sigmascout.org`.

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

The deploy output must print `schedule: * * * * *` and list three bindings — `MANIFEST` (KV), `DB`
(D1), `ARTIFACTS` (R2). If a binding is missing, stop: the tick will fail every minute against a
binding that is not there.

**Check the entrypoint before deploying.** `apps/worker/wrangler.toml` must have
`main = "src/scheduled.ts"`. `src/bundleSmoke.ts` is kept in the repo as a re-runnable proof that
`ml-matrix` bundles and executes in the Workers runtime, and it was briefly the entrypoint during
Phase 4 — deploying with it wired up would put a linear-algebra smoke test on a one-minute
production cron.

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

```bash
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-vpr.sql
```
As of plan 07-17, `pnpm publish:seasons` includes offseason and preseason events (`--include-offseason`) in both the published set and the walk-forward stream — an operator running this command is entitled to know its scope changed.

The third seed file's name follows the algorithm's own registry id (`publish.ts`'s
`seed-${algorithm.id}.sql`) — renamed from `seed-sigma1.sql` by plan 07-16 (D-04/D-05). This
instruction describes the file a FUTURE `pnpm publish:seasons` run produces; see the transition
note under "Live folding tier" below for what has and has not landed yet.

Skipping it breaks nothing — the site stays up and approximately fresh. It just means any drift
between the Worker's incremental folding and a from-scratch offline replay goes uncorrected until
the next run.

---

## Live folding tier (quick task 260822-wqt)

**D-04/D-05 (plan 07-16) transition note — read this before the rest of this section.** The
TRACKED config now names the renamed publisher-side identity (`LIVE_ALGORITHM_IDS = "vpr"` in
`apps/worker/wrangler.toml`), but that change is INERT until 07-19 runs `pnpm worker:deploy` — the
DEPLOYED Worker is still running the pre-rename tier (folding under the id this section's
historical measurements below were taken against) until that redeploy happens, and the deployed
browser is still reading the pre-rename R2 object prefix until 07-18 flips the client's request
target. Nothing below this note describes a state that exists yet on the live site; it describes
the mechanism and the historical verification that mechanism was built and proven against.

**Only the published algorithm folds live.** `apps/worker/wrangler.toml`'s `[vars]
LIVE_ALGORITHM_IDS` is the single place that is configured — a plain tracked value, visible in
git, following `TBA_BASE_URL`'s own precedent in the same block. Change it there, never anywhere
else.

**Why.** `processEvent`'s `estimatedCost` for ONE ordinary 3v3 match (6 touched teams) is 18 with
the published algorithm alone vs. 50 with all three published algorithms, against ~41 subrequests
actually available per tick (`SUBREQUEST_CAP` 50, `SUBREQUEST_RESERVE` 4, minus the tick's own
fixed costs). With all three live the event defers every tick, forever — measured on the deployed
Worker during plan 04-07 under the pre-rename identity `sigma1` [pre-rename] and recorded in
[`publish-budget.md`](publish-budget.md)'s "Worker runtime budget (D-21/D-23, plan 04-07)" section;
this task's own numbers below reconfirm it on the same criterion, also measured under the
pre-rename identity `sigma1` [pre-rename].

**`opr` and `epa` remain FULLY PUBLISHED** (D-03) — every page and the Compare page still read
them; `packages/harness/publish.ts`, `packages/harness/manifests.ts` and the algorithms manifest
are untouched by this. They refresh only at the manual pre/post-event-weekend re-baseline above,
**not** on the cron. During an event weekend their numbers are as of the last re-baseline — that is
expected behavior, not a bug.

**Adding a second id to `LIVE_ALGORITHM_IDS` is gated** by
`apps/worker/test/liveAlgorithmTier.test.ts`, which recomputes the same budget arithmetic
`processEvent` uses. Re-measure on a deployed Worker before changing the tracked value; do not
raise the test's threshold to make a wider tier pass.

**Verified 2026-08-23, all measurements below under the pre-rename identity `sigma1` [pre-rename] —
plan 07-16 renamed the identity afterward without re-running this verification, since the rename
moves no predicted number and folds no different match** (`apps/worker/test/liveAlgorithmTier.test.ts`'s
tracked-tier assertion flipped to `"sigma1,epa,opr"` [pre-rename] and observed to fail on the
arithmetic-naming message, then reverted — see that test file and its own commit):

- Deployed version `77fca208-753f-4a4b-9f91-98e32c0e1717` (tracked config). `wrangler deploy`'s
  output listed both `env.TBA_BASE_URL` and `env.LIVE_ALGORITHM_IDS ("sigma1")` [pre-rename]
  alongside the `MANIFEST`/`DB`/`ARTIFACTS` bindings and `schedule: * * * * *`.
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

## Watching it

```bash
cd apps/worker
npx wrangler tail sigmascout-worker --format json
```

Every invocation emits exactly one structured line:

```json
{"msg":"tick","ok":true,"durationMs":152,"eventsConsidered":0,"eventsAdvanced":0,
 "eventsDeferred":0,"eventsFailed":0,"tbaRequests":0,"subrequestsUsed":1,"globalRebuildRan":false}
```

That is a healthy idle tick: nothing live, one KV read, zero TBA requests. A failing tick logs
`"ok":false` with an `error` field and is recorded as a failed invocation in the dashboard.

Retained logs, CPU time and subrequest counts are in the dashboard under **Workers & Pages →
sigmascout-worker → Observability**. Observability is enabled at `head_sampling_rate = 1.0` in
`wrangler.toml`; at ~1,440 events/day sampling would save nothing worth the blind spots.

Measured idle-tick cost (10 consecutive invocations, 2026-08-22, version `5a8e0a6f`): CPU median
**7 ms**, range 5–9 ms, with a **14 ms** cold start; wall time median 168 ms; 1 subrequest; 0 TBA
requests. All ten returned `ok`.

---

## When something is wrong

| Symptom | Likely cause | First thing to check |
|---|---|---|
| Artifacts stale during a live event | Cron not firing, or the event is outside its manifest window | `wrangler tail` — are ticks arriving ~60 s apart at all? If yes, check `eventsConsidered` in the log line: `0` during a live event means the live-windows manifest doesn't think anything is live |
| Ticks arriving but `eventsConsidered: 0` all weekend | The live-windows manifest went stale — nothing has republished it | Fetch `https://sigmascout.org/v1/manifest/live-windows.json` and check its `computedAt`. Fix by re-running `pnpm publish:seasons` |
| `"ok":false` in the tick log | A tick is throwing | Read the `error` field, then check `subrequestsUsed` on the surrounding ticks first — the subrequest cap is the most likely limit to be hit before anything else |
| `eventsDeferred` climbing every tick | Subrequest budget saturated; events are being pushed to later ticks | Expected under load and self-correcting — the rotation offset guarantees a deferred event is attempted earlier next tick. If it never drains, more events are live than one tick can serve |
| Predictions look wrong but ticks are healthy | Live state has drifted from the offline authority | Re-baseline (above). The offline snapshot always wins; never hand-edit D1 rows |
| No logs at all in `wrangler tail` | Either nothing is firing, or a version without logging is deployed | `wrangler deployments list` — confirm the current version is at or after `0210df9e`'s deploy. Before that commit the Worker logged nothing, and a silent tail meant nothing either way |
| `opr` or `epa` metrics look stale mid-event while `vpr` updates | Expected — only `vpr` folds live (see "Live folding tier" above) | `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; refresh via a re-baseline (above) |
| A `live-tier-defaulted` warn line in the tail | `LIVE_ALGORITHM_IDS` did not reach the deployed Worker (e.g. a `--var` deploy that did not carry tracked vars through) | Redeploy from tracked config with `pnpm worker:deploy` and confirm the deploy output lists both `TBA_BASE_URL` and `LIVE_ALGORITHM_IDS` |

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
