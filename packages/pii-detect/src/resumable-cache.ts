import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import { downloadResumable } from "./resumable-download";

type ResumableCache = {
  match: (name: string) => Promise<Response | undefined>;
  put: (name: string, response: Response) => Promise<void>;
};

type CacheProgress = { loaded: number; name: string; total: number };

type ResumableCacheOptions = {
  cacheKey?: string;
  chunkSize?: number;
  fetchRange?: typeof fetch;
  onProgress?: (progress: CacheProgress) => void;
  signal?: AbortSignal;
  store?: ChunkStore;
};

const CHUNK_SIZE = 8 * 1024 * 1024;
const CACHE_KEY = "transformers-cache";

const isHttpUrl = (name: string) => name.startsWith("https://") || name.startsWith("http://");

const warnStorageFailed = (name: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not keep ${name} in the browser cache`, cause);
};

// A stopped download also gives up its place in the queue for the lock, not only the fetch.
const underLock = (name: string, signal: AbortSignal | undefined, run: () => Promise<Response>) => {
  const { locks } = globalThis.navigator;
  const key = `localveil-model:${name}`;

  if (locks === undefined) {
    return run();
  }

  return signal === undefined ? locks.request(key, run) : locks.request(key, { signal }, run);
};

const createResumableCache = (options: ResumableCacheOptions = {}): ResumableCache => {
  const {
    cacheKey = CACHE_KEY,
    chunkSize = CHUNK_SIZE,
    fetchRange = fetch,
    onProgress,
    signal,
    store = createIndexedDbChunkStore(),
  } = options;

  return {
    match: async (name) => {
      if (!isHttpUrl(name)) {
        return undefined;
      }

      const cache = await caches.open(cacheKey);
      const hit = await cache.match(name);

      if (hit !== undefined) {
        return hit;
      }

      return underLock(name, signal, async () => {
        const arrived = await cache.match(name);

        if (arrived !== undefined) {
          return arrived;
        }

        const blob = await downloadResumable(name, {
          chunkSize,
          fetchRange,
          onProgress: (loaded, total) => {
            onProgress?.({ loaded, name, total });
          },
          signal,
          store,
        });

        const headers = { "content-length": String(blob.size) };

        try {
          await cache.put(name, new Response(blob, { headers }));
        } catch (error) {
          warnStorageFailed(name, error);
        }

        return new Response(blob, { headers });
      });
    },
    put: async (name, response) => {
      if (!isHttpUrl(name)) {
        return;
      }

      const cache = await caches.open(cacheKey);

      try {
        await cache.put(name, response);
      } catch (error) {
        warnStorageFailed(name, error);
      }
    },
  };
};

export { CACHE_KEY, createResumableCache };
export type { CacheProgress, ResumableCache, ResumableCacheOptions };
