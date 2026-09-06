/**
 * The shared "Video" cell for both match tables (quick task 260906-7eu Task
 * 2) — one implementation, two surfaces, the same rule `BonusRpDots.tsx`
 * already follows. Placed at the top level of `components/` (not under
 * `event/` or `team/`) precisely because both `event/EventMatchTable.tsx`
 * and `team/MatchTable.tsx` import it.
 */
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { parseMatchVideoKey, youTubeEmbedUrl } from "../lib/matchVideo.js";

export interface MatchVideoCellProps {
  /** The match's opaque key — used only to derive a stable per-row `data-testid`, never displayed. */
  matchKey: string;
  /** The match's human label (e.g. "Qual 12"), reused for the trigger's accessible name and the dialog's title. */
  matchLabel: string;
  /** The raw, unparsed video key `EventMatchSchema.video`/`TeamSeasonMatchSchema.video` carried, or absent for a match with no published video. */
  videoKey?: string;
}

/**
 * Renders NOTHING — not a dash, not a placeholder glyph, not a non-breaking
 * space — when `videoKey` is absent or does not parse (T-7eu-01: an
 * unparseable key is treated identically to a missing one, never passed
 * through to the iframe `src`). Most rows have no video; a per-row glyph on
 * all of them would be noise charged to every reader for the benefit of a
 * few.
 *
 * When the key parses, renders a single button that opens an in-site player
 * over the page. `DialogContent` mounts only while the dialog is open —
 * Radix's own structural laziness, not a `loading` attribute — which is what
 * keeps an 80-row event page at zero iframes until a reader activates one
 * (T-7eu-04). Do NOT pass `forceMount` to `DialogPortal` or `DialogContent`:
 * that would silently defeat this entire requirement.
 */
export function MatchVideoCell({ matchKey, matchLabel, videoKey }: MatchVideoCellProps) {
  const parsed = parseMatchVideoKey(videoKey);
  if (parsed === undefined) return null;

  const accessibleName = `Watch video: ${matchLabel}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="match-video-trigger"
          aria-label={accessibleName}
          data-testid={`match-video-trigger-${matchKey}`}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
          </svg>
        </button>
      </DialogTrigger>
      <DialogContent className="match-video-dialog" data-testid={`match-video-dialog-${matchKey}`}>
        <DialogTitle>{matchLabel}</DialogTitle>
        <div className="match-video-frame">
          <iframe
            title={accessibleName}
            src={youTubeEmbedUrl(parsed)}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
