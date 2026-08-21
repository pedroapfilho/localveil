import { describe, expect, it } from "vitest";

import { inReadingOrder } from "./reading-order.ts";
import type { WordInput } from "./word-index.ts";

const LINE = 20;

const word = (text: string, x0: number, x1: number, y0: number): WordInput => ({
  bbox: { x0, x1, y0, y1: y0 + LINE },
  text,
});

const read = (words: Array<WordInput>) =>
  inReadingOrder(words)
    .map((entry) => entry.text)
    .join(" ");

describe("inReadingOrder", () => {
  it("leaves a line that is already in order alone", () => {
    const line = [word("Invoice", 0, 50, 0), word("for", 60, 110, 0), word("Ana", 120, 170, 0)];

    expect(read(line)).toBe("Invoice for Ana");
  });

  it("reads top to bottom when the layer hands the lines back shuffled", () => {
    const lines = [word("third", 0, 60, 60), word("first", 0, 60, 0), word("second", 0, 60, 30)];

    expect(read(lines)).toBe("first second third");
  });

  it("keeps a stacked paragraph in one piece", () => {
    const paragraph = [
      word("one", 0, 40, 0),
      word("two", 50, 90, 0),
      word("three", 0, 40, 30),
      word("four", 50, 90, 30),
    ];

    expect(read(paragraph)).toBe("one two three four");
  });

  it("keeps a value with its caption instead of the column beside it", () => {
    const signature = [
      word("Name", 100, 150, 130),
      word("of", 155, 175, 130),
      word("Recipient", 180, 260, 130),
      word("ACME", 300, 400, 80),
      word("HOLDINGS", 300, 420, 100),
      word("Pedro", 100, 160, 100),
      word("Filho", 165, 225, 100),
    ];

    expect(read(signature)).toBe("ACME HOLDINGS Pedro Filho Name of Recipient");
  });

  it("splits a line where a wide gap puts two columns side by side", () => {
    const row = [word("Pedro", 100, 160, 0), word("Filho", 165, 225, 0), word("ACME", 300, 400, 0)];

    expect(inReadingOrder(row).map((entry) => entry.text)).toEqual(["Pedro", "Filho", "ACME"]);
  });

  it("carries each word's own box along with it", () => {
    const [first] = inReadingOrder([word("second", 0, 60, 30), word("first", 0, 60, 0)]);

    expect(first).toEqual(word("first", 0, 60, 0));
  });

  it("returns nothing for no words", () => {
    expect(inReadingOrder([])).toEqual([]);
  });
});
