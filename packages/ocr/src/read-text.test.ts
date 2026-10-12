import { Canvas } from "@napi-rs/canvas";
import { contextOf } from "@repo/redact-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OcrLanguage } from "./languages";
import type { Recognise } from "./read-text";
import { createTextReader } from "./read-text";
import type { Recognition } from "./recognize";

type Scanned = Array<[text: string, confidence: number]>;

const PORTUGUESE = "Ele nao foi a reuniao entao voce deve enviar uma copia dos documentos";

const boxOf = (index: number) => ({ x0: index * 12, x1: index * 12 + 10, y0: 0, y1: 10 });

const recognised = (confidence: number, scanned: Scanned): Recognition => ({
  confidence,
  words: scanned.map(([text, wordConfidence], index) => ({
    bbox: boxOf(index),
    confidence: wordConfidence,
    text,
  })),
});

const legible = (...texts: Array<string>) =>
  texts.map((text, index) => ({ bbox: boxOf(index), text }));

const ILLEGIBLE = recognised(40, [
  ["CPF", 95],
  ["108.467.036-45", 92],
  ["ruido", 10],
  ["texto", 15],
]);

const CLEAR = recognised(90, [
  ["NOME", 95],
  ["JOSE", 94],
  ["SILVA", 92],
]);

const EMPTY = recognised(0, []);

let page: OffscreenCanvas;

/* The fake engine answers by which raster it was handed, the page itself or the copy prepared for
   a second pass, and by the language it was asked to read in. */
const engine = (answer: (prepared: boolean, language: OcrLanguage) => Recognition) =>
  vi.fn<Recognise>((image, language) => Promise.resolve(answer(image !== page, language)));

const passes = (recognise: ReturnType<typeof engine>) =>
  recognise.mock.calls.map(([image, language]) => [image === page ? "page" : "prepared", language]);

const pixelsOf = (canvas: OffscreenCanvas) => [
  ...contextOf(canvas).getImageData(0, 0, canvas.width, canvas.height).data,
];

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", Canvas);

  page = new OffscreenCanvas(2, 1);

  const context = contextOf(page);

  context.fillStyle = "rgb(100, 100, 100)";
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = "rgb(200, 200, 200)";
  context.fillRect(1, 0, 1, 1);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a legible page", () => {
  it("is read once and handed back as its legible words", async () => {
    const recognise = engine(() => CLEAR);

    expect(await createTextReader(recognise)(page)).toEqual({
      alternatives: [],
      language: "en",
      legibility: "legible",
      words: legible("NOME", "JOSE", "SILVA"),
    });
    expect(passes(recognise)).toEqual([["page", "en"]]);
  });

  it("keeps a word at the floor and drops one just under it", async () => {
    const scanned: Scanned = [
      ["one", 95],
      ["two", 60],
      ["three", 59],
      ["four", 90],
      ["five", 90],
      ["six", 90],
      ["seven", 90],
      ["eight", 90],
    ];
    const { legibility, words } = await createTextReader(engine(() => recognised(80, scanned)))(
      page,
    );

    expect(legibility).toBe("legible");
    expect(words.map((word) => word.text)).toEqual([
      "one",
      "two",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ]);
  });

  it("holds at exactly a quarter illegible, without a second pass", async () => {
    const recognise = engine(() =>
      recognised(80, [
        ["one", 95],
        ["two", 92],
        ["three", 88],
        ["four", 12],
      ]),
    );

    const { legibility } = await createTextReader(recognise)(page);

    expect(legibility).toBe("legible");
    expect(recognise).toHaveBeenCalledTimes(1);
  });
});

describe("a page that reads badly", () => {
  it("tips into unreadable one word past a quarter", async () => {
    const tipped = recognised(80, [
      ["one", 95],
      ["two", 92],
      ["three", 88],
      ["four", 12],
      ["five", 11],
    ]);

    const { legibility } = await createTextReader(engine(() => tipped))(page);

    expect(legibility).toBe("unreadable");
  });

  it("is read again from a black and white copy, leaving the page itself alone", async () => {
    const recognise = engine((prepared) => (prepared ? CLEAR : ILLEGIBLE));

    await createTextReader(recognise)(page);

    const [, retry] = recognise.mock.calls;

    expect(passes(recognise)).toEqual([
      ["page", "en"],
      ["prepared", "en"],
    ]);
    expect(retry?.[0] === undefined ? [] : pixelsOf(retry[0])).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    expect(pixelsOf(page)).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it("is read again when the first pass found no words at all", async () => {
    const recognise = engine((prepared) => (prepared ? CLEAR : EMPTY));

    const { words } = await createTextReader(recognise)(page);

    expect(words).toEqual(legible("NOME", "JOSE", "SILVA"));
  });

  it("is called blank when neither pass found a word", async () => {
    expect(await createTextReader(engine(() => EMPTY))(page)).toEqual({
      alternatives: [[]],
      language: "en",
      legibility: "blank",
      words: [],
    });
  });

  it("takes the pass with more legible words and hands back the other beside it", async () => {
    const reading = await createTextReader(engine((prepared) => (prepared ? CLEAR : ILLEGIBLE)))(
      page,
    );

    expect(reading).toEqual({
      alternatives: [legible("CPF", "108.467.036-45")],
      language: "en",
      legibility: "legible",
      words: legible("NOME", "JOSE", "SILVA"),
    });
  });

  it("keeps the first pass when the retry recovers fewer words", async () => {
    const sparse = recognised(95, [
      ["CPF", 95],
      ["ruido", 10],
      ["texto", 12],
    ]);
    const reading = await createTextReader(engine((prepared) => (prepared ? sparse : ILLEGIBLE)))(
      page,
    );

    expect(reading.words).toEqual(legible("CPF", "108.467.036-45"));
    expect(reading.alternatives).toEqual([legible("CPF")]);
    expect(reading.legibility).toBe("unreadable");
  });

  it("breaks a tie on legible words with the recogniser's own confidence", async () => {
    const steadier = recognised(75, [
      ["CPF", 90],
      ["10846703645", 88],
      ["noise", 8],
    ]);
    const reading = await createTextReader(engine((prepared) => (prepared ? steadier : ILLEGIBLE)))(
      page,
    );

    expect(reading.words).toEqual(legible("CPF", "10846703645"));
  });

  it("keeps the first pass when the retry is no better", async () => {
    const level = recognised(40, [
      ["CPF", 95],
      ["10846703645", 92],
      ["ruido", 10],
      ["texto", 15],
    ]);
    const reading = await createTextReader(engine((prepared) => (prepared ? level : ILLEGIBLE)))(
      page,
    );

    expect(reading.words).toEqual(legible("CPF", "108.467.036-45"));
  });
});

describe("the language", () => {
  it("reads in a language it was told, without probing", async () => {
    const recognise = engine(() => CLEAR);
    const { language } = await createTextReader(recognise)(page, "pt");

    expect(language).toBe("pt");
    expect(passes(recognise)).toEqual([["page", "pt"]]);
  });

  it("keeps the English probe when it reads as English or as nothing in particular", async () => {
    const recognise = engine(() => CLEAR);
    const { language } = await createTextReader(recognise)(page);

    expect(language).toBe("en");
    expect(recognise).toHaveBeenCalledTimes(1);
  });

  it("reads again in the language the English probe turned out to be in", async () => {
    const recognise = engine((_prepared, language) =>
      language === "en"
        ? recognised(70, [[PORTUGUESE, 80]])
        : recognised(90, [
            ["Maria", 92],
            ["Silva", 88],
          ]),
    );
    const { language, words } = await createTextReader(recognise)(page);

    expect(passes(recognise)).toEqual([
      ["page", "en"],
      ["page", "pt"],
    ]);
    expect(language).toBe("pt");
    expect(words).toEqual(legible("Maria", "Silva"));
  });

  it("works the language out afresh for the second pass", async () => {
    const recognise = engine((prepared, language) => {
      if (!prepared) {
        return EMPTY;
      }

      return language === "en" ? recognised(70, [[PORTUGUESE, 80]]) : CLEAR;
    });
    const { language } = await createTextReader(recognise)(page);

    expect(passes(recognise)).toEqual([
      ["page", "en"],
      ["prepared", "en"],
      ["prepared", "pt"],
    ]);
    expect(language).toBe("pt");
  });

  it("keeps a language it was told for the second pass too", async () => {
    const recognise = engine((prepared) => (prepared ? CLEAR : ILLEGIBLE));

    await createTextReader(recognise)(page, "es");

    expect(passes(recognise)).toEqual([
      ["page", "es"],
      ["prepared", "es"],
    ]);
  });
});
