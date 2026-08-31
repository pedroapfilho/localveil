import { describe, expect, it } from "vitest";

import { isCovered } from "./covered";

const box = { x0: 10, x1: 20, y0: 10, y1: 20 };

const rect = (x: number, y: number, width = 10, height = 10) => ({ height, width, x, y });

describe("isCovered", () => {
  it("reports a word sitting under the rect", () => {
    expect(isCovered(box, [rect(10, 10)])).toBe(true);
  });

  it("reports a word the rect only clips", () => {
    expect(isCovered(box, [rect(18, 18)])).toBe(true);
  });

  it("leaves a word beside the rect alone", () => {
    expect(isCovered(box, [rect(30, 10)])).toBe(false);
  });

  it("leaves a word above the rect alone", () => {
    expect(isCovered(box, [rect(10, 30)])).toBe(false);
  });

  it("treats touching edges as clear", () => {
    expect(isCovered(box, [rect(20, 10)])).toBe(false);
    expect(isCovered(box, [rect(10, 20)])).toBe(false);
  });

  it("checks every rect, not just the first", () => {
    expect(isCovered(box, [rect(100, 100), rect(12, 12)])).toBe(true);
  });

  it("leaves everything alone when nothing was redacted", () => {
    expect(isCovered(box, [])).toBe(false);
  });
});
