/**
 * pickRobotPhotoUrl tests (D-03, TEAM-02, threat T-06-04, plan 06-03 Task
 * 2), from real-shaped TBA media fixtures per the OpenAPI `Media_Base`
 * schema.
 */
import { describe, expect, it } from "vitest";
import { PHOTO_MEDIA_TYPES, pickRobotPhotoUrl } from "./media.js";
import type { TbaMedia } from "./schemas.js";

function media(overrides: Partial<TbaMedia> = {}): TbaMedia {
  return {
    type: "imgur",
    foreign_key: "1kDEW6V",
    team_keys: ["frc254"],
    direct_url: "https://i.imgur.com/1kDEW6V.jpeg",
    ...overrides,
  };
}

describe("PHOTO_MEDIA_TYPES", () => {
  it("contains exactly imgur, cdphotothread, instagram-image", () => {
    expect(PHOTO_MEDIA_TYPES).toEqual(["imgur", "cdphotothread", "instagram-image"]);
    expect(PHOTO_MEDIA_TYPES).toHaveLength(3);
  });
});

describe("pickRobotPhotoUrl", () => {
  it("returns the preferred imgur among three candidates", () => {
    const candidates: TbaMedia[] = [
      media({ direct_url: "https://i.imgur.com/first.jpeg", preferred: undefined }),
      media({ direct_url: "https://i.imgur.com/second.jpeg", preferred: true }),
      media({ direct_url: "https://i.imgur.com/third.jpeg", preferred: false }),
    ];

    const result = pickRobotPhotoUrl(candidates);
    expect(result).toEqual({ imageUrl: "https://i.imgur.com/second.jpeg", mediaType: "imgur" });
  });

  it("returns the first survivor when no preferred flag is anywhere", () => {
    const candidates: TbaMedia[] = [
      media({ direct_url: "https://i.imgur.com/first.jpeg" }),
      media({ direct_url: "https://i.imgur.com/second.jpeg" }),
    ];

    const result = pickRobotPhotoUrl(candidates);
    expect(result).toEqual({ imageUrl: "https://i.imgur.com/first.jpeg", mediaType: "imgur" });
  });

  it("returns null for an array containing only avatar and youtube-channel entries", () => {
    const candidates: TbaMedia[] = [
      media({ type: "avatar", direct_url: undefined }),
      media({ type: "youtube-channel", direct_url: undefined, foreign_key: "FRC254" }),
    ];

    expect(pickRobotPhotoUrl(candidates)).toBeNull();
  });

  it("skips an imgur entry with direct_url absent, next candidate wins", () => {
    const candidates: TbaMedia[] = [
      media({ direct_url: undefined }),
      media({ direct_url: "https://i.imgur.com/valid.jpeg" }),
    ];

    const result = pickRobotPhotoUrl(candidates);
    expect(result).toEqual({ imageUrl: "https://i.imgur.com/valid.jpeg", mediaType: "imgur" });
  });

  it("ignores an entry with an unknown future type string, no throw", () => {
    const candidates: TbaMedia[] = [
      media({ type: "some-new-tba-type-2027", direct_url: "https://example.com/new.jpeg" }),
    ];

    expect(() => pickRobotPhotoUrl(candidates)).not.toThrow();
    expect(pickRobotPhotoUrl(candidates)).toBeNull();
  });

  it("skips an entry whose direct_url uses a non-https scheme", () => {
    const candidates: TbaMedia[] = [media({ direct_url: "http://i.imgur.com/insecure.jpeg" })];

    expect(pickRobotPhotoUrl(candidates)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(pickRobotPhotoUrl([])).toBeNull();
  });

  it("never selects an avatar entry — mediaType is never 'avatar' for a mixed array", () => {
    const candidates: TbaMedia[] = [
      media({ type: "avatar", direct_url: undefined, preferred: true }),
      media({ type: "imgur", direct_url: "https://i.imgur.com/robot.jpeg" }),
    ];

    const result = pickRobotPhotoUrl(candidates);
    expect(result).not.toBeNull();
    expect(result?.mediaType).not.toBe("avatar");
    expect(result?.mediaType).toBe("imgur");
  });

  it("cdphotothread and instagram-image are both selectable", () => {
    expect(
      pickRobotPhotoUrl([media({ type: "cdphotothread", direct_url: "https://www.chiefdelphi.com/photo.jpg" })])
    ).toEqual({ imageUrl: "https://www.chiefdelphi.com/photo.jpg", mediaType: "cdphotothread" });

    expect(
      pickRobotPhotoUrl([media({ type: "instagram-image", direct_url: "https://instagram.com/p/abc.jpg" })])
    ).toEqual({ imageUrl: "https://instagram.com/p/abc.jpg", mediaType: "instagram-image" });
  });
});
