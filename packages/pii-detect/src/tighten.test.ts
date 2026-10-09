import type { Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { tightenToVerified } from "./tighten";

const span = (start: number, end: number, score: number, label: Span["label"] = "account_number") =>
  ({ end, label, score, start }) satisfies Span;

const TEXT = "CNPJ 45.448.325/0001-70 emitido";

const VERIFIED = span(5, 23, 1);

const kept = (found: Array<Span>, verified: Array<Span>, text = TEXT) =>
  tightenToVerified(found, verified, text).map((entry) => text.slice(entry.start, entry.end));

describe("tightenToVerified", () => {
  it("drops a model span that only adds a label word to a verified number", () => {
    expect(kept([span(0, 23, 0.9)], [VERIFIED])).toEqual(["45.448.325/0001-70"]);
  });

  it("drops it even when the model scored it as certain", () => {
    expect(kept([span(0, 23, 1)], [VERIFIED])).toEqual(["45.448.325/0001-70"]);
  });

  it("keeps a model span whose extra text carries digits", () => {
    const text = "111.444.777-35 e 529.982.247-25";

    expect(kept([span(0, 31, 0.9)], [span(0, 14, 1)], text)).toHaveLength(2);
  });

  it("leaves a model span that no verified span sits inside", () => {
    expect(kept([span(0, 23, 0.9)], [])).toEqual(["CNPJ 45.448.325/0001-70"]);
  });

  it("does not tighten across labels", () => {
    expect(kept([span(0, 23, 0.9, "private_person")], [VERIFIED])).toHaveLength(2);
  });

  it("keeps a verified span even when another verified span encloses it", () => {
    expect(tightenToVerified([], [span(0, 23, 1), VERIFIED], TEXT)).toHaveLength(2);
  });

  it("keeps a model span that merely overlaps rather than encloses", () => {
    expect(kept([span(0, 12, 0.9)], [VERIFIED])).toHaveLength(2);
  });

  it("returns nothing when nothing was found", () => {
    expect(tightenToVerified([], [], TEXT)).toEqual([]);
  });
});
