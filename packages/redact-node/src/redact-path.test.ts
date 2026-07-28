import type { Detect, RedactionResult, Redactor } from "@repo/redact-core";
import { UnsupportedFileError } from "@repo/redact-core";
import type * as RedactImage from "@repo/redact-image";
import type * as RedactPdf from "@repo/redact-pdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

// The two recogniser-backed redactors are stood down, keeping their real `accepts`:
// what is under test is which one a path reaches, and running either for real means
// a wasm build, a language download and a minute of OCR. The text redactor stays
// real, so one file does go through end to end.
const stubResult = (): Promise<RedactionResult> =>
  Promise.resolve({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
    redactionCount: 7,
    warnings: ["warning.scannedPages"],
  });

const redactPdf = vi.fn<Redactor["redact"]>(stubResult);
const redactImage = vi.fn<Redactor["redact"]>(stubResult);

vi.mock("@repo/redact-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof RedactPdf>();

  return { ...actual, pdfRedactor: { accepts: actual.pdfRedactor.accepts, redact: redactPdf } };
});

vi.mock("@repo/redact-image", async (importOriginal) => {
  const actual = await importOriginal<typeof RedactImage>();

  return {
    ...actual,
    imageRedactor: { accepts: actual.imageRedactor.accepts, redact: redactImage },
  };
});

const { redactPath } = await import("./redact-path.ts");

// Tags every "John Smith" it is shown, wherever it sits.
const detecting = (target: string): Detect =>
  vi.fn((text: string) => {
    const spans = [];

    for (let start = text.indexOf(target); start !== -1; start = text.indexOf(target, start + 1)) {
      spans.push({
        end: start + target.length,
        label: "private_person" as const,
        score: 0.9,
        start,
      });
    }

    return Promise.resolve(spans);
  });

const nothing: Detect = () => Promise.resolve([]);

const run = (name: string, detect: Detect = nothing) => {
  const stages: Array<string> = [];

  return redactPath(`${FIXTURES}${name}`, detect, (_fraction, stage) => {
    stages.push(stage);
  }).then((result) => ({ ...result, stages }));
};

beforeEach(() => {
  redactPdf.mockClear();
  redactImage.mockClear();
});

describe("redactPath", () => {
  it("sends a PDF to the pdf redactor", async () => {
    await run("sample.pdf");

    expect(redactPdf).toHaveBeenCalledTimes(1);
    expect(redactImage).not.toHaveBeenCalled();
  });

  it("sends a PNG to the image redactor", async () => {
    await run("sample.png");

    expect(redactImage).toHaveBeenCalledTimes(1);
    expect(redactPdf).not.toHaveBeenCalled();
  });

  it("sends a markdown file to the text redactor", async () => {
    const { bytes } = await run("sample.md");

    expect(redactPdf).not.toHaveBeenCalled();
    expect(redactImage).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(bytes)).toContain("#");
  });

  it("hands the redactor a file named and typed after the path", async () => {
    await run("sample.pdf");

    const [file] = redactPdf.mock.calls[0];

    expect(file.name).toBe("sample.pdf");
    expect(file.type).toBe("application/pdf");
  });

  it("turns away a file no redactor takes", async () => {
    await expect(run("../packages/redact-node/vitest.config.ts")).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it("passes the count and the warnings through as the redactor reported them", async () => {
    const { redactionCount, warnings } = await run("sample.pdf");

    expect(redactionCount).toBe(7);
    expect(warnings).toEqual(["warning.scannedPages"]);
  });

  it("hands back bytes rather than a blob, since nothing downstream is a browser", async () => {
    const { bytes } = await run("sample.pdf");

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("covers a name it was told about and counts it", async () => {
    const { bytes, redactionCount } = await run("sample.txt", detecting("John Smith"));
    const text = new TextDecoder().decode(bytes);

    expect(text).not.toContain("John Smith");
    expect(text).toContain("█");
    expect(redactionCount).toBeGreaterThan(0);
  });

  it("leaves the rest of the file alone", async () => {
    const { bytes } = await run("sample.txt", detecting("John Smith"));

    expect(new TextDecoder().decode(bytes)).toContain("Meeting notes");
  });

  it("reports the stages a reader watches go by", async () => {
    const { stages } = await run("sample.txt");

    expect(stages[0]).toBe("stage.reading");
    expect(stages.at(-1)).toBe("stage.finished");
  });
});
