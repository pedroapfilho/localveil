import { describe, expect, it, vi } from "vitest";

import { paint, rectsFor, surfaceOf, uncovered } from "./page-surface";
import type { Rect, Span, WordInput } from "./types";

const LINE = 12;

const word = (text: string, x0: number, x1: number, y0 = 0): WordInput => ({
  bbox: { x0, x1, y0, y1: y0 + LINE },
  text,
});

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.99,
  start,
});

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  height,
  width,
  x,
  y,
});

const spanOver = (text: string, target: string) => {
  const start = text.indexOf(target);

  return span(start, start + target.length);
};

const oneLine = surfaceOf([word("Ana", 0, 10), word("Silva", 14, 40), word("mora", 44, 60)]);

const twoLines = surfaceOf([word("Ana", 0, 10), word("Silva", 0, 30, 40)]);

/* Two columns level with each other, the way a signature block sits beside a company block. */
const twoColumns = surfaceOf([
  word("Pedro", 100, 160),
  word("Filho", 165, 225),
  word("ACME", 300, 400),
  word("HOLDINGS", 300, 420, 16),
]);

describe("the text of a surface", () => {
  it("joins the words with a space and records where each one sits in it", () => {
    expect(oneLine.text).toBe("Ana Silva mora");
    expect(oneLine.words.map(({ charEnd, charStart }) => [charStart, charEnd])).toEqual([
      [0, 3],
      [4, 9],
      [10, 14],
    ]);
  });

  it("carries each word's box through", () => {
    expect(oneLine.words[1]?.bbox).toEqual({ x0: 14, x1: 40, y0: 0, y1: 12 });
  });

  it("is empty for no words", () => {
    expect(surfaceOf([])).toEqual({ text: "", words: [] });
  });
});

describe("the rects for spans", () => {
  it("covers a single word", () => {
    expect(rectsFor(oneLine, [span(0, 3)])).toEqual([rect(0, 0, 10, 12)]);
  });

  it("covers two neighbouring words on one line with one rect", () => {
    expect(rectsFor(oneLine, [span(0, 9)])).toEqual([rect(0, 0, 40, 12)]);
  });

  it("splits a span that crosses a line break into one rect per line", () => {
    expect(rectsFor(twoLines, [span(0, 9)])).toEqual([rect(0, 0, 10, 12), rect(0, 40, 30, 12)]);
  });

  it("splits a span the reading order carried across a gutter, so the gap stays unpainted", () => {
    expect(rectsFor(twoColumns, [spanOver(twoColumns.text, "Filho ACME")])).toEqual([
      rect(165, 0, 60, LINE),
      rect(300, 0, 100, LINE),
    ]);
  });

  it("keeps one column's lines apart from the other's", () => {
    expect(rectsFor(twoColumns, [spanOver(twoColumns.text, "Pedro Filho ACME HOLDINGS")])).toEqual([
      rect(100, 0, 125, LINE),
      rect(300, 0, 100, LINE),
      rect(300, 16, 120, LINE),
    ]);
  });

  it("leaves out the words a span does not touch", () => {
    expect(rectsFor(oneLine, [span(4, 9)])).toEqual([rect(14, 0, 26, 12)]);
  });

  it("gives one set of rects per span", () => {
    expect(rectsFor(oneLine, [span(0, 3), span(10, 14)])).toEqual([
      rect(0, 0, 10, 12),
      rect(44, 0, 16, 12),
    ]);
  });

  it("gives nothing for a span that lands on no word", () => {
    expect(rectsFor(oneLine, [span(200, 210)])).toEqual([]);
  });

  it("gives nothing for no spans or no words", () => {
    expect(rectsFor(oneLine, [])).toEqual([]);
    expect(rectsFor(surfaceOf([]), [span(0, 3)])).toEqual([]);
  });
});

describe("what stays visible after painting", () => {
  const box = surfaceOf([
    { bbox: { x0: 10, x1: 20, y0: 10, y1: 20 }, text: "Ana" },
    { bbox: { x0: 30, x1: 40, y0: 10, y1: 20 }, text: "Lima" },
  ]);

  const shown = (rects: Array<Rect>) => uncovered(box, rects).text;

  it("keeps every word when nothing was painted", () => {
    expect(shown([])).toBe("Ana Lima");
  });

  it("drops a word a rect sits on", () => {
    expect(shown([rect(10, 10, 10, 10)])).toBe("Lima");
  });

  it("drops a word a rect only clips", () => {
    expect(shown([rect(18, 18, 10, 10)])).toBe("Lima");
  });

  it("keeps a word a rect only touches at the edge", () => {
    expect(shown([rect(20, 10, 10, 10)])).toBe("Ana Lima");
    expect(shown([rect(10, 20, 10, 10)])).toBe("Ana Lima");
  });

  it("checks every rect, not only the first", () => {
    expect(shown([rect(100, 100, 5, 5), rect(32, 12, 2, 2)])).toBe("Ana");
  });

  it("indexes what is left as text of its own", () => {
    expect(uncovered(box, [rect(10, 10, 10, 10)]).words).toEqual([
      { bbox: { x0: 30, x1: 40, y0: 10, y1: 20 }, charEnd: 4, charStart: 0, text: "Lima" },
    ]);
  });

  it("leaves nothing showing where the rects for a span were painted", () => {
    const rects = rectsFor(twoColumns, [span(0, twoColumns.text.length)]);

    expect(uncovered(twoColumns, rects)).toEqual(surfaceOf([]));
  });
});

describe("paint", () => {
  it("fills every rect in black", () => {
    const fillRect = vi.fn();
    const context = { fillRect, fillStyle: "" };
    const canvas = { getContext: () => context } as unknown as OffscreenCanvas;

    paint(canvas, [rect(1, 2, 3, 4), rect(5, 6, 7, 8)]);

    expect(context.fillStyle).toBe("#000000");
    expect(fillRect.mock.calls).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it("refuses a canvas that gives no 2d context", () => {
    const canvas = { getContext: () => null } as unknown as OffscreenCanvas;

    expect(() => {
      paint(canvas, []);
    }).toThrow(/no 2d canvas/v);
  });
});
