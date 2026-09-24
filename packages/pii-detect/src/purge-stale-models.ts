import type { ModelSpec } from "./catalog";
import { revisionUrl } from "./catalog";
import type { ChunkStore } from "./chunk-store";
import { CACHE_KEY } from "./resumable-cache";

const MODEL_HOST = "huggingface.co";

type PurgeOptions = {
  models: ReadonlyArray<ModelSpec>;
  store?: ChunkStore;
};

/* A download belongs to the catalogue when it sits under one model's pinned revision, and a weight
   file only when it is that model's chosen export. Anything else from the hub is a superseded
   revision or an export the app stopped using, and at hundreds of megabytes it is not left behind. */
const isStale = (url: string, models: ReadonlyArray<ModelSpec>) => {
  if (!url.includes(MODEL_HOST)) {
    return false;
  }

  const owner = models.find((model) => url.startsWith(revisionUrl(model)));

  if (owner === undefined) {
    return true;
  }

  return url.includes(".onnx") && !url.endsWith(`/${owner.file}`);
};

const purgeChunks = async (store: ChunkStore, models: ReadonlyArray<ModelSpec>) => {
  const urls = await store.listUrls();
  const stale = urls.filter((url) => isStale(url, models));

  await Promise.allSettled(stale.map((url) => store.clear(url)));
};

const purgeCache = async (models: ReadonlyArray<ModelSpec>) => {
  const cache = await caches.open(CACHE_KEY);
  const keys = await cache.keys();
  const stale = keys.filter((request) => isStale(request.url, models));

  await Promise.allSettled(stale.map((request) => cache.delete(request)));
};

const purgeStaleModels = async ({ models, store }: PurgeOptions): Promise<void> => {
  const sweeps: Array<Promise<void>> = [];

  if (store !== undefined) {
    sweeps.push(purgeChunks(store, models));
  }

  if ("caches" in globalThis) {
    sweeps.push(purgeCache(models));
  }

  await Promise.allSettled(sweeps);
};

export { purgeStaleModels };
