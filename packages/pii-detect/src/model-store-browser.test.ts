import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelById, tokenizerUrls, weightsUrl } from "./catalog";
import { memoryStore } from "./chunk-store-fixture";
import { downloadModel, inspectModel, removeModel } from "./model-store-browser";

const MODEL = modelById("gliner-pii-base");
const OTHER = modelById("gliner-multi-pii");
const [TOKENIZER, TOKENIZER_CONFIG] = tokenizerUrls(MODEL);
const WEIGHTS = weightsUrl(MODEL);

const memoryCaches = (held: Array<string> = []) => {
  // The resumable cache writes content-length on every entry it keeps; the size comes from there.
  const entries = new Map(
    held.map((url) => [url, new Response("x", { headers: { "content-length": "1234" } })]),
  );

  vi.stubGlobal("caches", {
    open: () =>
      Promise.resolve({
        delete: (request: { url: string }) => Promise.resolve(entries.delete(request.url)),
        keys: () => Promise.resolve([...entries.keys()].map((url) => ({ url }))),
        match: (url: string) => Promise.resolve(entries.get(url)),
        put: (url: string, response: Response) => {
          entries.set(url, response);

          return Promise.resolve();
        },
      }),
  });

  return entries;
};

const BODY = new Uint8Array(40);

const serveRanges = () => {
  const asked: Array<string> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const [start, end] = (new Headers(init?.headers).get("Range") ?? "")
        .replace("bytes=", "")
        .split("-")
        .map(Number);

      asked.push(url);

      return Promise.resolve(
        new Response(BODY.slice(start, end + 1), {
          headers: { "content-range": `bytes ${String(start)}-${String(end)}/40`, etag: url },
          status: 206,
        }),
      );
    }),
  );

  return asked;
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inspectModel in the browser", () => {
  it("calls a model ready once its weights and tokenizer are all cached", async () => {
    memoryCaches([TOKENIZER, TOKENIZER_CONFIG, WEIGHTS]);

    await expect(inspectModel(MODEL, memoryStore())).resolves.toEqual({
      bytes: 1234,
      state: "ready",
    });
  });

  it("counts the chunks an interrupted download banked", async () => {
    memoryCaches();

    const store = memoryStore();

    await store.writeManifest(WEIGHTS, { chunkSize: 10, etag: "e", total: 25 });
    await store.append(WEIGHTS, 0, new ArrayBuffer(10));
    await store.append(WEIGHTS, 20, new ArrayBuffer(5));

    await expect(inspectModel(MODEL, store)).resolves.toEqual({
      loaded: 15,
      state: "partial",
      total: MODEL.bytes,
    });
  });

  it("does not call weights without their tokenizer ready, since they cannot load offline", async () => {
    memoryCaches([WEIGHTS]);

    await expect(inspectModel(MODEL, memoryStore())).resolves.toMatchObject({
      state: "partial",
    });
  });

  it("reports a model with nothing kept as absent", async () => {
    memoryCaches([weightsUrl(OTHER)]);

    await expect(inspectModel(MODEL, memoryStore())).resolves.toEqual({ state: "absent" });
  });

  it("reports absent where the browser has no Cache Storage", async () => {
    await expect(inspectModel(MODEL, memoryStore())).resolves.toEqual({ state: "absent" });
  });
});

describe("downloadModel in the browser", () => {
  it("fetches the tokenizer before the weights and reports only the weights' progress", async () => {
    const entries = memoryCaches();
    const asked = serveRanges();
    const reported: Array<number> = [];

    await downloadModel(
      MODEL,
      (fraction) => {
        reported.push(fraction);
      },
      undefined,
      memoryStore(),
    );

    expect([...new Set(asked)]).toEqual([TOKENIZER, TOKENIZER_CONFIG, WEIGHTS]);
    expect([...entries.keys()]).toEqual([TOKENIZER, TOKENIZER_CONFIG, WEIGHTS]);
    expect(reported.at(-1)).toBe(1);
    expect(reported.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true);
  });

  it("stops before fetching anything when it is already told to stop", async () => {
    const entries = memoryCaches();
    const asked = serveRanges();
    const controller = new AbortController();

    controller.abort();

    await expect(
      downloadModel(MODEL, () => undefined, controller.signal, memoryStore()),
    ).rejects.toThrow(/abort/iv);
    expect(asked).toEqual([]);
    expect(entries.size).toBe(0);
  });

  it("fetches nothing for a model that is already kept", async () => {
    memoryCaches([TOKENIZER, TOKENIZER_CONFIG, WEIGHTS]);

    const asked = serveRanges();

    await downloadModel(MODEL, () => undefined, undefined, memoryStore());

    expect(asked).toEqual([]);
  });

  it("refuses where the browser has no Cache Storage to keep it in", async () => {
    await expect(downloadModel(MODEL, () => undefined, undefined, memoryStore())).rejects.toThrow(
      /Cache Storage/v,
    );
  });
});

describe("removeModel in the browser", () => {
  it("clears one model's cached files and banked chunks and leaves the other model alone", async () => {
    const entries = memoryCaches([TOKENIZER, WEIGHTS, weightsUrl(OTHER)]);
    const store = memoryStore();

    await store.writeManifest(WEIGHTS, { chunkSize: 10, etag: "e", total: 25 });
    await store.writeManifest(weightsUrl(OTHER), { chunkSize: 10, etag: "e", total: 25 });

    await removeModel(MODEL, store);

    expect([...entries.keys()]).toEqual([weightsUrl(OTHER)]);
    await expect(store.listUrls()).resolves.toEqual([weightsUrl(OTHER)]);
  });
});
