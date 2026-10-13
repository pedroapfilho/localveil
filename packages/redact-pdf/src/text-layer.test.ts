import { assert, describe, expect, it } from "vitest";

import { textLayerWords } from "./text-layer";
import type { MeasureText } from "./text-layer";

const VIEWPORT = { transform: [2, 0, 0, -2, 0, 400] };

const STYLES = { sans: { ascent: 0.75, descent: -0.25, fontFamily: "sans-serif" } };

const byCharacter: MeasureText = (text) => text.length;

const wideWs: MeasureText = (text) => text.length + 2 * (text.match(/W/gv)?.length ?? 0);

type Placed = {
  baseline: number;
  fontName?: string;
  size?: number;
  str: string;
  width: number;
  x: number;
};

const item = ({ baseline, fontName, size = 10, str, width, x }: Placed) => ({
  fontName,
  height: size,
  str,
  transform: [size, 0, 0, size, x, baseline],
  width,
});

const layer = (...items: Array<ReturnType<typeof item>>) =>
  textLayerWords({ items, styles: STYLES, viewport: VIEWPORT }, byCharacter);

describe("textLayerWords", () => {
  it("places a single word where the run sits", () => {
    const [word] = layer(item({ baseline: 100, str: "Ana", width: 30, x: 10 }));

    assert.isDefined(word);

    expect(word.text).toBe("Ana");
    expect(word.bbox.x0).toBeCloseTo(20 - 20 / 2, 1);
    expect(word.bbox.y1).toBeCloseTo(200, 1);
  });

  it("splits a run into its words", () => {
    const words = layer(item({ baseline: 100, str: "Ana Lima", width: 80, x: 0 }));

    expect(words.map((entry) => entry.text)).toEqual(["Ana", "Lima"]);
  });

  it("puts the second word to the right of the first", () => {
    const [first, second] = layer(item({ baseline: 100, str: "Ana Lima", width: 80, x: 0 }));

    assert.isDefined(first);
    assert.isDefined(second);

    expect(second.bbox.x0).toBeGreaterThan(first.bbox.x0);
  });

  it("pads each box by half a glyph, for the measuring font that differs slightly from the PDF's", () => {
    const [tight] = layer(item({ baseline: 100, str: "Ana", width: 30, x: 0 }));

    assert.isDefined(tight);

    const per = (30 * 2) / 3;

    expect(tight.bbox.x0).toBeCloseTo(-per / 2, 1);
    expect(tight.bbox.x1).toBeCloseTo(3 * per + per / 2, 1);
  });

  it("places a word by the measured width of the text before it, not by its character count", () => {
    const [, second] = textLayerWords(
      {
        items: [item({ baseline: 100, str: "WWW ab", width: 60, x: 0 })],
        styles: STYLES,
        viewport: VIEWPORT,
      },
      wideWs,
    );

    assert.isDefined(second);

    const per = (60 * 2) / 6;

    expect(second.bbox.x0).toBeCloseTo((10 / 12) * 120 - per / 2, 1);
    expect(second.bbox.x1).toBeCloseTo(120 + per / 2, 1);
  });

  it("reaches from the font's ascent down past the baseline to its descent", () => {
    const [word] = layer(
      item({ baseline: 100, fontName: "sans", size: 12, str: "jog", width: 30, x: 0 }),
    );

    assert.isDefined(word);

    expect(word.bbox.y0).toBeCloseTo(200 - 24 * 0.75, 1);
    expect(word.bbox.y1).toBeCloseTo(200 + 24 * 0.25, 1);
  });

  it("gives a box real height from the transform", () => {
    const [word] = layer(item({ baseline: 100, size: 12, str: "Ana", width: 30, x: 0 }));

    assert.isDefined(word);

    expect(word.bbox.y1 - word.bbox.y0).toBeCloseTo(24, 1);
  });

  it("flips the y axis, so a lower baseline is further down the page", () => {
    const [high] = layer(item({ baseline: 150, str: "Ana", width: 30, x: 0 }));
    const [low] = layer(item({ baseline: 50, str: "Ana", width: 30, x: 0 }));

    assert.isDefined(high);
    assert.isDefined(low);

    expect(low.bbox.y1).toBeGreaterThan(high.bbox.y1);
  });

  it("skips a run that is only whitespace", () => {
    expect(layer(item({ baseline: 100, str: "   ", width: 30, x: 0 }))).toEqual([]);
  });

  it("skips an empty run", () => {
    expect(layer(item({ baseline: 100, str: "", width: 0, x: 0 }))).toEqual([]);
  });

  it("ignores an item that is not text", () => {
    expect(
      textLayerWords(
        { items: [{ type: "beginMarkedContent" }], styles: STYLES, viewport: VIEWPORT },
        byCharacter,
      ),
    ).toEqual([]);
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
