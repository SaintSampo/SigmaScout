---
quick_id: 260925-hr9
status: complete
date: 2026-09-25
---

# Make the Road to District Champs ledger look like sketch 021 A

Jacob, after seeing the deployed tab: "the page looks totally different than the sketch." It was.
The data, the statuses and the cell text forms were all right; the drawing was not. Phase 10 shipped
bare numbers in a table with a controls card three times the sketch's height. This task is
presentation only — behaviour, data flow, statuses, cell text rules, search params, `data-cell`
values and every `data-testid` are byte-identical.

**Net: 5 files changed, 492 insertions, 167 deletions across one commit, `51d91043`.**

## The seven gaps, and what closed each

### 1. Cells are bare text; the sketch draws boxes

Every category cell, event total and grand total is now a filled, centred box with a 6px radius,
declared once in `theme.css` as `.district-ledger-cell` and three modifiers:

| Cell | Fill | Ink | Shape |
|---|---|---|---|
| final | `--color-bg-inset` | `--color-text-muted` | inert `<div>`, one integer, min-height 32px |
| open | `--tier-rare-bg` | `--tier-rare-fg` | a real `<button>`, inset ring, two lines, hover tint, a 2px ring while its drawer is open |
| grand total | the same two | the same two | min-height 70px, one size larger, spanning the team's rows |
| unavailable | none | `--color-text-muted` | plain centred text, so an absence never reads as a value |

**The open cell's blue moved from `--lock-status-locked-award-*` (blue-700) to the shipped SKY rare
pair.** The sketch's blue is sky, and the tier palette's own note makes sky load-bearing: a classic
blue measures ΔE 1.3 against the epic purple under deuteranopia. The rare pair carries no tier
meaning on this tab (an award-locked team wears the locked GREEN pair), so it is free to mean "still
open, click for the histogram". The grey/blue split is still never hue alone — grey holds ONE
integer and is not focusable, blue holds TWO lines and is a button, and `data-cell` says which.

### 2. The controls card was three times the sketch's height

Now, top to bottom: the small-caps `REWIND TO` label and the bold position readout on ONE line; the
rail directly under them; the tick labels under the rail; the jump chips as small pills in one
wrapping row; the one-sentence rewind note; the five status chips and the cell key (with swatches)
on one wrapping row; the five definitions as ONE wrapping row with the status word in full ink; the
team search and the stat line on one row. Padding and gaps dropped from `--spacing-md`/`--spacing-lg`
to `--spacing-sm`/`--spacing-xs`.

The jump chips and the chip filters dropped `.tap-target`'s 44px minimum for 32px, which is what the
sketch's density needs and still clears WCAG 2.5.8's 24px AA floor. Measured: the card went from
"three times the sketch" to 344px at 1280 against the sketch's ~295px, and 623px at 390 against the
sketch's ~620px.

**The tick labels are derived from the same jump chips**, never a hardcoded week list — the first
prints `start`, each per-week chip its own `wk N`, the last `now` — and a tick that would land within
10% of a neighbour is DROPPED rather than drawn over it. The sketch itself collides `wk 3` with `now`
at 390px and reads `wk 3now`; this does not.

### 3. Event cell

The name in muted ink, a faint 11px `Wk N` suffix, the stage word as a faint 11px second line.

The name is also SHORTENED, but only when it matches TBA's whole district naming template:
`districtLedgerShortEventName` turns "PNW District Oregon State Fair Event" into "Oregon State Fair"
and "FIM District - Kettering University Event #1" into "Kettering University #1", while
"ISR District Event #1" (no name body between the two words) and any non-district name print
verbatim. The plan permitted this only if the prefix is carried verbatim and the short form is
derivable, and both hold. It is also what makes the table fit: with the full names the Grand total
column sat behind the scroll at 1280px.

### 4. Team cell

Bold 15px number (still the router `Link`), the nickname beneath in muted 12px, truncated, then
`#1 · 145 earned` with ` · median 141` only when the team has an open category. The width cap from
cf809985 is kept and tightened from 260px to 176px, the second half of what fits nine columns at
1280px.

### 5. Rows

A 1px solid hairline above each team's first row, a 1px DASHED hairline between that team's two event
rows, and no rule anywhere else — `TableRow`'s `border-b` is switched off inside
`.district-ledger-table`. The drawer row takes the dashed edge. Vertical cell padding halved to 4px,
so a row is ~44px against the sketch's ~42px. The sticky first column and the shipped scroll-region
wrapper are untouched.

### 6. Column headers

The site's uppercase letterspaced `th-cell-label` as before, now centred over the six numeric
columns, with their cells centred under them.

### 7. Drawer

Unchanged, as the plan said.

## No palette entry, no literal colour

`theme.css` gains one property, `--district-ledger-faint`, a `color-mix` of `--color-text-muted` at
82%. The sketch's own faint ink is `#7d8da3`, which measures about 3.9:1 on white and fails AA; this
mix measures **4.83:1** and passes. Everything else is a shipped token or a `color-mix` of one, the
same construction `--sim-hist-bar` and `--sim-picker-selected-bg` already use. Greps confirm zero hex
literals in the component and zero `±` anywhere in the tab.

## Verification

| Check | Result |
|---|---|
| `npx vitest run apps/web/src/components/districts` | 9 files, **182 passed** |
| `npx vitest run` (repo root) | 281 files, **6304 passed, 1 skipped** — includes the `MetricHistoryTab` flake, unmodified and green |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `npx tsc --noEmit` (root) | clean |
| e2e selectors | every `TEST_IDS` entry, both `data-cell` values and `div.overflow-x-auto:has(> table)` still resolve in the component; the spec was NOT run (it targets the deployed site) |
| hex literal / `±` greps | zero |

### Tests changed, and why

Four assertions moved with the layout; none was weakened.

- `DistrictLedger.test.tsx`: `"1. "` → `"#1 · "` and `/projected/` → `/median \d+/`, the team cell's
  third line taking the sketch's form.
- `DistrictLedger.test.tsx`: a NEW assertion on the derived tick rail (first `start`, last `now`,
  middles matching `/^wk \d+$/`, never more ticks than chips).
- `districtLedgerCopy.test.ts`: two NEW tests pinning the three tick strings and the six
  event-name-shortening cases, including the three that must NOT be shortened.

No assertion pinning a status label, a definition, the no-± rule or the no-literal-colour rule was
touched.

## The local visual check

Built with `VITE_ARTIFACT_ORIGIN` pointed at a throwaway localhost fixture server on 4331 serving the
real `2026pnw` artifact with `state` and `awardProfile` injected (six events final, two mid-quals, so
both greys and blues are on screen), previewed on 4332, both verified by CONTENT and killed by PID
afterwards. Chromium via Playwright at 1280x1000 and 390x844. Zero `pageerror` and zero console errors
at either width. No network beyond localhost.

### Screenshots

| What | Path |
|---|---|
| ledger at 1280 | `C:\Users\Jacob\AppData\Local\Temp\claude\c--Users-Jacob-Documents-GitHub-SigmaScout\04f3ffd4-5db9-4a50-8e61-363d6723b0e6\scratchpad\hr9\hr9-app-table-1280.png` |
| page top at 1280 | `...\scratchpad\hr9\hr9-app-1280.png` |
| a drawer open at 1280 | `...\scratchpad\hr9\hr9-app-1280-drawer.png` |
| ledger at 390 | `...\scratchpad\hr9\hr9-app-table-390.png` |
| page top at 390 | `...\scratchpad\hr9\hr9-app-390.png` |
| **sketch 021 A at 1280** | `...\scratchpad\hr9\hr9-sketch-1280.png` |
| **sketch 021 A at 390** | `...\scratchpad\hr9\hr9-sketch-390.png` |

(The sketch shots have the sketch's own chrome — its variant tabs and its "why" strip — removed in the
page before capture, so the comparison is ledger against ledger.)

### The comparison

Side by side at 1280 the two now read as the same table. Both draw a grey filled box per earned
category and a sky box with an inset ring per open one, both centre every number under a centred
uppercase header, both put the event name with a faint week suffix over a faint stage word, both give
the team three stacked lines ending in `#rank · N earned`, both span a taller grand-total box across a
team's two rows, and both separate teams with a solid hairline and a team's own two rows with a dashed
one. The cell text is identical in form: `22 / likely 21.6–22.4` for a median-form cell and
`98% play / ~30 if in` for a lumpy one. Row height lands within 2px of the sketch's and the controls
card within 50px. All nine columns fit inside the card at 1280 (table 1150px in a 1150px wrapper,
measured), which is what the sketch does and what the shipped version did not.

Four things still differ, each on purpose:

1. **The faint ink is one step darker than the sketch's**, because the sketch's `#7d8da3` fails WCAG
   AA as text and the 4.83:1 mix does not. Visible only against the sketch, and only in the tick
   labels and the "Wk N"/stage lines.
2. **`Wk` stays capitalised** where the sketch writes `wk`. The rest of the site writes `Week N`; a
   single lowercase instance would read as a typo, and the hierarchy the sketch is after comes from
   the size and the colour, not the case.
3. **No per-position hint on the rewind line.** The sketch prints something like "week 2 events both
   at this stage" to the right of the readout; this page has no such published quantity and inventing
   copy for it was out of scope. The line carries the label and the readout only.
4. **The tick rail is sparser than the sketch's.** The sketch steps by week, so its ticks are evenly
   spaced by construction. The real slider steps by MATCH across the district's interleaved timeline
   (the phase's own deliberate choice over the sketch's week granularity), so an in-progress event's
   ~85 qualification rows dominate the rail and the surrounding week ticks genuinely sit on top of
   each other. Those are dropped rather than overprinted, which is why the 2026pnw render shows
   `start … wk 1 … now` instead of five evenly spaced labels. The positions are honest; the labels
   follow them.

One note that is not a difference from the sketch but is worth recording: at 390px the Team column
(192px) plus the Status column (121px) is most of the viewport, so the numeric columns are reached by
scrolling the table sideways. That is the shipped pattern the e2e suite already covers, the sketch
behaves the same way, and `document.documentElement.scrollWidth` is 390 against a `clientWidth` of 390
— the page itself still does not pan.

This was a LOCAL check against a fixture origin on this machine, not a deploy. Nothing was published,
pushed or deployed.
