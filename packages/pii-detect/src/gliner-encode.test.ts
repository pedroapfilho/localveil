import { describe, expect, it } from "vitest";

import { encodeGlinerInput } from "./gliner-encode.ts";

const FRAME = { cls: 1, sep: 2 };

// The encoder positions the words it keeps, so the fixtures carry offsets rather than bare text.
const at = (...texts: Array<string>) => {
  let start = 0;

  return texts.map((text) => {
    const word = { end: start + text.length, start, text };

    start = word.end + 1;

    return word;
  });
};

const encodeWord = (word: string) => {
  if (word === "<<ENT>>") {
    return [8];
  }

  if (word === "<<SEP>>") {
    return [9];
  }

  // oxlint-disable-next-line typescript/no-misused-spread
  return [...word].map((piece) => piece.codePointAt(0) ?? 0);
};

describe("encodeGlinerInput", () => {
  it("frames the sequence with CLS and SEP around prompt and text", () => {
    const input = encodeGlinerInput({
      encodeWord,
      frame: FRAME,
      maxWidth: 2,
      prompts: ["person"],
      words: at("ab"),
    });

    expect(input.inputIds.at(0)).toBe(1);
    expect(input.inputIds.at(-1)).toBe(2);
    expect(input.attentionMask).toEqual(input.inputIds.map(() => 1));
    expect(input.wordsMask.length).toBe(input.inputIds.length);
  });

  it("masks the prompt to zero and numbers only the first token of each word", () => {
    const input = encodeGlinerInput({
      encodeWord,
      frame: FRAME,
      maxWidth: 2,
      prompts: ["id"],
      words: at("ab", "c"),
    });

    expect(input.wordsMask).toEqual([0, 0, 0, 0, 0, 1, 0, 2, 0]);
  });

  it("keeps the source position of a word that survives an unvoiceable neighbour", () => {
    const input = encodeGlinerInput({
      encodeWord,
      frame: FRAME,
      maxWidth: 2,
      prompts: [],
      words: at("ab", "", "c"),
    });

    expect(input.keptWords).toEqual([
      { end: 2, start: 0, text: "ab" },
      { end: 5, start: 4, text: "c" },
    ]);

    expect(input.wordsMask).toEqual([0, 0, 1, 0, 2, 0]);
  });

  it("builds a span for every width up to the cap and masks those past the end", () => {
    const input = encodeGlinerInput({
      encodeWord,
      frame: FRAME,
      maxWidth: 3,
      prompts: [],
      words: at("a", "b"),
    });

    expect(input.spanIdx).toEqual([0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
    expect(input.spanMask).toEqual([1, 1, 0, 1, 0, 0]);
  });
});
