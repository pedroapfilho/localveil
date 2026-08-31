import { describe, expect, it } from "vitest";

import { collectShouting, positionShouted, titleCased } from "./shouting";
import { splitWords } from "./split-words";

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

  it("skips a line whose length case folding would change", () => {
    expect(collectShouting("MAİL ANKARA").text).toBe("");
  });
});

const position = (source: string, base = 0) => {
  const { segments, text } = collectShouting(source);

  return positionShouted(splitWords(text), segments, base);
};

describe("positionShouted", () => {
  it("puts a word back on the line it came from", () => {
    const { text } = collectShouting("header\nPEDRO AFONSO\n");

    expect(text).toBe("Pedro Afonso");
    expect(position("header\nPEDRO AFONSO\n")).toEqual([
      { end: 12, line: 0, start: 7, text: "Pedro" },
      { end: 19, line: 0, start: 13, text: "Afonso" },
    ]);
  });

  it("uses each joined line's own offset", () => {
    const positioned = position("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(positioned.at(0)).toEqual({ end: 3, line: 0, start: 0, text: "Rua" });
    expect(positioned.at(-1)).toEqual({ end: 40, line: 1, start: 35, text: "Souza" });
  });

  it("marks words from different source lines as different lines", () => {
    const positioned = position("RUA DAS FLORES\nquantity 4\nANA LIMA SOUZA");

    expect(new Set(positioned.map((word) => word.line))).toEqual(new Set([0, 1]));
  });

  it("shifts every word by the base offset of its chunk", () => {
    expect(position("PEDRO AFONSO", 100).at(0)).toEqual({
      end: 105,
      line: 0,
      start: 100,
      text: "Pedro",
    });
  });

  it("returns nothing when no line was shouted", () => {
    expect(position("nothing shouted here")).toEqual([]);
  });
});
