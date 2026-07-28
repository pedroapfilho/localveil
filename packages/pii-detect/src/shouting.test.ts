import type { Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { collectShouting, titleCased, toSourceSpans } from "./shouting.ts";

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 0.9,
  start,
});

describe("titleCased", () => {
  it("lowers every letter of a shouted word but the first", () => {
    expect(titleCased("PEDRO AFONSO")).toBe("Pedro Afonso");
  });

  it("leaves text that is already mixed case alone", () => {
    expect(titleCased("Pedro Afonso")).toBe("Pedro Afonso");
  });

  it("keeps a single capital, which is not shouting", () => {
    expect(titleCased("A road in Brazil")).toBe("A road in Brazil");
  });

  it("keeps the apostrophe inside a shouted name", () => {
    expect(titleCased("O'BRIEN")).toBe("O'Brien");
  });
});

describe("collectShouting", () => {
  it("takes a line holding two shouted words", () => {
    expect(collectShouting("PEDRO AFONSO PEDROSA").text).toBe("Pedro Afonso Pedrosa");
  });

  // The reason this gate exists: every log line carries a level, and reading the
  // whole file twice to reach one was the entire cost of the second pass.
  it("leaves a line whose only capitals are one acronym", () => {
    expect(collectShouting("2026-01-01 INFO user signed in").text).toBe("");
  });

  it("leaves a line of ordinary prose", () => {
    expect(collectShouting("Contact Ana Lima about the invoice").text).toBe("");
  });

  it("takes only the shouted lines out of a mixed document", () => {
    const { text } = collectShouting("an invoice\nPEDRO AFONSO PEDROSA\ntotal 210,37\n");

    expect(text).toBe("Pedro Afonso Pedrosa");
  });

  it("keeps several shouted lines, one per line", () => {
    const { text } = collectShouting("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(text).toBe("Rua Das Flores\nAna Lima Souza");
  });

  it("reports where in the source each line came from", () => {
    const { segments } = collectShouting("header\nPEDRO AFONSO\n");

    expect(segments).toEqual([{ at: 7, end: 12, start: 0 }]);
  });

  it("finds nothing to do in an empty chunk", () => {
    expect(collectShouting("")).toEqual({ segments: [], text: "" });
  });

  // Case is length-preserving for almost every letter. U+0130 lowercases to two code
  // units, and a line that changed length would shift every later offset.
  it("skips a line whose length case folding would change", () => {
    expect(collectShouting("MAİL ANKARA").text).toBe("");
  });
});

describe("toSourceSpans", () => {
  it("shifts a span onto the line it came from", () => {
    const { segments, text } = collectShouting("header\nPEDRO AFONSO\n");

    expect(text).toBe("Pedro Afonso");
    expect(toSourceSpans([span(0, 12)], segments)).toEqual([span(7, 19)]);
  });

  it("shifts spans on the second joined line by that line's own offset", () => {
    const { segments } = collectShouting("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(toSourceSpans([span(15, 23)], segments)).toEqual([span(26, 34)]);
  });

  it("cuts a span back when the model runs it across the join", () => {
    const { segments } = collectShouting("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(toSourceSpans([span(0, 20)], segments)).toEqual([span(0, 14)]);
  });

  it("drops a span that starts in no segment at all", () => {
    expect(toSourceSpans([span(400, 410)], [{ at: 0, end: 12, start: 0 }])).toEqual([]);
  });

  it("keeps the label and score the model gave", () => {
    const mapped = toSourceSpans(
      [{ end: 5, label: "private_address", score: 0.42, start: 0 }],
      [{ at: 100, end: 12, start: 0 }],
    );

    expect(mapped).toEqual([{ end: 105, label: "private_address", score: 0.42, start: 100 }]);
  });
});
