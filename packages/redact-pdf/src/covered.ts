import type { Bbox, Rect } from "@repo/redact-core";

// Rebuilding the text layer is what keeps the output searchable, so it must not put
// back a word the black box was drawn over. Any overlap at all disqualifies a word:
// a box that clips half a name still means that name was meant to go.
const isCovered = (bbox: Bbox, rects: Array<Rect>) =>
  rects.some(
    (rect) =>
      bbox.x0 < rect.x + rect.width &&
      bbox.x1 > rect.x &&
      bbox.y0 < rect.y + rect.height &&
      bbox.y1 > rect.y,
  );

export { isCovered };
