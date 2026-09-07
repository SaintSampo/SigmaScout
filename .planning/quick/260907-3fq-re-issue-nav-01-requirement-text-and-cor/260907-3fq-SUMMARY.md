---
quick_id: 260907-3fq
date: 2026-09-07
status: complete
commits: [c7216ce0]
files_modified:
  - .planning/REQUIREMENTS.md
  - .claude/CLAUDE.md
requirements-completed: []  # NAV-01's text was RE-ISSUED; its [x] and ID were already complete from Phase 5 and are unchanged. No requirement was newly completed here (matches the ALGO-01/Phase 3.2 precedent).
source: .planning/v1.0-MILESTONE-AUDIT.md
---

# Quick Task 260907-3fq — Summary

Closed both `highest`-priority items from the v1.0 milestone audit. Both were the same defect
class — a document asserting something about the system that had stopped being true — which is the
project's own named historical failure mode, and the reason this bucket was worth closing before the
milestone is archived.

## Task 1 — NAV-01 re-issued

**Before:** "Top ribbon navigates to Teams, Events, and Compare"
**After:** "Top ribbon navigates to Teams, Events, Districts, and Methodology; the
accuracy-comparison table lives under Methodology at `/methodology/compare`"

The ribbon has carried those four destinations since quick task `260905-phf` (2026-09-05, commit
`a9d971c2`), which replaced the Compare slot with Methodology and moved the Compare page intact via
`git mv`. The requirement text never followed.

Corrected using the ALGO-01 pattern Phase 3.2 established for exactly this situation: text fixed in
place, `[x]` and ID untouched, traceability row untouched, and a dated "Re-issued 2026-09-07" note
appended below the NAV block citing `260905-phf` and stating explicitly that it is a text correction
and not a scope reduction.

**Why it is not a scope reduction, on the record:** nothing NAV-01 asked for was dropped. The
Compare table is still reachable, still deep-linkable, and still one ribbon click away —
`apps/web/src/routes/compare.tsx` redirects the original `/compare` path to the new one with search
params preserved (a fixed literal target, so no open-redirect is constructible), and both
`VprGuide.tsx:49` and `AcknowledgmentsPage.tsx:59` link to it directly.

## Task 2 — CLAUDE.md's RP-PMF blurb corrected

The sketch-findings skill blurb claimed one Phase 8 gap remained open: "played event matches carry
no `redRpPmf`/`blueRpPmf`, so the rank simulation cannot rewind into played matches until that
republish lands."

The republish landed 2026-09-06 (STATE row 74 — 75,796 objects, 216 presim sidecars live for the
first time), and the milestone audit measured **72/72 played qualification matches carrying both
PMFs** on a live fetch of `2024casf` under `vpr@10.0.0+rolling-2026-09d`.

The blurb now records all three gaps as resolved and carries the evidence — the republish date, the
72/72 measurement, and the date it was taken — rather than simply deleting the claim, so a future
reader can distinguish "verified resolved" from "quietly dropped". This one mattered more than an
ordinary stale planning doc because the blurb auto-loads into context during UI implementation, so
the false claim was actively steering future work.

## Verification

Documentation-only; no code, tests, or artifacts touched. Verified by direct comparison against the
code each document describes:

1. `grep -n "NAV-01" .planning/REQUIREMENTS.md` — bullet updated, `[x]` present, ID unchanged,
   `| NAV-01 | Phase 5 | Complete |` traceability row untouched.
2. `grep -o 'to="/[a-z]*"' apps/web/src/components/ribbon/Ribbon.tsx` returns exactly
   `/teams`, `/events`, `/districts`, `/methodology` (plus `/` for the wordmark) — equal to the four
   destinations the corrected bullet now names. This is the check that would have caught the drift
   originally.
3. `grep -n "redRpPmf" .claude/CLAUDE.md` — the only surviving mention is the past-tense "which
   blocked" clause in the resolved-gaps sentence. No open-gap claim remains.

## What was deliberately left open

The audit's six `bookkeeping` items are real and remain filed: Phase 5's now-moot NAV-06 override
(the static shell shipped and congested-venue LCP measures 1028 ms against the locked 2500 ms gate),
Phase 6 and Phase 7's stale `human_verification` seal lines (both closed by their own UAT files),
07-UAT's ~8 "pending deploy + live re-verification" entries, 07-UI-REVIEW's unannotated fixes,
03.2-REVIEW's `issues-found` frontmatter, and the post-Phase-08 UI review's `issues_found` frontmatter.

Closing those means editing seven sealed phase artifacts — a different and larger job than this one,
and one where the code is already correct in every case. They are recorded in
`.planning/v1.0-MILESTONE-AUDIT.md` and do not block `/gsd-complete-milestone`.
