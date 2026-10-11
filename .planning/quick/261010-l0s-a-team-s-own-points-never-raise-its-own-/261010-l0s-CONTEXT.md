# Quick Task 261010-l0s: A team's own points never raise its own joint lock bound - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning (plan against HEAD e868a1a2; quick task 261010-d7r is complete and pushed)

<domain>
## Task Boundary

Jacob's rule: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked." Jacob, 2026-10-09: "fix the gaps. do not leave anything undone."

The verifier of quick task 261010-d7r passed it with one warning that deserves closing (its W1; the 261010-d7r run B executor reported the same thing as its finding 3):

- The joint lock proof's bound for a team T (`packages/core/districts/champJointLock.ts`) is sound, and since 261010-d7r no OTHER team's posting raises it (0 of 335,397 core level comparisons). But T's OWN floor rising (its own award posting, its own playoff points) can raise T's OWN bound by 1 at the core, in about 0.002 to 0.03 percent of random comparisons.
- Mechanism as the verifier read it: T's floor jumps past a rival R that was counted once as already ahead by floor. R is then counted both by the seat cover and as the winner's fill in (an old relaxation: a fill in counted beside a seat that may lift the same rival). The true number of rivals that can finish ahead of T cannot go up when T gains points, so this is slack in the relaxation, not a real future.
- Smallest example: the verifier's script `SCRATCH/d7r-verify/bf1.mts`, seed 1256: T is mem20 at floor 155, a member of alliance 2 (value 39); the rival free0 is at 158 in group 0; K is 1 and fill ins are 2. mem20's own 15 point award posts (floor 170, K 0) and its bound goes 2 then 3.
- No real championship shows it: every micro step walk of 261010-d7r (58 walks, 4,439 edges) and the verifier's 49 shuffled walks lose 0 Locked teams. It is a theoretical path to a take back (a team sitting exactly one below its slot count whose own points then bump its bound), and the header of `champJointLock.ts` claims more than is proven.

Scope: `packages/core/districts/champJointLock.ts` and its tests; the monotone and walk tests under `scripts/` only to add the property; headers. No artifact change, no Worker bundled file (the 261010-d7r closure gate must still read `WORKER BUNDLE UNTOUCHED`), no browser display change beyond what the bound gives.

</domain>

<decisions>
## Implementation Decisions

### D1. Close it at the root: the bound never counts one rival twice where that is what makes it rise
- First REPRODUCE the verifier's finding at the core (seed 1256 and a random search of your own) and state the exact mechanism with file and line: which terms count the same rival twice, in which shapes (single, divisioned frames with seat groups, two championships).
- Preferred fix (prove or refute it on the prototype before planning it): a cap that is sound by definition, the number of DISTINCT rivals that can finish ahead of T or take a slot by ANY modelled means in that frame (already ahead by floor, liftable by a seat, a judged award or a settled value, a consuming award, a fill in). The bound of a frame is the smaller of today's count and that cap. It can only lower a bound.
- If the cap does not bring "T's own floor rising raises T's bound" to ZERO in a random search of at least 300,000 comparisons, find what remains and plan the smallest sound fix for it too. One sound fallback that needs no new modelling: for any floor f' at or below T's floor, the bound computed with T's floor set to f' is also a valid bound for T (lowering T's points cannot reduce who finishes ahead), so the minimum over a small, justified set of lower floors is valid. Use it only if the cap is not enough, and only where it is cheap (for example only for a team whose bound is within 1 or 2 of its slot count). If neither closes it, STOP and report what remains with the smallest failing instance: do not pin a nonzero count as acceptable.
- Soundness must hold exactly as before: the exhaustive and sampled futures, the brute force (20,000 instances) and the verifier's enumerator shape (`bf1.mts`) never find a legal future above the bound.

### D2. The property becomes a test
- Core, always on: over at least 300,000 seeded random transitions, (a) another team's posting never raises a team's bound (the verifier measured 0; pin it), and (b) a team's own floor rising (by an award, by playoff points, by any amount) never raises its own bound. Both exact zeros.
- The micro step walks and the awards order lattice of 261010-d7r still read 0 Locked lost and 0 margin drops with the rules on. Add the per edge assertion that NO pool team's bound rises over any walked edge, Locked or not (today the walks assert on Locked teams and on margins): report the count before the fix, zero after. If it is not zero after for a cause other than a stated limit, STOP and report.

### D3. Gates
- Baselines before the first edit with the 261010-d7r tooling (`SCRATCH/d7r/gates.sh`, `SCRATCH/66y/gates_compare.sh`, `SCRATCH/d7r/worker_closure.mjs`; `SCRATCH/d7r/exec/final` is the reading at 72cc0830).
- The four sweeps: zero violations, `SKIPPED (0)`, `take-backs 0`. A cap can only lower bounds, so sweep rows may only GAIN locks: report every moved row (single, divisioned and California), per stop no lock lost, pins replaced with executed values, never fitted. If nothing moves, say so.
- Cutoff no drift, the Now dump identical unless a moved row explains a difference (then name the teams), publisher comparison clean, `WORKER BUNDLE UNTOUCHED`.
- Full `npx vitest run` with `REQUIRE_LOCAL_DATA=1`; four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo.
- Cost: the status code computes a bound for every pool team at every stop. Measure the proof's time on 2026 FIM at one stop before and after and report it; more than about a quarter slower needs a reason.

### D4. Headers
- `champJointLock.ts`: soften nothing that is now proven and state exactly what is: no bound rises when another team's facts land, none when a team's own points land (with the test names), and what "monotone" still rests on walks for. Remove the over claim the verifier named if anything of it remains.

### D5. Decisions after the planner's measurements and the plan check (orchestrator, 2026-10-10; BINDING, they override D1 to D4 and the plan text where they differ)
- **The fix of D1 is the EXACT MATCHING, not the cap.** The planner refuted the distinct rivals cap (787 own floor rises left on the divisioned shape, and it adds a rise from another team's posting) and the lower floor fallback (leaves another team's posting, 14 times slower). There are three double counts, not one (the winner's fill in beside the cover; once per seat group for a rival no group names; a listed pick as a member and again on a seat), rises up to 5, and "no other team's posting raises a bound" was false at HEAD for a listed pick on an alliance still in its bracket (10 of 391,941). The matching counts every rival as one entity: 0 rises in 814,080 comparisons, never above the old bound, equal to the model's enumeration, no sweep row moves, faster. The planner's eight contradicted premises stand.
- **Finding F2 is closed in this task, as Task 3** (`champLedgerStatus.ts` and the files the plan names are in scope for it): a listed pick TBA has paid playoff points at its alliance's key, read only once that key's Playoffs are final at the position, is a member of that alliance (`confirmedPicks`); for a division's decided winner the finals key is read too. Six live walk locks are gained (each a decided winner's paid backup), none lost.
- **Two executor runs:** run A Tasks 1 and 2, run B Task 3. Installing the planner's tested references with the hash guarded installer is accepted; after every install the REAL tree is tested (the real full suite, the four typechecks, the gates, the monotone and walk files): nothing ships on the prototype's numbers.
- **Binding addenda from the plan check (the plan text does not carry these):**
  - **Run in the main checkout, no worktree.** Long commands (the full `npx vitest run` takes 15 to 20 minutes) are run so they cannot be cut off at the tool's foreground limit: in the background with their output in a log file, then read the printed `Test Files` and `Tests` lines. Never judge by exit code alone.
  - **The full root suite runs BEFORE Task 1's commit too**, not only the seven file set.
  - **An independent two seat group brute force (Task 1).** The model enumeration is the same allocation reading as the matching, so equality with it proves nothing about the rules, and the existing brute force has one seat group. Add an always on core test that enumerates RULE LEGAL FUTURES directly (not allocations) on small instances with TWO seat groups, one or two frames, awarded rivals, listed only picks and slot only rivals, and asserts no future puts more rivals ahead than the bound. The 261010-d7r verifier's `SCRATCH/d7r-verify/bf1.mts` is a starting point; it must not import the matching's helpers. Report its counts. Also report the E3 and S2 "bound reached" and "never above" lines in run A's report.
  - **Two guards on `confirmedPicks` (Task 3), each with a status test:** a paid pick is confirmed only when exactly ONE alliance of its key lists it (a team two lists name stays unconfirmed, so both seats stay open); the finals reading names a division winner's backup only when exactly ONE unlisted team of that division was paid at the finals (two or more: nobody is named, the seat stays open). Both take the side with the larger bound.
  - **The header paragraph for the paid rule states its gate:** the payment is read once the FIELD says the key's playoffs are done (`stage.elim`) and the team's own row carries playoff points; membership is sound either way (only a team on an alliance is paid); that the payment is then in the floor rests on the points being posted for the event together, the stated assumption of quick task 261009-vp9, checked on the walks.
  - STOP: any soundness test failing after an install stops the run; nothing is adjusted to make it pass. A bound rising with rules on, for a cause that is not a stated limit, stops the run with the smallest input.

### Claude's Discretion
- Where the cap lives in the cover bound and how the distinct set is built.
- If a step is ambiguous take the side that is sound (the larger bound) and record the reading.

</decisions>

<specifics>
## Specific Ideas

- SCRATCH = `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`. The verifier's material: `SCRATCH/d7r-verify/` (`bf1.mts`, `shuffle/`). The 261010-d7r material: `SCRATCH/d7r/` (tooling, `exec/final`, `runB-handover.md` finding 3).
- A simplified picture of the double count: before, R is ahead by floor (counted once), the seat cover and the fill in pool do not hold it. After T passes R's floor, R is in the liftable set L and in the fill in pool P. When both pools are below their capacity the count is |L| + |P| while the distinct rivals are |L union P|. The cap restores the count to at most what it was before. Check this picture against the real code (frames, seat groups, budgets): it may be too simple.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`). Never Read, cat or echo `.env`. The executor has no network and must not push or deploy. Long content goes through the Write tool, never a Bash heredoc. Another quick task (261010-jyn) is editing `scripts/publishDistricts.ts`, `scripts/districtLiveGuard.ts`, `scripts/districtPublishGuard.ts` and `docs/worker-operations.md`: this task must not touch those files.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/champJointLock.ts` (the cover bound, `unpickedCover`, the fill in term near `others3`, `CoverOptions`), `champJointLock.test.ts`
- `scripts/champJointMonotone.test.ts`, `scripts/champFieldStagedWalk.test.ts`
- `.planning/quick/261010-d7r-the-joint-lock-proof-never-raises-a-boun/261010-d7r-VERIFICATION.md` (W1), `261010-d7r-SUMMARY.md` (run B finding 3)
</canonical_refs>
