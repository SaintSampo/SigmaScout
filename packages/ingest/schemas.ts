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
