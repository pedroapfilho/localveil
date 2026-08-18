import type { ChunkStore } from "./chunk-store.ts";
import { CACHE_KEY } from "./resumable-cache.ts";

const MODEL_HOST = "huggingface.co";

type PurgeOptions = {
  keepFiles: Array<string>;
  revision: string;
  store?: ChunkStore;
};

const isStale = (url: string, { keepFiles, revision }: PurgeOptions) => {
  if (!url.includes(MODEL_HOST)) {
    return false;
  }

  if (!url.includes(revision)) {
    return true;
  }

  if (!url.includes(".onnx")) {
    return false;
  }

  return !keepFiles.some((file) => url.endsWith(`/${file}`));
};

const purgeChunks = async (store: ChunkStore, options: PurgeOptions) => {
  const urls = await store.listUrls();
  const stale = urls.filter((url) => isStale(url, options));

  await Promise.allSettled(stale.map((url) => store.clear(url)));
};

const purgeCache = async (options: PurgeOptions) => {
  const cache = await caches.open(CACHE_KEY);
  const keys = await cache.keys();
  const stale = keys.filter((request) => isStale(request.url, options));

  await Promise.allSettled(stale.map((request) => cache.delete(request)));
};

const purgeStaleModels = async (options: PurgeOptions): Promise<void> => {
  const sweeps: Array<Promise<void>> = [];

  if (options.store !== undefined) {
    sweeps.push(purgeChunks(options.store, options));
  }

  if ("caches" in globalThis) {
    sweeps.push(purgeCache(options));
  }

  await Promise.allSettled(sweeps);
};

export { purgeStaleModels };
