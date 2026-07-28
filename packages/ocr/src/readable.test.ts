import { describe, expect, it } from "vitest";

import { GOOD, LEGIBLE, readabilityOf } from "./readable.ts";
import type { Recognition } from "./recognize.ts";

const BOX = { x0: 0, x1: 10, y0: 0, y1: 10 };

const reading = (confidence: number, count = 3): Recognition => ({
  confidence,
  words: Array.from({ length: count }, (_word, index) => ({ bbox: BOX, text: `word${index}` })),
});

describe("readabilityOf", () => {
  it("calls a page with no words unreadable, however confident the recogniser was", () => {
    expect(readabilityOf({ confidence: 99, words: [] })).toBe("unreadable");
  });

  it("calls a page below the legible floor unreadable", () => {
    expect(readabilityOf(reading(LEGIBLE - 1))).toBe("unreadable");
  });

  // The page that prompted the floor: fonts that did not resolve, recognised as
  // "sn ssss inan fs n inn", and tagged by the model as one person's name.
  it("calls the tofu page that started this unreadable", () => {
    expect(readabilityOf(reading(28))).toBe("unreadable");
  });

  it("calls a page exactly on the legible floor shaky rather than unreadable", () => {
    expect(readabilityOf(reading(LEGIBLE))).toBe("shaky");
  });

  it("calls a page between the two floors shaky", () => {
    expect(readabilityOf(reading((LEGIBLE + GOOD) / 2))).toBe("shaky");
  });

  it("calls a page exactly on the good floor good", () => {
    expect(readabilityOf(reading(GOOD))).toBe("good");
  });

  it("calls a confident page good", () => {
    expect(readabilityOf(reading(95))).toBe("good");
  });

  it("keeps the floors in order, so no reading can be both", () => {
    expect(LEGIBLE).toBeLessThan(GOOD);
  });
});
