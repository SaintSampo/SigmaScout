/**
 * Zod schemas for the TBA v3 event and match shapes the corpus needs.
 * Parsed at the fetch boundary; a parse failure throws — per the project's
 * failure log, a loud failure on TBA drift is the point, never a silently
 * coerced default.
 */
import { z } from "zod";

/** `GET /status` — datafeed health, checked once at the start of a backfill run. */
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
  // `nullish` (not required), for the same reason tbaEventSchema's
  // week/country/state_prov are: TBA legitimately reports null for some
  // teams, so this describes TBA's real contract rather than coercing a
  // value that isn't there.
  rookie_year: z.number().int().nullish(),
});
export type TbaTeam = z.infer<typeof tbaTeamSchema>;
export const tbaTeamListSchema = z.array(tbaTeamSchema);

/** TBA's district assignment for an event — absent on non-district events. */
const tbaDistrictSchema = z.object({
  abbreviation: z.string(),
  display_name: z.string(),
  key: z.string(),
  year: z.number(),
});

export const tbaEventSchema = z.object({
  key: z.string(),
  // `name` is present on every TBA event — required, not nullish, so a
  // missing one is real drift and throws per this file's header policy,
  // rather than silently degrading the events page's search and display.
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

/**
 * `GET /match/{key}` and list-endpoint element's `videos[]` entry. `type` is
 * modelled as a plain `z.string()`, not an enum, for the identical reason
 * `tbaMediaSchema.type` above already gives: TBA publishes `type` values of
 * `youtube` and `tba`, and only the `youtube` variant is embeddable by this
 * pipeline, but an unknown future type string must degrade to "not
 * selected" in `normalize.ts`'s picker, never to a parse failure that
 * aborts an ingest run.
 */
const tbaMatchVideoSchema = z.object({
  type: z.string(),
  key: z.string(),
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
  // Store verbatim, normalize only totals/winner/RP here.
  score_breakdown: z.unknown(),
  // `.nullish()`, never required: many recorded responses omit this key
  // entirely, and this file's header policy makes a required key a
  // run-aborting parse failure on every one of them.
  videos: z.array(tbaMatchVideoSchema).nullish(),
});
export type TbaMatch = z.infer<typeof tbaMatchSchema>;

export const tbaMatchListSchema = z.array(tbaMatchSchema);

/**
 * `GET /team/{key}/media/{year}` element. Per TBA's own OpenAPI spec only
 * `type`, `foreign_key` and `team_keys` are required — `preferred`,
 * `direct_url` and `view_url` are all optional, and the `avatar` variant
 * carries an inline base64 image under `details` instead of a URL. `type`
 * is modelled as a plain `z.string()`, not an enum: an unknown future type
 * must degrade to "not allowlisted" in `media.ts`'s picker, never to a
 * parse failure that aborts an ingest run. Every other field is passed
 * through loosely — this schema exists to validate shape, not to constrain
 * TBA's evolving vocabulary.
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
 * `GET /event/{key}/rankings` element. Field set confirmed live across
 * real events spanning 2022-2026. `qual_average`/`sort_orders`/
 * `extra_stats` are `.nullable()` because TBA has observed-null
 * `qual_average` in every 2022-2026 sample and `sort_orders`/`extra_stats`
 * genuinely vary by season — this schema models the shape without
 * constraining vocabulary this pipeline does not read.
 *
 * `rank`/`team_key`/`rankings.length` are NOT the only fields read:
 * `record` (TBA's own win/loss/tie tally, which accounts for DQs and
 * surrogate appearances a match-derived count would misreport) and the
 * position-0 entry of `sort_orders` (TBA's ranking-score/RP value) are also
 * read and persisted into `event_rankings`. `sort_orders` stays
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
  // persist into a SQLite INTEGER column.
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
 * all (confirmed live). The top-level `.nullable()` is load-bearing and
 * non-negotiable — without it, a genuine TBA `null` response throws here
 * instead of being handled as a real, distinct answer by `rankings.ts`'s
 * `normalizeEventRankings` and `packages/ingest/cli.ts`'s
 * `ingestSeasonRankingsOnly`.
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
 * `GET /event/{key}/alliances` element — one playoff alliance selection.
 * Field set confirmed live against real events spanning 2022-2026. This is
 * deliberately NOT the module-private `tbaAllianceSchema` above, which
 * models a single MATCH's red or blue roster (`team_keys`/
 * `surrogate_team_keys`/`dq_team_keys`/`score`) — two different TBA
 * concepts share the word "alliance"; this response schema must never be
 * substituted for the per-match one or vice versa.
 *
 * Four fields, four reasons a later reader has no other source for:
 * - `name` is `.nullish()` — not required, not `.optional()` alone, and
 *   never given a `.default()`. Live sampling observed the key ABSENT
 *   entirely at one event, where the alliance object's only keys are
 *   `declines`, `picks` and `status`. `.nullish()` additionally tolerates
 *   an explicit `null` without aborting the run over a purely cosmetic
 *   label. A `.default()` of any kind is forbidden here: it would make an
 *   absence indistinguishable from a value at every layer downstream.
 * - `picks` has NO `.min(1)`. A live backfill found an offseason event
 *   with 8 declared alliance slots, the last two with `picks: []` — a real
 *   TBA shape, not drift, so the parse boundary must admit it.
 *   `packages/corpus/db.ts`'s `event_alliances` contract still forbids a
 *   row with an empty picks array; keeping that contract true is now
 *   `normalizeEventAlliances`'s job — it drops zero-pick entries after
 *   assigning seed numbers. The maximum remains deliberately unconstrained:
 *   both 3 and 4 have been observed, and a length ceiling would turn a
 *   future format change into a parse failure over something this pipeline
 *   does not care about.
 * - `status` is `z.unknown().optional()`, the same treatment
 *   `tbaMatchSchema.score_breakdown` gets, plus `.optional()`. Its shape
 *   varies with `playoff_type`, and live full-season ingests have found
 *   real alliance objects carrying no `status` key at all — Zod v4 treats
 *   `z.unknown()` alone as requiring the key to be present (an "unknown"
 *   value is not the same as an absent key), so an un-`.optional()`-ed
 *   schema would throw against real data. Modelling it field-by-field
 *   would make a future playoff format a parse failure; storing it whole
 *   (when present) keeps the provenance without the brittleness, and
 *   `.optional()` makes absence a real, distinct answer rather than a
 *   parse failure, exactly like `name`'s treatment above.
 * - `declines` is required. It is present, as an empty array, on every
 *   sampled event, and `event_alliances.declines` is `NOT NULL` — a
 *   missing key is genuine drift that a NOT NULL column cannot honestly
 *   absorb, and this file's header policy says drift throws.
 */
export const tbaAllianceEntrySchema = z.object({
  declines: z.array(z.string()),
  name: z.string().nullish(),
  picks: z.array(z.string()),
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

/**
 * `GET /districts/{year}` element. Live-probed across several years --
 * `official_advancement_counts` was present for every year checked, but
 * modelled `.nullish()` per this file's honesty rule: an absent value is a
 * real answer ("TBA published no capacity for this district-year"), never
 * a guessed number.
 */
const tbaDistrictAdvancementCountsSchema = z.object({
  cmp: z.number().int().nonnegative(),
  dcmp: z.number().int().nonnegative(),
});

export const tbaDistrictListElementSchema = z.object({
  abbreviation: z.string(),
  display_name: z.string(),
  key: z.string(),
  year: z.number(),
  official_advancement_counts: tbaDistrictAdvancementCountsSchema.nullish(),
});
export type TbaDistrictListElement = z.infer<typeof tbaDistrictListElementSchema>;

/**
 * `GET /districts/{year}` -- the whole response. Modelled `.nullable()`
 * mirroring `tbaEventRankingsResponseSchema`'s / `tbaAllianceResponseSchema`'s
 * precedent — a season with no active districts is a real, honest "nothing
 * to report" answer this pipeline must not throw on.
 */
export const tbaDistrictListSchema = z.array(tbaDistrictListElementSchema).nullable();
export type TbaDistrictListResponse = z.infer<typeof tbaDistrictListSchema>;

/**
 * `GET /district/{districtKey}/rankings` element. Field set confirmed live.
 * `event_points` is deliberately `z.unknown()`: store verbatim, normalize
 * only the summary fields here. The per-component district point model
 * changed across the seasons
 * this corpus ingests (2019-2026) — Task 2's publish layer parses this
 * array's shape with its own season-aware Zod schema rather than this
 * ingest-boundary schema locking down component field names that could
 * drift, and locking them down here would also risk Zod silently stripping
 * an unmodelled field from what is supposed to be a byte-verbatim store.
 */
export const tbaDistrictRankingSchema = z.object({
  team_key: z.string(),
  rank: z.number().int(),
  point_total: z.number(),
  rookie_bonus: z.number(),
  adjustments: z.number(),
  event_points: z.array(z.unknown()),
});
export type TbaDistrictRanking = z.infer<typeof tbaDistrictRankingSchema>;

/**
 * `GET /district/{districtKey}/rankings` -- the whole response. TBA can
 * return a bare `null` body for a district with no rankings computed yet
 * (mirrors `tbaEventRankingsResponseSchema`'s precedent) -- the top-level
 * `.nullable()` is load-bearing and non-negotiable for the same reason.
 */
export const tbaDistrictRankingsResponseSchema = z.array(tbaDistrictRankingSchema).nullable();
export type TbaDistrictRankingsResponse = z.infer<typeof tbaDistrictRankingsResponseSchema>;

/**
 * `GET /district/{districtKey}/events/keys` and `GET /event/{eventKey}/teams/keys`
 * -- both are bare arrays of key strings. Shared schema since both responses
 * have the identical shape: a possibly-null array of strings, mirroring
 * every other TBA response this file models as nullable.
 */
export const tbaKeysResponseSchema = z.array(z.string()).nullable();
export type TbaKeysResponse = z.infer<typeof tbaKeysResponseSchema>;

/**
 * `GET /event/{key}/awards` recipient entry -- `team_key` is `.nullable()`,
 * not required: TBA's own recipient_list shape carries a person-only
 * recipient (a mentor/judge award) as `{ team_key: null, awardee: "Some
 * Person" }`. `awardee` is likewise `.nullable()` for the mirror-image case
 * (a team-only recipient carries no person name). Both being nullable at
 * once is a real, valid TBA shape -- this schema never requires exactly one
 * of the two to be present.
 */
const tbaAwardRecipientSchema = z.object({
  team_key: z.string().nullable(),
  awardee: z.string().nullable(),
});

/**
 * `GET /event/{key}/awards` element. `award_type` is TBA's own enumerated
 * constant (`0`=Chairman's/FIRST Impact, `1`=Winner, `9`=Engineering
 * Inspiration, `10`=Rookie All Star, plus many others this pipeline does
 * not read) -- modelled as a plain `z.number().int()`, never an enum,
 * because this schema must accept every award_type TBA has ever
 * enumerated, not just the four this pipeline's qualification model cares
 * about -- that filter belongs to `districts.ts`'s `normalizeEventAwards`,
 * at the normalize boundary, never at this parse boundary.
 */
export const tbaEventAwardSchema = z.object({
  name: z.string(),
  award_type: z.number().int(),
  event_key: z.string(),
  recipient_list: z.array(tbaAwardRecipientSchema),
  year: z.number(),
});
export type TbaEventAward = z.infer<typeof tbaEventAwardSchema>;

/**
 * `GET /event/{key}/awards` -- the whole response. Modelled `.nullable()`
 * mirroring `tbaEventRankingsResponseSchema`'s / `tbaAllianceResponseSchema`'s
 * precedent above -- an event with no awards structure set up at all is a
 * real, honest "nothing to report" answer this pipeline must not throw on.
 */
export const tbaEventAwardsResponseSchema = z.array(tbaEventAwardSchema).nullable();
export type TbaEventAwardsResponse = z.infer<typeof tbaEventAwardsResponseSchema>;

/**
 * `GET /event/{key}/teams/simple` -- an event's REGISTERED roster. The element
 * is the SAME `tbaTeamSchema` object the full `/teams` shapes use, never a
 * second element schema for the same TBA object: the `/simple` variant returns
 * a SUBSET of that object's keys (`key`, `team_number`, `nickname`, plus a
 * couple this pipeline does not read), and Zod strips the extra keys it does
 * not declare, so one schema describes both variants honestly.
 *
 * `.nullable()`, mirroring `tbaEventAwardsResponseSchema` above -- an event
 * with no roster registered yet is a real "nothing to report" answer the live
 * tick must not throw on.
 */
export const tbaEventTeamsSimpleResponseSchema = z.array(tbaTeamSchema).nullable();
export type TbaEventTeamsSimpleResponse = z.infer<typeof tbaEventTeamsSimpleResponseSchema>;
