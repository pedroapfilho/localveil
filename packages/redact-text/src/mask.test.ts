import type { Span } from "@repo/redact-core";
import { mergeOverlappingRanges } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { maskRanges } from "./mask.ts";

// The redactor merges before masking; these cases are written in spans, so merge here too.
const maskSpans = (text: string, spans: Array<Span>) =>
  maskRanges(text, mergeOverlappingRanges(spans));

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.9,
  start,
});

describe("maskSpans", () => {
  it("replaces a span with one block per character", () => {
    expect(maskSpans("Hi Ana!", [span(3, 6)])).toBe("Hi ███!");
  });

  it("masks two overlapping spans once", () => {
    expect(maskSpans("Hi Ana Silva!", [span(3, 6), span(4, 12)])).toBe("Hi █████████!");
  });

  it("keeps earlier offsets valid when several spans are masked", () => {
    const masked = maskSpans("Ana met Rui today", [span(0, 3), span(8, 11)]);

    expect(masked).toBe("███ met ███ today");
  });

  it("counts an emoji as a single block", () => {
    expect(maskSpans("hi 🙂 there", [span(3, 5)])).toBe("hi █ there");
  });

  it("returns the input unchanged when there are no spans", () => {
    expect(maskSpans("nothing to hide", [])).toBe("nothing to hide");
  });

  it("throws when a span reaches past the end of the text", () => {
    expect(() => maskSpans("short", [span(2, 99)])).toThrow(/outside/v);
  });

  it("throws when a span starts before the text", () => {
    expect(() => maskSpans("short", [span(-1, 2)])).toThrow(/outside/v);
  });
});

describe("maskSpans across lines", () => {
  it("keeps the line break when a span runs past the end of a line", () => {
    const text = "ana@example.com\n2024-03-14 next";

    expect(maskSpans(text, [{ end: 26, label: "private_email", score: 0.9, start: 0 }])).toBe(
      "███████████████\n██████████ next",
    );
  });

  it("keeps a carriage return pair intact", () => {
    const text = "a\r\nb";

    expect(maskSpans(text, [{ end: 4, label: "secret", score: 0.9, start: 0 }])).toBe("█\r\n█");
  });
});

describe("scale", () => {
  it("masks ten thousand spans over a megabyte without rebuilding the text each time", () => {
    const row = "name,email\n";
    const text = row.repeat(10_000);
    const spans = Array.from({ length: 10_000 }, (_entry, index) =>
      span(index * row.length, index * row.length + 4),
    );

    const masked = maskSpans(text, spans);

    expect(masked).toHaveLength(text.length);
    expect(masked.startsWith("████,email")).toBe(true);
  });
});
