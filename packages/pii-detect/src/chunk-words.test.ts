import { describe, expect, it } from "vitest";

import { chunkWords } from "./chunk-words.ts";
import { splitWords } from "./split-words.ts";

describe("chunkWords", () => {
  it("covers every word once with no overlap", () => {
    const chunks = chunkWords(splitWords("aa bb cc dd ee"), 2, 0);

    expect(chunks.map((chunk) => chunk.words.map((word) => word.text))).toEqual([
      ["aa", "bb"],
      ["cc", "dd"],
      ["ee"],
    ]);
    expect(chunks.at(1)).toMatchObject({ end: 11, start: 6 });
  });

  it("repeats the tail of each chunk when asked to overlap", () => {
    const chunks = chunkWords(splitWords("aa bb cc dd"), 3, 1);

    expect(chunks.map((chunk) => chunk.words.map((word) => word.text))).toEqual([
      ["aa", "bb", "cc"],
      ["cc", "dd"],
    ]);
  });

  it("returns nothing for no words", () => {
    expect(chunkWords([], 3, 1)).toEqual([]);
  });

  it("refuses an overlap as large as the chunk", () => {
    expect(() => chunkWords(splitWords("aa"), 2, 2)).toThrow(/smaller/v);
  });
});
