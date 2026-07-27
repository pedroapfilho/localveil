import type { Bbox, PositionedWord } from "./types.ts";

type WordInput = { bbox: Bbox; text: string };

type WordIndex = { text: string; words: Array<PositionedWord> };

const buildWordIndex = (words: Array<WordInput>, joiner = " "): WordIndex => {
  const positioned: Array<PositionedWord> = [];
  let cursor = 0;

  for (const word of words) {
    const charStart = cursor;
    const charEnd = charStart + word.text.length;

    positioned.push({ bbox: word.bbox, charEnd, charStart, text: word.text });
    cursor = charEnd + joiner.length;
  }

  return { text: words.map((word) => word.text).join(joiner), words: positioned };
};

export { buildWordIndex };
export type { WordIndex, WordInput };
