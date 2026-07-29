import type { SourceWord } from "./split-words.ts";

type WordChunk = { end: number; start: number; words: Array<SourceWord> };

// Chunked by words rather than characters because the model's context is a word
// count; a character budget can silently overshoot it on short-word text, and
// whatever falls off the end is PII nobody scanned.
const chunkWords = (words: Array<SourceWord>, size: number, overlap: number): Array<WordChunk> => {
  if (overlap >= size) {
    throw new RangeError(
      `chunk overlap (${String(overlap)}) must be smaller than size (${String(size)})`,
    );
  }

  if (words.length === 0) {
    return [];
  }

  const stride = size - overlap;
  const chunks: Array<WordChunk> = [];

  for (let at = 0; at < words.length; at += stride) {
    const slice = words.slice(at, at + size);
    const last = slice.at(-1) ?? slice[0];

    chunks.push({ end: last.end, start: slice[0].start, words: slice });

    if (at + size >= words.length) {
      break;
    }
  }

  return chunks;
};

export { chunkWords };
export type { WordChunk };
