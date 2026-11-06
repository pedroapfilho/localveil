import { warnRecoverable } from "@repo/redact-core";

import type { ModelSpec } from "./catalog";
import { HUB, revisionUrl, weightsUrl } from "./catalog";
import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import type { FileProgress, Persistence } from "./model-files";
import { CATALOGUED, downloadInOrder, keptStatus, openInOrder, ownedUrls } from "./model-files";
import type { ModelStatus, OpenModel, PlatformModelStore } from "./model-status";
import { bankedBytes, downloadResumable } from "./resumable-download";
import { settleAll } from "./settle-all";

const CACHE_KEY = "transformers-cache";
const CHUNK_SIZE = 8 * 1024 * 1024;

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

const isStale = (url: string) => url.startsWith(HUB) && !CATALOGUED.has(url);

const warnStorageFailed = (url: string, cause: unknown) => {
  warnRecoverable(`Could not keep ${url} in the browser cache`, cause);
};

const createBrowserModelStore = (chunks: ChunkStore): PlatformModelStore => {
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

  // Chunks banked by an interrupted download sit in IndexedDB until the last one lands.
  const inspectModel = async (model: ModelSpec): Promise<ModelStatus> => {
    const cache = await openCache();

    return keptStatus(
      model,
      async (url) => {
        const hit = await cache.match(url);

        return hit === undefined ? undefined : sizeOf(hit);
      },
      () => bankedBytes(chunks, weightsUrl(model)),
    );
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

  const removeModel = (model: ModelSpec): Promise<void> => {
    const owned = new Set(ownedUrls(model));

    return withLock(revisionUrl(model), "exclusive", () => clearWhere((url) => owned.has(url)));
  };

  return { downloadModel, inspectModel, openModel, removeModel };
};

const modelStore = createBrowserModelStore(createIndexedDbChunkStore());

export { createBrowserModelStore, modelStore };
