import type { Decisions, Detection } from "./types";

const APPLY_SCORE = 0.65;

const defaultDecisions = (detections: ReadonlyArray<Detection>): Decisions => {
  const covered: Array<string> = [];

  for (const detection of detections) {
    if (detection.confidence >= APPLY_SCORE) {
      covered.push(detection.id);
    }
  }

  return { covered };
};

export { APPLY_SCORE, defaultDecisions };
