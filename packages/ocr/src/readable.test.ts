import { describe, expect, it } from "vitest";

import { assessReading } from "./readable";
import type { Recognition } from "./recognize";

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
  assessReading(reading(...confidences)).legible.map((word) => word.text);

describe("legible words", () => {
  it("keeps the words at or above the floor", () => {
    expect(kept(95, 60, 59, 12)).toEqual(["word0", "word1"]);
  });

  it("drops every word when none reaches the floor", () => {
    expect(kept(21, 8, 14, 30, 19)).toEqual([]);
  });

  it("carries the box and the text through, without the confidence", () => {
    expect(assessReading(reading(95)).legible).toEqual([{ bbox: BOX, text: "word0" }]);
  });

  it("returns nothing for a page with no words", () => {
    expect(kept()).toEqual([]);
  });
});

describe("the unreadable verdict", () => {
  it("calls a mostly legible page readable", () => {
    expect(assessReading(reading(95, 88, 74)).unreadable).toBe(false);
  });

  it("allows one bad word in eight", () => {
    expect(assessReading(reading(95, 92, 88, 91, 90, 87, 94, 12)).unreadable).toBe(false);
  });

  it("calls a page with half its words unreadable gibberish", () => {
    expect(assessReading(reading(95, 92, 12, 8)).unreadable).toBe(true);
  });

  it("calls a page with six bad words in eight gibberish", () => {
    expect(assessReading(reading(95, 91, 4, 7, 11, 3, 9, 14)).unreadable).toBe(true);
  });

  it("calls an empty page readable rather than gibberish", () => {
    expect(assessReading(reading()).unreadable).toBe(false);
  });

  it("holds at exactly a quarter unreadable and tips one word later", () => {
    expect(assessReading(reading(95, 92, 88, 12)).unreadable).toBe(false);
    expect(assessReading(reading(95, 92, 88, 12, 11)).unreadable).toBe(true);
  });

  it("decides the kept words and the verdict in the same pass", () => {
    const assessed = assessReading(reading(95, 92, 12, 8));

    expect(assessed.legible).toHaveLength(2);
    expect(assessed.unreadable).toBe(true);
  });
});
