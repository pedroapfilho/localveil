import type { ImageLike } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));

vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

const workerStub = () => ({
  recognize: vi.fn(() => Promise.resolve({ data: { blocks: [], confidence: 90 } })),
});

const load = () => {
  vi.resetModules();

  return import("./recognize.ts");
};

beforeEach(() => {
  mocks.createWorker.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the worker cache", () => {
  it("starts one worker per language and reuses it", async () => {
    mocks.createWorker.mockImplementation(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();
    const image = {} as ImageLike;

    await recognizeWords(image, "en");
    await recognizeWords(image, "en");

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
  });

  it("starts a separate worker for a second language", async () => {
    mocks.createWorker.mockImplementation(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();
    const image = {} as ImageLike;

    await recognizeWords(image, "en");
    await recognizeWords(image, "pt");

    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
    expect(mocks.createWorker.mock.calls.map(([name]) => name)).toEqual(["eng", "por"]);
  });

  it("retries a language whose first start failed instead of caching the failure", async () => {
    mocks.createWorker
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementationOnce(() => Promise.resolve(workerStub()));

    const { recognizeWords } = await load();
    const image = {} as ImageLike;

    await expect(recognizeWords(image, "en")).rejects.toThrow("offline");
    await expect(recognizeWords(image, "en")).resolves.toMatchObject({ confidence: 90 });
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
  });
});
