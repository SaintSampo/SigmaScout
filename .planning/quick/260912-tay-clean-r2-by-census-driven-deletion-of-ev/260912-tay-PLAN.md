---
phase: quick-260912-tay
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/r2Client.ts
  - packages/harness/r2ClientRetry.test.ts
  - packages/harness/r2ClientList.test.ts
  - scripts/pruneR2Generations.ts
  - scripts/pruneR2Generations.test.ts
  - scripts/verifySubsetPublish.ts
  - docs/publish-budget.md
  - package.json
  - .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-before.json
  - .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-prune-report.json
  - .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-after.json
  - .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-spotchecks.txt
autonomous: false
requirements: [TAY-01, TAY-02, TAY-03, TAY-04]

worktree: false   # workflow.use_worktrees is false; sequential on the main tree.

estimate:
  tokens: 80000
  raw_tokens: 160000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A FULL-LISTING census taken after the deletion (260912-tay-census-after.json, not a sample) shows the bucket below 10 GB, and every generation it lists is one the live manifest names"
    - "Zero objects remain under every deleted generation, proven by the full listing (each deleted generation is absent from census-after), never by a sample and never by an exit code alone"
    - "The three live generations (the manifest's opr, epa and spr entries) have IDENTICAL object and byte counts in census-before and census-after"
    - "pruneR2Generations.ts refuses, before the first DELETE, when: the live manifest is unavailable, malformed or empty; a PUBLISHED_ALGORITHM_IDS member is missing from it; a requested generation is live, malformed, duplicated or absent from the fresh census; a live generation is missing or implausibly small in the census; a requested generation was written within the recent-write window; or a selected key has an unrecognised shape. Selection is exact equality on the parsed final segment"
    - "The live site is untouched: the manifest still names the same three versions, one key per live generation returns 200 with parseable JSON, and one key per deleted generation returns 404"
    - "verify:subset event level reports 0 failing, including 15 NEW vpr@11.0.0+rolling-2026-09g absence entries (the 15 existing 9.0.0+rolling-2026-09c entries are kept). verify:subset --team-only reports 0 failing, including a NEW frc4206/2024 vpr@11.0.0+rolling-2026-09g absence entry"
    - "docs/publish-budget.md records the pass with measured before and after totals, and corrects the 2026-09-10 and 2026-09-11 'nothing orphaned' claims as 60-key-sample conclusions that a full listing disproved. The original text stays intact and the correction is added as dated annotations"
  artifacts:
    - path: "packages/harness/r2Client.ts"
      provides: "listObjects (paginated, signed ListObjectsV2 with retry) + deleteObject transient retry"
      exports: ["listObjects", "parseListObjectsV2Xml", "canonicalQueryString", "deleteObject", "putObject", "getObject"]
    - path: "scripts/pruneR2Generations.ts"
      provides: "census (read-only default), preview, and guarded --execute deletion with built-in post-census"
      exports: ["parseGenerationKey", "pageKindOfKey", "buildCensus", "fetchLiveGenerations", "assertPruneSelection", "selectKeysForDeletion", "runPrune", "parseCliOptions", "PruneRefusalError"]
    - path: "scripts/pruneR2Generations.test.ts"
      provides: "parse, classification, every refusal code, exact selection, post-census failure, failure cap, preview"
    - path: "packages/harness/r2ClientList.test.ts"
      provides: "query-string construction, two-page pagination, entity decoding, malformed-XML fail-closed, no-query regression for existing calls"
    - path: "scripts/verifySubsetPublish.ts"
      provides: "vpr@11.0.0+rolling-2026-09g absence layer (15 event + 1 team), stale comments rewritten"
    - path: ".planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-after.json"
      provides: "the proof: post-deletion full-listing aggregate"
  key_links:
    - from: "scripts/pruneR2Generations.ts"
      to: "packages/harness/r2Client.ts listObjects/deleteObject"
      via: "injected deps defaulting to the real client; credentials only ever read inside r2Client.ts"
      pattern: "listObjects|deleteObject"
    - from: "scripts/pruneR2Generations.ts"
      to: "scripts/verifySubsetPublish.ts ALGORITHMS_MANIFEST_KEY/DEFAULT_ARTIFACT_ORIGIN/fetchArtifactFresh"
      via: "fresh, cache-busted live manifest fetch, fail closed"
      pattern: "fetchArtifactFresh"
    - from: "scripts/pruneR2Generations.ts"
      to: "packages/harness/publishedAlgorithms.ts PUBLISHED_ALGORITHM_IDS"
      via: "second-source cross-check: every published id must have a manifest entry"
      pattern: "PUBLISHED_ALGORITHM_IDS"
    - from: "scripts/verifySubsetPublish.ts RETIRED_VPR absence tables"
      to: "PRE_RENAME_EVENT_SUBSET sigma1 controls"
      via: "programmatic .filter().map() derivation, never hand-retyped"
      pattern: "PRE_RENAME_EVENT_SUBSET\\.filter"
---

<objective>
Bring the `sigmascout-artifacts` R2 bucket back inside the 10 GB free tier. It holds 16.52 GB today, and about 12.18 GB of that is orphaned generations. The job is to list the WHOLE bucket, delete every generation the live manifest does not name, and prove the result with a second full listing. After that, add the retired-vpr absence entries that `scripts/verifySubsetPublish.ts` deliberately withheld until the orphan deletion ran.

Purpose: "Cloudflare free tiers only" is a project constraint, and the bucket is in standing violation of it. The existing tool (`scripts/deleteRetiredAlgorithmObjects.ts`) is the wrong instrument. It deletes a superset predicted from the corpus, then censuses a 60-key sample. Its "nothing orphaned" claims on 2026-09-10 and 2026-09-11 were false: 11,002 `epa@5.0.0+baseline` objects and 214 `epa@6.0.0+baseline` objects are still present. It is blind to season slices its single-range `--seasons` skipped, to corpus drift, and to superseded presim sidecars under a live id. So this plan adds LISTING, and only listing uses a new R2 capability. Deletion stays single-key through `deleteObject`.

Authorization: Jacob gave EXPLICIT, FULL permission to delete every dead generation ("You have my full permission to make any deletions you need to in R2"). There is NO confirmation checkpoint before deletion, by his instruction. The deletion cannot be undone, and that is why every guard below fails closed and applies before the first DELETE.

Output: a listing capability in r2Client, a census-driven prune tool with tests, a cleaned bucket proven by full-listing census files, 16 new vpr absence entries, and a corrected delete-pass record in docs/publish-budget.md.

EXECUTION PROTOCOL (read this first; it is load-bearing):
- Task 1: EXECUTOR, offline only. It commits, then STOPS at Task 2's checkpoint and returns control.
- Task 2: ORCHESTRATOR ONLY, network. Executor subagents' sandbox denies ALL network Bash, including tsx or pnpm scripts that reach R2 or data.sigmascout.org. An executor that reaches Task 2 must skip it and return the checkpoint.
- Task 3: EXECUTOR (continuation), offline edits that read Task 2's saved census files. Then the ORCHESTRATOR runs the network verification listed under `<verification>`.
- The executor must NOT create SUMMARY.md: Write is blocked for that filename, and heredocs break on long markdown here. The executor returns its summary text in its final message, and the orchestrator writes `260912-tay-SUMMARY.md` after the network steps, because the headline numbers come from them.
- Stage by explicit path only. Never use `git add -A` or `git add .`, because other sessions share this checkout. Run `git status` after every commit.
- Secrets: credentials reach the process only through `tsx --env-file=.env`. Never Read, cat, head or echo `.env`, and never print a credential, an Authorization header, or a signed URL.
- Tests: run `npx vitest run <paths>` from the repo root and judge by the PRINTED pass/fail counts, not the exit code (`timeout <n> pnpm ...` swallows output and exits 0). Typecheck with `npx tsc --noEmit` at the root.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/STATE.md
@packages/harness/r2Client.ts
@packages/harness/r2ClientRetry.test.ts
@scripts/deleteRetiredAlgorithmObjects.ts
@scripts/verifySubsetPublish.ts
@packages/harness/publishedAlgorithms.ts

<interfaces>
Extracted from the codebase. Use these directly and do not re-derive them.

packages/harness/r2Client.ts (current):
- private `signRequest(method: "PUT"|"GET"|"DELETE", credentials, bucket, key, body, extraHeaders): { url, headers }`. The canonical path is `encodePath("/" + bucket + "/" + key)`, and the canonical query string is HARDCODED to "" (the third element of the canonical-request join).
- private `uriEncode(component)`: encodeURIComponent plus `! ' ( ) *`. Private `encodePath(path)`: encodes each segment and rejoins with a literal `/`.
- `PUT_MAX_ATTEMPTS = 5`, `PUT_BASE_DELAY_MS = 250`, `isRetriableStatus(status)` (5xx, 429, 408), `delay(ms)`. The backoff is `base * 2^(attempt-1) + random jitter`, re-signed on every attempt.
- `export async function putObject(bucket, key, body, { contentType, cacheControl }): Promise<void>`. Its retry error strings are pinned by r2ClientRetry.test.ts: `/failed with status 503 .*after 5 attempts/` and `/after 5 attempts: Error: socket hang up/`.
- `export async function getObject(bucket, key): Promise<string>`
- `export async function deleteObject(bucket, key): Promise<void>`. It makes ONE attempt with no retry; 2xx and 404 count as success.

scripts/verifySubsetPublish.ts (import-safe: its only heavy import is pageArtifacts/zod, and main() is entry-point-guarded):
- `export const DEFAULT_ARTIFACT_ORIGIN = "https://data.sigmascout.org"`
- `export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json"`
- `export async function fetchArtifactFresh(origin, key, runId): Promise<{ status, bytes, body: string|undefined }>`. It adds `?cb=runId` and `cache: "no-store"`.
- The manifest body shape is `{ algorithms: [{ id: string, version: string }, ...] }`.
- `export const RETIRED_VPR_EVENT_SUBSET` derives from `PRE_RENAME_EVENT_SUBSET.filter(e => e.algorithmId === "sigma1")` with `algorithmId: "vpr"`, `expectAbsent: true` and `version: "9.0.0+rolling-2026-09c"`.
- `PUBLISHED_SUBSET = [...PRE_RENAME_EVENT_SUBSET, ...RENAMED_EVENT_SUBSET, NEW_2024AUWARP_ENTRY, ...RETIRED_VPR_EVENT_SUBSET]` holds 50 entries today, and `assertSubsetEntryShape(PUBLISHED_SUBSET, ...)` runs at module load.
- `PUBLISHED_TEAM_SUBSET` holds 7 entries. Its first is frc4206/2024/sigma1 with `expectPlayoffRows: 25`, `expectAbsent: true` and `version: "2.0.0+tuned-2026-08"`.
- The CLI flags are `--origin`, `--only`, `--algorithm`, `--version`, `--baseline`, `--json`, `--team-only` and `--compare-legacy`. The default run is EVENT level; `--team-only` runs the team level. The summary lines read `N entries checked, F failing, T total failure(s).` and `N team entries checked, F failing, ...`.
- FAIL lines print `${eventKey}/${algorithmId}` (event) and `${teamKey}/${year}/${algorithmId}` (team), with NO version.
- The 15 sigma1 control events are 2024casf, 2022ilpe, 2022mirr, 2023cur, 2023cnsh, 2023nhgrs, 2024new, 2024vabrb, 2024wvrox, 2025flta, 2025isios, 2025bc, 2025cmptx, 2026vache and 2026wvrox.

scripts/deleteRetiredAlgorithmObjects.ts: do NOT import from it. It top-level imports `packages/corpus/db.js` (better-sqlite3), which would couple a list-based tool to the corpus. Match its house shape instead: a header doc comment, `parseArgs` from node:util, `.js` import extensions, exported pure functions, and `main()` guarded by `process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href`, which exits 1 on error.

packages/harness/publishedAlgorithms.ts has no imports: `export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "spr"] as const;`

packages/harness/pageArtifacts.ts key shapes (every generation-bearing key ends in `/{algorithmId}@{version}.json`):
- `v1/teams/{year}/…`, `v1/team/{teamKey}/{year}/…`, `v1/events/{year}/…`, `v1/event/{eventKey}/…`, `v1/presim/{eventKey}/…`
- Unversioned keys: `v1/compare/{year}.json`, `v1/manifest/*.json`, `v1/districts/{year}.json`, `v1/district/{key}.json`, `v1/methodology/*.json`

HAZARD, the identity sweep (packages/harness/algorithmIdentity.test.ts): `RETIRED_IDS` is `sigma1`, `sigma1-defaults`, `sigma1-seasonsd`, `sigma1-normalcdf`, `sigma1-adapt` and `bpr`. For each id it flags a double-, single- or backtick-quoted occurrence, `id@`, `algorithm=id`, and `algorithm_id = 'id'`, in every NON-exempt file, comments included. The four new or changed files in Task 1 are NOT exempt, and adding them to `STRUCTURAL_EXEMPTIONS` would break that list's length pin, so it is not an option. Test fixtures and doc comments in those files must therefore use only `vpr`, `epa`, `opr`, `spr` or invented ids (e.g. `zzz`). `vpr` is NOT in RETIRED_IDS and is safe. `scripts/verifySubsetPublish.ts` and `docs/publish-budget.md` ARE exempt.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (EXECUTOR, offline): add bucket listing plus delete retry to r2Client, and build the census-driven prune tool</name>
  <files>packages/harness/r2Client.ts, packages/harness/r2ClientRetry.test.ts, packages/harness/r2ClientList.test.ts, scripts/pruneR2Generations.ts, scripts/pruneR2Generations.test.ts</files>
  <behavior>
    r2Client (packages/harness/r2ClientList.test.ts, with the deleteObject cases added to r2ClientRetry.test.ts; fetch stubbed, fake credentials on the environment object in beforeEach exactly as r2ClientRetry.test.ts does, fake timers plus its `settle` helper):
    - canonicalQueryString sorts params by encoded key and uriEncodes both key and value. A continuation token containing `+`, `/` and `=` encodes to `%2B`, `%2F` and `%3D`, and an omitted prefix is not emitted at all (no `prefix=`).
    - listObjects requests the path `/{bucket}` with `?` followed by exactly the canonical query string: `continuation-token` (pages 2 and later), `list-type=2`, `max-keys=1000` and `prefix` (only when given), in that sorted order. It sends an Authorization header beginning `AWS4-HMAC-SHA256` whose SignedHeaders include host, x-amz-content-sha256 and x-amz-date.
    - Two-page fixture: page 1 has IsTruncated true, a NextContinuationToken and 2 Contents; page 2 has IsTruncated false and 1 Contents. The result is 3 objects with numeric size and a lastModified string, fetch is called twice, and the second URL carries the encoded token.
    - XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and numeric `&#NN;`/`&#xHH;`) are decoded in Key and in NextContinuationToken, with `&amp;` decoded last so `&amp;lt;` becomes `&lt;` and not `<`.
    - Fail closed: a 200 whose body lacks ListBucketResult throws. So do a missing IsTruncated, IsTruncated true with no NextContinuationToken, a KeyCount (when present) that differs from the parsed Contents count, a Contents with no Key or a non-integer Size, and a continuation token repeated across pages.
    - listObjects retries 500 and then succeeds (2 calls), and does not retry a 403 (1 call, throws). Its error messages name the status, bucket and prefix, and contain neither the fake access key id nor the fake secret.
    - Regression: after the signRequest change, putObject, getObject and deleteObject request URLs carry no `?`.
    - deleteObject retries 500 twice and then succeeds on 204 (3 calls). A 404 succeeds immediately with 1 call. A 403 throws after 1 call. A persistent 503 throws after 5 attempts, naming the count.
    Prune tool (scripts/pruneR2Generations.test.ts; every dep is injected and mocked, with no network, no vi.mock of modules, and fixture ids limited to vpr/epa/opr/spr/zzz):
    - parseGenerationKey returns `{ generation, algorithmId, version, kind }` for one key of each kind: teams, team, events, event and presim (e.g. `v1/presim/2026mrcmp/epa@10.0.0+baseline.json` gives kind presim and generation `epa@10.0.0+baseline`). It returns null for `v1/compare/2024.json`, `v1/manifest/algorithms.json`, `v1/x@y/foo.json` (@ only in a directory segment), `v1/event/2024casf/vpr@1.0.0.json.bak`, and a final segment with no `.json`.
    - Near misses are distinct generations and never equal: `vpr@10.0.0+rolling-2026-09ee` differs from `vpr@10.0.0+rolling-2026-09e`, and `xvpr@10.0.0+rolling-2026-09e` parses with algorithmId `xvpr`.
    - buildCensus puts generation-bearing keys into generations (objects, bytes, byKind, newestLastModified, status LIVE when its string is in the live set and ORPHAN otherwise), keys with no `@` into unversioned (with a per-prefix breakdown over the first two path segments), and keys containing `@` that fail the parse into anomalous (count, bytes, at most 20 sample keys). Totals add up.
    - Each refusal is a PruneRefusalError whose `code` is asserted, and deleteObject is asserted NEVER called: MANIFEST_UNAVAILABLE (fetch throws, non-200, invalid JSON, algorithms missing, an entry lacking string id/version, zero entries), PUBLISHED_ID_NOT_IN_MANIFEST, MALFORMED_GENERATION_ARG (bad shape or a duplicate), REQUESTED_IS_LIVE, NOT_IN_CENSUS, LIVE_MISSING_FROM_CENSUS (a live generation below the injected minimum object floor), RECENT_WRITE (newestLastModified inside the injected window relative to the injected now), UNKNOWN_KEY_SHAPE (a selected key whose kind is other) and SELECTION_MISMATCH.
    - A surplus manifest id not in PUBLISHED_ALGORITHM_IDS is treated as LIVE and never refused.
    - Exact selection: a bucket holding `vpr@10.0.0+rolling-2026-09e`, `vpr@10.0.0+rolling-2026-09ee` and `xvpr@10.0.0+rolling-2026-09e` objects, with a request for the first only, deletes exactly the first generation's keys.
    - Execute happy path: the mocked list returns the pre objects and then the post objects without the deleted keys. The report is ok, remaining is 0 for each requested generation, and live counts and bytes are unchanged.
    - Post-census failure: one requested key is still listed after deletes, so the result is not ok and remaining is 1. Live drift (a live generation's bytes differ between pre and post) also makes the result not ok.
    - Failure cap: deleteObject always rejects, so deletion stops once failures exceed the injected cap, the post-census STILL runs, and the result is not ok.
    - Preview (generations given, no execute): every guard runs, per-generation selection counts are reported, and deleteObject is called zero times.
    - parseCliOptions rejects `--execute` with no `--generation`, `--prefix` combined with `--generation` or `--execute`, and `--concurrency` outside 1..64. It defaults to bucket `sigmascout-artifacts`, origin DEFAULT_ARTIFACT_ORIGIN and concurrency 24.
  </behavior>
  <action>
  RED first: write the behavior tests above and run them to confirm they fail. Then implement. Make two atomic commits: (a) r2Client plus its tests, (b) the prune tool plus its tests.

  (A) packages/harness/r2Client.ts:
  - Extend the private signRequest so it can sign a bucket-level path and a query. Accept an optional ordered param list, and let the canonical path be either `/{bucket}/{key}` (existing callers) or `/{bucket}` (listing). Build the canonical query string with a new exported pure `canonicalQueryString(params)`. It sorts by uriEncoded key (then by value) and joins `uriEncode(k)=uriEncode(v)` with `&`. The request URL must carry the byte-identical string after `?`, and no `?` at all when the list is empty, so existing PUT/GET/DELETE signatures and URLs are unchanged.
  - Add the exported pure `parseListObjectsV2Xml(xml)`, returning `{ objects: {key, size, lastModified}[], isTruncated, nextContinuationToken?, keyCount? }`. Parse with regexes over the `<Contents>…</Contents>` blocks (no new dependency) and decode the XML entities as described in behavior. Throw on every fail-closed condition listed there.
  - Add the exported `listObjects(bucket, options?: { prefix?: string; onPage?: (pagesSoFar: number, objectsSoFar: number) => void })`, returning `Promise<{ key: string; size: number; lastModified: string }[]>`. It sends a signed GET with `list-type=2`, `max-keys=1000`, the optional `prefix` and `continuation-token`, and paginates until IsTruncated is false. It throws on a repeated token and on more than 5,000 pages (an infinite-loop guard far above the ~340 pages expected). Retries reuse the existing policy (`isRetriableStatus`, the same attempt count, backoff and jitter, network rejections retried, each attempt re-signed). Error messages name the status, bucket and prefix only, and never the URL (it carries the account host), a header or a credential.
  - Give deleteObject the same transient-retry policy. 404 still counts as success. After retries are exhausted it throws a message with the key, the status and `after N attempts`. A private shared retry helper is allowed ONLY if every existing r2ClientRetry.test.ts assertion stays green unchanged. Update the file header and deleteObject doc to record why: publish-budget.md logs "two transient R2 500s" interrupting a past delete pass.
  - There is still no bulk or prefix DELETE, and none may be added.

  (B) scripts/pruneR2Generations.ts:
  - Header doc comment. Explain why this replaces enumerate-then-sample for bulk cleanup, citing the measured failure: deleteRetiredAlgorithmObjects.ts's 60-key samples reported "nothing orphaned" while a full listing still showed 11,002 epa 5.0.0 and 214 epa 6.0.0 objects, and it is blind to skipped season slices, corpus drift, and superseded presim sidecars under a live id. State that listing is new and deletion stays single-key through deleteObject, that the full-listing post-census is the proof and an exit code alone never is, and that every guard fails closed before the first DELETE. Follow the identity-sweep hazard in `<interfaces>`: never write the retired ids in quoted or `@`-suffixed form, in comments included.
  - `parseGenerationKey(key)`: take the final path segment and match it EXACTLY against `^([a-z0-9][a-z0-9-]*)@([^/@]+)\.json$` anchored to the whole segment. The kind comes from the prefix: `^v1/teams/\d{4}/` gives teams, `^v1/team/[^/]+/\d{4}/` team, `^v1/events/\d{4}/` events, `^v1/event/[^/]+/` event, `^v1/presim/[^/]+/` presim, and anything else other. Deviation from the orchestrator's suggested id class `[a-z0-9]+`: hyphens are allowed so that harness-style ids with hyphens can never be silently filed as unversioned. Export `pageKindOfKey` too.
  - `buildCensus(objects, liveGenerations, takenAt)` returns the census shape: takenAt, totals, live, orphan, unversioned (with byPrefix), anomalous (with sampleKeys at most 20), and generations sorted by bytes descending. Each generation carries generation, algorithmId, version, status, objects, bytes, byKind and newestLastModified.
  - `fetchLiveGenerations(origin, runId, deps)` uses `fetchArtifactFresh(origin, ALGORITHMS_MANIFEST_KEY, runId)` (imported from ./verifySubsetPublish.js) and returns the set of `id@version` strings plus the raw entries. Raise PruneRefusalError code MANIFEST_UNAVAILABLE on a non-200, invalid JSON, a missing algorithms array, an entry without string id and version, or ZERO entries, and PUBLISHED_ID_NOT_IN_MANIFEST when any PUBLISHED_ALGORITHM_IDS member has no entry. Surplus manifest ids stay LIVE, which is the safe direction.
  - `assertPruneSelection(census, requested, live, options)` enforces, in order: MALFORMED_GENERATION_ARG (the value must match `^[a-z0-9][a-z0-9-]*@[^/@]+$`, no duplicates), REQUESTED_IS_LIVE, NOT_IN_CENSUS (the typo guard, e.g. 09e against 09g), LIVE_MISSING_FROM_CENSUS (every live generation must be present with at least `minLiveGenerationObjects` objects, default 10,000; the smallest live set measured is 36,536, and a broken pagination or parse yields at most one page's 1,000), and RECENT_WRITE (a requested generation whose newestLastModified falls within `recentWriteRefusalHours` of now, default 6). The last guard exists because a generation written in the last few hours that the manifest does not name is the signature of another session's in-flight publish, and this checkout is shared. There is no bypass flag.
  - `selectKeysForDeletion(objects, requested, live)` compares by exact equality of the parsed generation string, never by prefix or substring. It re-asserts on EVERY selected key that the parsed generation is in the requested set and not in the live set (else SELECTION_MISMATCH), and that its kind is not other (else UNKNOWN_KEY_SHAPE).
  - `runPrune(options, deps)`. The deps are listObjects, deleteObject, fetchArtifactFresh, now and log, defaulting to the real implementations; tests inject all of them. The options are bucket, origin, prefix, generations, execute, concurrency, outPath, keysOutPath, minLiveGenerationObjects, recentWriteRefusalHours and maxDeleteFailures (default 25).
    - Flow: fetch the live manifest, list, and build the census. Print a table: generation, LIVE/ORPHAN, objects, bytes, GB = bytes/1e9 to 2 dp, and the kinds. Then print totals (bucket, live, orphan, unversioned by prefix, anomalous with samples) and one copy-pasteable line of `--generation <g>` flags covering every ORPHAN generation.
    - With keysOutPath, write key, size and lastModified as tab-separated lines, creating the parent dir. With outPath and no generations, write the census JSON.
    - With generations, run assertPruneSelection and selectKeysForDeletion, then print the per-generation selection counts. Without execute, stop there: the preview makes zero deletes.
    - With execute, delete the selected keys through a pool of `concurrency` async workers. Print progress every 5,000 deletes and at the end (deleted, failures, elapsed). Collect failures rather than throwing mid-run, and stop issuing new deletes once failures exceed maxDeleteFailures, since a permanent error such as a 403 would otherwise fail every key. Then ALWAYS re-list the whole bucket, build the post-census, and compute remaining objects per requested generation (must be 0) and the live generations' objects and bytes against the in-run pre-census (must be identical).
    - With outPath, write the report JSON: startedAt, finishedAt, requested, preCensus, deletes (issued, succeeded, failed, first 50 failures with key and message), postCensus, remainingByGeneration, liveUnchanged, liveDiffs, ok and refused. On a refusal, write the report with refused set to `{ code, message }` before exiting.
    - Return `{ ok }`. main exits non-zero on a refusal, when ok is false, or on any thrown error, after printing the reason.
    - Never read or print credentials. The tool never touches the environment object directly, and credentials flow only through r2Client.ts.
  - `parseCliOptions(argv)` uses node:util parseArgs with `--bucket`, `--origin`, `--prefix`, `--out`, `--keys-out`, `--generation` (multiple), `--execute` and `--concurrency`, plus the validation listed in behavior. `--prefix` exists only for the cheap signing smoke test.
  - `main()` is entry-point-guarded exactly like deleteRetiredAlgorithmObjects.ts.
  - Do NOT add the package.json alias here. Task 3 adds it; Task 2 invokes tsx directly.
  - Do not stage package.json or any other file not listed for this task.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/r2ClientRetry.test.ts packages/harness/r2ClientList.test.ts scripts/pruneR2Generations.test.ts packages/harness/algorithmIdentity.test.ts scripts/deleteRetiredAlgorithmObjects.test.ts && npx tsc --noEmit && test "$(grep -v '^\s*\(\*\|//\|/\*\)' scripts/pruneR2Generations.ts | grep -c 'process\.env')" = "0"</automated>
  </verify>
  <done>
  The printed vitest output shows every listed file passing, with zero failed tests, including the identity sweep and its marker-cap test. `npx tsc --noEmit` prints no errors. The tool reads no environment variables outside comments. Both commits are made, staged by explicit path, and `git status` shows no stray changes from this task. The executor then STOPS at Task 2 and returns the checkpoint, and it must NOT create SUMMARY.md.
  </done>
</task>

<task type="checkpoint:orchestrator-network" gate="blocking">
  <name>Task 2 (ORCHESTRATOR ONLY, network; executor must skip): census, delete every orphaned generation, prove it by full listing</name>
  <precondition>Task 1's two commits are on main and its vitest and tsc output was green. `git log -3` shows them.</precondition>
  <files>.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-before.json, .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-prune-report.json, .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-after.json, .planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-spotchecks.txt</files>
  <action>
  ORCHESTRATOR ONLY. The executor must skip this task and return the checkpoint, because its sandbox cannot reach R2 or the public origin. Run from the repo root in main context. Let `Q` stand for `.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev`, and let `PRUNE` stand for `npx tsx --env-file=.env scripts/pruneR2Generations.ts`. Invoke tsx directly, not pnpm, to avoid this machine's pnpm pre-check failure. Judge every step by printed content, never by exit code alone. Jacob pre-authorized every deletion here: there is no confirmation checkpoint, and none may be inserted.

  Step 0, concurrency check. Re-read the tail of .planning/STATE.md and `git log -5` for any in-progress publish, and list running node processes with full command lines (PowerShell: `Get-CimInstance Win32_Process -Filter "name='node.exe'" | Select-Object CommandLine`). If a `publish.ts`, `publishAlgorithmsManifest` or other R2-writing process is running, STOP and report. RECENT_WRITE is the mechanical backstop, not a substitute.

  Step 1, tracer smoke (signing, listing, parse and classification against real R2, read-only, one page): `PRUNE --prefix v1/manifest/`. Expect the manifest keys to be listed under unversioned, with exit 0 and no 403. A 403 or SignatureDoesNotMatch means the listing signature is wrong: STOP and fix it in code offline before anything else. Nothing destructive has happened at this point.

  Step 2, full pre-census: `PRUNE --out Q/260912-tay-census-before.json --keys-out reports/r2-prune/260912-tay-pre-keys.tsv` (reports/ is gitignored; the TSV is the audit trail of what existed). Check the printed content against the established facts. The total should be about 337,614 objects and 16.52 GB. There should be exactly three LIVE generations, matching the manifest's opr, epa and spr entries at about 36.5K objects each. The ORPHAN list should include at least the 11 known sets: vpr at 11.0.0+rolling-2026-09g, 11.0.0+rolling-2026-09e, 10.0.0+rolling-2026-09e, 2.1.0+tuned-2026-08, 10.0.0+rolling-2026-09d, 5.0.0+tuned-2026-08 and 8.0.0+rolling-2026-09b; epa at 1.1.0+baseline, 5.0.0+baseline and 6.0.0+baseline; opr at 3.1.0+baseline. If the total drifts by more than 1% from 337,614, or a live generation count is far from 36.5K, STOP and reconcile before deleting. Any ADDITIONAL orphan generation the census turns up is in scope, since Jacob authorized all dead generations. If the unversioned class shows a sizable orphan-looking prefix, or anomalous is non-zero, REPORT it in spotchecks.txt and do NOT delete it: out of scope.

  Step 3, non-vacuity baseline for Task 3's new absence entries. In the pre-keys TSV, count the presence of `v1/event/{E}/vpr@11.0.0+rolling-2026-09g.json` for each of the 15 control events in `<interfaces>`, and of `v1/team/frc4206/2024/vpr@11.0.0+rolling-2026-09g.json`. Record the found count as N/16, with any missing keys named, in `Q/260912-tay-spotchecks.txt`. Also record there one key per LIVE generation and one key per ORPHAN generation, taking the first TSV line for each, for Step 6.

  Step 4, preview: `PRUNE` followed by the copy-pasteable `--generation` line from Step 2, with no `--execute`. Every guard must pass, and the per-generation selection counts must equal census-before's orphan object counts. Any PruneRefusalError means STOP and report the code. Never work around a guard.

  Step 5, execute. Run the same flags plus `--execute --out Q/260912-tay-prune-report.json`, IN THE BACKGROUND (run_in_background) with stdout and stderr redirected to `reports/r2-prune/260912-tay-execute.log`. Expect about 228K single-key deletes, somewhere from 10 to 60 minutes. Poll the log's progress lines. A quiet log is NOT proof the process died: check that the process is still alive and the log's mtime before concluding anything. When it finishes, the log must show `ok` true, failures 0, remaining 0 for every requested generation, and live unchanged. If it exits non-zero: read the report, run a standalone `PRUNE` census, then re-run Step 5 with `--generation` for ONLY the orphan generations that census still lists. Guard NOT_IN_CENSUS deliberately refuses fully-deleted ones, and DELETE is idempotent, so a re-run resumes the pass. Never widen the list beyond generations census-before marked ORPHAN.

  Step 6, independent proof and live content checks. Run a standalone `PRUNE --out Q/260912-tay-census-after.json` at least one minute after Step 5 finishes. It must show every deleted generation ABSENT, only the three LIVE generations remaining with objects and bytes identical to census-before, and a total below 10 GB (target about 4.3 GB and about 109.6K generation objects plus unversioned). Then append to spotchecks.txt the results of content checks against `https://data.sigmascout.org`, fetched with `curl -s` plus a `?cb=<random>` suffix:
  - `v1/manifest/algorithms.json` parses and names exactly the three live id and version pairs.
  - Each recorded live key returns 200, and its body parses with `node -e` JSON.parse and carries a generation field.
  - Each recorded orphan key returns 404.

  Step 7, unchanged-reality check (before Task 3 edits anything): `npx tsx scripts/verifySubsetPublish.ts` must print `50 entries checked, 0 failing`, and `npx tsx scripts/verifySubsetPublish.ts --team-only` must print `7 team entries checked, 0 failing`. Append both summary lines to spotchecks.txt.

  Do not commit yet. Hand Task 3's executor the four Q files: census-before, prune-report, census-after and spotchecks.
  </action>
  <verify>
    <automated>node -e "const b=require('./.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-before.json'),a=require('./.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-census-after.json'),r=require('./.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-prune-report.json');const L=c=>Object.fromEntries(c.generations.filter(g=>g.status==='LIVE').map(g=>[g.generation,g.objects+'/'+g.bytes]));const orph=b.generations.filter(g=>g.status==='ORPHAN').map(g=>g.generation);const left=a.generations.filter(g=>orph.includes(g.generation));console.log({ok:r.ok,afterGB:a.totals.bytes/1e9,orphansAfter:a.generations.filter(g=>g.status==='ORPHAN').length,deletedStillPresent:left.length,liveSame:JSON.stringify(L(b))===JSON.stringify(L(a))});process.exit(r.ok&&a.totals.bytes<1e10&&left.length===0&&JSON.stringify(L(b))===JSON.stringify(L(a))?0:1)"</automated>
  </verify>
  <done>
  census-after.json shows a total below 1e10 bytes and zero ORPHAN generations. No generation census-before marked ORPHAN is present, and the LIVE generations' objects and bytes are identical to census-before. The prune report shows ok true. spotchecks.txt records the N/16 non-vacuity count, the manifest content check, 200 plus parseable JSON for each live key, 404 for each deleted key, and verify:subset at 50/0 and 7/0.
  </done>
  <resume-signal>Orchestrator: continue Task 3 by spawning the executor with the four Q files once the verify above prints ok and exits 0. If any step stopped, report the stop reason to Jacob instead.</resume-signal>
</task>

<task type="auto">
  <name>Task 3 (EXECUTOR, offline edits; ORCHESTRATOR verifies over the network afterwards): vpr final-generation absence entries, the package alias, and the corrected delete-pass record</name>
  <precondition>Task 2 completed: Q/260912-tay-census-before.json, 260912-tay-prune-report.json, 260912-tay-census-after.json and 260912-tay-spotchecks.txt exist, and the prune report's ok is true.</precondition>
  <files>scripts/verifySubsetPublish.ts, docs/publish-budget.md, package.json</files>
  <action>
  Read the four Q files from Task 2 first. Every figure written below comes from them and none may be invented. Deviation from the design direction: the numbers are read from the saved census files rather than left as placeholders, since this task runs after the measurement. The one exception is the post-edit verify:subset result, which the orchestrator appends.

  (D) scripts/verifySubsetPublish.ts:
  - Add a retired-vpr FINAL-generation absence layer pinned to `11.0.0+rolling-2026-09g`, VPR's last published generation, per the house convention that an absence layer pins the final version. Derive it PROGRAMMATICALLY from `PRE_RENAME_EVENT_SUBSET.filter(sigma1)` exactly as RETIRED_VPR_EVENT_SUBSET is derived: algorithmId vpr, expectAbsent true, the version literal, and a note prefixed `[retired-vpr final-generation absence, 2026-09-12]`. That gives 15 entries. Either add a second exported derived constant or generalize through a helper applied to both versions. KEEP the existing 15 `9.0.0+rolling-2026-09c` entries with unchanged content, because they are still true and removing an assertion narrows the verifier. Append the new layer to PUBLISHED_SUBSET, for 65 entries.
  - Add one PUBLISHED_TEAM_SUBSET entry, for 8 total: teamKey frc4206, year 2024, algorithmId vpr, expectPlayoffRows 25 (mirroring the sigma1 team control), expectAbsent true, version `11.0.0+rolling-2026-09g`, and a note naming quick task 260912-tay.
  - Rewrite the stale paragraph in the RENAMED_ALGORITHM_ID doc comment. It currently says the orphaned vpr objects are still in R2 and that vpr absence entries are deliberately not added yet. Replace it with a 2026-09-12 entry: quick task 260912-tay deleted every orphaned generation, all seven vpr versions among them, by full-listing census, so absence is now assertable. The final-generation layer covers 15 event entries and 1 team entry, the earlier 9.0.0 layer stays, and the doc cites the pre-delete presence count N/16 from spotchecks.txt, so the reader can see how many of the new absence keys were proven to exist before the deletion.
  - In RETIRED_VPR_EVENT_SUBSET's doc comment, correct the sentence claiming the absence layer pins only the final version. 9.0.0 was not the final vpr generation; it is kept alongside the final-generation layer.
  - Update PUBLISHED_SUBSET's doc comment: list its composition and change the count 50 to 65.
  - Put the version in the FAIL label for absence entries, in both the event and team FAIL lines (e.g. `2024casf/vpr@11.0.0+rolling-2026-09g`), because two vpr absence layers now share eventKey and algorithmId and a failure must name which one failed. Presence-entry labels stay unchanged.

  (E) docs/publish-budget.md (the machine-readable json budget block at the bottom must stay byte-identical):
  - Insert a new section, `## Delete pass — 2026-09-12, every orphaned generation removed by full-listing census (quick task 260912-tay)`, immediately ABOVE `## Delete pass — 2026-09-10, the retired vpr prefix removed`. It covers:
    - the exact commands run (the PRUNE invocations from Task 2, with tsx invoked directly)
    - the before and after totals (objects, bytes, GB) from the two census files
    - a table of the generations removed (generation, objects, bytes) taken from census-before's ORPHAN rows, plus deletes issued and failures from the prune report
    - the live generations' unchanged objects and bytes
    - any reported-not-deleted unversioned or anomalous classes from spotchecks.txt
    - the live content spot-check results
    - a correction paragraph: the 2026-09-10 claim ("exactly one generation per published algorithm version, nothing orphaned") and the 2026-09-11 claim ("R2 again holds no orphaned generations") were conclusions drawn from 60-key stratified samples over a corpus-predicted key superset, and a full listing disproved them (name the epa 5.0.0 and epa 6.0.0 remnants with their census-before counts). Give the three blind spots, and state the rule going forward: bulk cleanup is proven by a full listing, never by a sample.
    - a note that the Cloudflare dashboard storage figure can lag, and that the full-listing census is the measurement of record.
  - Add dated inline annotations, keeping the original text intact (the Phase 3.2 superseded-note convention):
    - After the 2026-09-11 "R2 again holds no orphaned generations" sentence, and after the 2026-09-10 "nothing orphaned" sentence, add `(Corrected 2026-09-12: a full bucket listing disproved this; see "Delete pass — 2026-09-12".)`.
    - After the "Filed, not done" caveat paragraph near the top, add a dated line: done 2026-09-12, with the after-census total. It also notes that the caveat's "five retired VPR generations" undercounted, since the census found seven vpr versions.
  - package.json: add `"cleanup:r2-generations": "tsx --env-file=.env scripts/pruneR2Generations.ts"` beside the existing `cleanup:` scripts, matching the house naming family. Deviation from the suggested `r2:prune`.
  - Also list the new alias in the new doc section as the reusable command.
  - Commit (D) and (E) by explicit path only. Return summary text in the final message and do NOT create SUMMARY.md.
  </action>
  <verify>
    <automated>npx vitest run scripts/deleteRetiredAlgorithmObjects.test.ts packages/harness/algorithmIdentity.test.ts packages/harness/payloadBudget.test.ts && npx tsc --noEmit && npx tsx -e "import('./scripts/verifySubsetPublish.ts').then(m=>{const ev=m.PUBLISHED_SUBSET.filter(e=>e.algorithmId==='vpr'&&e.expectAbsent&&e.version==='11.0.0+rolling-2026-09g').length;const old=m.PUBLISHED_SUBSET.filter(e=>e.algorithmId==='vpr'&&e.version==='9.0.0+rolling-2026-09c').length;const tm=m.PUBLISHED_TEAM_SUBSET.filter(e=>e.algorithmId==='vpr'&&e.expectAbsent&&e.version==='11.0.0+rolling-2026-09g').length;console.log({total:m.PUBLISHED_SUBSET.length,team:m.PUBLISHED_TEAM_SUBSET.length,ev,old,tm});process.exit(m.PUBLISHED_SUBSET.length===65&&m.PUBLISHED_TEAM_SUBSET.length===8&&ev===15&&old===15&&tm===1?0:1)})"</automated>
  </verify>
  <done>
  Offline: the printed vitest output passes for all three files. This includes the module load of verifySubsetPublish.ts through deleteRetiredAlgorithmObjects.test.ts (assertSubsetEntryShape) and the untouched machine-readable budget block through payloadBudget. tsc is clean. The tsx check prints total 65, team 8, ev 15, old 15 and tm 1. The doc section exists above the 2026-09-10 delete-pass heading, with figures traceable to the Q files. Afterwards the ORCHESTRATOR runs the network verification in `<verification>`, and this task counts as done only when that verification passes.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| script to R2 S3 API | signed destructive requests against the production artifact bucket |
| script to public origin | the manifest decides LIVE and ORPHAN; a stale or malformed manifest is the main hazard |
| shared checkout and other sessions | a concurrent publish can create a not-yet-manifested generation |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tay-01 | Tampering | runPrune selection | critical | mitigate | Exact parsed-segment equality plus a per-key re-assertion (SELECTION_MISMATCH); REQUESTED_IS_LIVE; no prefix or bulk DELETE exists |
| T-tay-02 | Tampering | live manifest dependency | critical | mitigate | Fetch fresh (cache-busted, no-store) and fail closed on any fetch, parse or shape failure or an empty manifest; cross-check against PUBLISHED_ALGORITHM_IDS (PUBLISHED_ID_NOT_IN_MANIFEST) |
| T-tay-03 | Denial of Service | broken listing or pagination | high | mitigate | Fail-closed XML parse (KeyCount, IsTruncated and token checks, repeated-token and page caps); LIVE_MISSING_FROM_CENSUS floor; a full post-census compares live counts and bytes |
| T-tay-04 | Tampering | concurrent in-flight publish | high | mitigate | Step 0 process and STATE check; RECENT_WRITE guard on newestLastModified with no bypass |
| T-tay-05 | Information Disclosure | credentials in logs or reports | high | mitigate | Credentials are read only inside r2Client.ts; error messages carry status, bucket, prefix and key only, never a URL, header or secret; tsx --env-file only |
| T-tay-06 | Repudiation | irreversible deletion | medium | mitigate | Pre-delete full key TSV (reports/), census-before and after plus the prune report committed under Q, spot checks recorded |
| T-tay-07 | Denial of Service | permanent error storm (e.g. 403 on every key) | low | mitigate | maxDeleteFailures cap stops new deletes; the post-census still runs |
</threat_model>

<verification>
ORCHESTRATOR ONLY, after Task 3's executor commits (network):
1. `npx tsx scripts/verifySubsetPublish.ts` prints `65 entries checked, 0 failing`. `npx tsx scripts/verifySubsetPublish.ts --algorithm vpr` prints 30 entries, 0 failing (15 at 9.0.0 plus 15 at 11.0.0, all 404).
2. `npx tsx scripts/verifySubsetPublish.ts --team-only` prints `8 team entries checked, 0 failing`.
3. Append those three summary lines to the new "Delete pass — 2026-09-12" section in docs/publish-budget.md with a scoped Edit.
4. Write `Q/260912-tay-SUMMARY.md` from the executor's returned text plus Task 2's measured headline: before and after GB and objects, generations removed, live unchanged, and verify:subset 65/0 and 8/0. Add the STATE.md quick-task row, avoiding any pipe character in its description. Commit by explicit paths: the four Q files, the SUMMARY, docs/publish-budget.md and .planning/STATE.md. Verify the stamped hash, then run `git status`.
5. Optionally mark the "R2 orphan generations" auto-memory entry resolved, citing census-after.
Offline, any time: `npx vitest run packages/harness/r2ClientRetry.test.ts packages/harness/r2ClientList.test.ts scripts/pruneR2Generations.test.ts packages/harness/algorithmIdentity.test.ts scripts/deleteRetiredAlgorithmObjects.test.ts packages/harness/payloadBudget.test.ts` is green by printed counts, and `npx tsc --noEmit` is clean.
</verification>

<success_criteria>
- The bucket is below 10 GB by full-listing census (census-after.json), down from 16.52 GB.
- Every generation census-before marked ORPHAN has zero objects in census-after.
- The live opr, epa and spr generations are byte- and count-identical before and after, and the live content spot checks pass.
- verify:subset reports 0 failing at the event level (65 entries) and at the team level (8 entries), including the 16 new vpr@11.0.0+rolling-2026-09g absence entries. N/16 of those keys were proven present before deletion.
- docs/publish-budget.md carries the measured pass and the dated corrections of the two sample-based "nothing orphaned" claims.
- No test is red, tsc is clean, the identity sweep is green, and no credential appears in any output or file.
</success_criteria>

<output>
The orchestrator (not the executor) creates `.planning/quick/260912-tay-clean-r2-by-census-driven-deletion-of-ev/260912-tay-SUMMARY.md` after the verification above.
</output>
