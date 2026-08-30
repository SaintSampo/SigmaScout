# Phase 7 — UI Review

**Audited:** 2026-08-30
**Baseline:** `07-UI-SPEC.md` (approved) + `sketch-findings-sigmascout` skill references, cross-checked against `07-UAT.md`'s G-1..G-13 fix record and its "developer decisions" section
**Screenshots:** captured live against `https://sigmascout.org` (the deployed origin — this phase's artifacts are CORS-blocked from localhost) at `desktop` (1440×900) and `phone-390` (390×844, iPhone 17 descriptor) for all 9 named adversarial URLs. Stored at `.planning/ui-reviews/07-event-pages/*.png` (gitignored).

This audit does **not** re-report G-1 through G-13 — all thirteen are recorded fixed and (mostly) live-reverified in `07-UAT.md`, and spot checks below confirm the live site matches that record (D-08 fallback notice renders correctly, zebra striping full-width on Quals/Elims, tab strip content-sized and start-aligned, superscript metric cells legible). It also does not reopen the accepted Breakdown desktop overflow (464px, developer-closed) or the wide-box superscript "visually sparse" call (developer-closed, kept for consistency). Everything below is either genuinely new or was out of either document's scope.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | D-08/D-11/D-15 caption copy matches the contract verbatim; no generic labels found |
| 2. Visuals | 3/4 | On a 390px first paint, Insights/Breakdown show a real data column but zero of the tab's *predictive* (tiered) values — only raw Record/RP; Alliances has no pinned anchor column at all |
| 3. Color | 4/4 | Zero hardcoded hex/rgb in event components; tier tokens and alliance tokens used exactly per contract; G-8's approximation marker correctly gated to non-Common tiers |
| 4. Typography | 3/4 | Role-class discipline is clean (`text-role-*` only, 2 weights), but the `VPR Rank` header label clips to `VPR Ra…` inside a 72px column sized only for a bare integer |
| 5. Spacing | 3/4 | Token discipline holds everywhere except three sub-4px arbitrary values (`gap-[1px]`, `gap-[2px]`×2) inside the match table's stacked team-number cell |
| 6. Experience Design | 3/4 | D-08/empty/error states all present and correct; Alliances' unpinned layout loses row identity while reading Pick 3/Combined Total on a phone |

**Overall: 20/24**

---

## Top 3 Priority Fixes

1. **`VPR Rank` header text clips inside Insights' 72px Rank column, live on the D-08 fallback state** — a scout reading a no-official-ranking event (259/1,581 corpus events) sees a nonsense truncated header `VPR Ra…` where the whole point of that state is telling them the ranking source changed. Fix: give the `Rank`/`{Algo} Rank` header its own `min-width` (measured: the label needs ~72px of content width alone, i.e. ~88px with padding — matching what the Teams page's own 96px Rank column already budgets) rather than reusing the plain-`"Rank"`-sized 72px column for both label lengths.

2. **Alliances tab has no pinned column at all, so scrolling right to read Pick 3 or Combined Total on a 390px phone loses the alliance number entirely** — the tab's own stated purpose ("which alliance is strongest") requires reading Combined Total, which sits 4 columns past the edge with nothing anchoring which row you're on. Fix: pin `Alliance #` (a single 2-digit column, cheap) below `MOBILE_BREAKPOINT_PX`, mirroring the identity-pinning pattern already proven safe on Insights/Breakdown/Teams (G-1/G-2/G-11).

3. **First paint at 390px on Insights/Breakdown shows Record/RP but zero tiered percentile values** — for a site whose stated differentiator is showing modeled uncertainty in color, the first screenful of its two most data-dense tabs shows only plain TBA facts (win-loss record, RP), not a single Auto/Teleop/Endgame or raw-component box. This is not the G-2/G-11 defect (that is fixed — a data column genuinely is visible) but a step short of it: the *visible* data column isn't the product's differentiator. Consider narrowing Record slightly further or accepting a smaller first metric column, so at least one tiered cell clears the fold on the narrowest supported width.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Checked every copy string the contract specifies against the live site:

- D-08 fallback notice, live on `/event/2025cmptx?tab=insights`: *"This event has no official TBA ranking. Teams below are ordered by VPR's rank instead."* — matches the contract's `{selected algorithm label}` template exactly, `Info` icon present and `aria-hidden`, muted (not accent, not destructive) surface — confirmed by screenshot.
- D-15 Alliances independence caveat, live on `/event/2023cur?tab=alliances`: *"Combined values assume each robot's performance is independent of its alliance partners. Real alliances are not fully independent, so the true uncertainty is likely larger than shown."* — verbatim match.
- Tab labels are the five contracted single words (`Insights`/`Breakdown`/`Quals`/`Alliances`/`Elims`) on every page checked.
- `grep -rn "Click Here\|OK\|Cancel\|Save"` across `components/event/` and the route file returns nothing — no generic CTA labels introduced this phase.
- The View-on-TBA link renders `View on TBA`, accent-styled, matching the team page's existing pattern.

No copywriting defects found. This pillar substantially exceeds the contract's own bar — every piece of new copy the spec called for was checked against the live text and matched exactly, including the wording the contract itself flagged as "Claude's discretion."

### Pillar 2: Visuals (3/4)

**Focal point on desktop is clean.** Event name (Heading 20/600) reads as the anchor on every page checked, including the 124-character `2026vache` event name, which truncates to `"FCH District Chesapeake VA Event presented by Newport News Ship Yard / Hampton Roads Community Foundatio…"` with a working `title` tooltip — confirmed correct per spec's overflow rule.

**Icon-only elements are labelled.** The D-08 `InfoIcon` is `aria-hidden` with the notice's own text carrying the meaning (correct — decorative icon, not an interactive control needing its own label). The G-8 `≈` approximation marker on Alliances carries both `title` and `aria-label` (`apps/web/src/components/event/AlliancesTab.tsx:395-396`) — verified in source, this is the right pattern for a glyph that otherwise reads as noise to a screen reader.

**The finding that costs a point:** at 390px, Insights and Breakdown's first-paint data column is `record`/`rp` or `autoLeave` — real but non-tiered data — never a colour-boxed cell. Measured live (`/event/2023cur?tab=insights`, phone-390): scroll position 0 shows Rank/Team#/Nickname (pinned) + Record + RP fully, with Auto/Teleop/Endgame (the only tier-boxed cells on the tab) requiring a horizontal scroll. This is architecturally the G-2/G-11 fix working as designed (a real data column is visible, satisfying that gap's own bar), but it means the page's single differentiating visual — the tier-coloured `X ± Y` cell — is not part of first paint on the narrowest supported width. Not a regression of G-2/G-11 (their own acceptance criterion, "at least one non-pinned column visible," is met), but a visual-hierarchy gap the contract's own "Visual Hierarchy" section doesn't anticipate: it names the Rank column as Insights' tertiary focal point, but Rank is pinned and off to the side of the only genuinely modelled content.

Separately: Alliances renders with zero pinned columns on mobile (confirmed by design — G-8's write-up states this explicitly, since dropping the nickname column removed the free-growth reason `table-layout: auto` needed). That is a defensible choice for the *layout-correctness* defect G-1 addressed, but it leaves the *identity* problem (which row am I reading) unaddressed for this one tab — see Pillar 6.

### Pillar 3: Color (4/4)

```
grep -rn "#[0-9a-fA-F]{3,8}|rgb(" apps/web/src/components/event apps/web/src/components/team/MatchTable.tsx apps/web/src/components/MetricValue.tsx
```
returns zero matches — every colour in this phase's components resolves through a `--color-*`/`--tier-*`/`--alliance-*` token, matching D-06's discipline exactly.

Tier boxes render correctly on Insights/Breakdown against the four-tier system (screenshot-confirmed: amber/purple/sky/plain across `2026vache`, `2023cur`, `2024new`). The tier-blue stays sky (`#0EA5E9`-derived `--tier-rare-*`), never true blue — confirmed visually, no drift from the locked tokens.

Alliance red/blue in the Quals/Elims plot render at full alliance-colour weight on both played and upcoming rows (no greying of the mark itself), matching the contract's "always alliance-colored, never greyed" rule.

The G-8 Combined Total approximation is correctly restricted to rendering a tier only when the 3x-heuristic's estimated percentile crosses a tier boundary (Common renders no box, confirmed by source read of `boxed = approx !== undefined && approx.tier !== "common"`), matching the contract's "Alliances tab combined values are NEVER tier-boxed [with an exact percentile]" intent while implementing the developer's own later-approved heuristic.

No overuse of accent: the only accent-colored elements on any event page screenshot are the active-tab underline and the "View on TBA" link, matching the contract's reserved-for list exactly.

### Pillar 4: Typography (3/4)

Role-class discipline is clean: `grep -rohn "text-role-[a-z-]*"` across `components/event/` and the route returns only `text-role-body` (16), `text-role-heading` (2), `text-role-label` (17), `text-role-nav` (5), `text-role-spread-suffix` (1) — exactly the four declared roles plus the one pre-existing spread-suffix class, no stray raw Tailwind `text-lg`/`text-2xl` etc. Font-weight grep finds only two literal `font-semibold` utilities, both incidental container styling, not body text — the two-weight rule (400/600 via role classes) holds.

**The defect:** `VPR Rank`'s rendered text width on Insights measures **56.16px** against a **56px** available content box (72px column − 16px padding) — live-measured via canvas text metrics against the deployed page. This is a sub-pixel overflow, but `text-overflow: ellipsis` fires on any overflow regardless of magnitude, so the header renders `VPR Ra…` live on `/event/2025cmptx?tab=insights` (screenshot-confirmed). The Teams page's own equivalent header (`apps/web/src/routes/teams.tsx`) budgets **96px** for the identical string and renders it whole — this is a real, measurable cross-surface inconsistency: the same D-20 label was reused on the Insights tab without inheriting the column-width fix D-20 itself needed elsewhere. Only reproduces in the D-08 fallback state (`"VPR Rank"`), never in the normal state (`"Rank"`, which fits with room to spare) — likely why it wasn't caught: the ~259/1,581 no-ranking events are a minority path and the fallback label is longer only in that path.

### Pillar 5: Spacing (3/4)

Spacing token discipline holds broadly — `grep -rn "\[[0-9]+px\]"` across `components/event/` and the route surfaces only three real arbitrary values, all inside `EventMatchTable.tsx`'s stacked team-number cell (`gap-[1px]` line 208, `gap-[2px]` lines 263/270) plus two `max-w-[1200px]` container-width literals (not spacing, a layout constant already justified in G-7's own write-up and inherited unchanged from Phase 5/6). The three sub-4px gaps sit below the declared scale's own floor (`xs` = 4px) — a deliberate micro-adjustment for the three-team stacked rows to read as one visual block rather than three separated lines, consistent with `chart-craft.md`'s "grouping is proximity" rule, but technically outside the documented scale and worth a one-line comment noting the intentional exception (the file has none currently).

44×44px minimum tap targets: the tab triggers, algorithm/year dropdowns, and horizontal-scroll affordances were not independently re-measured here (already covered by `tab-strip-trigger-sizing.spec.ts`/`tab-strip-alignment.spec.ts` per G-5/G-6, both proven GREEN in 07-UAT.md) — deferred to that existing test coverage rather than re-measured, per this audit's own honesty-about-scope standard.

### Pillar 6: Experience Design (3/4)

**States present and correct**, verified live:
- D-08 fallback: renders correctly (see Pillar 1).
- Empty/loading/error: not independently forced (would require intercepting the artifact fetch), but `07-UI-SPEC.md`'s own 55-row UI-considerations table records these as resolved with backstop test evidence, and no contradicting behavior was observed live.
- Disabled Alliances tab: not observed on any of the 9 sampled URLs (all had alliance data) — could not verify D-17's plain-disabled treatment live in this pass; deferred, noted rather than assumed.

**The finding that costs a point:** Alliances' complete absence of a pinned column on mobile (confirmed by design intent in G-8's write-up, not a bug) means a user scrolling right to compare alliances' Combined Totals has no persistent anchor for "which alliance is this." Screenshot-confirmed: at 390px scroll 0, only `Alliance #`/`Captain`/partial `Pick 1` are visible; scrolling to `Combined Total` scrolls `Alliance #` off-screen with it. This directly undercuts the tab's own stated Visual Hierarchy purpose ("which alliance is strongest... since 'which alliance is strongest' is the tab's stated purpose"): the strongest-alliance comparison is exactly the interaction this layout makes hardest on the device class (phone, the audience's likely at-venue device) the contract's own "Spacing Scale" section calls out as the constrained one.

Separately observed (not scored, recorded for completeness): the `2022mirr` Elims tab sample (chosen for its "60 elimination rows" adversarial case) returned entirely upcoming/unplayed matches on every visible row — a legitimate data state for that corpus event, not a UI defect, but it means this audit could not visually verify the played-match Actual/Call rendering on the specific adversarial URL named in the brief. Verified played-match rendering instead via `/team/118?year=2024`'s Quals-equivalent rows and `/event/2023cur?tab=quals`, both of which show correct Actual scores, Call glyphs, and donut-dot marks.

---

## Files Audited

- `.planning/phases/07-event-pages/07-UI-SPEC.md`, `07-UAT.md`, `07-CONTEXT.md` (read in full)
- `.claude/skills/sketch-findings-sigmascout/` (SKILL.md + referenced findings index)
- `apps/web/src/components/event/InsightsTab.tsx`, `BreakdownTab.tsx`, `AlliancesTab.tsx`, `EventMatchTable.tsx`
- `apps/web/src/components/MetricValue.tsx`, `apps/web/src/components/team/MatchTable.tsx`
- `apps/web/src/routes/event.$eventKey.tsx`, `apps/web/src/routes/teams.tsx`
- `apps/web/playwright.config.ts` (device/project reference for viewport fidelity)
- Live screenshots (desktop 1440×900 + phone-390) of all 9 briefed URLs: `2023cur` (insights/quals/alliances), `2022mirr` (elims), `2024new` (breakdown), `2026vache`, `2025cmptx` (insights), `teams?year=2024`, `team/118?year=2024` — stored at `.planning/ui-reviews/07-event-pages/*.png`
- Live DOM measurements via Playwright (`clientWidth`, canvas text-metric width, computed style) for the `VPR Rank` header clip finding and its Teams-page comparison
