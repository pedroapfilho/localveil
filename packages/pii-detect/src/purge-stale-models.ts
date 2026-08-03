import { CACHE_KEY } from "./resumable-cache.ts";

const MODEL_HOST = "huggingface.co";

type PurgeOptions = {
  keepFiles: Array<string>;
  revision: string;
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

const purgeStaleModels = async (options: PurgeOptions): Promise<void> => {
  if (!("caches" in globalThis)) {
    return;
  }

  const cache = await caches.open(CACHE_KEY);
  const keys = await cache.keys();
  const stale = keys.filter((request) => isStale(request.url, options));

  await Promise.allSettled(stale.map((request) => cache.delete(request)));
};

export { purgeStaleModels };
