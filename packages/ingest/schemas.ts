/**
 * Zod schemas for the TBA v3 event and match shapes the corpus needs
 * (DATA-01/DATA-02). Parsed at the fetch boundary; a parse failure throws —
 * per the project's failure log, a loud failure on TBA drift is the point,
 * never a silently coerced default.
 */
import { z } from "zod";

export const tbaEventSchema = z.object({
  key: z.string(),
  year: z.number(),
  event_type: z.number(),
  start_date: z.string(),
});
export type TbaEvent = z.infer<typeof tbaEventSchema>;

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
