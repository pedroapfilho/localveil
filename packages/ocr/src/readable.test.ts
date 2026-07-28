import { describe, expect, it } from "vitest";

import { droppedAnyWords, LEGIBLE_WORD, legibleWords } from "./readable.ts";
import type { Recognition } from "./recognize.ts";

const BOX = { x0: 0, x1: 10, y0: 0, y1: 10 };

const reading = (...confidences: Array<number>): Recognition => ({
  // The page average, which is the number that used to decide everything and now
  // decides nothing.
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

  // The whole point. A Brazilian driving licence recognised 244 words: 56 above 90,
  // and enough junk from the guilloche background to average the page down to 46. The
  // old page-average floor threw all 244 away.
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

describe("droppedAnyWords", () => {
  it("says nothing was dropped when every word cleared the floor", () => {
    expect(droppedAnyWords(reading(95, 88, 74))).toBe(false);
  });

  it("says so when even one word was too rough to trust", () => {
    expect(droppedAnyWords(reading(95, 88, 12))).toBe(true);
  });

  it("says nothing was dropped from a page that had no words to drop", () => {
    expect(droppedAnyWords(reading())).toBe(false);
  });
});
