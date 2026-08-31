import { afterEach, describe, expect, it, vi } from "vitest";

import { purgeStaleModels } from "./purge-stale-models";

const REVISION = "2e0397a7e8a250d76c37122232b3cbde42c8d629";

const OPTIONS = { keepFiles: ["model_q4.onnx"], revision: REVISION };

const request = (url: string) => ({ url });

const stubCaches = (urls: Array<string>) => {
  const deleted: Array<string> = [];
  const cache = {
    delete: (entry: { url: string }) => {
      deleted.push(entry.url);

      return Promise.resolve(true);
    },
    keys: () => Promise.resolve(urls.map(request)),
  };

  vi.stubGlobal("caches", { open: () => Promise.resolve(cache) });

  return deleted;
};

describe("purgeStaleModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes weights of other models and revisions, keeps the current ones", async () => {
    const deleted = stubCaches([
      "https://huggingface.co/openai/privacy-filter/resolve/7ffa9a04/onnx/model_q4f16.onnx_data",
      `https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/${REVISION}/onnx/model_q4.onnx`,
      `https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/${REVISION}/tokenizer.json`,
    ]);

    await purgeStaleModels(OPTIONS);

    expect(deleted).toEqual([
      "https://huggingface.co/openai/privacy-filter/resolve/7ffa9a04/onnx/model_q4f16.onnx_data",
    ]);
  });

  it("deletes a current-revision weight file the app no longer uses", async () => {
    const deleted = stubCaches([
      `https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/${REVISION}/onnx/model_fp16.onnx`,
      `https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/${REVISION}/onnx/model_q4.onnx`,
    ]);

    await purgeStaleModels(OPTIONS);

    expect(deleted).toEqual([
      `https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/${REVISION}/onnx/model_fp16.onnx`,
    ]);
  });

  it("leaves entries that are not model downloads alone", async () => {
    const deleted = stubCaches(["https://example.com/other-thing.json"]);

    await purgeStaleModels(OPTIONS);

    expect(deleted).toEqual([]);
  });

  it("does nothing where the Cache API does not exist", async () => {
    await expect(purgeStaleModels(OPTIONS)).resolves.toBeUndefined();
  });
});

const storeHolding = (urls: Array<string>) => {
  const held = new Set(urls);

  return {
    cleared: held,
    store: {
      append: () => Promise.resolve(),
      clear: (url: string) => {
        held.delete(url);

        return Promise.resolve();
      },
      listUrls: () => Promise.resolve([...held]),
      readManifest: () => Promise.resolve(undefined),
      readOffsets: () => Promise.resolve([]),
      readParts: () => Promise.resolve([]),
      writeManifest: () => Promise.resolve(),
    },
  };
};

const options = (store: ReturnType<typeof storeHolding>["store"]) => ({
  keepFiles: ["model_q4.onnx"],
  revision: "current",
  store,
});

describe("sweeping the chunk store", () => {
  it("clears a partial download of a superseded revision", async () => {
    const { cleared, store } = storeHolding([
      "https://huggingface.co/org/model/resolve/old/onnx/model_q4.onnx",
      "https://huggingface.co/org/model/resolve/current/onnx/model_q4.onnx",
    ]);

    await purgeStaleModels(options(store));

    expect([...cleared]).toEqual([
      "https://huggingface.co/org/model/resolve/current/onnx/model_q4.onnx",
    ]);
  });

  it("leaves a url that is not a model alone", async () => {
    const { cleared, store } = storeHolding(["https://example.com/whatever.bin"]);

    await purgeStaleModels(options(store));

    expect([...cleared]).toEqual(["https://example.com/whatever.bin"]);
  });

  it("does not fail the sweep when one clear rejects", async () => {
    const { store } = storeHolding([
      "https://huggingface.co/org/model/resolve/old/onnx/model_q4.onnx",
    ]);

    await expect(
      purgeStaleModels(options({ ...store, clear: () => Promise.reject(new Error("locked")) })),
    ).resolves.toBeUndefined();
  });
});
