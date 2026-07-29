import { CACHE_KEY } from "./resumable-cache.ts";

const MODEL_HOST = "huggingface.co";

type PurgeOptions = {
  // Weight file names still in use; anything else heavy goes.
  keepFiles: Array<string>;
  revision: string;
};

// A model swap, revision bump, or tier change orphans the previous weights in the
// browser cache, and nothing else ever deletes them, so each one would cost readers
// hundreds of MB of storage forever.
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
