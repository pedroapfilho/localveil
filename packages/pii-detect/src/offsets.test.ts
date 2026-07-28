import { describe, expect, it } from "vitest";

import { locateTokens } from "./offsets.ts";

// The real tokenizer is byte level: a token id maps to a fixed run of UTF-8 bytes,
// and decoding a lone id whose bytes are half a character yields U+FFFD.
const byteDecoder = (pieces: Array<Array<number>>): ((ids: Array<number>) => string) => {
  const decoder = new TextDecoder();

  return (ids) => decoder.decode(Uint8Array.from(ids.flatMap((id) => pieces[id])));
};

const bytesOf = (text: string) => [...new TextEncoder().encode(text)];

const tokenize = (parts: Array<string>) => {
  const pieces = parts.map((part) => bytesOf(part));

  return { decode: byteDecoder(pieces), ids: pieces.map((_piece, index) => index) };
};

describe("locateTokens", () => {
  it("locates every token of a plain sentence", () => {
    const { decode, ids } = tokenize(["Call", " John", " today"]);

    expect(locateTokens("Call John today", ids, decode)).toEqual([
      { end: 4, start: 0 },
      { end: 9, start: 4 },
      { end: 15, start: 9 },
    ]);
  });

  it("keeps leading and repeated whitespace inside the tokens that carry it", () => {
    const { decode, ids } = tokenize(["  a", "\tb", "\nc"]);

    expect(locateTokens("  a\tb\nc", ids, decode)).toEqual([
      { end: 3, start: 0 },
      { end: 5, start: 3 },
      { end: 7, start: 5 },
    ]);
  });

  it("skips special tokens that decode to nothing", () => {
    const { decode, ids } = tokenize(["", "hi", ""]);

    expect(locateTokens("hi", ids, decode)).toEqual([undefined, { end: 2, start: 0 }, undefined]);
  });

  it("covers a character whose bytes straddle two tokens", () => {
    const rocket = bytesOf("🚀");
    const pieces = [bytesOf("go "), rocket.slice(0, 2), rocket.slice(2), bytesOf(" now")];
    const decoder = byteDecoder(pieces);
    const ranges = locateTokens("go 🚀 now", [0, 1, 2, 3], decoder);

    expect(ranges).toEqual([
      { end: 3, start: 0 },
      { end: 5, start: 3 },
      { end: 5, start: 3 },
      { end: 9, start: 5 },
    ]);
  });

  it("gives a straddled character the same range from either half", () => {
    const rocket = bytesOf("🚀");
    const decoder = byteDecoder([rocket.slice(0, 2), rocket.slice(2)]);
    const ranges = locateTokens("🚀", [0, 1], decoder);

    expect(ranges[0]).toEqual(ranges[1]);
    expect("🚀".slice(0, 2)).toBe("🚀");
  });

  it("handles an empty text with only special tokens", () => {
    const { decode, ids } = tokenize(["", ""]);

    expect(locateTokens("", ids, decode)).toEqual([undefined, undefined]);
  });

  it("throws when a token does not match the text it should sit on", () => {
    const { decode, ids } = tokenize(["Call", " Jane"]);

    expect(() => locateTokens("Call John", ids, decode)).toThrow(
      /is not what the text holds at 4/v,
    );
  });
});
