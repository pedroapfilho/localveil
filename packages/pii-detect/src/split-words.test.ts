import { describe, expect, it } from "vitest";

import { splitWords } from "./split-words";

describe("splitWords", () => {
  it("keeps an accented name as one word", () => {
    expect(splitWords("JOSÉ 123")).toEqual([
      { end: 4, start: 0, text: "JOSÉ" },
      { end: 8, start: 5, text: "123" },
    ]);
  });

  it("keeps hyphenated compounds together", () => {
    expect(splitWords("guarda-chuva novo").at(0)).toEqual({
      end: 12,
      start: 0,
      text: "guarda-chuva",
    });
  });

  it("splits trailing punctuation into its own word", () => {
    expect(splitWords("Silva,").map((word) => word.text)).toEqual(["Silva", ","]);
  });

  it("finds nothing in whitespace", () => {
    expect(splitWords("  \n\t")).toEqual([]);
  });
});
