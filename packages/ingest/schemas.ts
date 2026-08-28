/**
 * Zod schemas for the TBA v3 event and match shapes the corpus needs
 * (DATA-01/DATA-02). Parsed at the fetch boundary; a parse failure throws —
 * per the project's failure log, a loud failure on TBA drift is the point,
 * never a silently coerced default.
 */
import { z } from "zod";

/** `GET /status` — datafeed health, checked once at the start of a backfill run (Plan 03 Task 3). */
export const tbaStatusSchema = z.object({
  current_season: z.number(),
  max_season: z.number(),
  is_datafeed_down: z.boolean(),
});
export type TbaStatus = z.infer<typeof tbaStatusSchema>;

/** `GET /team/{key}` and elements of `GET /teams/{year}/{page}`. */
export const tbaTeamSchema = z.object({
  key: z.string(),
  team_number: z.number(),
  nickname: z.string().nullable(),
});
export type TbaTeam = z.infer<typeof tbaTeamSchema>;
export const tbaTeamListSchema = z.array(tbaTeamSchema);

/** TBA's district assignment for an event — absent on non-district events (RESEARCH.md, plan 05-02). */
const tbaDistrictSchema = z.object({
  abbreviation: z.string(),
  display_name: z.string(),
  key: z.string(),
  year: z.number(),
});

export const tbaEventSchema = z.object({
  key: z.string(),
  // `name` is present on every TBA event (plan 05-02, EVNT-01) — required,
  // not nullish, so a missing one is real drift and throws per this file's
  // header policy, rather than silently degrading the events page's search
  // and display.
  name: z.string(),
  year: z.number(),
  event_type: z.number(),
  start_date: z.string(),
  // `week`, `country`, `state_prov` and `district` are legitimately absent
  // for offseason, preseason and non-district events — `nullish` describes
  // TBA's actual contract rather than coercing a value that isn't there.
  week: z.number().nullish(),
  country: z.string().nullish(),
  state_prov: z.string().nullish(),
  district: tbaDistrictSchema.nullish(),
});
export type TbaEvent = z.infer<typeof tbaEventSchema>;

/** `GET /events/{year}` — bulk event list for a season. */
export const tbaEventListSchema = z.array(tbaEventSchema);

const tbaAllianceSchema = z.object({
  team_keys: z.array(z.string()),
  surrogate_team_keys: z.array(z.string()),
  dq_team_keys: z.array(z.string()),
  // TBA reports null or -1 for an alliance's score on an unplayed match.
  score: z.number().nullable(),
});

export const tbaMatchSchema = z.object({
  key: z.string(),
  event_key: z.string(),
  comp_level: z.enum(["qm", "ef", "qf", "sf", "f"]),
  set_number: z.number(),
  match_number: z.number(),
  time: z.number().nullable(),
  predicted_time: z.number().nullable(),
  actual_time: z.number().nullable(),
  // Empty string when the match is unplayed or (rarely) tied.
  winning_alliance: z.enum(["red", "blue", ""]),
  alliances: z.object({
    red: tbaAllianceSchema,
    blue: tbaAllianceSchema,
  }),
  // Per D-05: store verbatim, normalize only totals/winner/RP here.
  score_breakdown: z.unknown(),
});
export type TbaMatch = z.infer<typeof tbaMatchSchema>;

export const tbaMatchListSchema = z.array(tbaMatchSchema);

/**
 * `GET /team/{key}/media/{year}` element (D-03, TEAM-02, plan 06-03). Per
 * TBA's own OpenAPI spec only `type`, `foreign_key` and `team_keys` are
 * required — `preferred`, `direct_url` and `view_url` are all optional, and
 * the `avatar` variant carries an inline base64 image under `details`
 * instead of a URL. `type` is modelled as a plain `z.string()`, not an
 * enum: an unknown future type must degrade to "not allowlisted" in
 * `media.ts`'s picker, never to a parse failure that aborts an ingest run
 * (T-06-11). Every other field is passed through loosely — this schema
 * exists to validate shape, not to constrain TBA's evolving vocabulary.
 */
export const tbaMediaSchema = z.object({
  type: z.string(),
  foreign_key: z.string(),
  team_keys: z.array(z.string()),
  preferred: z.boolean().optional(),
  direct_url: z.string().optional(),
  view_url: z.string().optional(),
});
export type TbaMedia = z.infer<typeof tbaMediaSchema>;

export const tbaMediaListSchema = z.array(tbaMediaSchema);

/**
 * `GET /event/{key}/rankings` element (TEAM-04, F-06-3, plan 06.1-01; widened
 * D-18.6, plan 07-04). Field set confirmed live against 7 real events
 * spanning 2022-2026 (06.1-RESEARCH.md Code Examples). `qual_average`/
 * `sort_orders`/`extra_stats` are `.nullable()` because TBA has observed-null
 * `qual_average` in every 2022-2026 sample and `sort_orders`/`extra_stats`
 * genuinely vary by season (Pitfall 3) — this schema models the shape
 * without constraining vocabulary this pipeline does not read.
 *
 * As of plan 07-04, `rank`/`team_key`/`rankings.length` are NOT the only
 * fields read: `record` (TBA's own win/loss/tie tally, which accounts for
 * DQs and surrogate appearances a match-derived count would misreport) and
 * the position-0 entry of `sort_orders` (TBA's ranking-score/RP value) are
 * now read and persisted into `event_rankings`. `sort_orders` stays
 * `.nullable()` here precisely because its per-season vocabulary variation
 * is why `rankings.ts`'s `normalizeEventRankings` asserts the position-0
 * name at ingest time rather than assuming it. `normalizeEventRankings` is
 * this schema's single consumer for both the pre-existing and the widened
 * fields.
 */
export const tbaEventRankingSchema = z.object({
  // `.int()`: every other boundary this value crosses treats it as strictly
  // integral (`packages/corpus/schema.sql`'s `rank INTEGER NOT NULL`,
  // `packages/harness/pageArtifacts.ts`'s `rank: z.number().int()...`) — a
  // non-integral rank must throw here, at the fetch boundary, not silently
  // persist into a SQLite INTEGER column (T-06.1-01).
  rank: z.number().int(),
  team_key: z.string(),
  matches_played: z.number(),
  dq: z.number(),
  qual_average: z.number().nullable(),
  sort_orders: z.array(z.number()).nullable(),
  extra_stats: z.array(z.number()).nullable(),
  record: z.object({ wins: z.number(), losses: z.number(), ties: z.number() }),
});
export type TbaEventRanking = z.infer<typeof tbaEventRankingSchema>;

/**
 * `GET /event/{key}/rankings` — the whole response, which TBA can return as a
 * bare HTTP 200 `null` body for an event with no ranking structure set up at
 * all (confirmed live against `2026scsc`, 06.1-RESEARCH.md Pitfall 2). The
 * top-level `.nullable()` is load-bearing and non-negotiable — without it, a
 * genuine TBA `null` response throws here instead of being handled as a real,
 * distinct answer by `rankings.ts`'s `normalizeEventRankings` and
 * `packages/ingest/cli.ts`'s `ingestSeasonRankingsOnly` (PD-02, threat
 * T-06.1-02).
 */
export const tbaEventRankingsResponseSchema = z
  .object({
    rankings: z.array(tbaEventRankingSchema),
    sort_order_info: z.array(z.object({ name: z.string(), precision: z.number() })),
    extra_stats_info: z.array(z.object({ name: z.string(), precision: z.number() })),
  })
  .nullable();
export type TbaEventRankingsResponse = z.infer<typeof tbaEventRankingsResponseSchema>;

/**
 * `GET /event/{key}/alliances` element (D-18.7, EVNT-05, plan 07-03) — one
 * playoff alliance selection. Field set confirmed live against 40 real
 * events spanning 2022-2026 (RESEARCH.md Open Question 2). This is
 * deliberately NOT the module-private `tbaAllianceSchema` above, which
 * models a single MATCH's red or blue roster (`team_keys`/
 * `surrogate_team_keys`/`dq_team_keys`/`score`) — two different TBA
 * concepts share the word "alliance"; this response schema must never be
 * substituted for the per-match one or vice versa.
 *
 * Four fields, four reasons a later reader has no other source for:
 * - `name` is `.nullish()` — not required, not `.optional()` alone, and
 *   never given a `.default()`. RESEARCH.md Q2 observed the key ABSENT
 *   entirely at `2024wvrox`, where the alliance object's only keys are
 *   `declines`, `picks` and `status`. `.nullish()` additionally tolerates
 *   an explicit `null` without aborting a 1,581-event run over a purely
 *   cosmetic label. A `.default()` of any kind is forbidden here: it would
 *   make an absence indistinguishable from a value at every layer
 *   downstream.
 * - `picks` carries `.min(1)`. An alliance object with zero picks is not
 *   an alliance, was never observed across the 38 populated events
 *   sampled, and could not be stored anyway — `packages/corpus/db.ts`'s
 *   `event_alliances` contract forbids a row with an empty picks array.
 *   Rejecting it at the parse boundary is what makes that contract
 *   structurally true instead of dependent on a downstream skip. The
 *   maximum is deliberately unconstrained: 3 and 4 were both observed, and
 *   a length ceiling would turn a future format change into a parse
 *   failure over something this pipeline does not care about.
 * - `status` is `z.unknown().optional()`, the same z.unknown() treatment
 *   `tbaMatchSchema.score_breakdown` already gets under D-05, plus
 *   `.optional()`. RESEARCH.md Q2's 40-event sample observed its shape
 *   varying with `playoff_type` across values 0, 4, 8 and 10, with only
 *   `status.status`, `status.record`, `status.current_level_record` and
 *   `status.level` reliably present — but did not observe the key ABSENT
 *   entirely. This plan's Task 2 live full-season run (2022, real corpus)
 *   found it: several alliance objects at real 2022 events carry no
 *   `status` key at all. Zod v4 treats `z.unknown()` alone as requiring
 *   the key to be present (an "unknown" value is not the same as an
 *   absent key), so the un-`.optional()`-ed schema threw
 *   `invalid_type: expected nonoptional, received undefined` against real
 *   data — exactly A3's named risk ("a full-corpus live ingest could
 *   surface a rarer shape variant [the 40-event] sample didn't hit")
 *   materializing inside this plan's own two-season run. Modelling it
 *   field-by-field would make a future playoff format a parse failure;
 *   storing it whole (when present) keeps the provenance without the
 *   brittleness, and `.optional()` makes absence a real, distinct answer
 *   rather than a parse failure, exactly like `name`'s treatment above.
 * - `declines` is required. It was present, as an empty array, in all 40
 *   sampled events, and `event_alliances.declines` is `NOT NULL` — a
 *   missing key is genuine drift that a NOT NULL column cannot honestly
 *   absorb, and this file's header policy says drift throws.
 */
export const tbaAllianceEntrySchema = z.object({
  declines: z.array(z.string()),
  name: z.string().nullish(),
  picks: z.array(z.string()).min(1),
  status: z.unknown().optional(),
});
export type TbaAllianceEntry = z.infer<typeof tbaAllianceEntrySchema>;

/**
 * `GET /event/{key}/alliances` — the whole response. The top-level
 * `.nullable()` is load-bearing and non-negotiable for the identical
 * reason `tbaEventRankingsResponseSchema`'s is: TBA returns HTTP 200 with
 * a bare `null` body for an event with no alliance structure at all,
 * observed live at `2022ispr`, and a schema that throws on it converts
 * TBA's honest answer into an aborted ingest run.
 */
export const tbaAllianceResponseSchema = z.array(tbaAllianceEntrySchema).nullable();
export type TbaAllianceResponse = z.infer<typeof tbaAllianceResponseSchema>;
