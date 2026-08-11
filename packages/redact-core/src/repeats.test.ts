import { describe, expect, it } from "vitest";

import { spansForTokens, tokensFromSpans } from "./repeats.ts";
import type { Span } from "./types.ts";

const span = (start: number, end: number, label: Span["label"] = "private_person"): Span => ({
  end,
  label,
  score: 0.9,
  start,
});

const TEXT = "Joao Goncalves came in. O Joao pode ser contactado. Ask joao about it.";

describe("tokensFromSpans", () => {
  it("takes each word of a span as its own token", () => {
    const tokens = tokensFromSpans(TEXT, [span(0, 14)]);

    expect(tokens.map((token) => token.text)).toEqual(["Joao", "Goncalves"]);
  });

  it("carries the label and score of the span the token came from", () => {
    expect(tokensFromSpans("write to ana@example.com now", [span(9, 24, "private_email")])).toEqual(
      [{ label: "private_email", score: 0.9, text: "ana@example.com" }],
    );
  });

  it("skips tokens too short to be a name", () => {
    expect(tokensFromSpans("de Sa lives here", [span(0, 5)]).map((token) => token.text)).toEqual(
      [],
    );
  });

  it("counts a token once however often it was tagged", () => {
    expect(tokensFromSpans(TEXT, [span(0, 4), span(26, 30)]).length).toBe(1);
  });

  it("keeps the highest score a token was seen with, in either order", () => {
    const low: Span = { end: 30, label: "private_person", score: 0.2, start: 26 };

    expect(tokensFromSpans(TEXT, [span(0, 4), low])[0].score).toBe(0.9);
    expect(tokensFromSpans(TEXT, [low, span(0, 4)])[0].score).toBe(0.9);
  });

  it("returns nothing when nothing was tagged", () => {
    expect(tokensFromSpans(TEXT, [])).toEqual([]);
  });
});

describe("spansForTokens", () => {
  it("finds every later mention the model missed", () => {
    const spans = spansForTokens(TEXT, tokensFromSpans(TEXT, [span(0, 14)]));

    expect(spans.map(({ end, start }) => TEXT.slice(start, end))).toEqual([
      "Joao",
      "Goncalves",
      "Joao",
      "joao",
    ]);
  });

  it("ignores case, the way a document does", () => {
    const spans = spansForTokens("Ana went out. ana came back.", [
      { label: "private_person", score: 0.9, text: "Ana" },
    ]);

    expect(spans.length).toBe(2);
  });

  it("does not fire inside a longer word", () => {
    const spans = spansForTokens("Ana and Anabela and banana", [
      { label: "private_person", score: 0.9, text: "Ana" },
    ]);

    expect(spans).toEqual([{ end: 3, label: "private_person", score: 0.9, start: 0 }]);
  });

  it("matches an email with all its punctuation", () => {
    const text = "write to ana@example.com or ana@example.com again";
    const spans = spansForTokens(text, [
      { label: "private_email", score: 0.9, text: "ana@example.com" },
    ]);

    expect(spans.length).toBe(2);
  });

  it("matches a phone number, hyphens and all", () => {
    const text = "call 555-0100 or 555-0100 again";
    const spans = spansForTokens(text, [{ label: "private_phone", score: 0.9, text: "555-0100" }]);

    expect(spans.map(({ end, start }) => text.slice(start, end))).toEqual(["555-0100", "555-0100"]);
  });

  it("builds a valid pattern for every punctuation mark a token can hold", () => {
    for (const token of ["a-b", "a/b", "a.b", "a+b", "a(b)", "a[b]", "a{b}", "a|b", "a^b", "a$b"]) {
      expect(() =>
        spansForTokens(`x ${token} y`, [{ label: "secret", score: 0.9, text: token }]),
      ).not.toThrow();
    }
  });

  it("treats a token with regex characters as plain text", () => {
    expect(
      spansForTokens("a+b and a+b", [{ label: "secret", score: 0.9, text: "a+b" }]).length,
    ).toBe(2);
  });

  it("returns spans in the order they appear", () => {
    const spans = spansForTokens(TEXT, tokensFromSpans(TEXT, [span(0, 14)]));
    const starts = spans.map((entry) => entry.start);

    expect(starts).toEqual(starts.toSorted((left, right) => left - right));
  });

  it("returns nothing for no tokens", () => {
    expect(spansForTokens(TEXT, [])).toEqual([]);
  });
});
