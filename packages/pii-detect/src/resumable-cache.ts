import { withCacheLock } from "./cache-lock";
import type { ChunkStore } from "./chunk-store";
import { createIndexedDbChunkStore } from "./chunk-store";
import { downloadResumable } from "./resumable-download";

type ResumableCache = {
  download: (name: string) => Promise<void>;
  match: (name: string) => Promise<Response | undefined>;
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

const createResumableCache = (options: ResumableCacheOptions = {}): ResumableCache => {
  const {
    cacheKey = CACHE_KEY,
    chunkSize = CHUNK_SIZE,
    fetchRange = fetch,
    onProgress,
    signal,
    store = createIndexedDbChunkStore(),
  } = options;

  const load = async (name: string, persistence: "required" | "best-effort") => {
    signal?.throwIfAborted();

    if (!isHttpUrl(name)) {
      return undefined;
    }

    const cache = await caches.open(cacheKey);
    const hit = await cache.match(name);

    if (hit !== undefined) {
      return hit;
    }

    return withCacheLock(
      name,
      "exclusive",
      async () => {
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
          if (persistence === "required") {
            throw error;
          }

          warnStorageFailed(name, error);

          return new Response(blob, { headers });
        }

        // Keep resumable bytes until the durable copy has landed.
        await store.clear(name);

        return new Response(blob, { headers });
      },
      signal,
    );
  };

  return {
    download: async (name) => {
      if ((await load(name, "required")) === undefined) {
        throw new TypeError(`The model file is not an HTTP URL: ${name}`);
      }
    },
    match: (name) => load(name, "best-effort"),
  };
};

export { CACHE_KEY, createResumableCache };
export type { CacheProgress, ResumableCache, ResumableCacheOptions };
