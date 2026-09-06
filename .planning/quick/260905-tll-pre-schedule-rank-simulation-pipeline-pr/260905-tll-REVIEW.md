---
phase: 260905-tll-pre-schedule-rank-simulation-pipeline
reviewed: 2026-09-06T09:04:17Z
depth: quick
diff_base: 1e99d98d
files_reviewed: 21
files_reviewed_list:
  - packages/harness/scheduleTemplates.ts
  - packages/harness/preSchedule.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/publish.ts
  - packages/ingest/eventTeams.ts
  - packages/ingest/cli.ts
  - scripts/fetchScheduleTemplates.ts
  - apps/web/src/lib/api/preSchedule.ts
  - apps/web/src/lib/preScheduleResult.ts
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/components/event/SimulationTab.tsx
  - apps/web/src/components/event/StartMatchPicker.tsx
  - apps/web/src/components/event/RunControl.tsx
  - apps/web/src/workers/createSimulationWorker.ts
  - apps/web/src/components/event/simulationTestFixtures.ts
  - apps/web/e2e/simulation-run.spec.ts
  - apps/web/e2e/support/simulation.ts
  - packages/harness/preSchedule.test.ts
  - packages/harness/scheduleTemplates.test.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.test.ts
findings:
  critical: 3
  warning: 8
  info: 3
  total: 14
status: issues_found
---

# Quick task 260905-tll: Code Review Report

**Reviewed:** 2026-09-06T09:04:17Z
**Depth:** quick (widened to per-file reading for the six named attention areas)
**Files Reviewed:** 21
**Status:** issues_found

## Summary

The pipeline half of this task is largely sound. Three of the six areas flagged for
scrutiny came back clean under tracing:

- **Pre-event state capture (Q1) is correct.** `lastStateByAlgo` genuinely holds the
  state after the previous chronological match; `preEventCaptureSeen` does exactly what
  its comment claims (without it, the cold-start first event would be re-visited on its
  second match and given a mid-event state); the season boundary falls through to
  `initialStates` (= `carrySeason(prior, boundary)`), which is the honest carried state;
  and the **aliasing claim holds** — `sigma1/index.ts:1536` builds `const finalTeams = new
  Map(afterBlue.teams)` and replaces entries with fresh objects, so `update()` never
  mutates the state object a caller is holding. `runEventMode`'s un-keyed `lastState`/
  `preEventCaptureSeen` is safe because that mode hard-throws unless exactly one
  algorithm is supplied.
- **`registeredTeamKeys!` is safe on the runEventMode path** (matchDerived empty ⟹
  `matches.length === 0` and `scheduledForEvent` empty ⟹ the guard already proved
  `registeredTeamKeys !== undefined`). It is *conditionally* safe on the seasons path —
  see WR-02.
- **Hook order in `event.$eventKey.tsx` is correct.** Every hook (`useParams`,
  `useSearch`, `useNavigate`, `useAlgorithmVersion`, two `useQuery`) now sits above the
  `!isValidKey` early return, and nothing below it is a hook. `handleTabChange` is a
  plain function declaration.
- **Seeded determinism holds inside `preSchedule.ts`** — no `Date.now()`, no
  `Math.random()`, FNV-1a over `eventKey|algorithmVersion|salt|k`, roster sorted before
  it becomes the index space. The determinism leaks are *outside* that module (WR-05,
  WR-08).

The defects concentrate in the **client integration** and in **artifact lifecycle**. The
three blockers are all reachable on ordinary user paths, not edge cases: every event page
in the app now renders an interactive-but-invalid Simulation stack for the duration of a
404 fetch, a late sidecar can hijack a run that is already executing, and a sidecar the
pipeline deliberately *declines* to publish is never removed from R2.

---

## Critical Issues

### CR-01: `preScheduleIsPending` suppresses BOTH Simulation-tab correctness guards on every event

**File:** `apps/web/src/components/event/SimulationTab.tsx:345-353`, gated from
`apps/web/src/routes/event.$eventKey.tsx:206-215`

**Issue:** `hasOrExpectsPreSchedule = hasPreSchedule || preScheduleIsPending` is used to
short-circuit *both* early returns. The sidecar query is enabled for **every** event whose
Simulation tab is active — there is no season gate on the client — so on every pre-2026
event and every offseason event, `preScheduleIsPending` is `true` for the whole round trip
that will end in a 404. During that window:

1. `qualRows.length === 0 && !hasOrExpectsPreSchedule` is false, so the "No qualification
   matches to simulate" state is suppressed. `StartMatchPicker` receives `rows=[]`,
   `hasPreScheduleStop=false`, `selection=null` → `activeRow` is `undefined` and
   `isPreScheduleSelected` is false, so **both** render branches (lines 337 and 376) are
   skipped and the picker renders a bare hint paragraph with no slider, no number input
   and no summary. The reader sees a control-less shell, then it is replaced by the empty
   state when the 404 lands.
2. `!hasSimulatableRankInputs(artifact) && !hasOrExpectsPreSchedule` is false, so the
   "Rank simulation isn't available for this event" state is suppressed too. This is the
   worse half: an offseason event *does* have `qualRows`, so the full stack renders with a
   working picker and an **enabled** `RunControl` (`canRun = simulationInputs !== null`,
   and `buildSimulationInputs` returns a non-null object even when no row carries a pmf).
   The reader can press Run and start the client engine over an input set the unavailable
   state exists specifically to prevent.

The comment claims the pending clause "stops the tab flashing an empty state during the
sidecar's own fetch and then contradicting it." It does the opposite for the ~100% of
events that have no sidecar: it flashes an interactive *wrong* state and then contradicts
*that*.

**Fix:** Gate the suppression on evidence that a sidecar is actually expected, not on the
query being in flight. Either push the `season >= PRESCHEDULE_FROM_SEASON` cutoff into the
route's `enabled` predicate so `preScheduleIsPending` is false for uncovered events, or —
better, since the cutoff would then have two homes — suppress only the branch the sidecar
can legitimately contradict and keep the tab non-interactive while pending:

```tsx
// Route: do not even ask for a sidecar that cannot exist.
const isPreScheduleEnabled =
  isValidKey && version !== undefined && !isSimulationDisabled &&
  activeTab === "simulation" && seasonFromEventKey(eventKey) >= PRESCHEDULE_FROM_SEASON;

// SimulationTab: while genuinely pending, render the skeleton, never the live stack.
if (preScheduleIsPending && !hasPreSchedule) return <SimulationTabSkeleton />;
if (qualRows.length === 0 && !hasPreSchedule) return <EmptyState heading={SIMULATION_EMPTY_STATE_HEADING} ... />;
if (!hasSimulatableRankInputs(artifact) && !hasPreSchedule) return <EmptyState heading={SIMULATION_UNAVAILABLE_HEADING} ... />;
```

---

### CR-02: A late-arriving sidecar hijacks the selection out from under an in-flight or completed run

**File:** `apps/web/src/components/event/SimulationTab.tsx:234-238, 310-322`

**Issue:** `effectiveSelection` returns `{ kind: "preSchedule" }` whenever `selection ===
null && hasPreSchedule`, and it is recomputed on every render. The reader's `selection`
stays `null` until they *actively touch the picker* — pressing **Run** does not set it.
The sidecar is fetched lazily and only starts when the Simulation tab becomes active, so
the following ordinary sequence is reachable:

1. Reader opens the Simulation tab on a covered 2026 event. Sidecar fetch (~160KB per the
   route's own comment) begins.
2. `hasPreSchedule` is still false, so `effectiveSelection` resolves to the default match.
   The picker shows it and Run is enabled.
3. Reader presses **Run** within the fetch window. `startRun` fires;
   `runState.status === "running"`.
4. Sidecar resolves. `hasPreSchedule` flips true; `selection` is still `null`, so
   `effectiveSelection` flips to `{ kind: "preSchedule" }`.
5. `rankResult`'s first branch (`isPreScheduleSelected && preSchedule !== null`, line 316)
   takes precedence over run state unconditionally, so the baked table renders — **while
   `RunControl` is simultaneously rendering the running/spinner state** for a simulation of
   a completely different start match. The picker has also silently jumped to "Before
   schedule release", contradicting the match the running simulation actually started from.

The same flip discards a *completed* result the reader was reading if they had not touched
the picker first.

**Fix:** Make the sidecar-outranks-default rule apply only before the reader has committed
to anything. Record the run's own commitment, and never let a derived default override it:

```tsx
const [hasCommittedSelection, setHasCommittedSelection] = useState(false);
// ...in handleRun, before startRun:
setHasCommittedSelection(true);

const effectiveSelection = useMemo(() => {
  if (selection !== null) return selection;
  if (hasPreSchedule && !hasCommittedSelection && runState.status === "idle") return { kind: "preSchedule" } as const;
  return defaultMatchKey !== null ? { kind: "match", matchKey: defaultMatchKey } as const : null;
}, [selection, hasPreSchedule, hasCommittedSelection, runState.status, defaultMatchKey]);
```

Independently, `rankResult` should not let the baked branch win while a run is active —
add `runState.status !== "running"` to the first branch's condition so the two panes can
never describe different things at once.

---

### CR-03: A sidecar the pipeline declines to publish is never deleted, so a stale one keeps being served

**File:** `packages/harness/publish.ts:1416-1466` (`buildPreScheduleSidecarForEvent`),
`packages/harness/publish.ts:2371-2391` (the upload site)

**Issue:** Every skip path in `buildPreScheduleSidecarForEvent` returns `undefined`, and
every `undefined` simply means "do not upload." Nothing ever issues a delete. R2 keeps
whatever was written by an earlier run, and `fetchPreScheduleArtifact` will keep serving
it (200, not 404) indefinitely. Concretely reachable transitions:

- **The schedule-landed-but-unplayed window.** PD-02's predicate is `qualMatchCount > 0`.
  The instant TBA publishes an event's qual schedule, `qualMatchCount` becomes ~80 and the
  code switches to the `pre-event-walk-forward` branch — but no match has completed, so
  `hasPreEventState` is false and the event is **skipped** (line 1428, "schedule has
  landed but no pre-event walk-forward state was captured"). The `pricedFrom:
  "current-state"` sidecar written by the previous run stays live and unchanged for the
  entire pre-event window, which is exactly the period a reader is most likely to be
  looking at this tab.
- **Roster shrink below six**, **template becomes unavailable**, or an **event reclassified
  to an RP-ineligible type** — all skip, all leave the prior artifact serving.
- A **roster change** on a scheduleless event: registration churn changes `eventTeamKeys`,
  but if the event later skips for any reason, the sidecar's `roster` (and therefore the
  baked histogram's index space) is frozen at the old roster while `artifact.teams` moves
  on. `buildRankDistributionRows` joins on `teamKey`, so unmatched teams silently render
  with a key-derived team number and no nickname (`rankRows.ts:167-186`) rather than
  failing.

**Fix:** Make the skip decision an explicit publish action. Track intended-vs-written keys
per run and reconcile:

```ts
// Return a discriminated result rather than `undefined`.
type SidecarOutcome =
  | { kind: "publish"; key: string; body: string }
  | { kind: "withdraw"; key: string; reason: string }   // event is covered but not publishable now
  | { kind: "out-of-scope" };                            // never had one; nothing to reconcile

// At the upload site, a "withdraw" issues deleteObject(bucket, key) before the event artifact,
// so an event that stops qualifying stops serving a sidecar in the same run that decides it.
```

At minimum, the schedule-landed-but-unplayed case should not skip at all — it should keep
pricing from current state (the `else` branch's source) rather than falling silently
through to a stale object, since that is precisely when the "before schedule release" view
is still meaningful.

---

## Warnings

### WR-01: `PreScheduleArtifactSchema` has no roster-uniqueness refinement, so its documented unreachability guarantee is false

**File:** `packages/harness/pageArtifacts.ts:1652, 1683-1697`;
`apps/web/src/lib/preScheduleResult.ts:34-45`

**Issue:** The schema declares (lines 1638-1643) that its refinements are "the
publish-boundary guarantee that makes `MalformedRankHistogramError` in `rankRows.ts`
unreachable in front of a visitor," and `preScheduleResult.ts:20-30` instructs future
readers not to add a second check. But `roster` is only
`z.array(z.string().min(1)).min(1)` — **no uniqueness constraint**. `decodePreScheduleResult`
builds a `Map` keyed by team key, so a duplicated roster entry yields
`rankHistograms.size < roster.length`, while each histogram is schema-enforced to have
length `roster.length`. `buildRankDistributionRows` then compares `histogram.length !==
teamCount` (where `teamCount = rankHistograms.size`) and **throws
`MalformedRankHistogramError` at render**, on the client, in front of the visitor — the
exact outcome the comments claim is impossible.

Today's writers happen not to produce duplicates (`new Set` on the match-derived path,
`PRIMARY KEY (event_key, team_key)` on the registered path), so this is an unenforced
invariant rather than a live bug — but the whole design rests on the schema being the
single home for these bounds, and it currently isn't.

**Fix:** Add the missing refinement so the claim becomes true:

```ts
.refine((artifact) => new Set(artifact.roster).size === artifact.roster.length, {
  message: "`roster` must contain no duplicate team keys — it is the index space for every r/b array and every baked histogram",
  path: ["roster"],
})
```

### WR-02: `registeredTeamKeys!` on the seasons path rests on an unstated cross-map invariant

**File:** `packages/harness/publish.ts:2331, 2340`

**Issue:** The non-null assertion is only reachable when `matchDerivedTeamKeys.length ===
0`, which requires both `predictions` and `scheduledForEvent` to be empty. The guard on
line 2331 only proves `registeredTeamKeys !== undefined` when `predictions` **and
`upcoming`** are empty. Safety therefore depends on two facts nothing in this file states
or asserts: (a) `upcoming` is derived from `scheduledByEvent` (it is — line 2177 — so
`upcoming` non-empty ⟹ `scheduledForEvent` non-empty), and (b) every scheduled match has
non-empty `redTeams`/`blueTeams`. If (b) is ever violated — a corpus row with `red_teams`
= `"[]"` — `[...undefined]` throws `TypeError: undefined is not iterable` and kills the
entire multi-season publish run mid-flight.

**Fix:** Test the actual precondition instead of asserting it:

```ts
const eventTeamKeys =
  matchDerivedTeamKeys.length > 0
    ? matchDerivedTeamKeys
    : registeredTeamKeys !== undefined
      ? [...registeredTeamKeys].sort()
      : [];
if (eventTeamKeys.length === 0) continue; // nothing publishable for this event
```

### WR-03: `matchesPerTeamFor` has no floor, so a partially-ingested qual schedule publishes a wrong-shaped synthetic schedule as authoritative

**File:** `packages/harness/scheduleTemplates.ts:109-112`;
`packages/harness/publish.ts:1450-1451`

**Issue:** PD-02's "has the schedule landed?" predicate is literally `qualMatchCount > 0`,
and `matchesPerTeamFor` then computes `clamp(trunc(qualMatchCount * 6 / numTeams), 1, 14)`.
One ingested qual row at a 40-team event gives `trunc(6/40) = 0`, clamped up to **1** — the
pipeline loads `40_1.csv`, builds seven synthetic matches in which each team plays once,
and publishes the resulting near-uniform rank distribution as the event's "before schedule
release" outlook. Nothing distinguishes "the schedule has landed" from "the corpus has one
qual row for this event," and nothing downstream can detect the difference: the artifact is
structurally valid and renders a plausible-looking table.

**Fix:** Treat a derived matches-per-team that falls far below the season convention as
"the schedule has not really landed" and use the default instead:

```ts
const derived = matchesPerTeamFor(args.roster.length, args.qualMatchCount);
const fallback = defaultMatchesPerTeam(args.eventType);
// A real schedule never runs at a third of the conventional length; a partial ingest does.
const matchesPerTeam = args.qualMatchCount > 0 && derived * 3 >= fallback ? derived : fallback;
```

...or gate the walk-forward branch on `qualMatchCount >= roster.length * 6 / 2` rather than
on `> 0`.

### WR-04: An empty-but-present template file yields a raw `TypeError`, not one of the module's named errors

**File:** `packages/harness/preSchedule.ts:182-183`;
`packages/harness/scheduleTemplates.ts:135-182`

**Issue:** `parseTemplateFile` returns `[]` for a file that is present but contains only
blank lines (line 140 skips blank lines, and no post-loop check requires at least one
row). `buildPreScheduleArtifact` then does `params.predict(firstScheduleMatches[0]!.upcoming)`
and throws `TypeError: Cannot read properties of undefined (reading 'upcoming')`. This is
precisely the interrupted/truncated-cache scenario WR-05 describes, and the module's whole
error design (`ScheduleTemplateMissingError` / `ScheduleTemplateParseError` naming file and
line) exists so an operator can tell what went wrong. A bare `TypeError` from a `!`
assertion names nothing.

**Fix:** Assert the invariant where the file is read:

```ts
// in loadTemplateFileDirect, after parseTemplateFile:
if (parsed.length === 0) {
  throw new ScheduleTemplateParseError(path, 0, "file contains no template rows — the cache entry is empty or truncated; delete it and re-run `pnpm fetch:schedule-templates`");
}
```

### WR-05: `fetchScheduleTemplates.ts` pins nothing, verifies nothing, and permanently skips a truncated partial write

**File:** `scripts/fetchScheduleTemplates.ts:31-44, 46-68`

**Issue:** Three compounding problems in one 14-line function, all of which land on a cache
that is gitignored (so no reviewer or CI ever sees it) and load-bearing for published
bytes:

1. **`UPSTREAM_BASE` points at `.../cheesy-arena/main`** — a moving branch. Two machines
   populating the cache on different days can get different templates, and the sidecar's
   entire seeded-determinism story ("republishing the same corpus twice produces
   byte-identical sidecars") silently stops holding across machines. Nothing records which
   upstream revision a cache was built from.
2. **`writeFileSync` is not atomic.** A `Ctrl-C` or crash mid-write leaves a partial CSV on
   disk. `existsSync(destination)` then treats it as complete on every subsequent run, so
   the poisoned entry is skipped **forever** — the "idempotent, resumes where it left off"
   property in the header is exactly what makes it unrecoverable without manual deletion.
   Downstream this surfaces as WR-04's bare `TypeError` or a mid-schedule
   `ScheduleTemplateParseError`.
3. **No response validation.** `res.text()` is written verbatim with no content check; a
   non-CSV 200 body is cached as if it were a template.

**Fix:**

```ts
const UPSTREAM_REF = "v2026.1.0"; // or a commit SHA — pin it, and print it in the summary
const UPSTREAM_BASE = `https://raw.githubusercontent.com/Team254/cheesy-arena/${UPSTREAM_REF}`;

// Atomic write: land the bytes under a temp name, then rename.
const body = await res.text();
if (destination.endsWith(".csv") && !/^\s*\d+(,\d+){11}\s*$/m.test(body)) {
  throw new Error(`fetchScheduleTemplates: GET ${url} returned a body that is not a 12-column template CSV`);
}
const tmp = `${destination}.partial`;
writeFileSync(tmp, body, "utf8");
renameSync(tmp, destination);
```

Also write a `SOURCE` marker file recording `UPSTREAM_REF` so `scheduleTemplates.ts` (or a
test) can prove which revision produced a given sidecar.

### WR-06: `event_teams` is upsert-only and never removes de-registered teams

**File:** `packages/ingest/cli.ts:955-966`; `packages/corpus/db.ts:1337-1342`

**Issue:** `ingestSeasonEventTeamsOnly` calls `upsertEventTeam` for each key TBA currently
returns and never deletes rows for keys it no longer returns. Team withdrawal before an
event is routine in FRC. Before this task the stale-row cost was invisible; now
`selectEventTeamsForEvents` is the **published roster** for every scheduleless event, so a
withdrawn team keeps appearing in the event page's standings table *and* in the sidecar's
`roster` — which means it also occupies a slot in every synthetic schedule and gets its own
row in the baked rank distribution. The reader is shown a confident rank forecast for a
team that is not attending.

Compounding it: a `null`-body or empty-array response (counted as `nullBodyCount` /
`emptyRosterCount`, lines 942-948) writes **no** rows and deletes none, so an event whose
entire registration list is withdrawn keeps its full stale roster.

**Fix:** Replace the roster transactionally per event:

```ts
const replaceRoster = db.transaction((eventKey: string, keys: string[], fetchedAt: string) => {
  db.prepare(`DELETE FROM event_teams WHERE event_key = ?`).run(eventKey);
  for (const teamKey of keys) upsertEventTeam(db, { eventKey, teamKey, fetchedAt });
});
// Only when the response carried a real body — a 304 or a null body must not clear anything.
if (teamKeys !== null) replaceRoster(eventKey, teamKeys, fetchedAt);
```

### WR-07: The Run button is enabled on the pre-schedule stop but is a hard no-op with zero feedback

**File:** `apps/web/src/components/event/SimulationTab.tsx:303, 324-332`;
`apps/web/src/components/event/RunControl.tsx`

**Issue:** `canRun = simulationInputs !== null || isPreScheduleSelected` keeps the button
pressable on the pre-schedule stop, and `handleRun` returns immediately on line 329. The
button now reads "Update simulation" (C-03's relabel) — a verb promising an action — and
clicking it produces **no state change of any kind**: no spinner, no re-render, no
completion line, no toast. The comment's justification ("re-showing it is exactly what the
reader asked for") does not survive contact with a control that gives no evidence it was
pressed at all. This is a worse affordance than the disabled control it was chosen over,
because a disabled button at least communicates its own inertness.

**Fix:** Either disable it on this stop with an explanatory line, or give the press a
visible effect. The smaller change:

```tsx
const canRun = simulationInputs !== null && !isPreScheduleSelected;
```

paired with a line in the pre-schedule scope text stating the result is already computed —
which `preScheduleScopeText` is already the natural home for.

### WR-08: The module header's byte-identical-republish claim is false as written

**File:** `packages/harness/preSchedule.ts:8-14`

**Issue:** "The platform's non-seedable random source never appears in this module, so
republishing the same corpus twice produces byte-identical sidecars." The *conclusion* does
not follow from the premise, and is false for the shipped artifact: `generation` is
`randomUUID()` and `computedAt` is `new Date().toISOString()` (both callers), and both are
embedded in the published JSON. Separately, every `pricedFrom: "current-state"` sidecar
re-prices from a season-final state that moves with the corpus, so its pmfs change too. A
reader who takes this sentence at face value will diff two publishes, see a mismatch, and
go hunting for a nondeterminism bug that does not exist — or worse, will use a byte-diff as
a regression check and get a permanent false positive.

**Fix:** State the actual guarantee, which is the useful one:

```
 * Given identical `generation`/`computedAt` inputs and identical pricing state, this
 * module's output is byte-identical: the shuffle and draw streams are pure hashes of
 * eventKey/algorithmVersion/index. The published bytes still vary run to run through the
 * caller-supplied `generation`/`computedAt` stamp, and a `current-state` sidecar's pmfs
 * additionally move with the corpus by design (PD-02).
```

---

## Info

### IN-01: A sidecar upload failure now blocks the event artifact's republish

**File:** `packages/harness/publish.ts:2388`

**Issue:** `uploader.publishSidecar(...).then(() => uploader.publish("event", key, eventBody))`
means a transient R2 failure on the ~160KB sidecar rejects before the event artifact is
ever attempted, leaving the event page's own artifact stale for that run. The
artifacts-before-index ordering rule is correct, but ordering and coupling are separable.

**Fix:** Consider `.catch()`-ing the sidecar leg into a logged, counted failure and still
uploading the event artifact — the sidecar's absence is already a first-class client state
(a 404 returns `null`), whereas a stale event artifact is not.

### IN-02: `runEventMode`'s sidecar carries a different `computedAt` from the event artifact it ships beside

**File:** `packages/harness/publish.ts:2797, 2818`

**Issue:** The comment at line 2797 says "one generation stamp shared by the event artifact
and its sidecar — the two describe the same run," and `generation` genuinely is shared. But
`computedAt` is not: the sidecar passes its own `new Date().toISOString()` (line 2818) while
`buildEventArtifact` defaults its own internally. The two D-04 stamps on objects written
milliseconds apart will disagree.

**Fix:** Hoist `const computedAt = new Date().toISOString();` beside `generation` and pass
it to both.

### IN-03: `selectEventTeamsForEvents`' `IN (...)` expands one bind parameter per event key

**File:** `packages/corpus/db.ts:1357-1363`, called from `packages/harness/publish.ts:2276-2279`

**Issue:** The seasons path passes every event key for the season. Measured against the live
corpus the worst year is 2025 at 350 events — comfortably under SQLite's 999-parameter
legacy floor and its modern 32,766 default, so this is not a live defect. It is worth noting
only because the call site is `eventMeta.map(...)` with no chunking, so any future widening
(a multi-season map, an all-time roster pass) crosses the limit silently.

**Fix:** If that widening ever happens, chunk at 500 keys per statement and merge the maps.

---

_Reviewed: 2026-09-06T09:04:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
