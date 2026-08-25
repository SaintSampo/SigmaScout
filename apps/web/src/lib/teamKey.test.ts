import { describe, expect, it } from "vitest";
import { InvalidTeamKeyError, TEAM_KEY_PREFIX, teamNumberFromKey, toTeamKey } from "./teamKey.js";

describe("teamKey", () => {
  it("TEAM_KEY_PREFIX is the corpus's own frc convention", () => {
    expect(TEAM_KEY_PREFIX).toBe("frc");
  });

  it("toTeamKey(1114) === 'frc1114'", () => {
    expect(toTeamKey(1114)).toBe("frc1114");
  });

  it("teamNumberFromKey('frc1114') === 1114", () => {
    expect(teamNumberFromKey("frc1114")).toBe(1114);
  });

  it("teamNumberFromKey('1114') throws InvalidTeamKeyError — the raw route param is never a valid team key", () => {
    expect(() => teamNumberFromKey("1114")).toThrow(InvalidTeamKeyError);
  });

  it("teamNumberFromKey rejects a malformed prefix", () => {
    expect(() => teamNumberFromKey("frc")).toThrow(InvalidTeamKeyError);
    expect(() => teamNumberFromKey("FRC1114")).toThrow(InvalidTeamKeyError);
    expect(() => teamNumberFromKey("frc1114x")).toThrow(InvalidTeamKeyError);
  });

  it("round-trips through both directions", () => {
    expect(teamNumberFromKey(toTeamKey(254))).toBe(254);
  });
});
