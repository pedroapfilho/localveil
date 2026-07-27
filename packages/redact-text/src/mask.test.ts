import type { Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { maskSpans } from "./mask.ts";

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
