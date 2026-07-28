import { describe, expect, it } from "vitest";

import { decodeBioes } from "./decode.ts";
import type { RawToken } from "./decode.ts";

const token = (entity: string, start: number, end: number, score = 0.9): RawToken => ({
  end,
  entity,
  score,
  start,
});

describe("decodeBioes", () => {
  it("turns a lone S- token into a single span", () => {
    expect(decodeBioes([token("S-private_email", 4, 20)], 0.5)).toEqual([
      { end: 20, label: "private_email", score: 0.9, start: 4 },
    ]);
  });

  it("joins B- I- E- of the same label into one span", () => {
    const spans = decodeBioes(
      [
        token("B-private_person", 0, 3),
        token("I-private_person", 4, 8),
        token("E-private_person", 9, 14),
      ],
      0.5,
    );

    expect(spans).toEqual([{ end: 14, label: "private_person", score: 0.9, start: 0 }]);
  });

  it("starts a second span when a B- follows a B- of the same label", () => {
    const spans = decodeBioes(
      [token("B-private_person", 0, 3), token("B-private_person", 4, 9)],
      0.5,
    );

    expect(spans).toEqual([
      { end: 3, label: "private_person", score: 0.9, start: 0 },
      { end: 9, label: "private_person", score: 0.9, start: 4 },
    ]);
  });

  it("drops O tokens", () => {
    const spans = decodeBioes(
      [token("O", 0, 5), token("S-secret", 6, 12), token("O", 13, 18)],
      0.5,
    );

    expect(spans).toEqual([{ end: 12, label: "secret", score: 0.9, start: 6 }]);
  });

  it("drops a token below minScore and breaks the sequence around it", () => {
    const spans = decodeBioes(
      [
        token("B-private_address", 0, 3),
        token("I-private_address", 4, 8, 0.2),
        token("E-private_address", 9, 14),
      ],
      0.5,
    );

    expect(spans).toEqual([
      { end: 3, label: "private_address", score: 0.9, start: 0 },
      { end: 14, label: "private_address", score: 0.9, start: 9 },
    ]);
  });

  it("scores a span by its weakest token", () => {
    const spans = decodeBioes(
      [token("B-private_phone", 0, 3, 0.95), token("E-private_phone", 4, 9, 0.61)],
      0.5,
    );

    expect(spans).toEqual([{ end: 9, label: "private_phone", score: 0.61, start: 0 }]);
  });

  it("throws on an unrecognised tag prefix rather than ignoring it", () => {
    expect(() => decodeBioes([token("X-private_person", 0, 3)], 0.5)).toThrow(/X-private_person/v);
  });

  it("throws on an unrecognised label rather than ignoring it", () => {
    expect(() => decodeBioes([token("B-favourite_colour", 0, 3)], 0.5)).toThrow(
      /favourite_colour/v,
    );
  });

  it("throws when a token carries no character offsets", () => {
    const offsetless = { end: undefined, entity: "S-secret", score: 0.9, start: 0 };

    expect(() => decodeBioes([offsetless as unknown as RawToken], 0.5)).toThrow(
      /could not be placed/v,
    );
  });

  it("emits a span for a B- that is never closed by an E-", () => {
    const spans = decodeBioes([token("B-private_url", 0, 3), token("I-private_url", 4, 9)], 0.5);

    expect(spans).toEqual([{ end: 9, label: "private_url", score: 0.9, start: 0 }]);
  });

  it("returns no spans for no tokens", () => {
    expect(decodeBioes([], 0.5)).toEqual([]);
  });
});
