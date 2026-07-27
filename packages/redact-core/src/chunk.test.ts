import { describe, expect, it } from "vitest";

import { chunkText } from "./chunk.ts";

describe("chunkText", () => {
  it("returns a single chunk at offset 0 when the text fits", () => {
    expect(chunkText("hello", 4000, 200)).toEqual([{ offset: 0, text: "hello" }]);
  });

  it("returns an empty array for empty text", () => {
    expect(chunkText("", 4000, 200)).toEqual([]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(25);
    const chunks = chunkText(text, 10, 3);

    expect(chunks).toEqual([
      { offset: 0, text: "a".repeat(10) },
      { offset: 7, text: "a".repeat(10) },
      { offset: 14, text: "a".repeat(10) },
      { offset: 21, text: "a".repeat(4) },
    ]);
  });

  it("every chunk's text equals the source sliced at its own offset", () => {
    const text = Array.from({ length: 500 }, (_, index) => `word${index} `).join("");
    const chunks = chunkText(text, 120, 20);

    for (const chunk of chunks) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });

  it("covers the whole text with no gaps between consecutive chunks", () => {
    const text = "b".repeat(97);
    const chunks = chunkText(text, 20, 5);
    const last = chunks.at(-1);

    expect(last).toBeDefined();
    expect((last?.offset ?? 0) + (last?.text.length ?? 0)).toBe(text.length);

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1];
      const current = chunks[index];

      expect(current?.offset).toBeLessThan((previous?.offset ?? 0) + (previous?.text.length ?? 0));
    }
  });

  it("rejects an overlap that is not smaller than the chunk size", () => {
    expect(() => chunkText("abc", 10, 10)).toThrow(/overlap/v);
  });
});
