# BPR and SPR are the same algorithm under two names

**One-line answer:** BPR and SPR are the same algorithm under two names, not two
models and not a before/after model revision — same code, same parameters, given
two names at two different times. Every measurement recorded anywhere in this
repository under the name "BPR" applies unchanged to "SPR", and vice versa.

## Timeline

- **2026-09-08** (quick task `260908-b4t`) — the algorithm is built: a per-team
  latent scoring contribution tracked by a Gaussian filter, in `packages/bpr/`
  (research harness) and `packages/core/algorithms/bpr.ts` (production port).
  Named "BPR" (Bayesian Power Rating) throughout.
- **2026-09-09** — BPR becomes SigmaScout's premier published algorithm, on the
  strength of the sealed 2023-2026 holdout (78.05% winner accuracy, 78.37% over
  qualification matches alone; structure and hyperparameters selected using only
  2016-2022 evidence — see `packages/spr/` for the harness and the sealed run).
- **2026-09-10** — "SPR" (Sigma Power Rating) becomes the **display name**: every
  user-visible surface (the `/methodology/spr` route, `sprContent.ts`, team-table
  column headers) reads "SPR". The underlying identifier layer — the package
  directory, `packages/core/algorithms/bpr.ts`'s registry `id`, the wire id
  embedded in R2 object keys / the URL search param / the KV manifest / D1's
  `algorithm_id` column — still reads `bpr`. Display name and identifier
  deliberately diverge for eleven days.
- **2026-09-12** (quick task `260912-ivg`) — the identifier layer catches up.
  Stage 1 renames the package directory (`packages/bpr/` -> `packages/spr/`),
  the production module (`bpr.ts` -> `spr.ts`, exported symbol `bpr` -> `spr`,
  registry `id: "bpr"` -> `id: "spr"`), and the ~200 files of surrounding
  identifiers, in a two-tier split that keeps the deployed site reading `bpr@`
  objects until the later stages (write pass, D1 reseed, Worker deploy, client
  flip, cleanup) make `spr@` objects live and remove the retired name.

## What this means for anyone reading a measurement

Every number attributed to "BPR" anywhere in this repository — the sealed
78.05%/78.37% 2023-2026 holdout, the 2016-2022 design-era component deltas
(season carryover +1.80pp, two-timescale state +1.05pp, anti-additivity
+0.53pp, foul-adjusted signal +0.30pp), every `bpr@<version>` R2 object-key
citation, every `docs/models/*.md` figure, every `.planning/` quick-task
record — describes the SAME algorithm SPR now identifies. Nothing was
re-tuned, re-measured, or re-run to produce this rename; nothing in
`data/baselines/` or `.planning/` was rewritten to read as though it was
always called SPR. That is deliberate: rewriting history to match a later
name would falsify the audit trail the sealed holdout depends on — see
`packages/spr/sealedPaths.ts` for the mechanism that makes the seal's
git-blob-sha attestation survive a pure rename unchanged, and
`.planning/quick/260912-ivg-rename-bpr-to-spr-sigma-power-rating-acr/` for
this rename's own plan and summary.

If a citation elsewhere in `docs/` reads "BPR" without further comment, treat
it exactly as the name in force at the time that citation was written —
current fact until 2026-09-10 (display) / 2026-09-12 (identifier), and
historically accurate before and after both dates, since the algorithm
itself never changed.
