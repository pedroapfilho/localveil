import type { WordInput } from "@repo/redact-core";

import type { Recognition } from "./recognize.ts";

const LEGIBLE_WORD = 60;

const legibleWords = ({ words }: Recognition, floor: number = LEGIBLE_WORD): Array<WordInput> => {
  const kept: Array<WordInput> = [];

  for (const { bbox, confidence, text } of words) {
    if (confidence >= floor) {
      kept.push({ bbox, text });
    }
  }

  return kept;
};

const UNREADABLE_SHARE = 0.25;

const muchWasUnreadable = (reading: Recognition, floor: number = LEGIBLE_WORD) => {
  const total = reading.words.length;

  if (total === 0) {
    return false;
  }

  return (total - legibleWords(reading, floor).length) / total > UNREADABLE_SHARE;
};

export { LEGIBLE_WORD, legibleWords, muchWasUnreadable, UNREADABLE_SHARE };
