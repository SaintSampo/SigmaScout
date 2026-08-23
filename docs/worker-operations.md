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
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-sigma1.sql
```

Skipping it breaks nothing — the site stays up and approximately fresh. It just means any drift
between the Worker's incremental folding and a from-scratch offline replay goes uncorrected until
the next run.

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
  --algorithm opr,epa,sigma1 \
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
