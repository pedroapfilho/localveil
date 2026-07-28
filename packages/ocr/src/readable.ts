import type { WordInput } from "@repo/redact-core";

import type { Recognition } from "./recognize.ts";

// This used to be a page-average threshold that vetoed the whole page, and it threw
// away real documents. Measured on a Brazilian driving licence: Tesseract found 244
// words, 56 of them above 90, and still reported a page average of 46, because the
// guilloche background produces a second population of junk readings sitting near
// zero. The mean of two populations describes neither, and one number under the line
// meant nothing on that page was ever looked at.
//
// So the score is read per word instead. On a clean page almost everything clears the
// floor and nothing changes. On a noisy one the fields survive and the background does
// not. A page of .notdef boxes, which is what the old floor was added for, still comes
// back untouched: every word on it scores low, so nothing survives to be searched.
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

// Whether the reader should be told some of the page was too rough to read. Separate
// from the filtering above on purpose: dropping a word changes what gets redacted,
// saying so changes what the reader trusts, and those are different decisions.
const droppedAnyWords = (reading: Recognition, floor: number = LEGIBLE_WORD) =>
  legibleWords(reading, floor).length < reading.words.length;

export { droppedAnyWords, LEGIBLE_WORD, legibleWords };
