/* oxlint-disable anti-slop/no-module-mocking -- tesseract.js is a wasm OCR engine; the module seam is the only practical hermetic substitute */
import { Canvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));

vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

const workerStub = () => ({
  recognize: vi.fn((_image: Uint8Array) =>
    Promise.resolve({ data: { blocks: [], confidence: 90 } }),
  ),
});

const load = () => {
  vi.resetModules();

  return import("./recognize");
};

const page = () => new OffscreenCanvas(4, 4);

beforeEach(() => {
  mocks.createWorker.mockReset();
  vi.stubGlobal("OffscreenCanvas", Canvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the worker cache", () => {
  it("starts one worker per language and reuses it", async () => {
    mocks.createWorker.mockImplementation(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();

    await recognizeWords(page(), "en");
    await recognizeWords(page(), "en");

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
  });

  it("starts a separate worker for a second language", async () => {
    mocks.createWorker.mockImplementation(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();

    await recognizeWords(page(), "en");
    await recognizeWords(page(), "pt");

    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
    expect(mocks.createWorker.mock.calls.map(([name]) => name)).toEqual(["eng", "por"]);
  });

  it("retries a language whose first start failed instead of caching the failure", async () => {
    mocks.createWorker
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementationOnce(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();

    await expect(recognizeWords(page(), "en")).rejects.toThrow("offline");
    await expect(recognizeWords(page(), "en")).resolves.toMatchObject({ confidence: 90 });
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
  });
});

describe("the page handed to the recogniser", () => {
  it("goes over as PNG bytes, which tesseract.js reads the same under Node and in a browser", async () => {
    const worker = workerStub();

    mocks.createWorker.mockImplementation(() => Promise.resolve(worker));

    const { recognizeWords } = await load();

    await recognizeWords(page(), "en");

    const [image] = worker.recognize.mock.calls[0] ?? [];

    expect(image).toBeInstanceOf(Uint8Array);
    expect(image?.slice(0, 4)).toEqual(PNG_MAGIC);
  });
});
