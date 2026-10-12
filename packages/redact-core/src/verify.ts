import { APPLY_SCORE } from "./detections";
import type { Detect, WarningKey } from "./types";

/* Detecting again over what stayed visible catches what painting cannot see: a box that landed
   short of a word, or a word written back into a rebuilt text layer beside the box meant to hide
   it. */
const verifyOutput = async (
  visible: string,
  detect: Detect,
  warnings: Iterable<WarningKey>,
): Promise<Array<WarningKey>> => {
  const verified = [...warnings];

  if (visible.trim().length === 0) {
    return verified;
  }

  const spans = await detect(visible);

  if (spans.some((span) => span.score >= APPLY_SCORE)) {
    verified.push("warning.notFullyRedacted");
  }

  return verified;
};

export { verifyOutput };
