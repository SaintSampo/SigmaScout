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
