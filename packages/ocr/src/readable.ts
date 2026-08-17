import type { WordInput } from "@repo/redact-core";

import type { Recognition } from "./recognize.ts";

const LEGIBLE_WORD = 60;

// Above this share of unreadable words a page is treated as gibberish rather than text. A page
// whose fonts do not resolve renders as a wall of boxes, and a detection model will confidently
// tag a long run of that as somebody's name.
const UNREADABLE_SHARE = 0.25;

type Readability = { legible: Array<WordInput>; unreadable: boolean };

/**
 * One pass, one answer. The words that are kept and the verdict on the page have to agree, so
 * they are derived together from the same floor rather than recomputed by separate callers.
 */
const assessReading = ({ words }: Recognition): Readability => {
  const legible: Array<WordInput> = [];

  for (const { bbox, confidence, text } of words) {
    if (confidence >= LEGIBLE_WORD) {
      legible.push({ bbox, text });
    }
  }

  return {
    legible,
    unreadable:
      words.length > 0 && (words.length - legible.length) / words.length > UNREADABLE_SHARE,
  };
};

export { assessReading, LEGIBLE_WORD, UNREADABLE_SHARE };
export type { Readability };
