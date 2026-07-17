// Minimal hash-based router. Hash routing needs no server rewrites, so it works
// as-is on GitHub Pages (a deep link like #/team/2026/1690 always loads index.html).

import { useEffect, useState } from "react";

/** Current hash path as segments, e.g. "#/team/2026/1690" -> ["team","2026","1690"]. */
export function useRoute(): string[] {
  const parse = () =>
    window.location.hash
      .replace(/^#\/?/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);

  const [segments, setSegments] = useState<string[]>(parse);

  useEffect(() => {
    const onChange = () => setSegments(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return segments;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/** Build an href for a hash route (for real anchors, so middle-click/open-in-tab work). */
export const href = (path: string) => `#/${path.replace(/^\/+/, "")}`;
