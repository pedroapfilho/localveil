import type { ChunkStore } from "./chunk-store.ts";
import { createIndexedDbChunkStore } from "./chunk-store.ts";
import { downloadResumable } from "./resumable-download.ts";

type ResumableCache = {
  match: (name: string) => Promise<Response | undefined>;
  put: (name: string, response: Response) => Promise<void>;
};

type ResumableCacheOptions = {
  cacheKey?: string;
  chunkSize?: number;
  fetchRange?: typeof fetch;
  onProgress?: (fraction: number) => void;
  store?: ChunkStore;
};

const CHUNK_SIZE = 8 * 1024 * 1024;
const CACHE_KEY = "transformers-cache";

const isHttpUrl = (name: string) => name.startsWith("https://") || name.startsWith("http://");

// A browser that refuses to store the file has not broken anything: the download
// already succeeded and is being returned. There is no UI channel for something the
// reader cannot act on, and staying quiet about it would hide a full disk.
const warnStorageFailed = (name: string, error: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not keep ${name} in the browser cache`, error);
};

// Two tabs of the same app both start the download, both write chunks under the same
// key, and whichever finishes first clears the store from under the other, which then
// assembles a file of the wrong size and fails. A lock makes the second tab wait, and
// by the time it runs the first has already put the file in the cache.
//
// A browser without the Locks API loses nothing it had before: the download runs the
// way it always did.
const underLock = (name: string, run: () => Promise<Response>) => {
  const { locks } = globalThis.navigator;

  return locks === undefined ? run() : locks.request(`localveil-model:${name}`, run);
};

// The cache is asked for a local path first and only then for the remote URL, so a
// non-URL key is a miss rather than something to go and fetch.
const createResumableCache = (options: ResumableCacheOptions = {}): ResumableCache => {
  const {
    cacheKey = CACHE_KEY,
    chunkSize = CHUNK_SIZE,
    fetchRange = fetch,
    onProgress,
    store = createIndexedDbChunkStore(),
  } = options;

  // Five files arrive one after another and only the weights are large, so progress
  // is reported over their combined size rather than restarting per file.
  const seen = new Map<string, { loaded: number; total: number }>();

  const report = () => {
    let loaded = 0;
    let total = 0;

    for (const entry of seen.values()) {
      loaded += entry.loaded;
      total += entry.total;
    }

    onProgress?.(total === 0 ? 0 : loaded / total);
  };

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

      return underLock(name, async () => {
        // Asked again on the other side of the lock: waiting for it means another tab
        // was downloading this, and it has finished by now.
        const arrived = await cache.match(name);

        if (arrived !== undefined) {
          return arrived;
        }

        const blob = await downloadResumable(name, {
          chunkSize,
          fetchRange,
          onProgress: (loaded, total) => {
            seen.set(name, { loaded, total });
            report();
          },
          store,
        });

        const headers = { "content-length": String(blob.size) };

        // Two responses over the one blob rather than `clone()`, which tees the body
        // and buffers a second copy of it while the cache write drains.
        await cache.put(name, new Response(blob, { headers })).catch((error: unknown) => {
          warnStorageFailed(name, error);
        });

        return new Response(blob, { headers });
      });
    },
    put: async (name, response) => {
      if (!isHttpUrl(name)) {
        return;
      }

      const cache = await caches.open(cacheKey);

      await cache.put(name, response).catch((error: unknown) => {
        warnStorageFailed(name, error);
      });
    },
  };
};

export { createResumableCache };
export type { ResumableCache, ResumableCacheOptions };
