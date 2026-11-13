import { APPLY_SCORE } from "@repo/redact-core";
import type { Detect } from "@repo/redact-core";

import { MASK } from "./text";
import type { WarningKey } from "./types";

const isMasked = (value: string) => value.replaceAll(MASK, "").trim().length === 0;

/* Detecting again over what stayed visible catches what painting cannot see: a box that landed
   short of a word, or a word written back into a rebuilt text layer beside the box meant to hide
   it. A detector shown masked text can tag a run of blocks as a name, and a span over nothing but
   mask has leaked nothing. */
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

  if (
    spans.some(
      (span) => span.score >= APPLY_SCORE && !isMasked(visible.slice(span.start, span.end)),
    )
  ) {
    verified.push("warning.notFullyRedacted");
  }

  return verified;
};

export { verifyOutput };
