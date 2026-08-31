import { describe, expect, it } from "vitest";

import type { Bbox } from "./types";
import { buildWordIndex } from "./word-index";

const box = (x0: number, y0: number, x1: number, y1: number): Bbox => ({ x0, x1, y0, y1 });

describe("buildWordIndex", () => {
  it("joins words with the joiner and records each word's char range", () => {
    const { text, words } = buildWordIndex([
      { bbox: box(0, 0, 10, 10), text: "Ana" },
      { bbox: box(12, 0, 30, 10), text: "Silva" },
    ]);

    expect(text).toBe("Ana Silva");
    expect(words[0]).toMatchObject({ charEnd: 3, charStart: 0, text: "Ana" });
    expect(words[1]).toMatchObject({ charEnd: 9, charStart: 4, text: "Silva" });
  });

  it("honours an empty joiner so ranges are contiguous", () => {
    const { text, words } = buildWordIndex(
      [
        { bbox: box(0, 0, 5, 10), text: "Ana" },
        { bbox: box(5, 0, 10, 10), text: "Silva" },
      ],
      "",
    );

    expect(text).toBe("AnaSilva");
    expect(words[1]).toMatchObject({ charEnd: 8, charStart: 3 });
  });

  it("returns empty text and no words for no input", () => {
    expect(buildWordIndex([])).toEqual({ text: "", words: [] });
  });
});
