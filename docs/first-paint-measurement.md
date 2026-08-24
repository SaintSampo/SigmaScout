# First-paint measurement (NAV-06, D-03's verdict)

## What this document is

The dated, reproducible answer to `05-RESEARCH.md` Open Question 2 and the measurement gate
`05-VALIDATION.md` locked before any run: does the Teams page, fetching a real, worst-case
`teams/{year}` artifact, paint fast enough on a throttled mobile profile to leave Phase 4/5's
deferred search-index split (D-03) deferred — or does the number say otherwise. The threshold
(`≤ 2.5 s` median LCP) and the decision rule were written down in `05-VALIDATION.md` before this
run, per the objective's "define up front" requirement — this record does not revise them after
seeing the result.

## Run metadata

- **Date:** 2026-08-24
- **Command (run three times, output paths varied only):**
  ```
  npx lighthouse "https://sigmascout.org/teams?year=2024&algorithm=sigma1" \
    --preset=perf --emulated-form-factor=mobile --throttling-method=simulate \
    --output=json --output-path=./lighthouse-teams-runN.json
  ```
  Lighthouse 13.4.1 (GoogleChrome/lighthouse), Chrome for Testing 151.0.7922.34 headless, launched
  via `CHROME_PATH` pointed at the same Chromium build Playwright's `pixel-10` project uses.
- **Deployed URL measured:** `https://sigmascout.org/teams?year=2024&algorithm=sigma1` — the
  canonical apex (D-17a), not a `*.pages.dev` preview and not `localhost`. Confirmed live and
  serving the Task 2 instrumented build before measuring: the response's bundled JS
  (`assets/index-DmfjauSt.js`) was verified byte-identical to this worktree's own
  `pnpm --filter web build` output, and a real headless-Chromium load of this exact URL logged
  the `teams-parse-to-paint` structured line (see "Parse-to-paint split" below) — Task 3's
  precondition (`https://www.sigmascout.org/teams` deployed, serving Task 2's build, fetching the
  real artifact) is satisfied; `www.sigmascout.org/teams` was independently confirmed to return
  `200` and serve the same bundle.
- **Artifact measured:** `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`, **2,721,887 bytes**
  — the measured max `teams/{year}` artifact per `docs/publish-budget.md` line 28 (`| teams/{year}
  | 15 | 1,361,992 | 2,721,887 | 2,721,887 | v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json |`).
  The Teams route is hard-coded to `year: 2024, algorithmId: "sigma1", version:
  "2.0.0+tuned-2026-08"` for this tracer (plan 05-01 Task 3, not yet parameterized by URL search
  params — plan 05-05's job), so the `?year=2024&algorithm=sigma1` query string is inert but the
  page genuinely fetches this exact worst-case artifact regardless.

## Median LCP

| Run | LCP (ms) | LCP (s) |
|-----|---------:|--------:|
| 1   | 2448.264 | 2.4 s   |
| 2   | 2590.628 | 2.6 s   |
| 3   | 2381.214 | 2.4 s   |

Sorted: 2381.214, 2448.264, 2590.628 ms.

**Median LCP: 2448.264 ms (2.4 s).**

Three runs and a median, per Lighthouse's own noise-reduction practice — not a single run.
Threshold, locked before this run (`05-VALIDATION.md`): **≤ 2.5 s**. 2448.264 ms is **under** the
2500 ms threshold, by a margin of about 52 ms (~2%) — a real pass, but a close one, close enough
that a future regression (a larger artifact, a slower edge path) could flip it. Worth watching,
not worth pre-emptively building the split for.

## Compression check (performed regardless of the pass/fail result, per the decision rule)

Independently of whether the threshold was cleared, the artifact response's compression was
captured directly against `https://data.sigmascout.org/v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`:

- **`Content-Encoding: br`** (Brotli) — present when the request advertises
  `Accept-Encoding: gzip, br`, exactly as every real browser does.
- **Transferred (wire) size: 346,427 bytes** — measured by downloading the response body with
  compression negotiated and no client-side auto-decode (so the byte count on disk is the actual
  wire size, not the decompressed size).
- **Raw artifact size: 2,721,887 bytes** (source: `docs/publish-budget.md` line 28, matches the
  `Content-Length` returned on an uncompressed request).
- **Compression ratio:** 346,427 / 2,721,887 ≈ 12.7% of the raw size (~87.3% reduction).

Compression is confirmed active and working well. This check runs first in the decision rule
specifically so a missing-compression misconfiguration would be caught before blaming the
artifact — here there is nothing to fix; the artifact is already served efficiently.

## Parse-to-paint split (Task 2's marks, a real load)

Captured via a headless Chromium navigation to `https://sigmascout.org/teams` with Task 2's
`artifact-parsed` → `first-rows-rendered` `performance.measure()` read from the page's own
structured console line:

```
{"event":"teams-parse-to-paint","season":2024,"durationMs":7.3}
{"event":"teams-parse-to-paint","season":2024,"durationMs":4.9}
```

Two real loads (one per Playwright device project, unthrottled network — this reads the browser's
own client-side parse+render cost in isolation from Lighthouse's simulated Slow-4G network
shaping): **parse-to-paint duration ≈ 5-7 ms.**

**What this says:** on an unthrottled connection, the gap between "the artifact JSON finished
`.parse()`ing" and "the first rows are painted" is under 10 ms — negligible next to the ~2.4 s
median LCP. The Lighthouse number is therefore **overwhelmingly a network cost** (TTFB + the
throttled Slow-4G download of the 346 KB compressed payload), not a parse-or-render cost. This is
exactly the split `05-VALIDATION.md`'s Measurement Gate names as deciding which follow-up applies:
a network-dominated number points at D-03's artifact-splitting question, not at a virtualization
fix — consistent with the median already clearing the threshold without needing either.

## Secondary gate — search keystroke latency (D-10)

**Deferred to plan 05-08**, restating the threshold set in `05-VALIDATION.md`: keystroke-to-updated-results
must be **under 100 ms** (RAIL model), measured via `performance.mark`/`performance.measure`
bracketing the search `onChange` handler through re-render, on the same throttled-CPU profile.
No search box exists yet in this phase's wave (plan 05-05 builds it) — this is recorded as an
explicit, named deferral rather than a silent omission, per the plan's own instruction.

## Verdict (D-03's decision rule, stated in D-03's own terms)

**Median LCP (2448.264 ms) ≤ 2.5 s → the deferred search-index split stays deferred.**

The compression check was performed regardless (see above) and found nothing to fix: Brotli
compression is active, cutting the 2.72 MB artifact to 346 KB on the wire, and the client-side
parse-to-paint cost is under 10 ms. D-03's single-fetch Teams page, as built, meets NAV-06's fast-load
requirement on the measured worst-case artifact under Lighthouse's standard mobile throttling
profile. Revisit only if a future artifact grows materially past 2.72 MB or the margin above (~2%)
gets eaten by a regression — the 2.4 s median leaves little headroom before threshold.

---

## Second measurement — the shipped Teams table (05-06-PLAN.md Task 3)

**This is a second, later measurement appended below the first, per this plan's own instruction
("append... as a second dated entry rather than editing the first"). The first entry above measured
the plain tracer table; this entry measures the real virtualized, pinned, sortable table plan 05-06
shipped.**

### Run metadata

- **Date:** 2026-08-24
- **Command (run three times, output paths varied only):**
  ```
  npx lighthouse "https://sigmascout.org/teams?year=2024&algorithm=sigma1&sort=total&sortDir=desc" \
    --preset=perf --emulated-form-factor=mobile --throttling-method=simulate \
    --output=json --output-path=./lighthouse-teams-runN.json
  ```
  Lighthouse 13.4.1, launched via `CHROME_PATH` pointed at the same Playwright-managed Chromium
  build the 05-04 measurement used.
- **Deployed URL measured:** `https://sigmascout.org/teams?year=2024&algorithm=sigma1&sort=total&sortDir=desc`
  — the canonical apex (D-17a). Confirmed live and serving this plan's build: both
  `https://www.sigmascout.org/teams?...` and `https://sigmascout.org/teams?...` return `200`
  (this plan's own verify command), and a real headless-Chromium load of the exact measured URL
  logged the `teams-parse-to-paint` structured line (see "Parse-to-paint split" below).
- **Artifact measured:** the same `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`
  (2,721,887 bytes) the first measurement used — this plan's URL contract makes `year`/`algorithm`
  genuinely load-bearing now (plan 05-05/05-06, not the tracer's hard-coded constants), and
  `?year=2024&algorithm=sigma1` resolves to the identical worst-case artifact D-03's decision rule
  was written against.

### Median LCP

| Run | LCP (ms) | LCP (s) |
|-----|---------:|--------:|
| 1   | 2851.260 | 2.9 s   |
| 2   | 2904.420 | 2.9 s   |
| 3   | 2748.718 | 2.7 s   |

Sorted: 2748.718, 2851.260, 2904.420 ms.

**Median LCP: 2851.260 ms (2.9 s).**

Three runs and a median, matching the first measurement's methodology. Threshold (`05-VALIDATION.md`,
unchanged): **≤ 2.5 s**. 2851.260 ms is **over** the 2500 ms threshold, by about 351 ms (~14%) — the
first measurement's own closing line flagged exactly this possibility ("Revisit only if... the
margin above (~2%) gets eaten by a regression"). Recorded and flagged here, per this plan's
instruction, rather than tuned silently.

### Diagnosing which layer moved (this plan's own instruction: "the parse-to-paint mark says so
directly")

- **Parse-to-paint (the render-side mark):** a real headless-Chromium load of the exact measured
  URL logged `{"event":"teams-parse-to-paint","season":2024,"durationMs":9.6}` — **under 10 ms**,
  the same order of magnitude as the first measurement's 5–7 ms. The marks bracket schema-parse to
  first-populated-render; this number says the TABLE's own JS-side row commit is NOT the driver of
  the regression.
- **Total Blocking Time:** 75 ms / 81.5 ms / 80 ms across the three runs — small, consistent with
  the parse-to-paint reading that main-thread work is not the bottleneck.
- **The LCP element itself, identified directly from Lighthouse's `lcp-breakdown-insight` audit in
  all three runs:** `div.min-h-screen > header... > span.text-role-display` — **the ribbon's
  wordmark, not any table content.** Its own breakdown: time-to-first-byte ≈127–141 ms plus
  element-render-delay ≈216–276 ms (observed, unthrottled trace numbers underlying the simulated
  metric). This is the same wordmark every route on the site renders in the persistent Ribbon
  (plan 05-05) — its paint timing is gated on the same JS-bundle fetch/parse/hydrate cost every
  page pays, not on anything Teams-table-specific.
- **Reading:** the regression is consistent with a heavier JS bundle (583.83 KB built /
  ~178.5 KB transferred, up from the tracer's slimmer bundle before `@tanstack/react-table` +
  `@tanstack/react-virtual` + the table/column code were wired in) delaying the FIRST paint of
  static shell content (the wordmark), not a cost incurred by rendering table ROWS once data
  arrives. Brotli compression is still confirmed active on the JS asset
  (`Content-Encoding: br`), so this is a genuine additional-bytes-to-parse-and-execute cost, not a
  missing-compression regression.

### Verdict — flagged, not silently tuned

**Median LCP (2851.260 ms) is over the 2.5 s threshold.** Per this plan's own instruction this is
recorded and flagged rather than fixed inline (fixing it — e.g. code-splitting the table bundle
behind a route-level dynamic `import()`, which `vite build`'s own warning already suggests — is a
real follow-up, but a bundle-splitting change is out of this plan's declared `files_modified` and
risks exactly the kind of silent, unmeasured tuning this project's failure log warns against). The
diagnosis above narrows the follow-up: this is a **bundle-weight** question (something Phase 6-8's
own additional page code will make MORE relevant, not less), not a virtualization or
row-rendering-cost question — the parse-to-paint marks and low TBT rule that out directly. D-03's
deferred search-index split remains a separate, still-deferred question; this LCP regression is
about JS bundle size, not artifact size.

---

## Deferred secondary gate — search keystroke latency (05-08-PLAN.md Task 3, D-10)

`05-VALIDATION.md`'s Measurement Gate set a keystroke-to-updated-results target of **< 100 ms**
(RAIL model), deferred by plan 05-04 because no search box existed yet, and restated by the first
entry above ("05-08... exists now. Measure it as that gate specifies"). It exists now.

**Method:** `SearchBox.tsx`'s `handleValueChange` calls `performance.mark("search-keystroke")` at
the very start of the `onChange` handler (`lib/perfMarks.ts`); a `useEffect` keyed on the rendered
results calls `performance.mark("search-results-rendered")` once the new dropdown content has
committed, then `performance.measure(...)` between the two marks and logs a structured
`{"event":"search-keystroke-to-render","durationMs":...}` console line — the same pattern
`routes/teams.tsx`'s `teams-parse-to-paint` line already established. A headless-Chromium script
(Playwright's own `chromium.launch()`) navigates to the deployed
`https://sigmascout.org/teams?year=2024&algorithm=sigma1&sort=total&sortDir=desc`, applies
**`Emulation.setCPUThrottlingRate({ rate: 4 })`** via a CDP session — 4x CPU slowdown, the same
multiplier Lighthouse's mobile preset applies under `--throttling-method=simulate`, i.e. "the same
throttled-CPU profile the first-paint gate uses" — fills the search input with `"1114"` (one
`onChange` firing, mirroring one real keystroke), and reads the logged duration back off the page's
own console.

**Measured (9 runs total, 3 sets of 3, run at different times to check stability rather than
cherry-picking a favorable set):**

| Set | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Set median (ms) |
|-----|-----------:|-----------:|-----------:|-----------------:|
| 1   | 137.5      | 75.7       | 102.3      | 102.3            |
| 2   | 53.1       | 65.4       | 98.6       | 65.4             |
| 3   | 82.0       | 57.0       | 72.5       | 72.5             |

All 9 measurements sorted: 53.1, 57.0, 65.4, 72.5, 75.7, 82.0, 98.6, 102.3, 137.5.

**Median across all 9 runs: 75.7 ms.**

**Verdict: 75.7 ms is UNDER the 100 ms threshold — a pass**, though the per-set medians (102.3,
65.4, 72.5) show real run-to-run variance on this machine, with one of three sets landing just over
threshold. The predicate itself (`lib/search-index.ts`'s `matchTeams`/`matchEvents`, plain
`.startsWith()`/`.includes()` over the resident ~3,750-row Teams artifact) does no regex compilation
and completes in low single-digit milliseconds per `search-index.test.ts`'s own timed adversarial
case — the measured 53–138 ms range here is dominated by React's re-render/commit cost under 4x CPU
throttling, not the matching predicate itself. Recorded honestly with the variance visible rather
than reporting only the most flattering set; no debouncing or D-03-style split is being built here,
per this task's own instruction, since the median clears the threshold.

---

## Third measurement — D-19 route-level code splitting (05-08-PLAN.md, added scope)

**This is a third, later measurement, appended below the first two per this document's own
established practice.** D-19 (`05-CONTEXT.md`, decided by the user at an execution checkpoint) was
added specifically because three prior measurements on identical methodology told a worsening
story: **2448 ms** (05-04, tracer table) → **2851 ms** (05-06, shipped table, second entry above) →
**3099 ms** (orchestrator, after 05-06+05-07 merged) against the locked **2500 ms** threshold. The
fix D-19 specified: split the Teams route's heavy dependencies (`@tanstack/react-table` +
`@tanstack/react-virtual`) behind a route-level dynamic `import()` so the ribbon's wordmark — the
LCP element in every prior measurement — is not gated on parsing/executing that code before it can
paint.

### What was done

`vite.config.ts`: `tanstackRouter({ ..., autoCodeSplitting: true })` — TanStack Router's own
officially-supported route-level split. Each route's `component` is emitted as its own chunk,
fetched only once the router actually matches that route, rather than eagerly imported by
`routeTree.gen.ts` into the single main bundle. No route file was manually restructured into the
`.lazy.tsx` convention.

**Verified in the build output:** the main eager payload dropped from one 602.07 KB / 183.27 KB
gzip bundle to a 273.90 KB / 87.43 KB gzip main chunk plus a 265.67 KB / 82.24 KB gzip shared
vendor chunk (both `modulepreload`ed from `index.html`) — combined ≈ 539.6 KB / 169.7 KB gzip eager
payload, alongside a separate, NOT preloaded `teams-*.js` chunk (71.17 KB / 20.46 KB gzip)
containing `@tanstack/react-table`/`@tanstack/react-virtual`. Grepping the built chunks confirmed
the isolation directly: `react-table`/`useVirtualizer`/`columnPinningFeature` strings appear ONLY in
the `teams-*.js` chunk, never in the main or shared chunks.

### Run metadata

- **Date:** 2026-08-24
- **Command (run three times, output paths varied only):**
  ```
  npx lighthouse "https://sigmascout.org/teams?year=2024&algorithm=sigma1&sort=total&sortDir=desc" \
    --preset=perf --emulated-form-factor=mobile --throttling-method=simulate \
    --output=json --output-path=./lh-runN.json --chrome-flags="--headless"
  ```
  Lighthouse 13.4.1, `CHROME_PATH` pointed at Playwright's own managed Chromium
  (`node -e "const {chromium}=require('@playwright/test');console.log(chromium.executablePath())"`),
  same methodology as the first two entries.
- **Deployed URL measured:** `https://sigmascout.org/teams?year=2024&algorithm=sigma1&sort=total&sortDir=desc`
  — the canonical apex (D-17a). Confirmed serving this exact build immediately before measuring:
  `sigmascout.org`/`www.sigmascout.org` both returned `200` and served `assets/index-CFq26DIg.js`,
  byte-identical to this worktree's own `dist/` output.
- **Search box included:** the deployed page carries plan 05-08's shipped `SearchBox` in the ribbon
  on every route, per this task's own instruction ("re-measure... with the search box included").

### Median LCP

| Run | LCP (ms) | TBT (ms) |
|-----|---------:|---------:|
| 1   | 3245.475 | 103      |
| 2   | 3232.192 | 106      |
| 3   | 3188.639 | 110.5    |

Sorted: 3188.639, 3232.192, 3245.475 ms.

**Median LCP: 3232.192 ms (3.2 s).**

Threshold (unchanged): **≤ 2.5 s**. 3232.192 ms is **over** the threshold by about 732 ms (~29%) —
**worse than the 3099 ms this task set out to fix**, not better.

### Diagnosis — reported plainly, not tuned away

The LCP element is still the ribbon's wordmark (`lcp-breakdown-insight`'s node identity, all three
runs) — unchanged from the second entry's finding. The OBSERVED (unthrottled-trace) breakdown also
stayed in the same order of magnitude as before: `elementRenderDelay` 220–278 ms across the three
runs here, against 216–276 ms in the second entry — the split did not make the real, observed paint
path meaningfully worse or better.

What changed is the **network dependency chain Lighthouse's simulator scores**, read directly off
the observed request timeline (`network-requests` audit): before the split, one JS bundle satisfied
the whole page. After the split, `teams-*.js` is only requested AFTER the main chunk has executed
enough to resolve the current route (observed: `index-*.js` finishes around 230 ms into the trace;
`teams-*.js` does not start until ~259 ms, a genuinely new SEQUENTIAL hop that did not exist before).
Lighthouse's `--throttling-method=simulate` model scales each hop in the observed critical-request
chain by the simulated Slow-4G RTT/throughput, so one additional serialized network round trip —
however cheap it is in reality (the observed gap here is ~30 ms) — is amplified substantially under
simulation. The net effect: less JS needs parsing before paint (a real win, confirmed in the build
output above), but the route now depends on an additional network round trip it did not need before
(a real cost), and on THIS measurement methodology the cost outweighs the win.

**Verdict: the split does NOT get Teams under the 2.5 s threshold. Recorded plainly, per this task's
own instruction, rather than tuned further** — no additional splitting, prefetching, or
`pendingComponent` work was attempted to chase a passing number. Brotli compression was re-confirmed
active on the main JS asset regardless of this result (`Content-Encoding: br`), so this is not a
missing-compression regression. A human should decide the next step: keep the split for its real
parse-time benefit despite the worse Lighthouse score, revert it, add an explicit
`pendingComponent`/prefetch strategy to remove the newly-introduced sequential hop, or reconsider
whether Lighthouse's simulated model is the right instrument for judging a route-split architecture
at all — none of those decisions belongs to this task.

---

## Fourth measurement — real-network A/B of the split, and its reversal (orchestrator, D-19 close-out)

**Why this entry exists.** The third entry recorded that route-level code splitting scored *worse*
under Lighthouse (3232 ms vs 3099 ms) and correctly declined to tune the number. That left an open
question the Lighthouse simulator cannot answer on its own: is the split actually worse for a real
user, or is the simulator over-penalizing one extra request hop? This entry answers it by measuring
both builds directly, with no simulator in the loop.

### Method

Both builds were produced from the same worktree — `autoCodeSplitting: true` and
`autoCodeSplitting: false` — and served from identical local static servers on adjacent ports, so
the only variable is the split itself. Chromium was driven via Playwright with **real CDP
throttling** (`Network.emulateNetworkConditions` + `Emulation.setCPUThrottlingRate`, 4x CPU on every
profile), LCP read from a `PerformanceObserver` registered before navigation. Median of three runs
per cell.

### Results — Teams route

| Network profile | With split | Without split | Split costs |
|---|---:|---:|---:|
| Congested venue (1.6 Mbps / 150 ms) | 4144 ms | 4064 ms | **+80 ms** |
| Decent LTE (10 Mbps / 40 ms) | 1144 ms | 1100 ms | **+44 ms** |
| Good wifi (40 Mbps / 15 ms) | 668 ms | 656 ms | **+12 ms** |

**The split is consistently slower on Teams across every profile, and never faster.** Lighthouse's
simulator exaggerated the effect but did not invent it.

### Why — the size table explains it

| | Eager JS | Route chunk | Total on Teams |
|---|---|---|---|
| With split | 539.6 KB (`index` 273.9 + vendor 265.7) | + 71.2 KB `teams` | 610.8 KB, **two serial stages** |
| Without split | 622.1 KB | — | 622.1 KB, **one stage** |

On the Teams route the split saves about **11 KB** and buys an extra serialized round trip. Most of
the bundle's weight lives in the *shared* vendor chunk that every route loads regardless, so there is
very little route-specific weight for a route-level split to defer. It does help Events (~552 KB
eager) and Compare, but not the page users land on and the one NAV-06 is measured against.

### Decision — reverted

`autoCodeSplitting` was reverted (`29364417` reverts `51ad41d6`). It measurably costs more than it
saves on the flagship page and adds build complexity in exchange. D-19's intent — get Teams under
2.5 s — is **not** satisfied, and is explicitly left open rather than declared closed.

### What is actually slow (the real finding, logged for a scoped follow-up)

The LCP element is the ribbon's wordmark, and this is a pure client-rendered SPA: **nothing paints
at all until ~600 KB of JS downloads, parses and executes.** That is why every profile above scales
with bundle size, and why reshuffling which JS blocks the paint cannot fix it. Splitting was the
wrong lever.

The lever that would work is putting real markup — a static shell or skeleton — into `index.html`,
so first paint is independent of JS entirely. On the congested-venue profile that is the difference
between ~4 s of blank screen and an immediate shell. That is a structural change to the app shell
and deserves its own plan with before/after measurement on this same method, not a late
in-phase edit.

Worth recording for whoever picks this up: Lighthouse's Slow-4G preset sits close to the
"congested venue" row above, and SigmaScout's users are in arenas with thousands of people sharing
wifi. The 2.5 s threshold is not an arbitrary target for this audience — the ~4 s measured there is
a real problem, and the gate is measuring something that matters.
