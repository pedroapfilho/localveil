import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelSpec } from "./catalog";
import { modelById, revisionUrl, tokenizerUrls, weightsUrl } from "./catalog";
import { createBrowserModelStore } from "./model-store-browser";
import {
  memoryCaches,
  memoryChunks,
  serveFiles,
  stopAt,
  TOKENIZER_BODY,
  urlOf,
  WEIGHTS_BODY,
} from "./model-store-fixture";

const MODEL = modelById("gliner-pii-base");
const OTHER = modelById("gliner-multi-pii");
const [TOKENIZER, TOKENIZER_CONFIG] = tokenizerUrls(MODEL);
const WEIGHTS = weightsUrl(MODEL);
const EVERYTHING = [TOKENIZER, TOKENIZER_CONFIG, WEIGHTS];
const TOKENIZER_JSON = { model: {} };

const ignore = () => undefined;

const superseded = (model: ModelSpec): ModelSpec => ({ ...model, revision: "0".repeat(40) });

const keepModel = (caches: ReturnType<typeof memoryCaches>, model: ModelSpec) => {
  caches.keep(tokenizerUrls(model), TOKENIZER_BODY);
  caches.keep([weightsUrl(model)], WEIGHTS_BODY);
};

// Holds the requests for one URL back until the test lets them through.
const holdFetch = (held: string) => {
  const serve = fetch;
  const started = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (urlOf(input) === held) {
      started.resolve(undefined);
      await resume.promise;
    }

    return serve(input, init);
  });

  return {
    release: () => {
      resume.resolve(undefined);
    },
    started: started.promise,
  };
};

const queuedFor = (url: string) =>
  vi.waitUntil(async () => {
    const { pending = [] } = await navigator.locks.query();

    return pending.some(({ name }) => name?.endsWith(url) === true);
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inspectModel in the browser", () => {
  it("calls a model ready once its weights and tokenizer are all cached", async () => {
    memoryCaches().keep(EVERYTHING);

    await expect(createBrowserModelStore(memoryChunks()).inspectModel(MODEL)).resolves.toEqual({
      bytes: 1234,
      state: "ready",
    });
  });

  it("counts the chunks an interrupted download banked", async () => {
    memoryCaches();

    const chunks = memoryChunks();

    await chunks.writeManifest(WEIGHTS, { chunkSize: 10, etag: "e", total: 25 });
    await chunks.append(WEIGHTS, 0, new ArrayBuffer(10));
    await chunks.append(WEIGHTS, 20, new ArrayBuffer(5));

    await expect(createBrowserModelStore(chunks).inspectModel(MODEL)).resolves.toEqual({
      loaded: 15,
      state: "partial",
      total: MODEL.bytes,
    });
  });

  it("does not call weights without their tokenizer ready, since they cannot load offline", async () => {
    memoryCaches().keep([WEIGHTS]);

    await expect(createBrowserModelStore(memoryChunks()).inspectModel(MODEL)).resolves.toEqual({
      loaded: 1234,
      state: "partial",
      total: MODEL.bytes,
    });
  });

  it("reports a model with nothing kept as absent", async () => {
    memoryCaches().keep([weightsUrl(OTHER)]);

    await expect(createBrowserModelStore(memoryChunks()).inspectModel(MODEL)).resolves.toEqual({
      state: "absent",
    });
  });
});

describe("downloadModel in the browser", () => {
  it("can cancel while queued behind a model removal without starting a fetch", async () => {
    memoryCaches();
    const asked = serveFiles();
    const listing = Promise.withResolvers<Array<string>>();
    const chunks = memoryChunks();
    const store = createBrowserModelStore({ ...chunks, listUrls: () => listing.promise });
    const controller = new AbortController();

    const removing = store.removeModel(MODEL);

    await vi.waitUntil(async () => {
      const { held = [] } = await navigator.locks.query();

      return held.length > 0;
    });
    const downloading = store.downloadModel(MODEL, ignore, controller.signal);

    controller.abort();
    await expect(downloading).rejects.toThrow(/abort/iv);
    listing.resolve([]);
    await removing;
    expect(asked).toEqual([]);
  });

  it("rejects a failed durable write, then resumes without fetching the banked chunks again", async () => {
    const caches = memoryCaches();
    const asked = serveFiles();
    const chunks = memoryChunks();
    const store = createBrowserModelStore(chunks);
    const weightsAsked = () => asked.filter((url) => url === WEIGHTS).length;

    caches.refuse(WEIGHTS);
    await expect(store.downloadModel(MODEL, ignore)).rejects.toThrow("full");
    await expect(chunks.readOffsets(WEIGHTS)).resolves.toEqual([0]);
    const fetched = weightsAsked();

    caches.allow(WEIGHTS);
    await store.downloadModel(MODEL, ignore);

    expect(weightsAsked()).toBe(fetched + 1);
    await expect(store.inspectModel(MODEL)).resolves.toMatchObject({ state: "ready" });
    await expect(chunks.listUrls()).resolves.toEqual([]);
  });

  it("fetches the tokenizer before the weights and reports only the weights' progress", async () => {
    const caches = memoryCaches();
    const asked = serveFiles();
    const reported: Array<{ fraction: number; weightsAsked: boolean }> = [];

    await createBrowserModelStore(memoryChunks()).downloadModel(MODEL, (fraction) => {
      reported.push({ fraction, weightsAsked: asked.includes(WEIGHTS) });
    });

    const order = [...new Set(asked)];

    expect(order.toSorted()).toEqual(EVERYTHING.toSorted());
    expect(order.at(-1)).toBe(WEIGHTS);
    expect([...caches.entries.keys()].at(-1)).toBe(WEIGHTS);
    expect(reported.every(({ weightsAsked }) => weightsAsked)).toBe(true);
    expect(reported.every(({ fraction }) => fraction >= 0 && fraction <= 1)).toBe(true);
    expect(reported.at(-1)?.fraction).toBe(1);
  });

  it("stops before fetching anything when it is already told to stop", async () => {
    const caches = memoryCaches();
    const asked = serveFiles();
    const controller = new AbortController();

    controller.abort();

    await expect(
      createBrowserModelStore(memoryChunks()).downloadModel(MODEL, ignore, controller.signal),
    ).rejects.toThrow(/abort/iv);
    expect(asked).toEqual([]);
    expect(caches.entries.size).toBe(0);
  });

  it("fetches nothing for a model that is already kept", async () => {
    memoryCaches().keep(EVERYTHING);

    const asked = serveFiles();

    await createBrowserModelStore(memoryChunks()).downloadModel(MODEL, ignore);

    expect(asked).toEqual([]);
  });

  it("refuses to keep or open a model where the browser has no Cache Storage", async () => {
    const store = createBrowserModelStore(memoryChunks());

    await expect(store.downloadModel(MODEL, ignore)).rejects.toThrow(/Cache Storage/v);
    await expect(store.openModel(MODEL, ignore)).rejects.toThrow(/Cache Storage/v);
  });
});

describe("openModel in the browser", () => {
  it("downloads what is missing and hands back the tokenizer pair and the weights", async () => {
    const caches = memoryCaches();

    serveFiles();

    const store = createBrowserModelStore(memoryChunks());

    await expect(store.openModel(MODEL, ignore)).resolves.toEqual({
      tokenizer: TOKENIZER_JSON,
      tokenizerConfig: TOKENIZER_JSON,
      weights: WEIGHTS_BODY,
    });
    expect([...caches.entries.keys()].toSorted()).toEqual(EVERYTHING.toSorted());
    await expect(store.inspectModel(MODEL)).resolves.toEqual({
      bytes: WEIGHTS_BODY.length,
      state: "ready",
    });
  });

  it("opens a model it already keeps again without the network", async () => {
    memoryCaches();
    serveFiles();

    const store = createBrowserModelStore(memoryChunks());
    const first = await store.openModel(MODEL, ignore);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));

    vi.stubGlobal("fetch", offline);

    await expect(store.openModel(MODEL, ignore)).resolves.toEqual(first);
    expect(offline).not.toHaveBeenCalled();
  });

  it("asks for nothing outside the model's pinned revision", async () => {
    memoryCaches();
    const asked = serveFiles();

    await createBrowserModelStore(memoryChunks()).openModel(MODEL, ignore);

    expect(asked.every((url) => url.startsWith(revisionUrl(MODEL)))).toBe(true);
  });

  it("reads the tokenizer before fetching the weights, so a broken one costs no download", async () => {
    memoryCaches().keep(tokenizerUrls(MODEL), new TextEncoder().encode("<html>"));
    const asked = serveFiles();

    await expect(createBrowserModelStore(memoryChunks()).openModel(MODEL, ignore)).rejects.toThrow(
      SyntaxError,
    );
    expect(asked).toEqual([]);
  });

  it("reports no download for a model it already keeps", async () => {
    keepModel(memoryCaches(), MODEL);
    const reported: Array<number> = [];

    await createBrowserModelStore(memoryChunks()).openModel(MODEL, (fraction) => {
      reported.push(fraction);
    });

    expect(reported).toEqual([]);
  });

  it("stops downloading the weights when the load is stopped", async () => {
    const caches = memoryCaches();
    const controller = new AbortController();

    serveFiles();
    stopAt(WEIGHTS, controller);

    await expect(
      createBrowserModelStore(memoryChunks()).openModel(MODEL, ignore, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(caches.entries.has(WEIGHTS)).toBe(false);
  });

  it("reports only the weights' progress", async () => {
    memoryCaches();
    const asked = serveFiles();
    const reported: Array<boolean> = [];

    await createBrowserModelStore(memoryChunks()).openModel(MODEL, () => {
      reported.push(asked.includes(WEIGHTS));
    });

    expect(reported.length).toBeGreaterThan(0);
    expect(reported.every(Boolean)).toBe(true);
  });

  it("still hands back the weights when the browser refuses to keep them, and says so", async () => {
    const caches = memoryCaches();

    serveFiles();
    caches.refuse(WEIGHTS);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const files = await createBrowserModelStore(memoryChunks()).openModel(MODEL, ignore);

    expect(files.weights).toEqual(WEIGHTS_BODY);
    expect(caches.entries.has(WEIGHTS)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("lets a second tab take the weights the first is fetching instead of fetching them again", async () => {
    memoryCaches();
    const asked = serveFiles();
    const chunks = memoryChunks();
    const { release, started } = holdFetch(WEIGHTS);

    const first = createBrowserModelStore(chunks).openModel(MODEL, ignore);

    await started;
    const second = createBrowserModelStore(chunks).openModel(MODEL, ignore);

    await queuedFor(WEIGHTS);
    release();

    const [firstFiles, secondFiles] = await Promise.all([first, second]);

    expect(secondFiles).toEqual(firstFiles);
    // One size probe and one range, both from the first tab.
    expect(asked.filter((url) => url === WEIGHTS)).toHaveLength(2);
  });

  it("holds a removal back until the model has finished loading", async () => {
    memoryCaches();
    serveFiles();
    const { release, started } = holdFetch(WEIGHTS);
    const store = createBrowserModelStore(memoryChunks());
    let removed = false;

    const opening = store.openModel(MODEL, ignore);

    await started;
    const remove = async () => {
      await store.removeModel(MODEL);
      removed = true;
    };
    const removing = remove();

    // Another model's removal is not held back, so this waits only on the lock under test.
    await store.removeModel(OTHER);
    const removedWhileLoading = removed;

    release();
    await Promise.all([opening, removing]);

    expect(removedWhileLoading).toBe(false);
    await expect(store.inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
  });

  it("clears superseded revisions and dropped exports, and keeps every catalogued model", async () => {
    const caches = memoryCaches();

    serveFiles();
    const chunks = memoryChunks();
    const droppedExport = `${revisionUrl(MODEL)}onnx/model_fp16.onnx`;
    const elsewhere = "https://example.com/other-thing.json";

    caches.keep([
      weightsUrl(superseded(MODEL)),
      tokenizerUrls(superseded(OTHER))[0],
      droppedExport,
      weightsUrl(OTHER),
      elsewhere,
    ]);
    await chunks.writeManifest(weightsUrl(superseded(OTHER)), {
      chunkSize: 10,
      etag: "e",
      total: 25,
    });
    await chunks.writeManifest(weightsUrl(OTHER), { chunkSize: 10, etag: "e", total: 25 });

    await createBrowserModelStore(chunks).openModel(MODEL, ignore);

    expect([...caches.entries.keys()].toSorted()).toEqual(
      [...EVERYTHING, weightsUrl(OTHER), elsewhere].toSorted(),
    );
    await expect(chunks.listUrls()).resolves.toEqual([weightsUrl(OTHER)]);
  });

  it("still opens the model when clearing superseded files fails", async () => {
    keepModel(memoryCaches(), MODEL);
    const chunks = memoryChunks();
    const stale = weightsUrl(superseded(MODEL));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await chunks.writeManifest(stale, { chunkSize: 10, etag: "e", total: 25 });

    const store = createBrowserModelStore({
      ...chunks,
      clear: (url) => (url === stale ? Promise.reject(new Error("locked")) : chunks.clear(url)),
    });

    await expect(store.openModel(MODEL, ignore)).resolves.toMatchObject({ weights: WEIGHTS_BODY });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("removeModel in the browser", () => {
  it("waits for an active download before deleting every file", async () => {
    const caches = memoryCaches();

    serveFiles();
    const { release, started } = holdFetch(WEIGHTS);
    const store = createBrowserModelStore(memoryChunks());

    const downloading = store.downloadModel(MODEL, ignore);

    await started;
    const removing = store.removeModel(MODEL);

    // The independent model can still finish while removal waits for this model's reader.
    await store.downloadModel(OTHER, ignore);
    const keptWhileDownloading = caches.entries.has(TOKENIZER);

    release();
    await Promise.all([downloading, removing]);

    expect(keptWhileDownloading).toBe(true);
    await expect(store.inspectModel(MODEL)).resolves.toEqual({ state: "absent" });
    for (const url of EVERYTHING) {
      expect(caches.entries.has(url)).toBe(false);
    }
    await expect(store.inspectModel(OTHER)).resolves.toMatchObject({ state: "ready" });
  });

  it("waits for the sibling tokenizer write even if the other tokenizer failed", async () => {
    const caches = memoryCaches();

    serveFiles();
    const { release, started } = holdFetch(TOKENIZER_CONFIG);
    const held = fetch;
    const chunks = memoryChunks();
    const store = createBrowserModelStore(chunks);

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      urlOf(input) === TOKENIZER ? Promise.reject(new Error("offline")) : held(input, init),
    );

    const removeMidDownload = async () => {
      await started;
      const removing = store.removeModel(MODEL);

      release();
      await removing;
    };

    await Promise.all([
      expect(store.downloadModel(MODEL, ignore)).rejects.toThrow("offline"),
      removeMidDownload(),
    ]);

    expect(caches.entries.size).toBe(0);
    await expect(chunks.listUrls()).resolves.toEqual([]);
  });

  it("clears one model's cached files and banked chunks and leaves the other model alone", async () => {
    const caches = memoryCaches();
    const chunks = memoryChunks();

    caches.keep([TOKENIZER, WEIGHTS, weightsUrl(OTHER)]);
    await chunks.writeManifest(WEIGHTS, { chunkSize: 10, etag: "e", total: 25 });
    await chunks.writeManifest(weightsUrl(OTHER), { chunkSize: 10, etag: "e", total: 25 });

    await createBrowserModelStore(chunks).removeModel(MODEL);

    expect([...caches.entries.keys()]).toEqual([weightsUrl(OTHER)]);
    await expect(chunks.listUrls()).resolves.toEqual([weightsUrl(OTHER)]);
  });
});
