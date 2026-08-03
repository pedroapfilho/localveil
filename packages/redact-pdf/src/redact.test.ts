import type * as Ocr from "@repo/ocr";
import type { Bbox, Detect, FileStageKey } from "@repo/redact-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const events: Array<string> = [];

type FakePage = { layer: string; words: Array<string> };

const state = {
  confidence: 90,
  confidenceOf: (_text: string) => 95,
  drawn: [] as Array<Array<string>>,
  drawTextThrowsOn: undefined as string | undefined,
  language: "en" as "en" | "es" | "pt",
  pages: [] as Array<FakePage>,
  painted: [] as Array<string>,
  recognisedIn: [] as Array<string | undefined>,
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
    promise: Promise.resolve({
      getPage: (number: number) =>
        Promise.resolve({
          cleanup: () => undefined,
          getTextContent: () => {
            events.push(`text:${String(number)}`);

            return Promise.resolve({
              items: state.pages[number - 1].layer.split(" ").map((str) => ({ str })),
            });
          },
          getViewport: () => ({ height: 200, width: 400 }),
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
        addPage: () => {
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
        embedFont: () => Promise.resolve({}),
        embedPng: () => Promise.resolve({}),
        save: () => Promise.resolve(new Uint8Array([37, 80, 68, 70])),
      }),
  },
  StandardFonts: { Helvetica: "Helvetica" },
}));

vi.mock("@repo/ocr", async (importOriginal) => ({
  ...(await importOriginal<typeof Ocr>()),
  detectLanguage: () => ({ confidence: 0.9, language: state.language }),
  readImageText: (_image: unknown, options: { known?: string } = {}) => {
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

const { pdfRedactor } = await import("./index.ts");

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

const run = (detect: Detect = detecting([])) => {
  const stages: Array<FileStageKey> = [];

  return pdfRedactor
    .redact(file(), detect, (_fraction, stage) => {
      stages.push(stage);
    })
    .then((result) => ({ ...result, stages }));
};

const page = (layer: string, words = layer.split(" ")): FakePage => ({ layer, words });

beforeEach(() => {
  events.length = 0;
  state.confidence = 90;
  state.drawn = [];
  state.drawTextThrowsOn = undefined;
  state.language = "en";
  state.pages = [page("Invoice for Ana Lima")];
  state.confidenceOf = () => 95;
  state.painted = [];
  state.recognisedIn = [];

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

    await run(detecting(["Signed by Ana Lima"]));

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

    const { warnings } = await run();

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

  it("recognises every page in the language the caller forced", async () => {
    state.pages = [{ layer: "", words: ["Ana", "Lima"] }, page("Signed by Ana Lima")];

    const stages: Array<FileStageKey> = [];

    await pdfRedactor.redact(
      file(),
      detecting([]),
      (_fraction, stage) => {
        stages.push(stage);
      },
      { language: "pt" },
    );

    expect(state.recognisedIn).toEqual(["pt", "pt"]);
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

    expect(state.drawn.length).toBe(3);
  });
});
