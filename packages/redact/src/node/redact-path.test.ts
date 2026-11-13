import type { Detect } from "@repo/redact-core";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type * as RedactImage from "../image/index";
import type * as RedactPdf from "../pdf/index";
import { RedactionFailure } from "../pipeline/failure";
/* oxlint-disable anti-slop/no-module-mocking -- the PDF and image redactors wrap wasm/canvas engines; the module seam is the only practical hermetic substitute */
import type { Analysis, Painted, Redactor } from "../pipeline/types";

const FIXTURES = new URL("../../../../fixtures/", import.meta.url).pathname;

const stubResult = (): Promise<Painted> =>
  Promise.resolve({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
    name: "redacted.pdf",
    visible: "",
    warnings: ["warning.droppedCharacters"],
  });

const stubAnalysis = (): Promise<Analysis> =>
  Promise.resolve({ detections: [], units: [], warnings: [] });

const redactPdf = vi.fn<Redactor["apply"]>(stubResult);
const redactImage = vi.fn<Redactor["apply"]>(stubResult);

vi.mock("../pdf/index", async (importOriginal) => {
  const actual = await importOriginal<typeof RedactPdf>();

  return {
    ...actual,
    createPdfRedactor: () => ({ analyse: stubAnalysis, apply: redactPdf }),
  };
});

vi.mock("../image/index", async (importOriginal) => {
  const actual = await importOriginal<typeof RedactImage>();

  return {
    ...actual,
    createImageRedactor: () => ({ analyse: stubAnalysis, apply: redactImage }),
  };
});

const { redactPath } = await import("./redact-path");

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

  it("passes on the name the redactor gave its output", async () => {
    const { name } = await run("sample.png");

    expect(name).toBe("redacted.pdf");
  });

  it("sends a markdown file to the text redactor", async () => {
    const { bytes } = await run("sample.md");

    expect(redactPdf).not.toHaveBeenCalled();
    expect(redactImage).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(bytes)).toContain("#");
  });

  it("hands the redactor a file named and typed after the path", async () => {
    await run("sample.pdf");

    const call = redactPdf.mock.calls[0];

    assert.isDefined(call);

    const [{ file }] = call;

    expect(file.name).toBe("sample.pdf");
    expect(file.type).toBe("application/pdf");
  });

  it("turns away a file no redactor takes", async () => {
    await expect(run("../packages/redact/vitest.config.ts")).rejects.toBeInstanceOf(
      RedactionFailure,
    );
  });

  it("passes the warnings painting raised through", async () => {
    const { redactionCount, warnings } = await run("sample.pdf");

    expect(redactionCount).toBe(0);
    expect(warnings).toEqual(["warning.droppedCharacters"]);
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
