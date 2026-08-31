/* oxlint-disable anti-slop/no-module-mocking -- pdfjs-dist, pdf-lib and @repo/ocr wrap wasm/canvas engines; the module seam is the only practical hermetic substitute */
import type * as Ocr from "@repo/ocr";
import type { Bbox, Detect, FileStageKey } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import type { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const events: Array<string> = [];

type FakePage = {
  layer: string;
  layout?: Array<[x: number, y: number]>;
  words: Array<string>;
};

const state = {
  confidence: 90,
  confidenceOf: (_text: string) => 95,
  copied: [] as Array<number>,
  drawn: [] as Array<Array<string>>,
  drawTextThrowsOn: undefined as string | undefined,
  language: "en" as "en" | "es" | "pt",
  layerTransform: undefined as Array<number> | undefined,
  pages: [] as Array<FakePage>,
  painted: [] as Array<string>,
  recognisedIn: [] as Array<string | undefined>,
  sourceOpens: true,
};

const WORD_WIDTH = 40;
const LINE_HEIGHT = 20;

const boxFor = (index: number): Bbox => ({
  x0: index * WORD_WIDTH,
  x1: index * WORD_WIDTH + WORD_WIDTH,
  y0: 0,
  y1: LINE_HEIGHT,
});

vi.mock("pdfjs-dist/build/pdf.worker.mjs", () => {
  Object.assign(globalThis, { pdfjsWorker: {} });

  return {};
});

vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({
    destroy: () => {
      events.push("destroy");

      return Promise.resolve();
    },
    promise: Promise.resolve({
      getPage: (number: number) =>
        Promise.resolve({
          cleanup: () => {
            events.push(`cleanup:${String(number)}`);
          },
          getTextContent: () => {
            events.push(`text:${String(number)}`);

            const page = state.pages[number - 1];

            return Promise.resolve({
              items: page.layer.split(" ").map((str, at) => {
                const [x, y] = page.layout?.[at] ?? [at * 40, 100];

                return { height: 10, str, transform: [10, 0, 0, 10, x, y], width: str.length * 5 };
              }),
            });
          },
          getViewport: () => ({
            height: 200,
            transform: state.layerTransform,
            width: 400,
          }),
          render: () => {
            events.push(`render:${String(number)}`);

            return { promise: Promise.resolve() };
          },
        }),
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

vi.mock("@repo/ocr", async (importOriginal) => ({
  ...(await importOriginal<typeof Ocr>()),
  detectLanguage: () => ({ confidence: 0.9, language: state.language }),
  readImageText: (_image: OffscreenCanvas, options: { known?: string } = {}) => {
    state.recognisedIn.push(options.known);

    const page = state.pages[state.recognisedIn.length - 1];

    return Promise.resolve({
      confidence: state.confidence,
      language: state.language,
      words: page.words.map((text, index) => ({
        bbox: boxFor(index),
        confidence: state.confidenceOf(text),
        text,
      })),
    });
  },
}));

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}

  convertToBlob() {
    return Promise.resolve(new Blob([new Uint8Array([1])], { type: "image/png" }));
  }

  getContext() {
    return {
      fillRect: (x: number, y: number, w: number, h: number) => {
        state.painted.push(`${x},${y},${w},${h}`);
      },
      fillStyle: "",
    };
  }
}

const { pdfRedactor } = await import("./index");

const file = () => new File([new Uint8Array([37, 80, 68, 70])], "statement.pdf");

const detecting = (targets: Array<string>): Detect =>
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

const detectingEvery = (targets: Array<string>): Detect =>
  vi.fn((text: string) =>
    Promise.resolve(
      targets.flatMap((target) =>
        [...text.matchAll(new RegExp(target.replaceAll(".", String.raw`\.`), "gv"))].map(
          (match) => ({
            end: match.index + target.length,
            label: "private_person" as const,
            score: 0.9,
            start: match.index,
          }),
        ),
      ),
    ),
  );

const onlyOnTheSignaturePage: Detect = (text) => {
  const start = text.startsWith("Signed") ? text.indexOf("Ana Lima") : -1;

  return Promise.resolve(
    start === -1
      ? []
      : [{ end: start + "Ana Lima".length, label: "private_person" as const, score: 0.9, start }],
  );
};

const run = (detect: Detect = detecting([])) => {
  const stages: Array<FileStageKey> = [];

  return redactFile({
    detect,
    file: file(),
    onProgress: (_fraction, stage) => {
      stages.push(stage);
    },
    redactor: pdfRedactor,
  }).then((result) => ({ ...result, stages }));
};

const page = (layer: string, words = layer.split(" ")): FakePage => ({ layer, words });

beforeEach(() => {
  events.length = 0;
  state.confidence = 90;
  state.copied = [];
  state.drawn = [];
  state.drawTextThrowsOn = undefined;
  state.language = "en";
  state.pages = [page("Invoice for Ana Lima")];
  state.confidenceOf = () => 95;
  state.painted = [];
  state.layerTransform = undefined;
  state.recognisedIn = [];
  state.sourceOpens = true;

  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});

describe("pdfRedactor", () => {
  it("takes a PDF by type and by name", () => {
    expect(pdfRedactor.accepts(new File([], "a.pdf", { type: "application/pdf" }))).toBe(true);
    expect(pdfRedactor.accepts(new File([], "SCAN.PDF"))).toBe(true);
    expect(pdfRedactor.accepts(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
  });

  it("hands back a PDF", async () => {
    const { blob } = await run();

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reads every page before it paints any of them", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    await run(detecting(["Ana Lima"]));

    const lastRead = events.lastIndexOf("text:2");
    const firstPainted = events.indexOf("image");

    expect(lastRead).toBeLessThan(firstPainted);
  });

  it("covers a name on the page where the model missed it", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima today")];

    await run(onlyOnTheSignaturePage);

    expect(state.drawn[0]).toEqual(["Invoice", "for"]);
  });

  it("puts the words it did not cover back, so the output stays searchable", async () => {
    await run(detecting(["Ana Lima"]));

    expect(state.drawn[0]).toEqual(["Invoice", "for"]);
  });

  it("counts what it covered", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    const { redactionCount } = await run(detecting(["Ana Lima"]));

    expect(redactionCount).toBe(2);
  });

  it("finds nothing to count in a page with nothing to hide", async () => {
    const { redactionCount } = await run();

    expect(redactionCount).toBe(0);
  });

  it("finds nothing to search in a page the recogniser could not read", async () => {
    state.confidenceOf = () => 28;

    const detect = detecting(["Ana Lima"]);
    const { warnings } = await run(detect);

    expect(detect).toHaveBeenCalledWith("");
    expect(warnings).toContain("warning.lowConfidence");
  });

  it("leaves an unreadable page whole rather than blacking it out", async () => {
    state.confidenceOf = () => 28;

    await run(detecting(["Ana Lima"]));

    expect(state.painted).toEqual([]);
  });

  it("covers the words it could read on a page the average would have condemned", async () => {
    state.confidence = 46;
    state.confidenceOf = (text) => (text === "Ana" || text === "Lima" ? 95 : 20);

    const { redactionCount, warnings } = await run(detecting(["Ana Lima"]));

    expect(redactionCount).toBe(1);
    expect(state.painted.length).toBeGreaterThan(0);
    expect(warnings).toContain("warning.lowConfidence");
  });

  it("warns when most of the page was beyond the recogniser", async () => {
    state.confidenceOf = () => 40;

    const { warnings } = await run();

    expect(warnings).toContain("warning.lowConfidence");
  });

  it("says nothing about the odd word it could not make out", async () => {
    state.pages = [page("Invoice for Ana Lima on the fourteenth of March")];
    state.confidenceOf = (text) => (text === "fourteenth" ? 20 : 95);

    const { warnings } = await run();

    expect(warnings).toEqual([]);
  });

  it("says nothing when the page read cleanly", async () => {
    const { warnings } = await run();

    expect(warnings).toEqual([]);
  });

  it("warns that a page carried no text layer, which means it was scanned", async () => {
    state.pages = [{ layer: "", words: ["Ana", "Lima"] }];

    const { warnings } = await run();

    expect(warnings).toContain("warning.scannedPages");
  });

  it("warns when a file gave up no text at all", async () => {
    state.pages = [{ layer: "", words: [] }];

    const { warnings } = await run();

    expect(warnings).toContain("warning.noText");
  });

  it("warns when a character could not go back into the text layer", async () => {
    state.drawTextThrowsOn = "Invoice";

    const { warnings } = await run(detecting(["Ana Lima"]));

    expect(warnings).toContain("warning.droppedCharacters");
  });

  it("reads the language off the text layer and recognises in it", async () => {
    state.language = "pt";
    state.pages = [page("Fatura para Ana Lima"), page("Assinado por Ana Lima")];

    await run();

    expect(state.recognisedIn).toEqual(["pt", "pt"]);
  });

  it("lets the recogniser work the language out when there is no text layer to read", async () => {
    state.pages = [{ layer: "", words: ["Ana", "Lima"] }];

    await run();

    expect(state.recognisedIn).toEqual([undefined]);
  });

  it("reports the stages a reader watches go by", async () => {
    const { stages } = await run();

    expect(stages).toContain("stage.rendering");
    expect(stages).toContain("stage.recognising");
    expect(stages).toContain("stage.detecting");
    expect(stages).toContain("stage.redacting");
    expect(stages.at(-1)).toBe("stage.finished");
  });

  it("adds one output page per input page", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima"), page("Page three")];

    await run();

    expect(state.copied.length + state.drawn.length).toBe(3);
  });

  it("copies a page that carries no redaction rather than rasterising it", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await run(detecting(["Ana Lima"]));

    expect(state.copied).toEqual([0]);
    expect(state.drawn.length).toBe(1);
  });

  it("keeps every page when it mixes copied and painted ones", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima"), page("Page three")];

    await run(detecting(["Ana Lima"]));

    expect(state.copied.length + state.drawn.length).toBe(3);
  });

  it("paints every page when every page carries a redaction", async () => {
    state.pages = [page("Invoice for Ana Lima"), page("Signed by Ana Lima")];

    await run(detecting(["Ana Lima"]));

    expect(state.copied).toEqual([]);
    expect(state.drawn.length).toBe(2);
  });

  it("does not render a page a second time to copy it", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await run(detecting(["Ana Lima"]));

    expect(events.filter((event) => event === "render:1")).toHaveLength(1);
    expect(events.filter((event) => event === "render:2")).toHaveLength(2);
  });

  it("counts the same whether a page is copied or painted", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const { redactionCount } = await run(detecting(["Ana Lima"]));

    expect(redactionCount).toBe(1);
  });

  it("warns when the detector still finds personal data in what stayed visible", async () => {
    const answers = [[], [{ end: 20, label: "private_person" as const, score: 0.9, start: 12 }]];
    const { warnings } = await run(() => Promise.resolve(answers.shift() ?? []));

    expect(warnings).toContain("warning.notFullyRedacted");
  });

  it("says nothing when the words left showing carry no personal data", async () => {
    const { warnings } = await run(detecting(["Ana Lima"]));

    expect(warnings).not.toContain("warning.notFullyRedacted");
  });

  it("checks what stayed visible on a copied page too", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const detect = detecting(["Ana Lima"]);

    await run(detect);

    expect(detect).toHaveBeenCalledWith("Invoice total due Signed by");
  });

  it("reads a typed page from its own text layer instead of recognising it", async () => {
    state.layerTransform = [2, 0, 0, -2, 0, 400];
    state.pages = [
      page("Fatura para Ana Lima em Recife com telefone e endereco e conta e data e mais palavras"),
    ];

    const seen: Array<string> = [];
    const detect = (text: string) => {
      seen.push(text);

      return detecting(["Ana Lima"])(text);
    };

    await run(detect);

    expect(state.recognisedIn).toEqual([]);
    expect(seen.at(0)).toContain("Ana Lima");
  });

  it("still recognises a typed page when its layer is too thin to trust", async () => {
    state.layerTransform = [2, 0, 0, -2, 0, 400];
    state.pages = [page("Invoice for Ana Lima")];

    await run(detecting(["Ana Lima"]));

    expect(state.recognisedIn).toHaveLength(1);
  });

  it("recognises a page whose viewport gives no transform to place words with", async () => {
    state.layerTransform = undefined;
    state.pages = [
      page("Fatura para Ana Lima em Recife com telefone e endereco e conta e data e mais"),
    ];

    await run(detecting(["Ana Lima"]));

    expect(state.recognisedIn).toHaveLength(1);
  });

  it("covers a name it read out of the text layer", async () => {
    state.layerTransform = [2, 0, 0, -2, 0, 400];
    state.pages = [
      page("Fatura para Ana Lima em Recife com telefone e endereco e conta e data e mais palavras"),
    ];

    const { redactionCount } = await run(detecting(["Ana"]));

    expect(redactionCount).toBeGreaterThan(0);
    expect(state.painted.length).toBeGreaterThan(0);
  });

  it("paints an untouched page when the source cannot be reopened", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];
    state.sourceOpens = false;

    await run(detecting(["Ana Lima"]));

    expect(state.copied).toEqual([]);
    expect(state.drawn.length).toBe(2);
  });

  it("releases every page it opens and the document at the end of the pass", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await pdfRedactor.analyse(file(), detecting(["Ana Lima"]), () => undefined);

    expect(events.filter((entry) => entry.startsWith("cleanup:"))).toHaveLength(2);
    expect(events.filter((entry) => entry === "destroy")).toHaveLength(1);
  });

  it("releases the document on the apply pass too", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    await run(detecting(["Ana Lima"]));

    expect(events.filter((entry) => entry === "destroy")).toHaveLength(2);
  });

  it("still releases the document when the job is cancelled mid-pass", async () => {
    state.pages = [page("Invoice total due"), page("Signed by Ana Lima")];

    const stopped = pdfRedactor.analyse(file(), detecting([]), (_fraction, stage) => {
      if (stage === "stage.detecting") {
        throw new Error("cancelled");
      }
    });

    await expect(stopped).rejects.toThrow("cancelled");
    expect(events).toContain("destroy");
    expect(events.some((entry) => entry.startsWith("cleanup:"))).toBe(true);
  });

  it("keeps only the word geometry in the handle it hands to apply", async () => {
    const analysis = await pdfRedactor.analyse(file(), detecting(["Ana"]), () => undefined);
    const [first] = (analysis.handle as { pages: Array<Record<string, unknown>> }).pages;

    expect(Object.keys(first)).toEqual(["words"]);
  });

  it("refuses a handle whose pages carry no words", async () => {
    const analysis = await pdfRedactor.analyse(file(), detecting(["Ana"]), () => undefined);

    await expect(
      pdfRedactor.apply({
        analysis: { ...analysis, handle: { pages: [{}] } },
        decisions: { covered: [] },
        detect: detecting([]),
        file: file(),
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/no recognised pages/v);
  });

  it("leaves a role the first page defined out of the detections on every page", async () => {
    state.pages = [
      page('Zora Labs, Inc. ("Client") engages Ana Lima'),
      page("Client will pay Ana Lima"),
    ];

    const analysis = await pdfRedactor.analyse(
      file(),
      detectingEvery(["Client", "Ana Lima"]),
      () => undefined,
    );

    expect(analysis.detections.map((detection) => detection.preview)).toEqual([
      "Ana Lima",
      "Ana Lima",
    ]);
  });

  it("reads a filled form by its layout, not by the order the layer lists it", async () => {
    state.layerTransform = [2, 0, 0, -2, 0, 400];
    state.pages = [
      {
        layer: "Name of Recipient Please Print Ana Lima The parties have executed this agreement",
        layout: [
          [0, 100],
          [40, 100],
          [80, 100],
          [120, 100],
          [160, 100],
          [0, 120],
          [40, 120],
          [0, 140],
          [40, 140],
          [80, 140],
          [120, 140],
          [160, 140],
          [200, 140],
        ],
        words: [],
      },
    ];

    const seen: Array<string> = [];

    await run((text) => {
      seen.push(text);

      return detecting([])(text);
    });

    expect(seen.at(0)).toBe(
      "The parties have executed this agreement Ana Lima Name of Recipient Please Print",
    );
  });
});
