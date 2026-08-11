import { describe, expect, it } from "vitest";

import { textLayerWords } from "./text-layer.ts";

// pdf.js hands back a page transform that flips the y axis and scales. This is the shape it
// produces for a 200-unit-tall page at scale 2, which is what redact-pdf renders at.
const VIEWPORT = { transform: [2, 0, 0, -2, 0, 400] };

type Placed = { baseline: number; size?: number; str: string; width: number; x: number };

const item = ({ baseline, size = 10, str, width, x }: Placed) => ({
  height: size,
  str,
  transform: [size, 0, 0, size, x, baseline],
  width,
});

const layer = (...items: Array<ReturnType<typeof item>>) =>
  textLayerWords({ items, viewport: VIEWPORT });

describe("textLayerWords", () => {
  it("places a single word where the run sits", () => {
    const [word] = layer(item({ baseline: 100, str: "Ana", width: 30, x: 10 }));

    expect(word.text).toBe("Ana");
    expect(word.bbox.x0).toBeCloseTo(20 - 20, 1);
    expect(word.bbox.y1).toBeCloseTo(200, 1);
  });

  it("splits a run into its words", () => {
    const words = layer(item({ baseline: 100, str: "Ana Lima", width: 80, x: 0 }));

    expect(words.map((entry) => entry.text)).toEqual(["Ana", "Lima"]);
  });

  it("puts the second word to the right of the first", () => {
    const [first, second] = layer(item({ baseline: 100, str: "Ana Lima", width: 80, x: 0 }));

    expect(second.bbox.x0).toBeGreaterThan(first.bbox.x0);
  });

  it("grows each box to absorb proportional-font drift", () => {
    const [tight] = layer(item({ baseline: 100, str: "Ana", width: 30, x: 0 }));
    const per = (30 * 2) / 3;

    expect(tight.bbox.x0).toBeCloseTo(-per, 1);
    expect(tight.bbox.x1).toBeCloseTo(3 * per + per, 1);
  });

  it("gives a box real height from the transform", () => {
    const [word] = layer(item({ baseline: 100, size: 12, str: "Ana", width: 30, x: 0 }));

    expect(word.bbox.y1 - word.bbox.y0).toBeCloseTo(24, 1);
  });

  it("flips the y axis, so a lower baseline is further down the page", () => {
    const [high] = layer(item({ baseline: 150, str: "Ana", width: 30, x: 0 }));
    const [low] = layer(item({ baseline: 50, str: "Ana", width: 30, x: 0 }));

    expect(low.bbox.y1).toBeGreaterThan(high.bbox.y1);
  });

  it("skips a run that is only whitespace", () => {
    expect(layer(item({ baseline: 100, str: "   ", width: 30, x: 0 }))).toEqual([]);
  });

  it("skips an empty run", () => {
    expect(layer(item({ baseline: 100, str: "", width: 0, x: 0 }))).toEqual([]);
  });

  it("ignores an item that is not text", () => {
    expect(textLayerWords({ items: [{ type: "beginMarkedContent" }], viewport: VIEWPORT })).toEqual(
      [],
    );
  });

  it("reads several runs on one page", () => {
    const words = layer(
      item({ baseline: 100, str: "Ana", width: 30, x: 0 }),
      item({ baseline: 100, str: "Lima", width: 40, x: 40 }),
    );

    expect(words.map((entry) => entry.text)).toEqual(["Ana", "Lima"]);
  });

  it("counts a grapheme rather than a code unit when it spaces the glyphs", () => {
    const words = layer(item({ baseline: 100, str: "Ana 👩‍👩‍👧‍👦 Lima", width: 120, x: 0 }));

    expect(words.map((entry) => entry.text)).toEqual(["Ana", "👩‍👩‍👧‍👦", "Lima"]);
  });
});
