import type { ModelSpec } from "./catalog";
import { revisionUrl, tokenizerUrls, weightsUrl } from "./catalog";
import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import type { FileProgress, Persistence } from "./model-files";
import { CATALOGUED, downloadInOrder, openInOrder } from "./model-files";
import type { ModelStatus, ModelStore, OpenModel } from "./model-status";
import { bankedBytes, downloadResumable } from "./resumable-download";
import { settleAll } from "./settle-all";

type BrowserModelStore = ModelStore & {
  openModel: OpenModel;
  seedModelFile: (url: string, bytes: ArrayBuffer) => Promise<void>;
};

const CACHE_KEY = "transformers-cache";
const CHUNK_SIZE = 8 * 1024 * 1024;
const MODEL_HOST = "huggingface.co";

const lockManagerOf = ({ locks }: { locks?: LockManager }) => locks;

// Shared model access spans all its files; removal takes the same lock exclusively.
// Individual files also take an exclusive lock so overlapping readers fetch only once.
const withLock = <T>(
  name: string,
  mode: LockMode,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const locks = lockManagerOf(globalThis.navigator);

  if (locks === undefined) {
    return Promise.reject(new Error("This browser cannot coordinate model storage"));
  }

  return locks.request(`localveil-model:${name}`, { mode, signal }, run);
};

const openCache = () =>
  "caches" in globalThis
    ? caches.open(CACHE_KEY)
    : Promise.reject(new Error("This browser has no Cache Storage, so a model cannot be kept"));

const sized = (blob: Blob) =>
  new Response(blob, { headers: { "content-length": String(blob.size) } });

const sizeOf = (response: Response) => Number(response.headers.get("content-length"));

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

const isStale = (url: string) => url.includes(MODEL_HOST) && !CATALOGUED.has(url);

const warnStorageFailed = (url: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console -- a cache write failure is recoverable, so it is surfaced in the console instead of thrown
  console.warn(`Could not keep ${url} in the browser cache`, cause);
};

const createBrowserModelStore = (chunks: ChunkStore): BrowserModelStore => {
  const keepInCache = async (cache: Cache, url: string, blob: Blob, persistence: Persistence) => {
    try {
      await cache.put(url, sized(blob));
    } catch (error) {
      if (persistence === "required") {
        throw error;
      }

      warnStorageFailed(url, error);

      return;
    }

    // Keep resumable bytes until the durable copy has landed.
    await chunks.clear(url);
  };

  const keepFile = async (
    url: string,
    persistence: Persistence,
    onProgress: FileProgress,
    signal?: AbortSignal,
  ): Promise<Response> => {
    signal?.throwIfAborted();

    const cache = await openCache();
    const hit = await cache.match(url);

    if (hit !== undefined) {
      return hit;
    }

    return withLock(
      url,
      "exclusive",
      async () => {
        const arrived = await cache.match(url);

        if (arrived !== undefined) {
          return arrived;
        }

        const blob = await downloadResumable(url, {
          chunkSize: CHUNK_SIZE,
          fetchRange: fetch,
          onProgress: (loaded, total) => {
            if (total > 0) {
              onProgress(Math.min(loaded / total, 1));
            }
          },
          signal,
          store: chunks,
        });

        await keepInCache(cache, url, blob, persistence);

        return sized(blob);
      },
      signal,
    );
  };

  const clearWhere = async (matches: (url: string) => boolean) => {
    const cache = await openCache();
    const [requests, urls] = await Promise.all([cache.keys(), chunks.listUrls()]);

    await settleAll([
      ...requests.flatMap((request) => (matches(request.url) ? [cache.delete(request)] : [])),
      ...urls.flatMap((url) => (matches(url) ? [chunks.clear(url)] : [])),
    ]);
  };

  /* Ready needs every file in Cache Storage. Chunks banked by an interrupted download sit in
     IndexedDB until the last one lands, and they count toward partial. */
  const inspectModel = async (model: ModelSpec): Promise<ModelStatus> => {
    const cache = await openCache();
    const [weights, ...tokenizer] = await Promise.all(
      [weightsUrl(model), ...tokenizerUrls(model)].map((url) => cache.match(url)),
    );

    if (weights === undefined) {
      const loaded = await bankedBytes(chunks, weightsUrl(model));

      return loaded > 0 ? { loaded, state: "partial", total: model.bytes } : { state: "absent" };
    }

    return tokenizer.every((hit) => hit !== undefined)
      ? { bytes: sizeOf(weights), state: "ready" }
      : { loaded: sizeOf(weights), state: "partial", total: model.bytes };
  };

  const downloadModel = async (
    model: ModelSpec,
    onProgress: FileProgress,
    signal?: AbortSignal,
  ): Promise<void> => {
    await withLock(
      revisionUrl(model),
      "shared",
      () =>
        downloadInOrder(model, onProgress, (url, progress) =>
          keepFile(url, "required", progress, signal),
        ),
      signal,
    );

    onProgress(1);
  };

  const openModel: OpenModel = (model, onProgress, signal) =>
    withLock(
      revisionUrl(model),
      "shared",
      () =>
        openInOrder(
          model,
          onProgress,
          async (url, progress) => bytesOf(await keepFile(url, "best-effort", progress, signal)),
          () => clearWhere(isStale),
        ),
      signal,
    );

  const removeModel = (model: ModelSpec): Promise<void> =>
    withLock(revisionUrl(model), "exclusive", () =>
      clearWhere((url) => url.startsWith(revisionUrl(model))),
    );

  const seedModelFile = async (url: string, bytes: ArrayBuffer) => {
    const cache = await openCache();

    await withLock(url, "exclusive", () => keepInCache(cache, url, new Blob([bytes]), "required"));
  };

  return { downloadModel, inspectModel, openModel, removeModel, seedModelFile };
};

const { downloadModel, inspectModel, openModel, removeModel, seedModelFile } =
  createBrowserModelStore(createIndexedDbChunkStore());

export {
  createBrowserModelStore,
  downloadModel,
  inspectModel,
  openModel,
  removeModel,
  seedModelFile,
};
