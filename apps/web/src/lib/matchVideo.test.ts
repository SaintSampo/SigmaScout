/**
 * `parseMatchVideoKey`/`youTubeEmbedUrl` coverage (quick task 260906-7eu Task
 * 2, TDD RED). Every bullet in the plan's `<behavior>` block for these two
 * functions, one test each.
 */
import { describe, expect, it } from "vitest";
import { parseMatchVideoKey, youTubeEmbedUrl } from "./matchVideo.js";

describe("parseMatchVideoKey — bare id", () => {
  it("a plain 11-character YouTube id returns that id with no start time", () => {
    const result = parseMatchVideoKey("dQw4w9WgXcQ");
    expect(result).toEqual({ id: "dQw4w9WgXcQ" });
  });

  it("an id with a trailing seconds-style timestamp query suffix returns the bare id plus the start time in whole seconds", () => {
    const result = parseMatchVideoKey("dQw4w9WgXcQ?t=95");
    expect(result).toEqual({ id: "dQw4w9WgXcQ", startSeconds: 95 });
  });

  it("an id with a trailing minute-and-second-style timestamp suffix returns the bare id plus the correctly summed start time in whole seconds", () => {
    const result = parseMatchVideoKey("dQw4w9WgXcQ?t=1m35s");
    expect(result).toEqual({ id: "dQw4w9WgXcQ", startSeconds: 95 });
  });

  it("an id with a trailing &t= timestamp suffix (as if appended to an existing query string) also resolves", () => {
    const result = parseMatchVideoKey("dQw4w9WgXcQ&t=42s");
    expect(result).toEqual({ id: "dQw4w9WgXcQ", startSeconds: 42 });
  });
});

describe("parseMatchVideoKey — URL forms", () => {
  it("a full YouTube watch URL returns the contained id", () => {
    const result = parseMatchVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ id: "dQw4w9WgXcQ" });
  });

  it("a full YouTube watch URL with a timestamp returns the id and the start time", () => {
    const result = parseMatchVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s");
    expect(result).toEqual({ id: "dQw4w9WgXcQ", startSeconds: 95 });
  });

  it("a youtu.be short URL returns the contained id", () => {
    const result = parseMatchVideoKey("https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({ id: "dQw4w9WgXcQ" });
  });

  it("a youtu.be short URL with a timestamp returns the id and the start time", () => {
    const result = parseMatchVideoKey("https://youtu.be/dQw4w9WgXcQ?t=1m35s");
    expect(result).toEqual({ id: "dQw4w9WgXcQ", startSeconds: 95 });
  });

  it("an embed URL returns the contained id", () => {
    const result = parseMatchVideoKey("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(result).toEqual({ id: "dQw4w9WgXcQ" });
  });
});

describe("parseMatchVideoKey — degrades to undefined rather than throwing", () => {
  it("an empty string returns undefined", () => {
    expect(parseMatchVideoKey("")).toBeUndefined();
  });

  it("a whitespace-only string returns undefined", () => {
    expect(parseMatchVideoKey("   ")).toBeUndefined();
  });

  it("undefined input returns undefined", () => {
    expect(parseMatchVideoKey(undefined)).toBeUndefined();
  });

  it("a string whose id portion contains a character outside the YouTube id alphabet returns undefined", () => {
    expect(parseMatchVideoKey("dQw4w9WgX!Q")).toBeUndefined();
  });

  it("a string too short to be a real id returns undefined", () => {
    expect(parseMatchVideoKey("short")).toBeUndefined();
  });

  it("a URL to an unrelated host returns undefined, never falling through to a bare-id interpretation", () => {
    expect(parseMatchVideoKey("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
  });

  it("a string long enough to be an attack payload rather than an id returns undefined", () => {
    const payload = `javascript:alert(1)//${"a".repeat(2000)}`;
    expect(parseMatchVideoKey(payload)).toBeUndefined();
  });
});

describe("youTubeEmbedUrl", () => {
  it("produces a privacy-mode embed origin, the parsed id as the final path segment, and autoplay enabled", () => {
    const url = youTubeEmbedUrl({ id: "dQw4w9WgXcQ" });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.youtube-nocookie.com");
    expect(parsed.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(parsed.searchParams.get("autoplay")).toBe("1");
  });

  it("includes a start parameter only when the parse produced a start time", () => {
    const withStart = new URL(youTubeEmbedUrl({ id: "dQw4w9WgXcQ", startSeconds: 95 }));
    expect(withStart.searchParams.get("start")).toBe("95");

    const withoutStart = new URL(youTubeEmbedUrl({ id: "dQw4w9WgXcQ" }));
    expect(withoutStart.searchParams.has("start")).toBe(false);
  });

  it("the returned string contains the parsed id and never the raw unparsed input", () => {
    const parsed = parseMatchVideoKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s")!;
    const url = youTubeEmbedUrl(parsed);
    expect(url).toContain("dQw4w9WgXcQ");
    expect(url).not.toContain("watch?v=");
  });
});
