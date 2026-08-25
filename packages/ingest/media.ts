/**
 * The robot-photo selection rule (D-03, TEAM-02, threat T-06-04, plan
 * 06-03): turns a heterogeneous TBA `Media` array into a single robot photo
 * URL, or an honest `null` when no usable photo exists (~25% of teams).
 *
 * The order of operations is the load-bearing part:
 *   1. keep only entries whose `type` is in `PHOTO_MEDIA_TYPES`;
 *   2. keep only entries whose `direct_url` is a non-empty `https://` URL;
 *   3. among the survivors, return the first with `preferred === true`,
 *      else the first survivor, preserving TBA's own array order as the
 *      deterministic tie-break;
 *   4. return `null` when nothing survives.
 *
 * Filtering by type BEFORE reading `direct_url` is what stops an `avatar`
 * entry's inline base64 payload, or a social-profile entry with no image at
 * all, from ever being treated as an image source. Requiring the `https://`
 * scheme is what stops a hostile or malformed value from reaching an image
 * source attribute in the browser.
 */
import type { TbaMedia } from "./schemas.js";

export const PHOTO_MEDIA_TYPES = ["imgur", "cdphotothread", "instagram-image"] as const;

function isPhotoBearing(media: TbaMedia): boolean {
  return (PHOTO_MEDIA_TYPES as readonly string[]).includes(media.type);
}

function hasUsableDirectUrl(media: TbaMedia): media is TbaMedia & { direct_url: string } {
  return typeof media.direct_url === "string" && media.direct_url.length > 0 && media.direct_url.startsWith("https://");
}

export function pickRobotPhotoUrl(media: TbaMedia[]): { imageUrl: string; mediaType: string } | null {
  const candidates = media.filter(isPhotoBearing).filter(hasUsableDirectUrl);
  if (candidates.length === 0) return null;

  const preferred = candidates.find((entry) => entry.preferred === true);
  const chosen = preferred ?? candidates[0];
  if (!chosen) return null; // unreachable — candidates.length > 0 guarantees this, kept for exhaustiveness

  return { imageUrl: chosen.direct_url, mediaType: chosen.type };
}
