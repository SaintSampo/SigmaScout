---
phase: quick-260929-ttp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (tracer): pure milestone model, schedule alias, copy, the picker, its CSS, DCMP Locks wiring
  - apps/web/src/components/districts/districtMilestones.ts
  - apps/web/src/components/districts/districtMilestones.test.ts
  - apps/web/src/components/districts/districtTimeline.ts
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/LocksMilestonePicker.tsx
  - apps/web/src/styles/theme.css
  - apps/web/src/components/districts/DistrictLedger.tsx
  - apps/web/src/components/districts/DistrictLedger.test.tsx
  # Task 2: Champ Locks wiring, picker behaviour tests, dead slider code out
  - apps/web/src/components/districts/ChampLocksLedger.tsx
  - apps/web/src/components/districts/ChampLocksLedger.test.tsx
  - apps/web/src/components/districts/LocksMilestonePicker.test.tsx
  - apps/web/src/components/districts/LedgerParts.tsx
  - apps/web/src/components/districts/districtTimeline.test.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
  # Task 3: e2e spec, two todos, fidelity audit, final verification
  - apps/web/e2e/districts-ledger.spec.ts
  - .planning/todos/pending/locks-picker-playoffs-half-stop.md
  - .planning/todos/pending/locks-cutoff-strip-chart.md
autonomous: true
requirements: [QUICK-260929-ttp]

estimate:
  tokens: 110000
  raw_tokens: 220000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Both the DCMP Locks and the Champ Locks tab show sketch 024 variant Q's picker, laid out as Q: row 1 is the EVENT label, the week-grouped native select, a spacer, then the Season start and Live pills; row 2 is the stepper (group label row, eight stops, caption); row 3 is the prev and next arrows plus the Next text. There is no range input, no tick row, no jump chip row, no readout and no hint paragraph (user decision 1)"
    - "The stepper has exactly EIGHT stops: Schedule (Out), Qualification (¼, ½, ¾, Done), Alliances (Done), Playoffs (Done), Awards (Done). There is no Playoffs ½ stop, and the group label spans are 1/2, 2/6, 6/7, 7/8, 8/9 (user decision 2)"
    - "No cutoff strip chart renders; two todos in .planning/todos/pending/ record the dropped Playoffs ½ stop and the cutoff strip chart (user decisions 2 and 3)"
    - "Clicking a stop that has happened writes that milestone's id to ?at= with replace history and no scroll reset, and the ledger recomputes at that position. A stop that has not happened is dashed and disabled"
    - "Reloading any milestone URL shows the same event in the select and the same stop pressed. That includes Schedule, stored as <eventKey>:schedule. An old link to a non-milestone step still resolves to its exact position, with its event shown and no stop pressed"
    - "Prev and next, and ArrowLeft, ArrowRight, Home and End pressed while focus is inside the picker but not on the select, walk Season start, then every happened milestone of every event in timeline order, then Live. The Next text names the next stop and reads 'This is live' at the end"
    - "A live focused event shows the red now marker with its 30px line and the live caption. A not-started focused event shows every stop dashed and the not-started caption"
    - "Every CSS value in the picker equals the sketch 024 Q value, with only the 8-column changes (repeat(8, ...), calc(100% / 16), the fill /7 and the now marker /8). Colours come only from tokens, and there is no hex literal in the picker's CSS block"
  artifacts:
    - path: apps/web/src/components/districts/districtMilestones.ts
      provides: "Pure milestone model: buildDistrictMilestones, districtMilestoneSelection, defaultMilestoneFocus, milestoneFocusTarget, milestoneWalkNeighbours, milestoneStopStates, districtMilestoneEvents"
    - path: apps/web/src/components/districts/LocksMilestonePicker.tsx
      provides: "The one Q picker component both tabs render"
    - path: apps/web/src/components/districts/districtTimeline.ts
      provides: "resolveDistrictTimelinePosition also resolves <eventKey>:schedule to the position just before that event's first qualification match step"
    - path: apps/web/src/styles/theme.css
      provides: "The .locks-picker block: the sketch Q CSS ported literally, plus four --locks-picker-* tokens derived from shipped tokens"
    - path: .planning/todos/pending/locks-picker-playoffs-half-stop.md
      provides: "Todo: restore the Playoffs ½ stop once partial playoff brackets are modelled"
    - path: .planning/todos/pending/locks-cutoff-strip-chart.md
      provides: "Todo: precomputed per-district cutoff history and sketch 024 Q's slim cutoff strip"
  key_links:
    - from: apps/web/src/components/districts/DistrictLedger.tsx
      to: apps/web/src/components/districts/LocksMilestonePicker.tsx
      via: "at={search.at}, positionIndex, timeline, events={districtMilestoneEvents(artifact, ['district'])}, onAtChange={handleAtChange}"
      pattern: "LocksMilestonePicker"
    - from: apps/web/src/components/districts/ChampLocksLedger.tsx
      to: apps/web/src/components/districts/LocksMilestonePicker.tsx
      via: "same props, events from districtMilestoneEvents(artifact, ['district', 'dcmp'])"
      pattern: "LocksMilestonePicker"
    - from: apps/web/src/components/districts/districtMilestones.ts
      to: apps/web/src/components/districts/districtTimeline.ts
      via: "districtScheduleMilestoneId(eventKey) is the Schedule stop's at id, and resolveDistrictTimelinePosition resolves it"
      pattern: "districtScheduleMilestoneId"
---

<objective>
Replace the Locks Rewind slider with sketch 024 variant Q's "event, then milestone" picker, on both the DCMP Locks and the Champ Locks tab (user decision 1: "Q is perfect. Be very careful that the updated real page matches the sketch."). Visual fidelity to Q is the acceptance bar. There are exactly two sanctioned differences. First, eight stops instead of nine, with no Playoffs ½ (user decision 2). Second, no cutoff strip chart (user decision 3). Both are logged as todos.

Purpose: a reader picks an event, then one of the milestones that matter, instead of dragging through hundreds of match-level positions.

Output:
- a pure, unit-tested milestone model
- one `LocksMilestonePicker` component, wired into both tabs
- the sketch's CSS ported into `theme.css` under token-only colours
- the dead slider code, CSS, copy and tests removed
- an updated live e2e spec
- two todos
- a returned sketch-to-real selector mapping for the orchestrator's visual check
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/sketches/024-locks-milestone-picker/index.html
@.planning/sketches/024-locks-milestone-picker/README.md

Project rules that bind this plan:
- D-06: no literal colour in component code; every colour is a token. The sketch-findings skill (`.claude/skills/sketch-findings-sigmascout/SKILL.md`) is loaded for UI work.
- A class list that mixes a text-role class with a `text-[var(...)]` colour never goes through `cn()`, because tailwind-merge drops the role class. This plan uses plain CSS classes in `theme.css` and plain `className` strings, never `cn()`.
- All user-facing copy lives in `districtLedgerCopy.ts`. The house voice is flat third person, with no hyphen, en dash or em dash in visible copy. The middle dot, the colon and the fraction glyphs the sketch shows are fine.
- Other sessions share this checkout. Stage by explicit path only, and never push.
- The site has NO dark theme (`theme.css` has no `prefers-color-scheme` or `.dark` rules). Port only the sketch's LIGHT values.

## Source reads (read each once; Grep for anything more)

- The sketch `index.html`. Read lines 5-176 for the CSS. Q uses `.row .lbl .spacer .pill .live-dot @keyframes pulse .ibtn .nav .nav .nx select.ev`, every `.stp*` rule, the 520px media rule and the reduced-motion rule. Read lines 327-436 and 491-518 for the markup and logic: `liveBtn`, `stepNav`, `updNav`, `keys`, `focusEvent`, `stepperHTML`, `updStepper` and `V.Q.build`. Ignore P, R, the chart and the preview.
- `apps/web/src/components/districts/districtTimeline.ts`. It has positions, `nowIndex`, the step ids (`${eventKey}:m:${matchKey}` and `${eventKey}:${kind}`), `resolveDistrictTimelinePosition`, and `compareSteps`.
  - An event with no loaded artifact contributes ONLY its four stage steps, untimed and ordered by week.
  - At "now" the tabs fetch artifacts only for events in progress. So on a finished district the timeline is stage-only until any `at` is set: `rewinding` widens the fetch set to every started event.
- `apps/web/src/components/districts/LedgerParts.tsx`. `RewindSlider` is at about lines 791-906, the tick and rail helpers at about 908-978, the REWIND and TICK constants at about 134-147. `ControlsCard` stays.
- `apps/web/src/components/districts/DistrictLedger.tsx`, about lines 250-360 and 513-518: `search`, `districtEvents`, `nowStageByEvent`, `rewinding`, `timeline`, `positionIndex`, `handlePositionChange`, and the `<ControlsCard>` children.
- `apps/web/src/components/districts/ChampLocksLedger.tsx`, about lines 381-490 and 799-803. The same shape; `events` there comes from `champTierEvents`, which carries a `tier`.
- `apps/web/src/components/districts/districtLedgerRows.ts`: `tierEvents`, `DistrictTierEventEntry.state`, `deriveStageFromState`.
- `packages/core/districts/reservedSlots.ts`: `DistrictEventStateFacts` (qualMatchesPlayed, qualMatchesTotal which can be null, alliancesPicked, playoffsDone, awardsPosted), `districtEventStateStarted`, `districtEventStateFinished`, `districtEventCategoryFinality`.
- `apps/web/src/styles/theme.css`, lines 950-1168: the district ledger block, `--district-ledger-faint`, and the old slider, tick and pill rules.
- Tests:
  - `DistrictLedger.test.tsx` lines 104-130 (the `state()` fixture) and 850-1026 (`doneEventArtifact`, a 12-match schedule with keys `2026wadone_qm1..12`, and the whole "the Rewind slider" describe block).
  - `districtTimeline.test.ts` for its `eventArtifact` fixture helper and the chip, tick and rail tests at about lines 211-215 and 278-339.
  - `districtLedgerCopy.test.ts` lines 40-115.

## Interfaces the three tasks share (Task 1 creates them; Tasks 2 and 3 consume them)

`districtTimeline.ts` gains:
- `districtScheduleMilestoneId(eventKey: string): string`, returning `${eventKey}:schedule`.
- An extended `resolveDistrictTimelinePosition(timeline, id)`. An EXACT position id match still wins first, so no existing id changes meaning; no existing id ends in `:schedule`. After that, an id of the form `<eventKey>:schedule` resolves to (index of that event's FIRST `match` step in `positions`) minus 1. If the event has no match step in the timeline, it resolves to `nowIndex`. That is the file's existing "unrecognised id resolves to now" rule, and it is exactly what a shared match-level link already does while artifacts load.

`districtMilestones.ts` (new, pure, no React):
- `DISTRICT_MILESTONE_KEYS = ["schedule", "q1", "q2", "q3", "qualsDone", "alliance", "playoffs", "awards"] as const` and `type DistrictMilestoneKey`. Eight stops (user decision 2).
- `DISTRICT_MILESTONE_QUAL_FRACTIONS = { q1: 0.25, q2: 0.5, q3: 0.75 }`.
- `interface DistrictMilestoneEventInput { eventKey; eventName; week: number | null; isDcmp: boolean; state: DistrictEventStateFacts | undefined }`.
- `districtMilestoneEvents(artifact: DistrictArtifact, tiers: readonly DistrictTier[]): DistrictMilestoneEventInput[]`. It walks `tierEvents(team, tier)` for each tier and team, keeps the first entry seen per eventKey, and sets `isDcmp` to `tier === "dcmp"`.
- `type DistrictMilestoneEventStatus = "done" | "live" | "up"`:
  - `done`: `districtEventStateFinished`
  - `live`: started and not finished
  - `up`: not started, or state undefined
- `interface DistrictMilestone`, with these fields:
  - `eventKey`, `eventName`, `key`, `index` (0-7)
  - `atId: string`
  - `positionIndex: number | null`
  - `happened: boolean`
  - `order: readonly [number, number]`
- `interface DistrictMilestoneEvent`, with `input`, `status`, `milestones` (always 8) and `firstIndex` (the index of the event's first step in `positions`, used for event order).
- `type DistrictMilestoneSelection`, one of:
  - `{ kind: "live" }`
  - `{ kind: "start" }`
  - `{ kind: "milestone"; milestone: DistrictMilestone }`
  - `{ kind: "position"; eventKey: string | null; positionIndex: number }`
- `type DistrictMilestoneWalkItem`, one of `{ kind: "start" }`, `{ kind: "live" }`, or `{ kind: "milestone"; milestone }`, plus `walkItemAtId(item)`. That returns `DISTRICT_TIMELINE_SEASON_START_ID`, `DISTRICT_TIMELINE_NOW_ID`, or `milestone.atId`.
- `buildDistrictMilestones(timeline, events): DistrictMilestoneModel`, where the model is `{ events (sorted by firstIndex, then eventName), byEvent: Map, walk, nowIndex }`.
- `districtMilestoneSelection(model, timeline, at: string | undefined, positionIndex: number): DistrictMilestoneSelection`.
- `defaultMilestoneFocus(model): string | undefined`.
- `milestoneFocusTarget(model, eventKey, selection): string | null`. It returns the at id to navigate to, or null when the event has nothing happened yet (focus only, no navigation).
- `milestoneWalkNeighbours(model, selection): { prev: DistrictMilestoneWalkItem | undefined; next: DistrictMilestoneWalkItem | undefined }`.
- `milestoneStopStates(model, eventKey, selection)`, returning:
  - `happened: boolean[8]`, `done: boolean[8]`, `pressed: boolean[8]`
  - `fillStop: number`, which is the last done stop index, or -1
  - `nowBoundary: number | null`, which is the happened count when the event is live, else null

## Milestone rules (decided here; Task 1 implements and tests every row)

| Stop | at id (what `?at=` stores) | happened (from the event's own state facts) |
|------|----------------------------|---------------------------------------------|
| schedule | `districtScheduleMilestoneId(eventKey)`. Its position is resolved as described above | `districtEventStateStarted(state)` |
| q1 / q2 / q3 | `${eventKey}:m:${eventKey}_qm${k}`, the existing match step id. `k = max(1, round(qualMatchesTotal x fraction))`, which is qualification match NUMBER k, the event's own match order | `qualMatchesTotal !== null && qualMatchesPlayed >= k` |
| qualsDone | `${eventKey}:qualsDone` | `districtEventCategoryFinality(state).qual` |
| alliance | `${eventKey}:alliance` | `state.alliancesPicked` |
| playoffs | `${eventKey}:playoffs` | `state.playoffsDone` |
| awards | `${eventKey}:awards` | `state.awardsPosted` |

A state of `undefined` means nothing has happened.

- **Why happened reads the state blocks, not the timeline.** Every event contributes its four stage steps, and a future event's steps sort BEFORE `nowIndex`. "Position exists and is before now" would therefore call a future event's Awards happened.
- **Why the ids are constructible without the event's artifact.** At "now" on a finished district no artifact is loaded, yet every stop of a finished event must be solid and clickable, as in Q. The quartile ids are existing match step ids, and they resolve once the rewind loads the artifact.
- **Why Schedule has its own alias id.** "The position just before the event's first match step" is some OTHER step's id: another event's match, or `season-start` for the first event. Storing that id would reopen a shared "Belleville · Schedule" link as a different event with no stop pressed. It also cannot be computed at all while the event's artifact is not loaded. The alias resolves to that same existing position, and old links are untouched.
- **positionIndex** is `positions.findIndex(p => p.id === atId)` for every stop except schedule. For schedule it is the first match step index minus 1. It is `null` when the step is not in the current timeline.
- **order** is `[positionIndex, index]` when resolved. Otherwise it is `[the event's qualsDone position index, index]`. The qualsDone step always exists, so an unresolved Schedule or quartile sorts just before its own event's Quals Done. Two orders compare lexicographically.

## Selection rules (`districtMilestoneSelection`)

Apply these in order:
1. `at` is undefined or `now`: Live.
2. `at === "season-start"`: Start.
3. `at` equals the atId of a milestone that HAS happened: that milestone. This holds even when its position is still unresolved while artifacts load, so the pressed stop shows the reader's choice at once.
4. `at` is a position id: `{ kind: "position", eventKey: positions[positionIndex].step?.eventKey ?? null, positionIndex }`. This is an old non-milestone link, or a hand-edited link to a milestone that has not happened. No stop is pressed.
5. Anything else: Live. That matches the resolver sending unknown ids to now.

The comparison key for done-ness and for walking:
- Start is `[0, -1]`, so nothing is done at Season start.
- Live is `[nowIndex, 9]`.
- A milestone uses its `order`.
- A position is `[positionIndex, 8]`.

`done[i] = happened[i] && compare(order[i], selectionKey) <= 0`. At Live this reduces to `happened`.

`pressed[i]` is true only for a milestone selection with the same eventKey and key.

`fillStop` is the highest done index, or -1 when stop 0 is not done. This follows the sketch's `a[0].t <= t ? done/8 : 0`.

## Walk, focus and default focus rules

- **walk** is `[start, ...every happened milestone of every event sorted by (order, then eventKey), live]`.
- **Neighbours.** For start, live or a milestone, use that item's index in the walk. For a position selection, prev is the last walk item whose key is below the selection key, and next is the first item above it.
- **Default focus.** Take the first `live` event in model order. Failing that, the `started` event that sorts LAST. Failing that, the first event. (With all events up, as preseason, this lands on an up event and shows its caption.)
- **Focus target** mirrors the sketch's `focusEvent`. If the current selection is a milestone and the same-index stop has happened in the chosen event, that stop is the target. Otherwise it is the chosen event's latest happened stop. Otherwise it is null.

## Picker DOM (sketch Q, 8 columns). The class names on the right are the contract Task 3 reports against

- `div.locks-picker` with `data-testid="district-ledger-rewind"` (the old root test id is kept for the e2e spec) and an `onKeyDown` for the arrow, Home and End keys
  - `div.locks-picker-row`. This is sketch `.row`.
    - `label.locks-picker-lbl` with htmlFor the select's `useId()` id, text "Event". This is sketch `.lbl`.
    - `select.locks-picker-select` with `data-testid="locks-picker-event"`. This is sketch `select.ev`.
      - One `optgroup` per week, labelled `Week N · done|live|not played yet`, or `DCMP · ...` for the dcmp-tier events. Each group holds `option`s whose value is the eventKey.
      - An option's text is the event name, plus ` (live)` when the event is live.
      - An option is disabled when its event status is `up`, as in Q.
    - `span.locks-picker-spacer`. This is sketch `.spacer`.
    - `button.locks-picker-pill` with `data-testid="locks-picker-season-start"` and `aria-pressed`, text "Season start". This is sketch `.pill`.
    - `button.locks-picker-pill` with `data-testid="locks-picker-live"` and `aria-pressed`, holding a `span.locks-picker-live-dot` (sketch `.live-dot`) and the text "Live"
  - `div.locks-picker-stepper`. This is sketch `.stp`.
    - `div.locks-picker-groups`. This is sketch `.stp-g`. It holds five `span`s with inline `gridColumn` of `1 / 2`, `2 / 6`, `6 / 7`, `7 / 8` and `8 / 9`.
    - `div.locks-picker-track`. This is sketch `.stp-t`. It contains:
      - `div.locks-picker-line` (sketch `.stp-line`), holding `span.locks-picker-line-fill` (sketch `.stp-line i`) with an inline width of `fillStop / 7 * 100%`, or 0
      - 8 x `button.locks-picker-stop` (sketch `.stp-b`). Each carries:
        - `.locks-picker-stop--done` when done (sketch `.done`)
        - `aria-pressed` and `disabled={!happened}`
        - `aria-label`, e.g. "Belleville quals ¼ done" plus ", not played yet" when it has not happened
        - `data-milestone={key}`
        - a `span.locks-picker-dot` (sketch `.dot`) and a `span.locks-picker-stop-label` (sketch `.t`) holding the sub word
      - `span.locks-picker-now` with `data-testid="locks-picker-now"` (sketch `.stp-now`), `hidden` unless the focused event is live, an inline `left` of `calc(${nowBoundary} * 100% / 8)`, and the text "now"
    - `p.locks-picker-caption` with `data-testid="locks-picker-caption"` (sketch `.stp-cap`). It always renders; the text is empty for a done event.
  - `div.locks-picker-row.locks-picker-row--nav` (sketch `.row` with the inline `margin-top: 6px`), holding `div.locks-picker-nav` (sketch `.nav`), which contains:
    - `button.locks-picker-ibtn` with `data-testid="locks-picker-prev"` and aria-label "Previous milestone". This is sketch `.ibtn`. Its svg has viewBox 0 0 16 16, path `M11 2v12L3 8z` and `aria-hidden`.
    - `button.locks-picker-ibtn` with `data-testid="locks-picker-next"` and aria-label "Next milestone". Its svg path is `M5 2v12l8-6z`.
    - `span.locks-picker-next` with `data-testid="locks-picker-next-text"` (sketch `.nav .nx`), reading `Next: <title>` or "This is live"

Every button is `type="button"`.

## CSS contract (Task 1 ports it; Task 3 audits it against the sketch)

Port every Q rule value LITERALLY: sizes, paddings, gaps, radii, font sizes, weights, opacities, the transition, the keyframes. Only the substitutions below change anything.

The sketch's `--r: 6px` becomes `var(--radius)`, which is 0.375rem, or 6px.

Token map:

| Sketch token | Shipped equivalent |
|---|---|
| `--surface` | `--color-bg-surface` |
| `--border` | `--color-border` |
| `--text` | `--color-text-primary` |
| `--muted` | `--color-text-muted` |
| `--faint` | `--district-ledger-faint` |
| `--accent` | `--color-accent` |

Four named tokens are added in a `:root {}` block beside `--district-ledger-faint`, each derived from a shipped token (no new palette entry):

| Token | Value | Equals the sketch's |
|---|---|---|
| `--locks-picker-accent-soft` | `color-mix(in srgb, var(--color-accent) 16%, transparent)` | `rgba(46,125,50,.16)` |
| `--locks-picker-track` | `var(--color-border)` | `#e2e8f0` |
| `--locks-picker-chrome` | `var(--color-bg-inset)` | `#f1f5f9` |
| `--locks-picker-live` | `var(--color-destructive)` | `#dc2626` |

The only geometry changes, all for 8 columns:
- `.stp-g` and `.stp-t` use `repeat(8, minmax(0, 1fr))`.
- `.stp-line` uses `left: calc(100% / 16)` and `right: calc(100% / 16)`.
- The fill width is `/ 7`.
- The now marker's left is `/ 8`.

Scoping:
- The sketch's page-wide rules become picker-scoped:
  - `.locks-picker` sets `font-size: 14px; line-height: 1.5`, which is the sketch body.
  - `.locks-picker :focus-visible` gets the sketch's `outline: 2px solid` accent with `outline-offset: 2px`.
- The keyframes are named `locks-picker-pulse`.
- The reduced-motion rule becomes `@media (prefers-reduced-motion: reduce) { .locks-picker *, .locks-picker *::after { transition: none !important; animation: none !important; } }`.
- The 520px rule becomes `@media (max-width: 520px) { .locks-picker-stop-label { font-size: 11px } }`.
- Tailwind preflight zeroes borders, margins and padding and makes button backgrounds transparent. Every sketch rule that sets a border, margin, padding or background must therefore be written out explicitly, even where the sketch relied on UA defaults. Do NOT add `appearance: none` to the select; Q is a native select with its native arrow.
- The picker fills the card's width fluidly, exactly as the sketch's own grid does at a wider page. There is no max-width cap. Task 3 reports the column pitch at 1440px so the orchestrator can judge it.

## Copy (Task 1 adds to districtLedgerCopy.ts; no dash characters)

- Label: "Event". Pills: "Season start" and "Live". The now marker: "now".
- Group labels: Schedule, Qualification, Alliances, Playoffs, Awards, with the spans above.
- Sub words: schedule "Out", q1 "¼", q2 "½", q3 "¾", and "Done" for the other four.
- Long words: "schedule released", "quals ¼ done", "quals ½ done", "quals ¾ done", "quals done", "alliance selection done", "playoffs done", "awards done".
- A title is `${eventName} · ${long with its first letter uppercased}`. Start's title is "Season start" and Live's is "Live".
- The aria-label is `${eventName} ${long}`, with ", not played yet" appended when the stop has not happened.
- Next text: `Next: ${title}`, or "This is live".
- Arrow labels: "Previous milestone" and "Next milestone".
- Optgroup: `Week ${week + 1} · ${status}` (TBA weeks are zero indexed). A null week reads "Week not published". The dcmp tier reads "DCMP". The status words are done, live and "not played yet". An option gets the suffix " (live)".
- Captions: `${name} has not started. Its milestones open as they happen.` for up, and `${name} is live. Milestones past the red line have not happened yet; use Live for the current state.` for live.

## Deletion list (Task 2; nothing here may survive anywhere in apps/web)

- `LedgerParts.tsx`:
  - the `RewindSlider` component
  - `timelineTicks`, `timelineRailFractions`, `nearestRailPosition`
  - `REWIND_INPUT_ID`, `REWIND_TICKS_ID`, `REWIND_COMMIT_DELAY_MS`, `REWIND_RAIL_MAX`, `TICK_MIN_GAP_PERCENT`
  - their now-unused imports, and the header comment's mention of the slider and its tick rail
- `districtTimeline.ts`: the `DistrictTimelineChip` interface, the `chips` field and its derivation. Also reword the header and doc comments that call a position a "slider position" or talk about chips.
- `districtLedgerCopy.ts`: `DISTRICT_LEDGER_REWIND_LABEL`, `DISTRICT_LEDGER_REWIND_HINT`, `DISTRICT_LEDGER_TICK_START`, `DISTRICT_LEDGER_TICK_NOW`, `districtLedgerTickWeekLabel`.
- `theme.css`: `.district-ledger-slider`, every `.district-ledger-ticks` rule, and `.district-ledger-pill` together with its `[aria-pressed]` rule. First confirm by grep that nothing else uses the pill class. The comment above those rules goes too.
- The tests that only served these: the chip, tick and rail tests in `districtTimeline.test.ts` and the tick copy asserts in `districtLedgerCopy.test.ts`.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The Q picker end to end on the DCMP Locks tab (pure milestone model, schedule alias, copy, component, CSS, wiring)</name>
  <files>apps/web/src/components/districts/districtMilestones.ts, apps/web/src/components/districts/districtMilestones.test.ts, apps/web/src/components/districts/districtTimeline.ts, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/LocksMilestonePicker.tsx, apps/web/src/styles/theme.css, apps/web/src/components/districts/DistrictLedger.tsx, apps/web/src/components/districts/DistrictLedger.test.tsx</files>
  <read_first>The sketch index.html (the lines named in the context), districtTimeline.ts, reservedSlots.ts lines 60-137, districtLedgerRows.ts lines 372-456, DistrictLedger.tsx lines 250-360 and 505-520, theme.css lines 950-1168, and DistrictLedger.test.tsx lines 104-130 and 850-1026.</read_first>
  <precondition>`git status --short -- apps/web/src/components/districts apps/web/src/styles` shows no uncommitted changes from another session in these paths, and apps/web/src/routeTree.gen.ts exists (if not, run npx vite build inside apps/web first).</precondition>
  <behavior>
    - The fixture is one finished event: 12 qualification matches, `state()` all done, keys `ev_qm1..12`. With the timeline stage-only (no artifact):
      - All 8 milestones have happened.
      - The q1, q2 and q3 at ids are `ev:m:ev_qm3`, `ev:m:ev_qm6` and `ev:m:ev_qm9`, with positionIndex null.
      - The schedule at id is `ev:schedule`, with positionIndex null.
      - qualsDone, alliance, playoffs and awards resolve to their stage positions.
      - The unresolved stops' `order` sorts before qualsDone, in stop order.
    - The same event with its artifact loaded:
      - q2 resolves to the index of `ev:m:ev_qm6`.
      - schedule resolves to (the index of `ev:m:ev_qm1`) minus 1.
      - `resolveDistrictTimelinePosition(timeline, "ev:schedule")` returns that same index.
      - The first event in the timeline resolves schedule to index 0.
      - An exact id still wins over the alias.
      - `"ev:schedule"` on a timeline without ev's matches resolves to `nowIndex`.
    - `districtStageAtPosition` at the Schedule position leaves all four of ev's categories open.
    - An event in mid qualification (played 6 of 12, `MID_QUALS`):
      - schedule, q1 and q2 have happened; q3 and later have not.
      - The status is `live`, and `nowBoundary` is 3.
    - An unstarted event, or one whose state is undefined: nothing has happened, the status is `up`, and `nowBoundary` is null.
    - A future event's stage steps sort before `nowIndex` but are NOT happened. This is the regression case for "happened reads state, not the timeline".
    - Selection:
      - An undefined `at` is Live, and so is `"now"`.
      - `"season-start"` is Start.
      - A happened milestone id is a milestone selection, even while its step is unresolved.
      - A non-quartile match id like `ev:m:ev_qm7` is a position selection with eventKey ev.
      - A not-happened milestone id is a position selection.
      - Garbage is Live.
    - Done and fill:
      - At Live, done equals happened.
      - At Start, nothing is done and `fillStop` is -1.
      - At ev's q2, stops 0 to 2 are done, stop 2 is pressed, and `fillStop` is 2.
      - At `ev:m:ev_qm7` (a position), stops 0 to 2 are done and none is pressed.
    - The walk:
      - It is Start, then every happened milestone of two interleaved loaded events in position order, then Live.
      - Unhappened stops never appear in it.
      - The neighbours of a position selection straddle it.
      - Start has no prev, and Live has no next.
    - `milestoneFocusTarget`:
      - From A's q2, choosing B, where B's q2 has happened, gives B's q2 id.
      - Choosing C, where only C's schedule and q1 have happened, gives C's q1 id.
      - Choosing an up event gives null.
      - From Live, choosing B gives B's latest happened id.
    - `defaultMilestoneFocus` picks the live event, else the last started, else the first.
    - At the DistrictLedger level:
      - At now, the picker renders 8 stops in `DISTRICT_MILESTONE_KEYS` order, Live pressed, and the Next text "This is live".
      - `at=2026wadone%3Aalliance` presses the Alliances stop.
      - `at=2026wadone%3Aschedule` presses Schedule, and once the artifact loads the `2026wadone:qual` cell is open.
      - Clicking the Season start pill presses it.
      - Clicking a stop presses it.
      - An unknown `at` presses Live.
  </behavior>
  <action>
RED first. Create `districtMilestones.test.ts` covering every behavior bullet above except the DistrictLedger-level ones. Build the timelines with `buildDistrictTimeline` and an event artifact helper that mirrors the `eventArtifact` helper in `districtTimeline.test.ts`; do not import it, since that file does not export it. Run the test and confirm it fails. Then implement until it passes.

1. `districtTimeline.ts`: add `districtScheduleMilestoneId` and the alias branch in `resolveDistrictTimelinePosition`, exactly per the Interfaces section. Extend that function's doc comment with one sentence on why Schedule has an alias. Do not touch `chips` yet; Task 2 removes it.

2. `districtMilestones.ts`: implement the model per the Milestone rules, Selection rules, and Walk, focus and default focus rules sections of the context. Give it a header comment that states the three decisions:
   - happened reads the state blocks;
   - quartile ids are qualification match numbers, so they can be built with no artifact loaded;
   - Schedule uses the `:schedule` alias.
   Import the state helpers from `packages/core/districts/reservedSlots.ts`. Import `tierEvents` from `districtLedgerRows.ts`.

3. `districtLedgerCopy.ts`: add the Copy section's strings as named exports near the old rewind copy. Include a `DISTRICT_LEDGER_MILESTONE_GROUPS` table with the label and grid-column span per group, a sub-word table and a long-word table keyed by `DistrictMilestoneKey`, and small functions for the title, aria-label, next text, optgroup label, option label and the two captions. Leave the old rewind and tick copy in place; Task 2 deletes it.

4. `LocksMilestonePicker.tsx` (new). Props: `{ timeline, events: readonly DistrictMilestoneEventInput[], at: string | undefined, positionIndex: number, onAtChange: (id: string) => void }`. Render exactly the Picker DOM section, using plain `className` strings and no `cn()`.
   - Memoize `buildDistrictMilestones`.
   - Derive the selection from `at` on every render. There is NO local selection state; the URL is the single source.
   - Keep the focused event in `useState`. Initialise it to the selection's eventKey, or else `defaultMilestoneFocus`. In an effect keyed on `at`, set it to the selection's eventKey when the selection carries one, and keep it for Live and Start. That is the sketch's behaviour: Season start and Live never move the select. If the focused key vanishes from the model, fall back to the default.
   - Select `onChange`: set the focus, then call `onAtChange` with the result of `milestoneFocusTarget` when it is not null.
   - A stop click calls `onAtChange(milestone.atId)`. The Season start pill calls `onAtChange(DISTRICT_TIMELINE_SEASON_START_ID)`, and the Live pill calls `onAtChange(DISTRICT_TIMELINE_NOW_ID)`.
   - The prev and next buttons call `onAtChange(walkItemAtId(neighbour))` and are disabled when there is no neighbour.
   - The root's `onKeyDown` ignores events whose target is a SELECT or INPUT. Otherwise ArrowLeft and ArrowRight go to prev and next, Home goes to Season start, and End goes to Live. Each calls `preventDefault`.
   - The optgroup order is numeric weeks ascending, then null weeks, then the DCMP group. Events within a group follow model order.
   - In a code comment, note that a click commits at once. The old slider's 160ms debounced drag commit existed only for dragging and is gone on purpose. Do not name removed identifiers in any comment.

5. `theme.css`: add a new block AFTER the district ledger block, headed `The Locks milestone picker (sketch 024 variant Q)`. Close it with the comment line `end of the Locks milestone picker block`. The verify gate and Task 2's CSS contract test both slice between these two markers, and rules later in the file carry literal colours of their own. The block holds the four tokens and every rule, per the CSS contract section. Every sketch Q rule gets its own counterpart class with the sketch's exact values; add a comment line per rule naming the sketch selector it ports, for example "ports .stp-b". Write no hex, rgb or hsl literal anywhere in this block. Leave the old slider rules for Task 2.

6. `DistrictLedger.tsx`:
   - Add a memoised `milestoneEvents = districtMilestoneEvents(artifact, ["district"])`.
   - Replace `handlePositionChange(index)` with `handleAtChange(id: string)`. It keeps the SAME navigate call: the search updater writes `at` as undefined for `DISTRICT_TIMELINE_NOW_ID`, else the id, with `replace: true` and `resetScroll: false`. That preserves the existing no-scroll-reset and history behaviour.
   - Render `<LocksMilestonePicker timeline={timeline} events={milestoneEvents} at={search.at} positionIndex={positionIndex} onAtChange={handleAtChange} />` in place of the slider inside `ControlsCard`, before `StatusChips`.

7. `DistrictLedger.test.tsx`: rename the describe block to "DistrictLedger — the milestone picker".
   - Rewrite the three control-specific tests: the slider render test, the jump chip click test, and the readout-based URL test. Cover the DistrictLedger-level behavior bullets with them.
   - Add the Schedule round trip test, using `installFetch({ eventArtifact: doneEventArtifact() })` and `renderLedgerAt`.
   - Keep SC-4, the status recompute test and the Worker construction test unchanged. Drop the import of the old rewind label constant.
   - Assert pressed state through `aria-pressed`, and query the stops by `[data-milestone]` inside `getByTestId("district-ledger-rewind")`. A pressed stop after a click proves the URL round trip, because the selection has no local state.

Commit with `feat(260929-ttp): sketch 024 Q milestone picker on the DCMP Locks tab`, staging the eight files by explicit path.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run apps/web/src/components/districts/districtMilestones.test.ts apps/web/src/components/districts/districtTimeline.test.ts apps/web/src/components/districts/DistrictLedger.test.tsx 2>&1 | tail -25</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx tsc --noEmit -p apps/web 2>&1 | tail -15</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && awk '/The Locks milestone picker \(sketch 024 variant Q\)/,/end of the Locks milestone picker block/' apps/web/src/styles/theme.css | grep -v '^\s*\*\|^\s*/\*' | grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\('</automated>
  </verify>
  <acceptance_criteria>
    - Vitest output shows the three files passing, with 0 failed. Read the Tests line; do not trust the exit code.
    - The tsc output has no error lines.
    - The literal-colour count for the picker block prints 0.
    - `grep -c "LocksMilestonePicker" apps/web/src/components/districts/DistrictLedger.tsx` prints at least 2 (the import and the use).
  </acceptance_criteria>
  <done>
    - The DCMP Locks tab renders the Q picker with eight stops, and the ledger follows every click through `?at=`.
    - Schedule links round trip via `<eventKey>:schedule`.
    - The pure model is unit tested for mapping, happened, selection, done, fill, walk and focus.
    - The work is committed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Champ Locks on the same picker, picker behaviour tests, and the dead slider code removed</name>
  <files>apps/web/src/components/districts/ChampLocksLedger.tsx, apps/web/src/components/districts/ChampLocksLedger.test.tsx, apps/web/src/components/districts/LocksMilestonePicker.test.tsx, apps/web/src/components/districts/LedgerParts.tsx, apps/web/src/components/districts/districtTimeline.ts, apps/web/src/components/districts/districtTimeline.test.ts, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts, apps/web/src/styles/theme.css</files>
  <read_first>ChampLocksLedger.tsx lines 381-490 and 795-805, the ChampLocksLedger.test.tsx fixtures around lines 140-240 and 338-345, the Deletion list section of this plan, and districtTimeline.test.ts lines 200-340 and districtLedgerCopy.test.ts lines 40-115 (both already located in the context).</read_first>
  <behavior>
    - `LocksMilestonePicker.test.tsx` renders the component standalone. It needs no router, only props and a vi.fn `onAtChange`. It checks each of these:
      - A live focused event shows `locks-picker-now` visible with style left `calc(3 * 100% / 8)` and the live caption text. Its unhappened stops are disabled, with aria-labels ending ", not played yet".
      - With every event up, the up caption shows, all 8 stops are disabled, and the up events' options are disabled.
      - At a milestone, clicking next calls `onAtChange` with the next walk item's id, and the Next text reads `Next: <Event> · <Title>`.
      - At Live, next is disabled and the text reads "This is live". At Start, prev is disabled.
      - ArrowRight, ArrowLeft, Home and End keydowns on a stop button call `onAtChange` with the next id, the previous id, `season-start` and `now`. The same keys on the select call nothing.
      - Changing the select to another event whose same stop has happened calls `onAtChange` with that stop's id. Changing it to an event where that stop has not happened calls it with that event's latest happened id.
      - The group row renders five labels with grid-column 1 / 2, 2 / 6, 6 / 7, 7 / 8 and 8 / 9. There is no element for a half playoffs stop.
      - A CSS contract test reads `apps/web/src/styles/theme.css`, normalising CRLF to LF first because `core.autocrlf` is true on this machine. It slices the picker block between its header comment and its `end of the Locks milestone picker block` comment, and asserts that block contains:
        - `repeat(8, minmax(0, 1fr))` and `calc(100% / 16)`
        - `border: 5px solid` and `0 0 0 4px var(--locks-picker-accent-soft)`, with 20px width and height on the pressed dot
        - `height: 30px` for the now line and `36px` for the icon button
        - `min-height: 38px` on the select and `min-height: 34px` on the pill
        - `@keyframes locks-picker-pulse`, `prefers-reduced-motion` and `max-width: 520px`
        - no hex, rgb or hsl literal
    - `ChampLocksLedger.test.tsx`: the champ tab renders `district-ledger-rewind`, the select has an optgroup whose label starts with "DCMP ·", and no range input exists in the tab.
  </behavior>
  <action>
1. `ChampLocksLedger.tsx`: make the same swap Task 1 made in the DCMP tab.
   - Add a memoised `districtMilestoneEvents(artifact, ["district", "dcmp"])`.
   - Replace `handlePositionChange` with `handleAtChange`, keeping the same navigate options.
   - Render `LocksMilestonePicker` with the same props in place of the slider.
   - Leave `dcmpStarted`, `rewinding` and the fetch set logic untouched. The alias counts as rewinding, because any `at` other than now does.

2. Write `LocksMilestonePicker.test.tsx` covering the behavior bullets. Write it RED against any bullet the Task 1 implementation misses, then fix the component or the model.

3. Add the ChampLocksLedger assertion.

4. Delete everything in the context's Deletion list from the five named source, test and style files, together with any import that becomes unused.
   - Reword comments by concept. Do not leave the removed identifiers' names in comments, so the negative gate below stays meaningful.
   - In `districtTimeline.test.ts`, the week-order test at about line 211 asserted chips. Delete those four chip lines only; the id order assertion above them already proves the ordering.
   - In `districtLedgerCopy.test.ts`, replace the tick asserts with a contract block for the new milestone copy. Restate the literals rather than importing and comparing a constant with itself, per that file's header. Include a no-dash test over every new string for the three dash characters, as the file's other copy blocks do.

Commit with `refactor(260929-ttp): Champ Locks on the milestone picker; remove the rewind slider`, staging the nine files by explicit path.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run apps/web/src/components/districts 2>&1 | tail -25</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx tsc --noEmit -p apps/web 2>&1 | tail -15</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && grep -rnE 'RewindSlider|timelineTicks|timelineRailFractions|nearestRailPosition|REWIND_RAIL_MAX|REWIND_COMMIT_DELAY_MS|REWIND_TICKS_ID|REWIND_INPUT_ID|TICK_MIN_GAP_PERCENT|DistrictTimelineChip|districtLedgerTickWeekLabel|DISTRICT_LEDGER_TICK_|DISTRICT_LEDGER_REWIND_|district-ledger-slider|district-ledger-ticks|district-ledger-jump-chip|district-ledger-pill|district-ledger-rewind-readout|timeline\.chips' apps/web/src | wc -l</automated>
  </verify>
  <acceptance_criteria>
    - Every districts test file passes, with 0 failed read from the output.
    - tsc has no error lines.
    - The removed-identifier grep prints 0.
    - `grep -c "LocksMilestonePicker" apps/web/src/components/districts/ChampLocksLedger.tsx` prints at least 2.
  </acceptance_criteria>
  <done>
    - Both tabs render the one picker.
    - Its behaviour and its CSS values are pinned by tests.
    - No slider, tick, rail, chip, readout or hint code, CSS, copy or test remains.
    - The work is committed.
  </done>
</task>

<task type="auto">
  <name>Task 3: Live e2e spec, the two todos, a line-by-line fidelity audit, and the returned sketch-to-real mapping</name>
  <files>apps/web/e2e/districts-ledger.spec.ts, .planning/todos/pending/locks-picker-playoffs-half-stop.md, .planning/todos/pending/locks-cutoff-strip-chart.md, apps/web/src/styles/theme.css, apps/web/src/components/districts/LocksMilestonePicker.tsx</files>
  <read_first>apps/web/e2e/districts-ledger.spec.ts lines 60-140 and 240-320, the format of one completed todo (.planning/todos/completed/early-season-rp-bonus-cold-start.md, frontmatter and headings only), and the sketch CSS lines 5-176 again for the audit.</read_first>
  <action>
1. **e2e spec.** The spec runs only against the live site. Subagents have no network, so do NOT run it; the orchestrator runs it after deploy. Rewrite the rewind test as "the milestone picker walks the district's timeline and its position is shareable":
   - Remove the `rewindReadout` test id, and add ids for the picker's select, stops, pills, prev, next and next text.
   - At the district URL, the picker is visible and the Live pill is `aria-pressed` true.
   - Click prev. The `at` search param becomes non-null, exactly one stop is pressed, and Live is no longer pressed.
   - Click prev again, then record the URL, the pressed stop's `data-milestone` and the select's value.
   - Reload that URL. Poll until the same stop is pressed and the select holds the same value, with a 30s timeout, because the rewind loads the artifacts first.
   - Keep every other test in the file unchanged. Update the test ids' line-number comments that pointed at the old control.

2. **The two todos.** Use the completed-todo frontmatter shape: id, created 2026-09-29, source "quick 260929-ttp (sketch 024 Q)", and priority. Each gets a title, a "Why this matters" section and a "What to do" section.
   - `locks-picker-playoffs-half-stop.md`, priority low. Restore sketch 024's ninth stop, "Playoffs ½ done". It was dropped because the timeline holds one playoffs step per event, and the district simulation cannot take a half-played bracket at a rewound position. Doing it needs:
     - a mid-bracket step, or per-match playoff steps, in `districtTimeline.ts`;
     - a rewound simulation input that carries a partially played bracket;
     - then a stepper back to 9 columns, with the sketch's spans (Playoffs 7/9), `calc(100% / 18)`, `/8` and `/9`.
   - `locks-cutoff-strip-chart.md`, priority medium. Add sketch 024 Q's slim cutoff strip (`chartHTML(52)`) below the picker. It needs a per-district predicted cutoff history:
     - precomputed in the publish pipeline;
     - appended by the Worker tick live;
     - rendered as Q's 52px strip: band and line, the chosen event's milestones dotted on the line, a cursor, the "not played yet" hatch, the week axis, and the title "Predicted <target> cutoff, with its likely range";
     - tapping it jumps to the nearest happened milestone.

3. **Fidelity audit.** Go through the sketch's Q rules one at a time, in source order. For each, compare every property and value with its ported rule in theme.css, and every element and attribute in `V.Q.build`, `stepperHTML`, `stepNav` and `liveBtn` with `LocksMilestonePicker.tsx`. Fix any divergence in those two files. The only allowed differences are the CSS contract section's token substitutions, its scoping, and the 8-column changes. Rerun the Task 2 verify commands after any fix. Commit the e2e spec, the two todos and any audit fixes with `test(260929-ttp): picker e2e, todos, fidelity audit`, staging by explicit path.

4. **Final verification.**
   - Run `npx vitest run apps/web/src/components/districts` and `npx tsc --noEmit -p apps/web` from the repo root.
   - Run `npx vitest run apps/web` for the whole web suite from the repo root, so a test outside the districts folder that referenced the old control is caught. Read the Tests summary line.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run apps/web 2>&1 | tail -12</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && npx tsc --noEmit -p apps/web 2>&1 | tail -10</automated>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout && ls .planning/todos/pending/locks-picker-playoffs-half-stop.md .planning/todos/pending/locks-cutoff-strip-chart.md && grep -c "district-ledger-rewind-readout\|type=\"range\"\]" apps/web/e2e/districts-ledger.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - The whole web suite shows 0 failed in its Tests line.
    - tsc has no error lines.
    - Both todo files exist.
    - The e2e grep prints 0.
    - `git status --short` shows no uncommitted file from this task.
  </acceptance_criteria>
  <done>
    - The e2e spec targets the picker.
    - Both todos are logged.
    - The audit is complete, with fixes committed.
    - The final message is returned as specified in the output section.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL -> picker and ledger | The `?at=` search param is untrusted text from a shared or hand-edited link |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ttp-01 | Tampering | `resolveDistrictTimelinePosition` `:schedule` alias | low | mitigate | An exact id match runs first, so the alias cannot shadow an existing step. An alias for an unknown or unloaded event resolves to now, the existing rule. Task 1 tests both |
| T-ttp-02 | Information disclosure | Picker rendering `at` | low | accept | `at` is only compared, never rendered as markup. React escapes all text, and no `dangerouslySetInnerHTML` is used (the sketch's `innerHTML` is not ported) |
| T-ttp-03 | Denial of service | A very long `at` string | low | accept | It is one linear `findIndex` over positions per render, the same cost as today |
</threat_model>

<verification>
- `npx vitest run apps/web` from the repo root shows 0 failed, and `npx tsc --noEmit -p apps/web` is clean. Check both by output, not by exit code.
- The removed-identifier grep prints 0, and the picker block's literal-colour grep prints 0.
- Both tabs import and render `LocksMilestonePicker`, and neither renders a range input.
- The live e2e spec is updated, and the orchestrator runs it after deploy.
</verification>

<success_criteria>
- The real Locks tabs match sketch 024 variant Q, except for the two sanctioned differences (eight stops; no cutoff strip), which are recorded as todos.
- Milestone links are shareable and round trip, including Schedule. Old step links still resolve.
- Discrete clicks commit at once, with replace history and no scroll jump.
</success_criteria>

<output>
Do NOT write SUMMARY.md; subagent writes to it are blocked, and heredocs break on long markdown here. Return, as the final message:
1. The SUMMARY text, covering commits, files, test counts, and the note that the old 160ms debounced drag commit was removed on purpose because clicks are discrete.
2. The one-to-one mapping table, one row per sketch Q selector and element. Columns: sketch selector, real selector, DOM element and attributes, any value that differs, and why. Cover the `.row`, `.lbl`, `select.ev` with its optgroups, `.spacer`, `.pill` in each state, `.live-dot` and its keyframes, the whole `.stp*` family in each state, `.stp-now`, `.stp-cap`, `.nav`, `.ibtn`, `.nx`, the 520px rule and the reduced-motion rule.
3. Every place the real page could not match Q exactly, and why. At minimum, cover these:
   - the column pitch at a 1440px viewport, against the sketch's roughly 102px;
   - long real event names widening the select;
   - `--district-ledger-faint` standing in for the sketch's `#64748b`;
   - no dark theme.
The orchestrator writes SUMMARY.md and does the visual comparison in the main context.
</output>
