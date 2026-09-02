---
quick_id: 260902-ixg
slug: alliances-tightening-and-tab-strip-jitter
date: 2026-09-02
type: execute
mode: quick
worktree: false
autonomous: false
source: user requests during UAT of 260902-i8i (this session)
files_modified:
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/AlliancesTab.test.tsx
  - apps/web/src/components/event/EventHeader.tsx
  - apps/web/src/components/event/EventHeader.test.tsx
  - apps/web/src/components/ui/tabs.tsx
  - apps/web/src/components/events-list/filterModel.ts
  - .planning/phases/07-event-pages/07-UI-SPEC.md
---

# Alliances tab tightening, tab-strip jitter, and the second out-of-band week

Five items, all raised by the user during UAT of quick task `260902-i8i`. Every
number below was **measured against the running app** at
`http://localhost:5280/event/2026iscmp?tab=alliances` (local vite dev proxied to
the real published artifacts) — none is estimated.

## Task 1 — Remove the D-15 independence caveat entirely

User decision, 2026-09-02: the caveat comes off the page completely. The site
then makes **no on-page independence disclosure**; the assumption stays
documented in `AlliancesTab.tsx`'s own code comments and in
`packages/core/algorithms/sigma1/covariance.ts`'s header, which is where the
arithmetic actually lives.

- Delete `ALLIANCE_INDEPENDENCE_CAVEAT` (`AlliancesTab.tsx:265`) and its render
  (the `<p data-testid="alliances-independence-caveat">` at ~line 607).
- `AlliancesTab.test.tsx`: delete the test at ~301 that asserts the copy
  word-for-word. **Rewrite** — do not delete — the test at ~457 that asserts the
  incomplete-combination notice renders *beneath the caveat*: it must still pin
  the notice's position, now relative to the table's scroll region instead of to
  a deleted element. Losing that assertion entirely would drop real coverage.
- `07-UI-SPEC.md`: retire the D-15 row in the Copywriting Contract table (~line
  289) and the "Independence-assumption caveat, stated once, visibly, not
  buried" instruction (~line 265). Mark both retired with the date and reason
  (user decision 2026-09-02 during UAT of 260902-i8i) rather than deleting the
  rows outright — a UI-SPEC that silently loses a row it once bound is exactly
  the doc-drift this project has been bitten by.

**Do not** touch `combineAlliancePicks`'s own doc comment. The independence
assumption it documents is still true of the arithmetic; only the on-page
disclosure is being removed.

## Task 2 — Hide the Pick 3 column when no alliance has a backup

Measured on `2026iscmp`: the `pickBackup` column is **240px wide and empty in
all 8 of 8 rows**. It is dead space on every event without a backup robot, which
is most of them.

- Build the column list conditionally: include the `pickBackup` column only when
  at least one row has `picks.slice(ALLIANCE_COMBINED_PICK_COUNT).length > 0`.
- Keep the column id `pickBackup` and the header label `Pick 3` unchanged when
  it IS shown — `ALLIANCES_COLUMN_HEADERS` stays a 7-entry tuple and external
  e2e tests key off the id (see the G-8 comment at `AlliancesTab.tsx:308`).
- `AlliancesTabSkeleton` cannot know the data, so it keeps all seven headers.
  That is deliberate: a loading placeholder that guesses wrong would shift
  layout twice. Record this in the skeleton's doc comment.
- The existing test "renders exactly seven column headers in the corrected order
  for an opr/2024 fixture" must be checked against its fixture: if that fixture
  has no backup, the test's expectation changes to six and a **new** test must
  cover the seven-column case with a backup-bearing fixture. Cover both
  directions — a column that disappears when it should appear is the worse bug.

## Task 3 — Tighten the Alliances table's horizontal spacing

Measured intrinsic widths (header text + 16px cell padding, and widest cell
content + 16px padding), against the current `size` values:

| Column | header needs | content needs | required | current | set to |
|---|---|---|---|---|---|
| `allianceNumber` | 88 | 26 | **88** | 112 | **88** |
| `pick0` Captain | 70 | 190 | **190** | 190 | 190 (unchanged) |
| `pick1` Pick 1 | 54 | 190 | **190** | 190 | 190 (unchanged) |
| `pick2` Pick 2 | 56 | 190 | **190** | 190 | 190 (unchanged) |
| `pickBackup` Pick 3 | 56 | — | — | 240 | 240 when shown (Task 2 removes it otherwise) |
| `combined` | 124 | 160 | **160** | 160 | 160 (unchanged) |
| `record` | 66 | 62 | **66** | 100 | **72** |

The three pick columns and Combined Total are already exactly content-bound
(174 + 16 = 190; 144 + 16 = 160) — **they cannot shrink without truncating**.
Their apparent looseness comes from the shared tier box's `min-width: 80px`,
which is a cross-site alignment token (`references/colour-and-tiers.md`) and is
**out of scope**: changing it would reflow Teams, Team and Insights too.

So the tightening is: `allianceNumber` 112→88, `record` 100→72, plus Task 2
dropping 240. Table total goes **1182px → 890px (−25%)** on a no-backup event.

`allianceNumber` at 88 is not a return to the 84 that truncated (the
2026-09-01 report the current 112 came from): the "ALLIANCE #" header's own
intrinsic text is 72px and the cell padding is 16px, so 88 is exactly its
requirement with nothing to spare. **Verify no ellipsis appears** after the
change — the `truncate` class on `TableHead` hides this failure silently.

## Task 4 — Stop the event tab strip jumping on hover

Reproduced: the whole strip sits at `y=235` on load and jumps to **`y=232` on
the first hover, then stays at 232**. Measured cause, not guessed:

- `TabsTrigger`'s base class sets `h-[calc(100%-1px)]` — a percentage height
  against `TabsList`, whose own height is content-derived (`flex-wrap`, no fixed
  height). Measured: `listH = 32` while every trigger reports `h = 44`.
- The 44 comes from `.tap-target { min-height: 44px }`
  (`apps/web/src/styles/theme.css:395`), applied per-trigger on the event page.
- So the triggers overflow a list 12px shorter than they are, and `items-center`
  re-centres them the moment a hover forces a style recalc.
- `transition-all` on the trigger animates the resulting shift, which is what
  makes it read as movement rather than a static offset.

Fix, scoped to the `line` variant only (the one this codebase renders in a
strip — leave the `default` segmented-control variant alone, exactly as the
existing G-5 comment at `tabs.tsx:~78` scopes its own fix):

- Give `line`-variant triggers an auto height so `.tap-target`'s 44px min-height
  is the sole authority, ending the circular percentage-height dependency.
- Narrow `transition-all` to the properties that actually need animating
  (colour and the `after` underline's opacity). `transition-all` on a element
  whose layout can change is what turns a 3px correction into visible motion.

**Verify by measurement, not by eye:** the strip's `y` must be identical before
hover, during hover, and after unhover, and `listH` must equal the trigger
height. A fix that only removes the transition would hide the jump instead of
removing it — that is not acceptable here.

## Task 5 — The event header's second blind `week + 1`

`EventHeader.tsx:72` renders `` `Week ${parts.week + 1}` `` unconditionally, so
`2026iscmp` (stored week 18) displays **"Week 19"** — the identical defect WR-01
fixed in the Events list, in a location that fix did not reach. Confirmed live
in the screenshot taken this session.

- Reuse the existing rule rather than writing a second copy: `MAX_SEASON_WEEK`
  and `hasOutOfBandWeek` already live in
  `apps/web/src/components/events-list/filterModel.ts`. If importing from
  `events-list/` into `event/` is the wrong direction for this codebase's module
  layout, move the two symbols to a neutral module and re-export — do not
  duplicate the constant. A second copy of this rule is how the bug got two
  homes in the first place.
- Out-of-band weeks **omit the week segment entirely**. `eventMetaLine`'s own
  doc comment already establishes the precedent: "A null week renders NOTHING
  rather than a guessed label". "Week 19" is a guessed label.
- `EventHeader.test.tsx` has several tests pinning `week + 1` for in-band values
  (stored 3 → "Week 4", stored 0 → "Week 1"). Those stay green — the rule only
  changes above the bound. Add a test pinning stored 18 → no week segment, and
  assert it fails against the unfixed code before the fix lands.

## Verification

1. `cd apps/web && npx vitest run` — full suite green. Use `npx vitest`, never
   `timeout <n> pnpm ...` (that pattern swallows output and exits 0 on this
   machine — see project memory).
2. `npx tsc --noEmit -p tsconfig.json` in `apps/web`.
3. Every new/changed assertion must be confirmed **failing against the unfixed
   code** before its fix lands, per this repo's established practice.
4. Re-measure the running app at `http://localhost:5280`: Alliances table total
   width ≈890px with no Pick 3 column and no ellipsis in "ALLIANCE #"; tab strip
   `y` constant across hover; event header for `2026iscmp` carries no week
   segment.

## Commits

One atomic commit per task, in the order above.
