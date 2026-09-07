---
id: algorithm-identity-sweep-reads-all-of-data
created: 2026-09-06
source: hit for real during the 2018 corpus ingest — a routine backup file turned the suite red
resolves_phase:
priority: medium
---

# `algorithmIdentity.test.ts` reads every byte under `data/`, and is one large file from going red

`packages/harness/algorithmIdentity.test.ts` walks the repository from its root and, for each
file, reads the **entire contents** into a string to decide whether it is binary — that is the
documented design (`looksBinary`, a content check chosen deliberately over an extension allowlist
so "no extension allowlist to keep in sync"). The design is defensible. The consequence is not
obvious from reading it: **`data/` is not excluded**, so every run reads the corpus and every
corpus backup in full.

## How it surfaced

During the 2018 ingest (2026-09-06) a routine pre-ingest backup, `data/corpus.sqlite.bak-pre-2018`
(468 MB), was created next to the live corpus. The next full-suite run failed:

```
FAIL packages/harness/algorithmIdentity.test.ts
  > the marker-exempted line count is at most the cap
  Error: Test timed out in 5000ms
```

Two tests timed out. **Neither was an assertion failure** — the sweep simply did not finish inside
vitest's 5-second per-test default.

Measured at the time:

| state of `data/` | bytes the sweep reads | result |
|---|---|---|
| with the new backup | **1.3 GB** | 2 tests time out at 5,000 ms |
| backup moved out of the repo | **833 MB** | 204 files, 3,752 passed, 0 failures |

Moving the one file out restored green, which confirms the mechanism rather than merely
correlating with it.

## Why this is worth fixing rather than remembering

**The test is already marginal, before anyone adds anything.** Run in isolation on a clean tree it
takes **6.59 s for 6 tests** against a **5,000 ms per-test cap** — it passes only because that time
is spread across six tests, and `runSweep()` happens to be memoised across them. The 833 MB it
reads on every run is `corpus.sqlite` (468 MB) plus `corpus.sqlite.bak-pre-2019-2020` (363 MB),
both of which are legitimately there and neither of which the sweep has any reason to read.

So the failure mode is: **anyone who drops a large file under `data/` turns the suite red, with a
timeout that names a line-count assertion and points nowhere near the real cause.** That is an
expensive diagnosis for the next person, and backups before a destructive-ish data operation are
exactly the kind of thing people should be doing freely.

It also means the current green is a coincidence of file sizes, not a property of the code.

## Options, roughly in order of preference

1. **Skip by size before reading.** A file over some bound (1 MB?) cannot plausibly be a source
   file carrying an identity-shaped string. One `statSync` — already called in `walk` — gates the
   read. Keeps the no-extension-allowlist property completely intact, which is the design's whole
   point.
2. **Read only a prefix for the binary check.** A NUL byte in a real binary appears within the
   first few KB; reading 8 KB instead of 468 MB decides it. Slightly weaker than (1) because the
   file is still opened.
3. **Add `data/` to `IDENTITY_SWEEP_EXCLUSIONS`.** Simplest, but wrong in kind — that list is a
   set of individually-reasoned *policy* exemptions ("planning history", "measurement records"),
   and its length is itself asserted. `data/` would be a performance exclusion smuggled into a
   policy list, and it would stop scanning `data/algorithm-versions/*.json`, which is genuinely
   identity-bearing content the sweep should keep checking.

(1) is the recommendation. Whatever is chosen, **add a regression test**: create a large temp file
under `data/`, assert the sweep still completes well inside its budget, remove it.

## Do not "fix" this by raising the timeout

Raising `testTimeout` hides the growth instead of stopping it. The corpus only gets bigger — the
2018 ingest just added ~100 MB, and 2017 and 2016 are queued behind it
(see [[extend-corpus-2018-2017-2016]]). A timeout bump buys one season.

## Related

- [[extend-corpus-2018-2017-2016]] — the job that surfaced this; its remaining passes will each
  grow `corpus.sqlite` again.
- The live backup now sits at `C:/Users/Jacob/Documents/SigmaScout-corpus-backups/corpus.sqlite.bak-pre-2018`,
  outside the repo. `data/corpus.sqlite.bak-pre-2019-2020` (363 MB) is still inside it and could be
  moved out too — that would cut the sweep's read volume nearly in half on its own, as a stopgap.
