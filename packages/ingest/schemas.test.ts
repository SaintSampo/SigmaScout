/**
 * tbaTeamSchema / tbaTeamListSchema tests (quick task 260912-7bp T1).
 *
 * The point of these is the `rookie_year` field the schema gained: zod
 * strips unknown keys, so before this task TBA was already sending
 * `rookie_year` on every `/team/{key}` and `/teams/{year}/{page}` element
 * and it was being silently discarded at the parse boundary. A test that
 * asserts the field survives the parse is what keeps that from quietly
 * regressing — a stripped field looks exactly like a field TBA stopped
 * sending.
 */
import { describe, expect, it } from "vitest";
import { tbaTeamListSchema, tbaTeamSchema } from "./schemas.js";

function teamPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "frc254",
    team_number: 254,
    nickname: "The Cheesy Poofs",
    rookie_year: 1999,
    ...overrides,
  };
}

describe("tbaTeamSchema", () => {
  it("parses and RETAINS rookie_year when TBA sends it", () => {
    const parsed = tbaTeamSchema.parse(teamPayload());
    expect(parsed.rookie_year).toBe(1999);
  });

  it("accepts a null rookie_year — TBA genuinely reports null for some teams", () => {
    const parsed = tbaTeamSchema.parse(teamPayload({ rookie_year: null }));
    expect(parsed.rookie_year).toBeNull();
  });

  it("accepts an absent rookie_year without throwing, leaving it undefined", () => {
    const payload = teamPayload();
    delete payload["rookie_year"];
    const parsed = tbaTeamSchema.parse(payload);
    expect(parsed.rookie_year).toBeUndefined();
    expect(parsed.key).toBe("frc254");
  });

  it("throws on a non-integer rookie_year rather than coercing it", () => {
    expect(() => tbaTeamSchema.parse(teamPayload({ rookie_year: 1999.5 }))).toThrow();
    expect(() => tbaTeamSchema.parse(teamPayload({ rookie_year: "1999" }))).toThrow();
  });

  it("still requires key/team_number and still allows a null nickname", () => {
    expect(tbaTeamSchema.parse(teamPayload({ nickname: null })).nickname).toBeNull();
    const missingNumber = teamPayload();
    delete missingNumber["team_number"];
    expect(() => tbaTeamSchema.parse(missingNumber)).toThrow();
  });
});

describe("tbaTeamListSchema", () => {
  it("inherits rookie_year for free — a page of teams keeps each element's value", () => {
    const parsed = tbaTeamListSchema.parse([
      teamPayload(),
      teamPayload({ key: "frc9999", team_number: 9999, rookie_year: null }),
    ]);
    expect(parsed.map((t) => t.rookie_year)).toEqual([1999, null]);
  });
});
