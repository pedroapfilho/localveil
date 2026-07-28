import { describe, expect, it } from "vitest";

import { LEGIBLE_WORD, legibleWords, muchWasUnreadable } from "./readable.ts";
import type { Recognition } from "./recognize.ts";

const BOX = { x0: 0, x1: 10, y0: 0, y1: 10 };

const reading = (...confidences: Array<number>): Recognition => ({
  confidence: confidences.reduce((sum, value) => sum + value, 0) / (confidences.length || 1),
  words: confidences.map((confidence, index) => ({
    bbox: BOX,
    confidence,
    text: `word${index}`,
  })),
});

const kept = (...confidences: Array<number>) =>
  legibleWords(reading(...confidences)).map((word) => word.text);

describe("legibleWords", () => {
  it("keeps a word the recogniser was sure of", () => {
    expect(kept(95)).toEqual(["word0"]);
  });

  it("drops a word it was guessing at", () => {
    expect(kept(12)).toEqual([]);
  });

  it("keeps a word exactly on the floor", () => {
    expect(kept(LEGIBLE_WORD)).toEqual(["word0"]);
  });

  it("drops the word one point below it", () => {
    expect(kept(LEGIBLE_WORD - 1)).toEqual([]);
  });

  // A driving licence recognised 244 words, 56 of them above 90, and still averaged
  // 46. The old page-average floor threw all 244 away.
  it("keeps the readable half of a page the average would have condemned", () => {
    const page = reading(95, 92, 91, 4, 7, 11, 3, 9);

    expect(page.confidence).toBeLessThan(50);
    expect(legibleWords(page).length).toBe(3);
  });

  // What the old floor existed for: fonts that did not resolve, recognised as
  // gibberish, then tagged by the model as one long name and painted over end to end.
  it("keeps nothing at all from a page of tofu", () => {
    expect(legibleWords(reading(21, 8, 14, 30, 19))).toEqual([]);
  });

  it("hands back plain words, without the score they were judged on", () => {
    expect(legibleWords(reading(95))).toEqual([{ bbox: BOX, text: "word0" }]);
  });

  it("takes a floor of its own when a caller has a reason to differ", () => {
    expect(legibleWords(reading(40), 30).length).toBe(1);
  });

  it("finds nothing to keep in a page with no words", () => {
    expect(legibleWords(reading())).toEqual([]);
  });
});

describe("muchWasUnreadable", () => {
  it("stays quiet when every word cleared the floor", () => {
    expect(muchWasUnreadable(reading(95, 88, 74))).toBe(false);
  });

  // Every real scan has a stray mark under the floor.
  it("stays quiet about the odd word it could not make out", () => {
    expect(muchWasUnreadable(reading(95, 92, 88, 91, 90, 87, 94, 12))).toBe(false);
  });

  it("speaks up when a quarter of the page was beyond it", () => {
    expect(muchWasUnreadable(reading(95, 92, 12, 8))).toBe(true);
  });

  // The measured shape of a driving licence: mostly background, fields in a minority.
  it("speaks up about a page that was mostly background", () => {
    expect(muchWasUnreadable(reading(95, 91, 4, 7, 11, 3, 9, 14))).toBe(true);
  });

  it("stays quiet about a page that had no words to lose", () => {
    expect(muchWasUnreadable(reading())).toBe(false);
  });
});
