/* oxlint-disable anti-slop/no-module-mocking -- pdfjs-dist and pdf-lib are the wasm/canvas engines this redactor drives; the module seam is the only practical hermetic substitute */
import type { OcrLanguage, ReadText, Recognise, TextReading } from "@repo/ocr";
import { createTextReader } from "@repo/ocr";
import type { Detect, FileProgress, FileStageKey } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import type { PDFDocument } from "pdf-lib";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

type FakePage = {
  layer: string;
  layout?: Array<[x: number, y: number]>;
  legibility?: TextReading["legibility"];
  passedOver?: Array<string>;
  readsAs?: OcrLanguage;
  scanned: Array<string>;
};

const events: Array<string> = [];

/* What pdf.js drew onto each canvas, so a reader handed the canvas can tell which page it holds. */
const rendered = new WeakMap<object, FakePage>();

const state = {
  copied: [] as Array<number>,
  drawn: [] as Array<Array<string>>,
  drawTextThrowsOn: undefined as string | undefined,
  layerTransform: undefined as Array<number> | undefined,
  pages: [] as Array<FakePage>,
  painted: [] as Array<string>,
  sourceOpens: true,
};

const TYPED = [2, 0, 0, -2, 0, 400];

vi.mock("#pdfjs-worker", () => {
  Object.assign(globalThis, { pdfjsWorker: {} });

  return {};
});

vi.mock("#pdfjs", () => ({
  getDocument: () => ({
    destroy: () => {
      events.push("destroy");

      return Promise.resolve();
    },
    promise: Promise.resolve({
      getPage: (number: number) => {
        const page = state.pages[number - 1];

        assert.isDefined(page, `no fake page ${String(number)}`);

        return Promise.resolve({
          cleanup: () => {
            events.push(`cleanup:${String(number)}`);
          },
          getTextContent: () => {
            events.push(`text:${String(number)}`);

            return Promise.resolve({
              items: page.layer.split(" ").map((str, at) => {
                const [x, y] = page.layout?.[at] ?? [at * 40, 100];

                return { height: 10, str, transform: [10, 0, 0, 10, x, y], width: str.length * 5 };
              }),
              styles: {},
            });
          },
          getViewport: () => ({ height: 200, transform: state.layerTransform, width: 400 }),
          render: ({ canvasContext }: { canvasContext: { canvas: object } }) => {
            events.push(`render:${String(number)}`);
            rendered.set(canvasContext.canvas, page);

            return { promise: Promise.resolve() };
          },
        });
      },
      numPages: state.pages.length,
    }),
  }),
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: () =>
      Promise.resolve({
        addPage: (sheet: Array<number> | { index: number }) => {
          if (!Array.isArray(sheet)) {
            state.copied.push(sheet.index);
            events.push("copy");

            return undefined;
          }

          const words: Array<string> = [];

          state.drawn.push(words);
          events.push("page");

          return {
            drawImage: () => {
              events.push("image");
            },
            drawText: (text: string) => {
              if (text === state.drawTextThrowsOn) {
                throw new Error("WinAnsi cannot encode this");
              }

              words.push(text);
            },
          };
        },
        copyPages: (_from: PDFDocument, indices: Array<number>) =>
          Promise.resolve(indices.map((index) => ({ index }))),
        embedFont: () => Promise.resolve({}),
        embedPng: () => Promise.resolve({}),
        save: () => Promise.resolve(new Uint8Array([37, 80, 68, 70])),
      }),
    load: () =>
      state.sourceOpens
        ? Promise.resolve({})
        : Promise.reject(new Error("This PDF is encrypted and cannot be reopened")),
  },
  StandardFonts: { Helvetica: "Helvetica" },
}));

class FakeCanvas {
  readonly context = {
    canvas: this,
    fillRect: (x: number, y: number, width: number, height: number) => {
      state.painted.push(`${String(x)},${String(y)},${String(width)},${String(height)}`);
    },
    fillStyle: "",
    font: "",
    getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
    measureText: (text: string) => ({ width: text.length }),
    putImageData: () => undefined,
  };

  constructor(
    public width: number,
    public height: number,
  ) {}

  convertToBlob() {
    return Promise.resolve(new Blob([new Uint8Array([1])], { type: "image/png" }));
  }

  getContext() {
    return this.context;
  }
}

const { createPdfRedactor } = await import("./index");

const boxOf = (index: number) => ({ x0: index * 40, x1: index * 40 + 40, y0: 0, y1: 20 });

const placed = (texts: Array<string>) => texts.map((text, index) => ({ bbox: boxOf(index), text }));

/* A fixed-words reader: it hands back the words scanned onto whichever page pdf.js rendered, and
   the words of any pass it passed over. */
const fixedWords = vi.fn<ReadText>((canvas) => {
  const page = rendered.get(canvas);

  assert.isDefined(page, "the reader was handed a canvas pdf.js never rendered");

  return Promise.resolve({
    alternatives: page.passedOver === undefined ? [] : [placed(page.passedOver)],
    language: page.readsAs ?? "en",
    legibility: page.legibility ?? (page.scanned.length === 0 ? "blank" : "legible"),
    words: placed(page.scanned),
  });
});

const file = () => new File([new Uint8Array([37, 80, 68, 70])], "statement.pdf");

const naming = (...targets: Array<string>): Detect =>
  vi.fn((text: string) =>
    Promise.resolve(
      targets.flatMap((target) => {
        const start = text.indexOf(target);

        return start === -1
          ? []
          : [{ end: start + target.length, label: "private_person" as const, score: 0.9, start }];
      }),
    ),
  );

const run = (detect: Detect = naming(), read: ReadText = fixedWords) => {
  const stages: Array<FileStageKey> = [];

  return redactFile({
    detect,
    file: file(),
    onProgress: (_fraction, stage) => {
      stages.push(stage);
    },
    redactor: createPdfRedactor(read),
  }).then((result) => ({ ...result, stages }));
};

const analyse = (detect: Detect, onProgress: FileProgress = () => undefined) =>
  createPdfRedactor(fixedWords).analyse(file(), detect, onProgress);

const page = (layer: string, scanned = layer.split(" ")): FakePage => ({ layer, scanned });

const scan = (scanned: Array<string>, rest: Partial<FakePage> = {}): FakePage => ({
  layer: "",
  scanned,
  ...rest,
});

const knownLanguages = () => fixedWords.mock.calls.map(([, known]) => known);

beforeEach(() => {
  events.length = 0;
  state.copied = [];
  state.drawn = [];
  state.drawTextThrowsOn = undefined;
  state.layerTransform = undefined;
  state.pages = [page("Invoice for Ana Lima")];
  state.painted = [];
  state.sourceOpens = true;
  fixedWords.mockClear();

  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});

describe("the document it hands back", () => {
  it("is a PDF", async () => {
    const { blob } = await run();

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reads every page before it paints any of them", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    await run(naming("Ana Lima"));

    expect(events.lastIndexOf("text:2")).toBeLessThan(events.indexOf("image"));
  });

  it("puts the words it did not cover back, so the output stays searchable", async () => {
    await run(naming("Ana Lima"));

    expect(state.drawn[0]).toEqual(["Invoice", "for"]);
  });

  it("counts what it covered", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    const { redactionCount } = await run(naming("Ana Lima"));

    expect(redactionCount).toBe(2);
  });

  it("reports the stages a reader watches go by", async () => {
    const { stages } = await run();

    expect(stages).toContain("stage.rendering");
    expect(stages).toContain("stage.recognising");
    expect(stages).toContain("stage.detecting");
    expect(stages).toContain("stage.redacting");
    expect(stages.at(-1)).toBe("stage.finished");
  });
});

describe("pages without redactions", () => {
  it("are copied rather than rasterised", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima"), page("Page three")];

    await run(naming("Ana Lima"));

    expect(state.copied).toEqual([0, 2]);
    expect(state.drawn).toHaveLength(1);
  });

  it("are all painted when every page carries a redaction", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    await run(naming("Ana Lima"));

    expect(state.copied).toEqual([]);
    expect(state.drawn).toHaveLength(2);
  });

  it("are not rendered a second time to be copied", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await run(naming("Ana Lima"));

    expect(events.filter((event) => event === "render:1")).toHaveLength(1);
    expect(events.filter((event) => event === "render:2")).toHaveLength(2);
  });

  it("count the same whether copied or painted", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const { redactionCount } = await run(naming("Ana Lima"));

    expect(redactionCount).toBe(1);
  });

  it("are painted when the source cannot be reopened", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];
    state.sourceOpens = false;

    await run(naming("Ana Lima"));

    expect(state.copied).toEqual([]);
    expect(state.drawn).toHaveLength(2);
  });
});

describe("the check on the output", () => {
  it("warns when the detector still finds personal data in what stayed visible", async () => {
    const answers = [[], [{ end: 20, label: "private_person" as const, score: 0.9, start: 12 }]];
    const { warnings } = await run(() => Promise.resolve(answers.shift() ?? []));

    expect(warnings).toContain("warning.notFullyRedacted");
  });

  it("says nothing when the words left showing carry no personal data", async () => {
    const { warnings } = await run(naming("Ana Lima"));

    expect(warnings).not.toContain("warning.notFullyRedacted");
  });

  it("reads what stayed visible on a copied page too", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const detect = naming("Ana Lima");

    await run(detect);

    expect(detect).toHaveBeenLastCalledWith("Invoice total due Signed by");
  });
});

describe("warnings", () => {
  it("say nothing when the page read cleanly", async () => {
    const { warnings } = await run();

    expect(warnings).toEqual([]);
  });

  it("say a page carried no text layer, which means it was scanned", async () => {
    state.pages = [scan(["Ana", "Lima"])];

    const { warnings } = await run();

    expect(warnings).toEqual(["warning.scannedPages"]);
  });

  it("say a file gave up no text at all", async () => {
    state.pages = [scan([])];

    const { warnings } = await run();

    expect(warnings).toContain("warning.noText");
  });

  it("carry the reader's verdict that a page was mostly unreadable", async () => {
    state.pages = [
      page("Invoice for Ana Lima"),
      { ...page("Signed by"), legibility: "unreadable" },
    ];

    const { warnings } = await run();

    expect(warnings).toEqual(["warning.lowConfidence"]);
  });

  it("say when a character could not go back into the text layer", async () => {
    state.drawTextThrowsOn = "Invoice";

    const { warnings } = await run(naming("Ana Lima"));

    expect(warnings).toContain("warning.droppedCharacters");
  });
});

describe("the language a page is read in", () => {
  it("comes off the text layer when the layer says enough", async () => {
    const prose = "Ele nao foi a reuniao entao voce deve enviar uma copia";

    state.pages = [page(prose, ["Fatura"]), page("Assinado", ["Ana"])];

    await run();

    expect(knownLanguages()).toEqual(["pt", "pt"]);
  });

  it("is left to the reader when there is no text layer to sample", async () => {
    state.pages = [scan(["Ana", "Lima"])];

    await run();

    expect(knownLanguages()).toEqual([undefined]);
  });

  it("carries over from the first page the reader worked it out on", async () => {
    state.pages = [scan(["Fatura"], { readsAs: "pt" }), scan(["Ana"]), scan(["Lima"])];

    await run();

    expect(knownLanguages()).toEqual([undefined, "pt", "pt"]);
  });
});

describe("a scanned page", () => {
  it("is read again from a black and white copy when its first reading is mostly illegible", async () => {
    state.pages = [scan([])];

    const recognise = vi.fn<Recognise>((image) =>
      Promise.resolve(
        rendered.has(image)
          ? {
              confidence: 40,
              words: [
                { bbox: boxOf(0), confidence: 95, text: "Ana" },
                { bbox: boxOf(1), confidence: 20, text: "Lima" },
              ],
            }
          : {
              confidence: 90,
              words: ["Signed", "by", "Ana", "Lima"].map((text, index) => ({
                bbox: boxOf(index),
                confidence: 95,
                text,
              })),
            },
      ),
    );
    const detect = naming("Ana Lima");

    const { redactionCount, warnings } = await run(detect, createTextReader(recognise));

    const [first, retry] = recognise.mock.calls.map(([image]) => image);

    expect(recognise).toHaveBeenCalledTimes(2);
    expect(first === undefined ? false : rendered.has(first)).toBe(true);
    expect(retry === undefined ? true : rendered.has(retry)).toBe(false);
    expect(detect).toHaveBeenCalledWith("Signed by Ana Lima");
    expect(redactionCount).toBe(1);
    expect(warnings).toEqual(["warning.scannedPages"]);
  });

  it("is covered where only a pass the reader passed over read a name", async () => {
    state.pages = [
      scan(["Signed", "by"], {
        legibility: "unreadable",
        passedOver: ["Signed", "by", "Ana", "Lima"],
      }),
    ];

    const detect = naming("Ana Lima");
    const redactor = createPdfRedactor(fixedWords);
    const analysis = await redactor.analyse(file(), detect, () => undefined);
    const { redactionCount } = await redactor.apply({
      analysis,
      decisions: { covered: analysis.detections.map(({ id }) => id) },
      detect,
      file: file(),
      onProgress: () => undefined,
    });

    expect(analysis.detections.map((detection) => [detection.page, detection.preview])).toEqual([
      [0, "Ana Lima"],
    ]);
    expect(state.painted).toEqual(["80,0,80,20"]);
    expect(state.drawn).toEqual([["Signed", "by"]]);
    expect(detect).toHaveBeenLastCalledWith("Signed by");
    expect(redactionCount).toBe(1);
  });

  it("is copied untouched once a name only a passed-over pass read is dismissed", async () => {
    state.pages = [scan(["Signed", "by"], { passedOver: ["Signed", "by", "Ana", "Lima"] })];

    const redactor = createPdfRedactor(fixedWords);
    const analysis = await redactor.analyse(file(), naming("Ana Lima"), () => undefined);
    const { redactionCount } = await redactor.apply({
      analysis,
      decisions: { covered: [] },
      detect: naming(),
      file: file(),
      onProgress: () => undefined,
    });

    expect(state.painted).toEqual([]);
    expect(state.copied).toEqual([0]);
    expect(redactionCount).toBe(0);
  });

  it("is painted with nothing over it when the reader could make none of it out", async () => {
    state.pages = [scan([], { legibility: "unreadable" })];

    const detect = naming("Ana Lima");
    const { warnings } = await run(detect);

    expect(detect).not.toHaveBeenCalled();
    expect(state.painted).toEqual([]);
    expect(warnings).toContain("warning.lowConfidence");
  });
});

describe("a typed page", () => {
  const LONG =
    "Fatura para Ana Lima em Recife com telefone e endereco e conta e data e mais palavras";

  it("is read from its own text layer instead of being recognised", async () => {
    state.layerTransform = TYPED;
    state.pages = [page(LONG)];

    const detect = naming("Ana Lima");

    await run(detect);

    expect(fixedWords).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledWith(expect.stringContaining("Ana Lima"));
  });

  it("is still recognised when its layer is too thin to trust", async () => {
    state.layerTransform = TYPED;

    await run(naming("Ana Lima"));

    expect(fixedWords).toHaveBeenCalledTimes(1);
  });

  it("is recognised when its viewport gives no transform to place words with", async () => {
    state.pages = [page(LONG)];

    await run(naming("Ana Lima"));

    expect(fixedWords).toHaveBeenCalledTimes(1);
  });

  it("is covered where the text layer put a name", async () => {
    state.layerTransform = TYPED;
    state.pages = [page(LONG)];

    const { redactionCount } = await run(naming("Ana"));

    expect(redactionCount).toBe(1);
    expect(state.painted).not.toEqual([]);
  });

  it("is read by its layout, not by the order the layer lists it", async () => {
    state.layerTransform = TYPED;
    state.pages = [
      {
        layer: "Name of Recipient Please Print Ana Lima The parties have executed this agreement",
        layout: [
          [0, 100],
          [25, 100],
          [40, 100],
          [90, 100],
          [125, 100],
          [0, 120],
          [20, 120],
          [0, 140],
          [20, 140],
          [60, 140],
          [85, 140],
          [130, 140],
          [155, 140],
        ],
        scanned: [],
      },
    ];

    const detect = naming();

    await run(detect);

    expect(detect).toHaveBeenCalledWith(
      "The parties have executed this agreement Ana Lima Name of Recipient Please Print",
    );
  });
});

describe("the pdf.js resources it holds", () => {
  it("are released page by page and as a document at the end of the pass", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await analyse(naming("Ana Lima"));

    expect(events.filter((entry) => entry.startsWith("cleanup:"))).toHaveLength(2);
    expect(events.filter((entry) => entry === "destroy")).toHaveLength(1);
  });

  it("are released on the apply pass too", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await run(naming("Ana Lima"));

    expect(events.filter((entry) => entry === "destroy")).toHaveLength(2);
  });

  it("are still released when the job is cancelled mid-pass", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const stopped = analyse(naming(), (fraction, stage) => {
      if (stage === "stage.extracting" && fraction > 0) {
        throw new Error("cancelled");
      }
    });

    await expect(stopped).rejects.toThrow("cancelled");
    expect(events).toContain("destroy");
    expect(events.some((entry) => entry.startsWith("cleanup:"))).toBe(true);
  });
});

describe("the handle analysis hands to apply", () => {
  it("keeps only the readings of each analysed page and their word geometry", async () => {
    const analysis = await analyse(naming("Ana"));
    const [[first] = []] = (analysis.handle as { pages: Array<Array<Record<string, unknown>>> })
      .pages;

    assert.isDefined(first);

    expect(Object.keys(first).toSorted()).toEqual(["marks", "text", "words"]);
  });

  it("is refused when its pages carry no words", async () => {
    const analysis = await analyse(naming("Ana"));

    await expect(
      createPdfRedactor(fixedWords).apply({
        analysis: { ...analysis, handle: { pages: [[{ marks: [], text: "Ana" }]] } },
        decisions: { covered: [] },
        detect: naming(),
        file: file(),
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/no recognised pages/v);
  });
});
