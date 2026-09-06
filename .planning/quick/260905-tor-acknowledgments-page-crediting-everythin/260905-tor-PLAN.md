---
quick_id: 260905-tor
phase: quick-260905-tor
plan: "01"
type: execute
mode: quick
wave: 1
depends_on: []
autonomous: false
requirements:
  - QT-260905-tor
files_modified:
  - apps/web/src/components/methodology/acknowledgmentsContent.ts
  - apps/web/src/components/methodology/AcknowledgmentsPage.tsx
  - apps/web/src/routes/methodology.acknowledgments.tsx
  - apps/web/src/routes/methodology.acknowledgments.test.tsx
  - apps/web/src/components/methodology/methodologyCardData.ts
  - apps/web/src/components/methodology/MethodologyCards.tsx

estimate:
  tokens: 70000
  raw_tokens: 140000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A third card on /methodology opens an Acknowledgments page at /methodology/acknowledgments."
    - "The page credits The Blue Alliance, Statbotics, FRC Locks and FIRST by name, each with a working outbound link, and says specifically WHAT each one contributed to SigmaScout."
    - "Every credit's factual claim is traceable to a named file in this repo — no invented relationship, no invented licensing or terms claim."
    - "The full prose is written and shipped in this task; no credit is a placeholder, a heading with no body, or a 'to be written' line."
    - "The page makes no better-than claim against any project it credits and publishes no accuracy figure of its own."
    - "Every open-source package the page names by package name is a real dependency of apps/web, proven by an automated test rather than by reading."
  artifacts:
    - apps/web/src/components/methodology/acknowledgmentsContent.ts
    - apps/web/src/components/methodology/AcknowledgmentsPage.tsx
    - apps/web/src/routes/methodology.acknowledgments.tsx
    - apps/web/src/routes/methodology.acknowledgments.test.tsx
  key_links:
    - "METHODOLOGY_CARDS gains a third descriptor AND MethodologyCards.tsx gains a matching explicit <Link> — the file renders explicit Links rather than mapping the array, so adding the descriptor alone silently ships a card that never renders."
    - "MethodologyCardDescriptor.to is a literal string union of exactly two routes today; the new route path must be added to that union or the descriptor will not type-check."
    - "The TanStack Router plugin regenerates apps/web/src/routeTree.gen.ts during the build; a typed Link to /methodology/acknowledgments does not type-check until that regeneration has run."
    - "ACKNOWLEDGMENTS_ENTRIES is the single source of names, links and prose — the route test iterates the exported constant, never a hand-typed second copy (the discipline vprGuideContent.ts/methodology.vpr.test.tsx already established)."
---

<objective>
Add an Acknowledgments page to the `/methodology` hub that credits, by name and with
outbound links, the projects SigmaScout's work is built on: The Blue Alliance,
Statbotics, FRC Locks, FIRST, and the open-source stack.

Purpose: SigmaScout consumes another project's data for every number it displays,
reimplements a second project's published rating as an on-site baseline, and took the
Districts page's central idea from a third. None of that is stated anywhere on the site
today. This page says it out loud, specifically, and links out.

Output: `/methodology/acknowledgments`, reachable from a third card on the `/methodology`
hub, with the full page prose written and shipped in this task.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.claude/CLAUDE.md

Established patterns this task copies rather than reinvents:
@apps/web/src/components/methodology/vprGuideContent.ts
@apps/web/src/components/methodology/VprGuide.tsx
@apps/web/src/components/methodology/methodologyCardData.ts
@apps/web/src/components/methodology/MethodologyCards.tsx
@apps/web/src/routes/methodology.vpr.tsx
@apps/web/src/routes/methodology.vpr.test.tsx
</context>

<mandatory_skill_load>
**Before writing any JSX or any class name, load `Skill("sketch-findings-sigmascout")`.**

That skill carries the decided palette and the rules this page must obey — most
importantly green-is-ink-not-paint (no green fills on cards or sections) and
accent-means-interactive (the accent colour is reserved for links and controls, never
for decoration). `MethodologyCards.tsx`'s existing card treatment and `VprGuide.tsx`'s
closing-link treatment are both already correct under that skill; match them.
</mandatory_skill_load>

<the_content_this_page_must_carry>

This is the substance of the task. The page content is written here, in this plan, as a
closed list of verified claims. **Every claim below was checked against this repo before
this plan was written, and the source file is named beside it.** Do not add a claim that
is not on this list. Do not soften or drop one that is.

### Page framing

- `<h1>` reads exactly `Acknowledgments`.
- A short lead paragraph above the credits, roughly: SigmaScout is built on work other
  people did first — the data, the ratings it measures itself against, and the ideas
  behind several of its pages. This page says who, and what each one contributed.
- Then one `<section>` per credit, in the order given below. Statbotics and The Blue
  Alliance come first because they are the two the site could not exist without.
- Tone: gracious, specific, plain language, short sentences. Same register as
  `vprGuideContent.ts`. Say WHAT each project contributed, not that it is "great".

### Credit 1 — The Blue Alliance (`https://www.thebluealliance.com/`)

Claims, each verified:

1. Every match, event, team, ranking, alliance, award and district-points record on
   SigmaScout comes from The Blue Alliance's public API. SigmaScout collects no
   competition data of its own.
   *(Source: `packages/ingest/tbaClient.ts` header — it enumerates the sixteen TBA
   capabilities the ingest layer uses: status, teams-list, team-detail, events-list,
   event-detail, event-teams, event-matches, match-detail, team-media, event-rankings,
   event-alliances, districts-list, district-rankings, district-events-keys,
   event-teams-keys, event-awards. `TBA_BASE` is `https://www.thebluealliance.com/api/v3`.)*
2. TBA is free and volunteer-run, so SigmaScout is deliberately a light caller: outbound
   requests are throttled, and repeat fetches use conditional requests so an unchanged
   payload costs a small "nothing changed" reply instead of a full download. That pattern
   came from TBA's own guidance on querying their API efficiently.
   *(Source: `packages/ingest/tbaClient.ts`'s throttle constant and its ETag/If-None-Match
   handling; `.claude/CLAUDE.md` Sources cites TBA's "Efficiently Querying the TBA API" post.)*
3. Team and event pages on SigmaScout link back to that team's or event's page on TBA.
   *(Source: `apps/web/src/components/team/SeasonHeader.tsx` builds
   `https://www.thebluealliance.com/team/{teamNumber}`;
   `apps/web/src/components/event/EventHeader.tsx` exports `TBA_EVENT_URL_PREFIX`.)*

**Prohibition:** do not state or imply anything about TBA's licence, terms of use, or
what attribution they require. This repo does not record those terms, so any such
sentence would be invented. Credit the dependency and link; stop there.

### Credit 2 — Statbotics (`https://www.statbotics.io/`)

This is the most prominent methodological credit on the page — it gets the most words.
Claims, each verified:

1. Statbotics established the way an FRC stats site presents teams, events and
   predictions, and SigmaScout follows that shape.
   *(Source: `.planning/PROJECT.md` line 5 — "It presents teams, events, and predictions
   the way statbotics.io does".)*
2. EPA, Statbotics' rating, is one of the algorithms a visitor can select on SigmaScout;
   the picker names it `EPA Statbotics 5.0`.
   *(Source: `apps/web/src/components/ribbon/AlgorithmSelect.tsx`'s
   `EPA_STATBOTICS_FULL_NAME`.)*
3. SigmaScout's EPA is a from-scratch reimplementation over TBA data, not Statbotics'
   own code — done that way so EPA can be replayed walk-forward at any point in a season.
   Any place the two disagree is SigmaScout's reimplementation drifting, not a fault of
   Statbotics'; those differences are measured and written down.
   *(Source: `.planning/PROJECT.md` Key Decisions row "EPA reimplemented, not pulled from
   Statbotics API"; `docs/models/epa-vs-statbotics.md`; `docs/models/epa-divergences.md`.)*
4. Statbotics' own published season accuracy is carried as a clearly-labelled reference
   figure inside SigmaScout's accuracy reporting, so SigmaScout's numbers are always
   shown next to the number they are trying to beat.
   *(Source: `packages/harness/statbotics.ts` — D-04's reference row.)*
5. This entry closes with an internal link to `/methodology/compare`, reading
   `See the algorithm accuracy comparison` — the same wording and treatment
   `VprGuide.tsx` already uses for that link.

**Prohibition:** this page publishes no head-to-head verdict and no accuracy number.
The comparison page owns those. Phrase the credit so it points at that page rather than
summarising it, and make no superiority claim of any kind here.

### Credit 3 — FRC Locks (`https://frclocks.com/`)

Claims, each verified:

1. The idea behind SigmaScout's Districts page — showing whether a team's district
   championship spot is already mathematically locked, or already out of reach — came
   from FRC Locks.
2. The concept is all that was taken. Every number on SigmaScout's Districts page is
   computed from TBA's published district point data and the official FIRST district
   point model. Nothing was fetched, scraped, or copied from FRC Locks.
   *(Source: `.planning/quick/260905-lic-districts-page-as-fourth-ribbon-page-wit/260905-lic-PLAN.md`
   — "frclocks.com is a reference for the concept only... Do not fetch, scrape or consult
   frclocks for values"; and that task's SUMMARY — "frclocks.com was consulted for the
   concept only; no value came from it".)*

Do not fetch or open frclocks.com while executing this task. The link is written from the
domain recorded in this repo; visiting it is unnecessary and is exactly what that task's
own rule forbade.

### Credit 4 — FIRST (`https://www.firstinspires.org/`)

Claims, each verified:

1. FIRST runs the FIRST Robotics Competition, and publishes the game manuals that define
   the ranking-point rules and the district point model SigmaScout implements.
   *(Source: `.planning/STATE.md` records a human confirming SigmaScout's ranking-point
   thresholds against the 2025 FRC Game Manual Sec 6.5.4 Table 6-2 and the 2026 FRC Game
   Manual Sec 6.5.3 Tables 6-4/6-5; the district point model is cited in the 260905-lic
   plan.)*
2. One short, plain sentence: SigmaScout is an independent community project and is not
   affiliated with or endorsed by FIRST.

Keep this entry to two or three sentences. No legal or trademark boilerplate beyond that
one sentence.

### Credit 5 — Built with open source

One short section, last. Names the open-source projects the site itself runs on, plus a
sentence noting it is hosted on Cloudflare.

**Two hard rules for this section, both because of the failure-log pattern where docs
outlive the thing they describe:**

- **No version numbers.** Versions drift; the page would be wrong within a month.
- The section exports its libraries as a constant of **npm package names**
  (`ACKNOWLEDGMENTS_PACKAGES`), each paired with the display name to render. Task 2 adds
  a test asserting every one of those package names really appears in `apps/web`'s
  `dependencies` or `devDependencies`. If a library is later removed from the app, that
  test goes red instead of the page quietly lying.
- Suggested set (adjust to whatever actually resolves — the test is the arbiter):
  `react`, `vite`, `tailwindcss`, `@tanstack/react-router`, `@tanstack/react-query`,
  `recharts`, `zod`. Cloudflare is named in prose only, not in the gated list, because it
  is hosting and not an npm dependency.

### Page-wide prohibitions (all four apply to every word on the page)

1. No claim that SigmaScout is better than, beats, or outperforms any project it credits.
2. No accuracy figure, Brier score, or percentage of its own — those live on the fetched
   accuracy-comparison page.
3. No claim about any third party's licence, terms of use, or required attribution.
4. No mention of the site's sponsor. `__root.tsx`'s footer already carries that
   site-wide, and a sponsorship is not the same thing as an acknowledgment of work this
   site is built on.

</the_content_this_page_must_carry>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end "a visitor reaches Acknowledgments from the Methodology hub" — one path, fully written</name>
  <files>
    apps/web/src/components/methodology/acknowledgmentsContent.ts,
    apps/web/src/components/methodology/AcknowledgmentsPage.tsx,
    apps/web/src/routes/methodology.acknowledgments.tsx,
    apps/web/src/components/methodology/methodologyCardData.ts,
    apps/web/src/components/methodology/MethodologyCards.tsx
  </files>
  <read_first>
    - `apps/web/src/components/methodology/vprGuideContent.ts` — the content-as-data shape and
      the file-header convention of listing every claim with its source. Copy both.
    - `apps/web/src/components/methodology/VprGuide.tsx` — how a section-id-keyed extra (its
      closing internal `Link`) is attached without polluting the plain-string paragraph data,
      and its `preserveSearch` escape hatch.
    - `apps/web/src/components/methodology/methodologyCardData.ts` — note `to` is a literal
      two-member string union that must be widened, and note the file-header explanation of
      why this file is named `...CardData.ts` and not `...Cards.ts`.
    - `apps/web/src/components/methodology/MethodologyCards.tsx` — note it destructures
      `const [vprCard, compareCard] = METHODOLOGY_CARDS` and renders **explicit** `<Link>`
      elements rather than mapping, and note the documented reason (typed `to` overload
      resolution). Adding a descriptor without adding a third explicit `<Link>` ships a card
      that never renders.
    - `apps/web/src/routes/methodology.vpr.tsx` — the page-container + `<h1>` shape every
      methodology child owns for itself (`methodology.tsx` is a bare pass-through `Outlet`
      and must stay that way).
    - `apps/web/src/routes/__root.tsx` line 45 and `apps/web/src/components/ribbon/Ribbon.tsx`'s
      `GitHubLink` — this repo's outbound-link attribute set: `target="_blank"` with
      `rel="noopener noreferrer"`.
  </read_first>
  <action>
Write the whole vertical slice, with the complete prose from this plan's
`<the_content_this_page_must_carry>` section already in it. This is not a skeleton — every
one of the five credits ships written in this task.

**File naming — Windows case-insensitivity.** This repo builds on a case-insensitive
filesystem, and quick task 260905-phf hit a real Rolldown resolution failure from a data
file differing from its component file by case alone (see `methodologyCardData.ts`'s own
header). The component here is therefore `AcknowledgmentsPage.tsx` and the data module is
`acknowledgmentsContent.ts` — those differ by far more than case. Do not rename either to
anything that collides case-insensitively with the other.

**1. `acknowledgmentsContent.ts` — content as data.**
Give it a file header in the same style as `vprGuideContent.ts`: state the audience, and
list the numbered claims with the source file beside each, exactly as this plan's content
section does. That header is what stops a later editor from drifting the prose away from
what the repo actually does.

Export:
- `interface AcknowledgmentEntry` with `readonly id: string`, `readonly name: string`,
  `readonly href: string`, `readonly paragraphs: readonly string[]`.
- `ACKNOWLEDGMENTS_LEAD` — the lead paragraph string.
- `ACKNOWLEDGMENTS_ENTRIES: readonly AcknowledgmentEntry[]` — the four outbound credits in
  the plan's order (The Blue Alliance, Statbotics, FRC Locks, FIRST), full prose.
- `ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID` — the id of the Statbotics entry, i.e. the entry
  after whose paragraphs the internal `/methodology/compare` link renders. Same mechanism as
  `VPR_GUIDE_CLOSING_LINK_SECTION_ID`.
- `ACKNOWLEDGMENTS_PACKAGES: readonly { readonly package: string; readonly label: string }[]`
  — the built-with list, npm package name plus display name, no versions.
- `ACKNOWLEDGMENTS_BUILT_WITH_TITLE` and `ACKNOWLEDGMENTS_BUILT_WITH_PARAGRAPHS` — the
  built-with section's heading and its prose, including the Cloudflare hosting sentence.

**2. `AcknowledgmentsPage.tsx` — the renderer.**
Mirror `VprGuide.tsx`'s structure: a `flex flex-col gap-[var(--spacing-lg)]` wrapper, one
`<section>` per entry keyed by id, an `<h2>` per entry, `<p className="max-w-[72ch] ...">`
per paragraph.

Each entry's `<h2>` contains the outbound anchor: `<a href={entry.href} target="_blank"
rel="noopener noreferrer">{entry.name}</a>`, styled with the accent colour and an
underline, matching `VprGuide.tsx`'s closing-link treatment
(`text-[var(--color-accent)] underline underline-offset-2`). Putting the anchor inside the
heading keeps one accessible name for both the heading role and the link role, which the
Task 2 tests rely on.

After the Statbotics entry's paragraphs (matched on
`ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID`), render the internal TanStack `Link` to
`/methodology/compare` reading `See the algorithm accuracy comparison`, using the same
local `preserveSearch` escape hatch `VprGuide.tsx` declares and documents.

Last, render the built-with section: its heading, its paragraphs, and the package display
names as a plain comma-joined line or a simple inline list. No outbound links needed there.

Copy `VprGuide.tsx`'s doc-comment discipline — explain in the component header why the
outbound anchor lives inside the heading and why the internal link is keyed by entry id
rather than folded into the paragraph strings.

**3. `methodology.acknowledgments.tsx` — the route.**
`createFileRoute("/methodology/acknowledgments")`, component renders the same container
`methodology.vpr.tsx` uses (`mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]`), an
`<h1 className="text-role-heading mb-[var(--spacing-md)]">Acknowledgments</h1>`, then
`<AcknowledgmentsPage />`. Fetches nothing. Note in the header that it fetches nothing —
every claim is a static fact about this repo, not a number from a published artifact.

**4. `methodologyCardData.ts` — widen and append.**
Add `"/methodology/acknowledgments"` to `MethodologyCardDescriptor["to"]`'s literal union,
then append a third descriptor: title `Acknowledgments`, testId
`methodology-card-acknowledgments`, and a one-line blurb naming what the page is for (the
projects and data SigmaScout is built on). Keep it third, after Intro to VPR and Algorithm
accuracy.

**5. `MethodologyCards.tsx` — render the third card.**
Widen the destructure to a third const, extend the existing `undefined` guard to cover it,
and add a third explicit `<Link>` copying the existing two verbatim except for the
descriptor it reads. Do not convert the file to a `.map()` — its header documents why the
explicit form is required for typed `to` resolution.

Change the grid from `md:grid-cols-2` to `md:grid-cols-3` so three cards sit in one row on
desktop; the mobile branch stays a single column via the unprefixed `grid`. If the sketch
skill's guidance conflicts with three-up at this width, follow the skill and say so in the
SUMMARY.

**6. Regenerate the route tree.**
`apps/web/src/routeTree.gen.ts` is **gitignored and untracked** in this repo (confirmed:
`.gitignore` line 23) — the TanStack Router plugin generates it during the build. Run
`npx vite build` from `apps/web` to regenerate it. The typed `Link to="/methodology/acknowledgments"`
will not type-check until that has run. Never hand-edit the generated file, and do not try
to commit it.
  </action>
  <verify>
    <automated>cd apps/web &amp;&amp; npx vite build &amp;&amp; grep -n "methodology/acknowledgments" src/routeTree.gen.ts &amp;&amp; npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>
    The build succeeds, the regenerated `routeTree.gen.ts` contains the
    `/methodology/acknowledgments` route, and `tsc --noEmit` is clean.
    `acknowledgmentsContent.ts` carries the complete written prose for all five credits —
    no placeholder string, no empty `paragraphs` array, no "TODO" anywhere in the file.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Route test that gates the page's content rules, not just its existence</name>
  <files>apps/web/src/routes/methodology.acknowledgments.test.tsx</files>
  <read_first>
    - `apps/web/src/routes/methodology.vpr.test.tsx` — the memory-router harness
      (`createRootRoute` + `RootSearchSchema` + `Route.update({...} as never)` +
      `waitFor(status === "idle")`), and its two content-rule assertions (no numeric
      accuracy figure, no superiority claim). Copy the harness exactly; extend the rules.
    - `apps/web/src/routes/methodology.index.test.tsx` — note it already asserts
      `getAllByRole("link")).toHaveLength(METHODOLOGY_CARDS.length)`, so it adapts to the
      third card with no edit. Run it and confirm that holds rather than assuming it.
  </read_first>
  <behavior>
    - Renders an `<h1>` reading exactly `Acknowledgments`.
    - For each entry in `ACKNOWLEDGMENTS_ENTRIES` (iterated from the exported constant,
      never a hand-typed copy): a level-2 heading with that entry's name exists, and a link
      with that accessible name exists whose `href` is exactly the entry's `href`.
    - Every entry carries at least one paragraph, and no paragraph is blank or whitespace —
      an emptied credit fails here rather than rendering a bare heading.
    - The four names the user explicitly asked for are all present: the set of entry names
      includes one matching The Blue Alliance, one matching Statbotics, one matching FRC
      Locks, and one matching FIRST. Assert against `ACKNOWLEDGMENTS_ENTRIES`, so deleting a
      credit is a test failure and not a silent regression.
    - Every `href` in `ACKNOWLEDGMENTS_ENTRIES` parses as an absolute `https:` URL.
    - Every outbound anchor rendered carries `rel` including both `noopener` and `noreferrer`
      and `target="_blank"`.
    - A link exists whose `href` pathname ends with `/methodology/compare` (the internal
      accuracy-comparison link; compare the pathname only, since `preserveSearch` appends the
      router's default-filled search params — `methodology.vpr.test.tsx` documents this).
    - Every `package` in `ACKNOWLEDGMENTS_PACKAGES` appears as a key of `dependencies` or
      `devDependencies` in `apps/web/package.json`, read from disk at test time.
    - No numeric accuracy figure in the rendered prose: no Brier-shaped decimal, no `%`.
    - No superiority claim in the rendered prose.
    - No licence/terms assertion in the rendered prose.
  </behavior>
  <action>
Write `methodology.acknowledgments.test.tsx` against the behaviors above, using
`methodology.vpr.test.tsx`'s harness verbatim (only the imported `Route` and the initial
history entry change).

Two implementation notes:

- **The package-manifest gate.** Read the manifest from disk rather than importing it, so no
  `resolveJsonModule` change is needed:
  `JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))` with
  `readFileSync` from `node:fs`. Merge `dependencies` and `devDependencies` and assert each
  `ACKNOWLEDGMENTS_PACKAGES` entry's `package` is a key of the merged object. Include the
  offending package name in the assertion message so a failure names the drift directly.
  If a package in the constant does not resolve, fix the **constant** — the manifest is the
  truth.

- **The negative content gates.** Keep them as assertions over
  `document.body.textContent`, the way `methodology.vpr.test.tsx` already does, rather than
  as shell greps. Use lowercased body text and regex alternations for the superiority gate
  and for the licence/terms gate. Choose the licence/terms pattern to catch an assertion
  about someone's terms while still permitting ordinary words the page legitimately uses.

Then run the whole `apps/web` suite, not just this file. Per the project's recorded test-scope
trap, `vitest` from `apps/web` and from the repo root cover different file sets — run it from
`apps/web`, and read the printed pass/fail counts rather than trusting an exit code. Never
wrap the command in `timeout` and never route it through `pnpm` for this check; both have
produced false greens on this machine.
  </action>
  <verify>
    <automated>cd apps/web &amp;&amp; npx vitest run src/routes/methodology.acknowledgments.test.tsx src/routes/methodology.index.test.tsx &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    The new test file passes, `methodology.index.test.tsx` still passes unchanged with three
    cards, and the full `apps/web` suite is green with its printed file/test counts confirmed
    by reading the output — not inferred from the exit status.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human visual verification of the Acknowledgments page and the three-up hub grid</name>
  <what-built>
    A third card, `Acknowledgments`, on the `/methodology` hub, opening
    `/methodology/acknowledgments` — a written page crediting The Blue Alliance, Statbotics,
    FRC Locks, FIRST and the open-source stack, each with a working outbound link and a
    specific statement of what it contributed.
  </what-built>
  <how-to-verify>
    Start the dev server from `apps/web` (`npx vite`) and open the printed URL. Note the
    project's recorded recipe: a fresh port per restart, and `VITE_ARTIFACT_ORIGIN=local` is
    only needed for pages that fetch published artifacts — this page fetches nothing, so the
    plain dev server is enough.

    1. Go to `/methodology`. Confirm three cards now sit in the grid and that the row reads
       comfortably at desktop width — three-up is a change from the previous two-up layout,
       so this is the main thing to eyeball.
    2. Narrow the window to phone width. Confirm the cards stack to one column and nothing
       overflows horizontally.
    3. Click the Acknowledgments card. Confirm the page opens with an `Acknowledgments`
       heading and reads as finished prose — not a list of headings with thin bodies.
    4. Read the four credits. Confirm each one says something specific about what that
       project contributed, and that the Statbotics entry is the most substantial.
    5. Click each of the four outbound links. Confirm each opens the right site in a new tab.
    6. Click `See the algorithm accuracy comparison` and confirm it lands on the accuracy
       page with the year/algorithm selections carried through.
    7. Confirm the green rule holds: no green fills, accent colour only on the links.
  </how-to-verify>
  <resume-signal>Type "approved", or describe what reads wrong or looks wrong</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| SigmaScout page → third-party site | Outbound anchors hand the visitor to sites this project does not control |
| Repo facts → published prose | Claims about what other projects contributed become public statements about third parties |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tor-01 | Tampering | Outbound anchors in `AcknowledgmentsPage.tsx` | medium | mitigate | Every outbound anchor carries `target="_blank"` with `rel="noopener noreferrer"`, matching `__root.tsx`/`Ribbon.tsx`; Task 2 asserts both tokens are present on every rendered outbound link rather than trusting review |
| T-tor-02 | Repudiation | `acknowledgmentsContent.ts` prose | high | mitigate | Every factual claim is fixed to a named repo file in this plan and restated in the module's own header; the page asserts nothing about any third party's licence, terms, or required attribution, and Task 2 gates that negatively |
| T-tor-03 | Information disclosure | `acknowledgmentsContent.ts` prose | low | mitigate | Page is static and fetches nothing — no key, endpoint, or artifact path is named. The one API base URL mentioned (`thebluealliance.com/api/v3`) is public documentation |
| T-tor-04 | Tampering | `apps/web/src/routeTree.gen.ts` | medium | mitigate | Generated by the router plugin during `vite build`, gitignored and untracked; Task 1 greps the regenerated file and corrects the `Link` props to match it rather than the reverse. Never hand-edited |
| T-tor-05 | Tampering | Dependency surface | low | accept | This task installs no package from any registry, so the supply-chain legitimacy gate does not apply. `ACKNOWLEDGMENTS_PACKAGES` names only packages already resolved in `apps/web/package.json`, and Task 2's manifest gate proves it |
</threat_model>

<verification>
1. `cd apps/web && npx vite build` succeeds and the regenerated `routeTree.gen.ts` contains
   `/methodology/acknowledgments`.
2. `cd apps/web && npx tsc --noEmit -p tsconfig.json` is clean.
3. `cd apps/web && npx vitest run` is green, with the printed counts read from the output.
4. `git status` after committing shows no unstaged leftovers — this repo has a recorded case
   of an Edit-then-move commit silently missing edited content, so confirm the committed
   diff actually contains the prose.
5. Human visual verification approved at the Task 3 checkpoint.
</verification>

<success_criteria>
- `/methodology` shows three cards; the third opens `/methodology/acknowledgments`.
- The page credits The Blue Alliance, Statbotics, FRC Locks and FIRST by name, each with a
  working outbound link, and states specifically what each contributed.
- The open-source stack is credited without version numbers, gated by a test against
  `apps/web/package.json`.
- The full prose shipped in this task — no credit is a stub, a placeholder, or a bare heading.
- The page publishes no accuracy figure of its own, makes no superiority claim, and asserts
  nothing about any third party's licence or terms.
- Every factual claim on the page traces to a repo file named in `acknowledgmentsContent.ts`'s
  header.
</success_criteria>

<output>
Return the SUMMARY text to the orchestrator rather than writing it directly — `Write` is
blocked for subagents on `SUMMARY.md` in this project. The orchestrator writes
`.planning/quick/260905-tor-acknowledgments-page-crediting-everythin/260905-tor-SUMMARY.md`.

The SUMMARY must state, explicitly:
- Which repo file backs each of the five credits (so a later reader can re-verify without
  re-deriving).
- Any claim from this plan's content list that was changed or dropped, and why.
- The final `ACKNOWLEDGMENTS_PACKAGES` list and whether any suggested package failed the
  manifest gate.
- Whether the three-up card grid was kept or overridden by the sketch skill's guidance.
</output>
