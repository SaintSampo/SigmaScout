---
quick_id: 260915-m4j
status: complete
date: 2026-09-15
commits: [90bb292b, 2b0d2baa, e494b251]
requirements: [DATA-04, DATA-05]
---

# 260915-m4j: The web prices upcoming SPR matches from the state block (step 3 of 4)

## Outcome

- **Worker-written artifacts parse on the web again (DD-1 closed).** The web now parses event
  artifacts with `LiveEventArtifactSchema`, so an artifact the Worker wrote with schedule-only
  upcoming rows parses.
- **Upcoming SPR rows are priced in the browser from the `state` block.** They match the offline
  publisher exactly on every path the pages read: event rows, merged table rows, rank-simulation
  inputs and team rows.
- **Rows nobody could price say so.** They render "No prediction", never a fabricated number or NaN.
  The simulation leaves them out and says it did.
- **Team pages overlay the event file for live events.** They use the same query and cache as the
  event page, and a match played in either source renders once, as played.
- **Live event queries poll.** Every 60 s, only while matches remain and the schedule is current,
  never in a hidden tab.
- **The pricer and the rule modules load lazily.**

## Design as built

- **Where pricing runs.**
  - It happens inside `eventQueryOptions`' `queryFn`, through `resolveEventArtifact`
    (`apps/web/src/lib/eventPricing.ts`). That means once per fetch, shared by every observer and
    off the render path.
  - Alternatives rejected: a `select` is synchronous and can't wait for the lazy chunk, and a second
    query would briefly paint unpriced rows.
  - A 16-entry memo, keyed by event, algorithm, version, generation, `computedAt` and the upcoming
    keys and rosters, means an unchanged poll is never re-priced. Failures are not memoized.
  - The `state` block is removed from the result, so no consumer can price on its own.
  - It never throws: every failure falls back to published rows and logs one `console.warn` JSON
    line.
- **Which prices win.** The block is authoritative. Rows with a demo robot keep their published
  fields (step 1's known gap).
- **Unpriced rows.**
  - The Confidence cell shows muted "No prediction" (testid `no-prediction-{key}`).
  - The Predicted RP cell is empty, and the plot cell draws nothing.
  - The scheduled time and the Call dash stay.
  - Axis domains skip unpriced rows.
  - Presence checks use `!== undefined`, so a 0 probability or score still counts as priced.
- **Shared schedule rule.** `eventScheduleIsCurrent` moved verbatim to the browser-safe
  `packages/harness/eventSchedule.ts`, and `publish.ts` re-exports it.

## Verification

- **Root `npx vitest run`.** Baseline 239 files / 5,334 passed. After: 245 files / 5,409 passed,
  1 skipped, 0 failed (re-run independently by the orchestrator).
- **Typechecks and build.** Root, web and worker `tsc` are clean, and `vite build` succeeds.
- **Parity at the web layer (exact).**
  - A Worker-shaped artifact plus its block resolves to the offline `upcoming`.
  - A published row with a tampered price is replaced by the block's price.
  - Merged table rows, simulation inputs from the first upcoming qm, and team rows all match.
  - The fallback paths are covered, along with demo rosters, the memo and the loader retry.
- **Mutations.** 21 applied by hand, all caught.
  - M9 (keeping published priced rows) initially survived; test B2 was added and then caught it.
  - Polling tests use fake timers: always-poll, background polling and ignoring the schedule were
    each caught.
- **Lazy chunk (real build).**
  - The pricer's marker literals exist only in `eventPricing.lazy-*.js`.
  - `index` reaches that chunk only through a dynamic import.
  - There is one rule-module chunk per season.

## Bundle impact (investigated by the orchestrator)

| | Before | After |
|---|---|---|
| Initial JS (gzip) | 262.90 kB | 268.46 kB (+5.56 kB) |
| index | 262.90 kB | 249.25 kB |
| schemas (zod, new, preloaded) | none | 19.21 kB |
| eventPricing.lazy (on demand) | none | 11.72 kB |

- **Why zod split out.** Rolldown moved zod into a shared `schemas` chunk because the lazily loaded
  per-season rule modules import it for their breakdown parsers.
- **What the split costs.** Measured directly, concatenated vs separate: **236 B gzip** (about
  1 kB brotli), plus one parallel preloaded request.
- **Where the rest comes from.** The other ~5.3 kB is real new code in the initial bundle: the team
  overlay, the pricing gate, the live-event rule, the no-prediction display and table changes. The
  app has no route-level splitting.
- **Verdict.** Accepted, not blocking.

## Local visual check (V1, orchestrator)

Fixture: `scripts/localPricingFixture.ts` built from the real published 2026 artifacts.
- `2026vache` has its last 8 qualification matches moved into upcoming, with a state block and one
  unseen team on Qual 60.
- `2026alhu` has 8 matches moved with no block.

The dev server ran against the fixture origin, and a Playwright check passed 14/14:
- A finished event loads no pricer chunk.
- 8/8 moved rows show a %, with no "No prediction" cell.
- Qual 60 draws a band on the blue side only and a tick on the red side, with faded RP dots.
- The console logs `event-upcoming-priced`.
- The match page row is priced.
- The team page (8230) fetches the live event file, and Quals 53 and 60 appear once each, priced.
- The unpriced event shows 8/8 "No prediction", no NaN, and logs `event-upcoming-pricing-failed`
  `no-state-block`.
- A simulation run from Qual 52 completes 1,000 draws with no NaN and discloses 1 match with no RP
  distribution (Qual 60).

The screenshots were reviewed. Both servers were stopped by PID, and nothing was written to R2.

## Deviations

- Tests that need the corpus fixture run under `// @vitest-environment node`, because jsdom breaks
  `import.meta.url`. The team route test stubs the pricer; exact team-row parity is proven in Node.
- A schedule-only demo row loses the band only on the demo robot's alliance, which matches the
  step 1 known gap.
- Warnings fire only when a schedule-only row is left or a present block is discarded, so finished
  events and OPR/EPA pages stay quiet.
- `EventPageArtifact` props widened on six event tab components; two tab tests had type-only changes.
- `localPricingFixture.ts` has a test-only `skipSeasonCheck`.
- The executor briefly wrote CRLF into the checkout. Commits were always LF; the checkout was restored
  and verified clean.

## Known gaps

- On team pages, when an event artifact has no block, published upcoming rows keep the team
  artifact's own row.
- An event artifact with no `sortTime` and no `startDate` counts as current and polls. A live merge
  drops `startDate` (todo `live-merge-drops-event-identity-fields`), though Worker upcoming rows
  normally carry `sortTime`.
- Browser pricing time is not measured in production (about 2 ms warm and 10 ms cold under Node for
  27 rows).
- OPR and EPA are unaffected: the Worker never writes their event artifacts.

## Ship (S1-S4)

Recorded in the orchestrator's follow-up commit once run.
