import type { WordInput } from "@repo/redact-core";

import type { Recognition } from "./recognize";

const LEGIBLE_WORD = 60;

const UNREADABLE_SHARE = 0.25;

type Readability = { legible: Array<WordInput>; unreadable: boolean };

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
