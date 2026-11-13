import { APPLY_SCORE } from "@repo/redact-core";

import type { Decisions, Detection } from "./types";

const defaultDecisions = (detections: ReadonlyArray<Detection>): Decisions => {
  const covered: Array<string> = [];

  for (const detection of detections) {
    if (detection.confidence >= APPLY_SCORE) {
      covered.push(detection.id);
    }
  }

  return { covered };
};

export { defaultDecisions };
