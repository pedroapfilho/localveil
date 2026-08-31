import { describe, expect, it } from "vitest";

import { tightenToVerified } from "./tighten";
import type { Span } from "./types";

const span = (start: number, end: number, score: number, label: Span["label"] = "account_number") =>
  ({ end, label, score, start }) satisfies Span;

const TEXT = "CNPJ 45.448.325/0001-70 emitido";

const kept = (spans: Array<Span>, text = TEXT) =>
  tightenToVerified(spans, text).map((entry) => text.slice(entry.start, entry.end));

describe("tightenToVerified", () => {
  it("drops a model span that only adds a label word to a verified number", () => {
    expect(kept([span(0, 23, 0.9), span(5, 23, 1)])).toEqual(["45.448.325/0001-70"]);
  });

  it("keeps a model span whose extra text carries digits", () => {
    const text = "111.444.777-35 e 529.982.247-25";

    expect(kept([span(0, 31, 0.9), span(0, 14, 1)], text)).toHaveLength(2);
  });

  it("leaves a model span that no verified span sits inside", () => {
    expect(kept([span(0, 23, 0.9)])).toEqual(["CNPJ 45.448.325/0001-70"]);
  });

  it("leaves spans alone when nothing was verified", () => {
    expect(tightenToVerified([span(0, 4, 0.9), span(5, 23, 0.8)], TEXT)).toHaveLength(2);
  });

  it("does not tighten across labels", () => {
    expect(kept([span(0, 23, 0.9, "private_person"), span(5, 23, 1)])).toHaveLength(2);
  });

  it("keeps a verified span even when another verified span encloses it", () => {
    expect(tightenToVerified([span(0, 23, 1), span(5, 23, 1)], TEXT)).toHaveLength(2);
  });

  it("keeps a model span that merely overlaps rather than encloses", () => {
    expect(kept([span(0, 12, 0.9), span(5, 23, 1)])).toHaveLength(2);
  });

  it("returns an empty list unchanged", () => {
    expect(tightenToVerified([], TEXT)).toEqual([]);
  });
});
