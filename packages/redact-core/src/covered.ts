import type { Bbox, Rect } from "./types";

const isCovered = (bbox: Bbox, rects: Array<Rect>) =>
  rects.some(
    (rect) =>
      bbox.x0 < rect.x + rect.width &&
      bbox.x1 > rect.x &&
      bbox.y0 < rect.y + rect.height &&
      bbox.y1 > rect.y,
  );

export { isCovered };
