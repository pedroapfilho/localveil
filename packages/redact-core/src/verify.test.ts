import { describe, expect, it, vi } from "vitest";

import type { Detect, Span } from "./types";
import { survivingSpans } from "./verify";

const finding = (target: string): Detect =>
  vi.fn((text: string) => {
    const start = text.indexOf(target);

    return Promise.resolve<Array<Span>>(
      start === -1
        ? []
        : [{ end: start + target.length, label: "private_person", score: 0.9, start }],
    );
  });

const findingNothing: Detect = vi.fn(() => Promise.resolve<Array<Span>>([]));

describe("survivingSpans", () => {
  it("reports nothing when the detector finds nothing", async () => {
    expect(await survivingSpans("Invoice total due", findingNothing)).toEqual([]);
  });

  it("reports what the detector still recognises in the output", async () => {
    const survivors = await survivingSpans("Signed by Ana Lima", finding("Ana Lima"));

    expect(survivors).toEqual([{ label: "private_person", score: 0.9, text: "Ana Lima" }]);
  });

  it("does not report a span under the apply floor", async () => {
    const low: Detect = vi.fn((text: string) =>
      Promise.resolve<Array<Span>>([
        { end: text.length, label: "private_person", score: 0.2, start: 0 },
      ]),
    );

    expect(await survivingSpans("Maybe Name stayed", low)).toEqual([]);
  });

  it("does not report a run of blocks as a survivor", async () => {
    expect(await survivingSpans("Signed by ████████", finding("████████"))).toEqual([]);
  });

  it("does not report blocks padded with whitespace", async () => {
    expect(await survivingSpans("Signed by ███ ███", finding("███ ███"))).toEqual([]);
  });

  it("skips the detector entirely on text with nothing in it", async () => {
    const detect = finding("Ana Lima");

    expect(await survivingSpans("   ", detect)).toEqual([]);
    expect(detect).not.toHaveBeenCalled();
  });

  it("truncates a long survivor to eighty graphemes", async () => {
    const long = "a".repeat(200);
    const survivors = await survivingSpans(long, finding(long));

    expect(survivors[0].text).toHaveLength(80);
  });

  it("counts a grapheme rather than a code unit when it truncates", async () => {
    const long = "👩‍👩‍👧‍👦".repeat(100);
    const survivors = await survivingSpans(long, finding(long));

    expect([
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(survivors[0].text),
    ]).toHaveLength(80);
  });
});
