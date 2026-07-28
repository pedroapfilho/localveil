import type { WordInput } from "@repo/redact-core";

import type { Recognition } from "./recognize.ts";

// Per word, because a page average is a mean over two populations on anything
// security-printed. Measured on a driving licence: 244 words, 56 of them above 90, and
// a page average of 46 that vetoed all of it. A page of .notdef boxes still comes back
// untouched, since every word on one scores low and nothing survives the floor.
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

// A share rather than a count: every real scan has a stray mark under the floor, so
// warning on one warned on everything. Measured: a clean page dropped 0 of 39 words, a
// driving licence 65% of 244.
const UNREADABLE_SHARE = 0.25;

const muchWasUnreadable = (reading: Recognition, floor: number = LEGIBLE_WORD) => {
  const total = reading.words.length;

  if (total === 0) {
    return false;
  }

  return (total - legibleWords(reading, floor).length) / total > UNREADABLE_SHARE;
};

export { LEGIBLE_WORD, legibleWords, muchWasUnreadable, UNREADABLE_SHARE };
