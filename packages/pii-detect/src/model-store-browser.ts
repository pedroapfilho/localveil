import type { ModelSpec } from "./catalog";
import { revisionUrl, tokenizerUrls, weightsUrl } from "./catalog";
import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import type { ModelStatus } from "./model-status";
import { CACHE_KEY, createResumableCache } from "./resumable-cache";

const filesOf = (model: ModelSpec) => [...tokenizerUrls(model), weightsUrl(model)];

const heldBytes = async (store: ChunkStore, url: string) => {
  const manifest = await store.readManifest(url);

  if (manifest === undefined) {
    return 0;
  }

  const offsets = await store.readOffsets(url);

  return offsets.reduce(
    (sum, start) => sum + Math.min(manifest.chunkSize, manifest.total - start),
    0,
  );
};

const sizeOf = (response: Response, fallback: number) => {
  const length = Number(response.headers.get("content-length"));

  return Number.isFinite(length) && length > 0 ? length : fallback;
};

/* Ready means every file the detector asks for is in Cache Storage, so the next load makes no
   request at all. Chunks banked by an interrupted download sit in IndexedDB until the last one
   lands, and they are what "partial" counts. */
const inspectModel = async (
  model: ModelSpec,
  store: ChunkStore = createIndexedDbChunkStore(),
): Promise<ModelStatus> => {
  if (!("caches" in globalThis)) {
    return { state: "absent" };
  }

  const cache = await caches.open(CACHE_KEY);
  const hits = await Promise.all(filesOf(model).map((url) => cache.match(url)));
  const weights = hits.at(-1);

  if (weights !== undefined) {
    return hits.every((hit) => hit !== undefined)
      ? { bytes: sizeOf(weights, model.bytes), state: "ready" }
      : { loaded: model.bytes, state: "partial", total: model.bytes };
  }

  const loaded = await heldBytes(store, weightsUrl(model));

  return loaded > 0 ? { loaded, state: "partial", total: model.bytes } : { state: "absent" };
};

const downloadModel = async (
  model: ModelSpec,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  store: ChunkStore = createIndexedDbChunkStore(),
): Promise<void> => {
  if (!("caches" in globalThis)) {
    throw new Error("This browser has no Cache Storage, so a model cannot be kept");
  }

  const weights = weightsUrl(model);
  const cache = createResumableCache({
    onProgress: ({ loaded, name, total }) => {
      if (name === weights && total > 0) {
        onProgress(Math.min(loaded / total, 1));
      }
    },
    signal,
    store,
  });

  // The tokenizer goes first: it is a few megabytes, and a model without it cannot load offline.
  for (const url of filesOf(model)) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    const response = await cache.match(url);

    if (response === undefined) {
      throw new Error(`${url} could not be downloaded`);
    }
  }

  onProgress(1);
};

const removeModel = async (
  model: ModelSpec,
  store: ChunkStore = createIndexedDbChunkStore(),
): Promise<void> => {
  const prefix = revisionUrl(model);
  const sweeps: Array<Promise<unknown>> = [];

  if ("caches" in globalThis) {
    const cache = await caches.open(CACHE_KEY);

    for (const request of await cache.keys()) {
      if (request.url.startsWith(prefix)) {
        sweeps.push(cache.delete(request));
      }
    }
  }

  for (const url of await store.listUrls()) {
    if (url.startsWith(prefix)) {
      sweeps.push(store.clear(url));
    }
  }

  await Promise.all(sweeps);
};

export { downloadModel, inspectModel, removeModel };
