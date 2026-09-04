/**
 * Quick task 260904-2i9: the SINGLE place a promoted-`vpr`-version re-pin is
 * edited. Before this module existed, five call sites (`cli.ts`,
 * `manifests.ts`, `selectionProvenance.ts`, `scripts/measureRewindGap.ts`,
 * `fixtures/extract-digest-slice.ts`) each hand-maintained their own copy of
 * this same path, justified at each site by an import cycle that, on
 * inspection, only ever existed between those FIVE files and each other —
 * never between any of them and a genuine leaf. That was the duplicated-fact
 * pattern behind every green-but-wrong defect in this session: five
 * constants that must agree, each file internally consistent either way,
 * where a missed update leaves the scorer, the manifest, the eligibility
 * flag, and the rewind measurement each believing a different parameter set
 * is live — plausibly with every individual suite green.
 *
 * This module is a genuine leaf: it imports only `node:path` and
 * `SIGMA1_CODE_VERSION` from `../core/algorithms/sigma1/params.js`, and
 * NOTHING else — no corpus, no schema, no sibling harness module. That is
 * the property that makes it importable from all five sites without
 * reopening any cycle (in particular, `selectionProvenance.ts` is imported
 * BY `cli.ts`, which is exactly the direction that made importing the path
 * back from `cli.ts` impossible — a third module neither of them owns has no
 * such direction to violate). Any future import added here can reopen the
 * cycle this module exists to avoid — keep it a leaf.
 *
 * `PROMOTED_VPR_VERSION_PATH` is DERIVED from `SIGMA1_CODE_VERSION`, not
 * retyped, so the next code-version bump moves it by construction rather
 * than requiring a hand-edit here (and, before this module, at every other
 * copy) — the same reasoning `tune.ts`'s `INCUMBENT_VERSION_PATH` already
 * used. `tune.ts`'s `INCUMBENT_VERSION_PATH` is a DELIBERATE EXCEPTION to
 * this being the one place a re-pin happens: it stays on `tuned-2026-08`
 * because it is the D-T7 acceptance BASELINE for ten already-recorded
 * verdicts, and repointing it would silently redefine what "the incumbent"
 * meant in results already written down. See `tune.ts`'s own comment above
 * that constant — it is not an oversight left behind by this collapse.
 *
 * Re-pin history (moved here from `cli.ts`, quick task 260904-2i9):
 * Re-pinned three times, each time alongside a `SIGMA1_CODE_VERSION` bump
 * (see that constant's own doc comment, `sigma1/params.ts`): from
 * `vpr@2.0.0+tuned-2026-08.json` to `2.1.0` (whole-alliance-DQ exclusion,
 * 2026-08-30), then to `3.0.0` (D-Q2's innovation-based R estimator, quick
 * task 260901-is2, 2026-09-01). The 3.0.0 re-promotion also carried ONE
 * parameter override, `linkC = 0.5`, recorded in that file's
 * `provenance.paramOverrides` — the R estimator changing made the tuned
 * link constant stale, and it was re-selected on the tune seasons only.
 *
 * Re-pinned again to `4.0.0` (D-T1/D-T2's scale-relative reparameterization,
 * quick task 260901-trz, 2026-09-01). Unlike the earlier re-promotions this
 * one went through `pnpm promote --from-version`, reading the retired 3.0.0
 * FILE rather than a search artifact — which is what carried the `linkC`
 * correction above forward. The search artifact's own winner still records
 * the stale 1.2398..., so re-promoting from it would have silently dropped
 * a correction that is live on the site (see `promote.ts`'s header).
 *
 * DERIVED, not re-pinned (260902-varopr): this constant had been hand-edited
 * at every `SIGMA1_CODE_VERSION` bump, and the 5.0.0 bump found it — plus
 * its three siblings — still pointing at a deleted 4.0.0 file, which is what
 * a re-pin invites. `tune.ts`'s `INCUMBENT_VERSION_PATH` already derived its
 * own path this way; the remaining hardcoded copies now matched it, so the
 * next bump moved them all by construction and a stale path became
 * unrepresentable rather than merely caught by a test.
 *
 * COLLAPSED from five hand-maintained copies into this one module (quick
 * task 260904-2i9, 2026-09-04), and re-pinned from `tuned-2026-08` to
 * `rolling-2026-09` (`260904-100`'s per-season promotion) in the same move —
 * the first re-pin this constant has ever undergone as a single edit rather
 * than five.
 *
 * Re-pinned to `rolling-2026-09b` (2026-09-04, full re-tune under code
 * version 8.0.0 with `--incumbent`-gated acceptance against the live set):
 * only origin 2022 cleared the D-T7 bar (off arm), so the new file replaces
 * 2022's set and carries every other season's `rolling-2026-09` entry
 * forward unchanged.
 */
import { join } from "node:path";
import { SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";

/** The committed version-file directory `warnIfNewerPromotedVpr` scans. */
export const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

/** The one live pin: which committed `vpr` version file every harness/publish path resolves. Previous values: `tuned-2026-08`, `rolling-2026-09`. */
export const PROMOTED_VPR_VERSION_PATH = join(ALGORITHM_VERSIONS_DIR, `vpr@${SIGMA1_CODE_VERSION}+rolling-2026-09b.json`);
