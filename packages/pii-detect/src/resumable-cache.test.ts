import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChunkStore, Manifest } from "./chunk-store.ts";
import { createResumableCache } from "./resumable-cache.ts";

const URL_UNDER_TEST = "https://example.com/model.onnx_data";

const BODY = Uint8Array.from({ length: 12 }, (_entry, index) => index);

const memoryStore = (): ChunkStore => {
  const chunks = new Map<string, Map<number, ArrayBuffer>>();
  const manifests = new Map<string, Manifest>();

  return {
    append: (url, start, bytes) => {
      const existing = chunks.get(url) ?? new Map<number, ArrayBuffer>();

      existing.set(start, bytes);
      chunks.set(url, existing);

      return Promise.resolve();
    },
    clear: (url) => {
      chunks.delete(url);
      manifests.delete(url);

      return Promise.resolve();
    },
    readManifest: (url) => Promise.resolve(manifests.get(url)),
    readParts: (url) =>
      Promise.resolve(
        [...(chunks.get(url) ?? new Map<number, ArrayBuffer>()).entries()]
          .toSorted(([left], [right]) => left - right)
          .map(([, bytes]) => new Blob([bytes])),
      ),
    writeManifest: (url, manifest) => {
      manifests.set(url, manifest);

      return Promise.resolve();
    },
  };
};

const memoryCaches = () => {
  const entries = new Map<string, Response>();
  const puts: Array<string> = [];
  let refuse = false;

  const cache = {
    match: (name: string) => Promise.resolve(entries.get(name)),
    put: (name: string, response: Response) => {
      if (refuse) {
        return Promise.reject(new Error("QuotaExceededError"));
      }

      puts.push(name);
      entries.set(name, response);

      return Promise.resolve();
    },
  };

  vi.stubGlobal("caches", { open: () => Promise.resolve(cache) });

  return {
    entries,
    puts,
    refuseWrites: () => {
      refuse = true;
    },
  };
};

const rangeServer = () => {
  const fetchRange = vi.fn<typeof fetch>((_input, init) => {
    const header = new Headers(init?.headers).get("Range") ?? "";
    const [start, end] = header.replace("bytes=", "").split("-").map(Number);

    return Promise.resolve(
      new Response(BODY.slice(start, end + 1), {
        headers: {
          "content-range": `bytes ${String(start)}-${String(end)}/${String(BODY.length)}`,
          etag: "v1",
        },
        status: 206,
      }),
    );
  });

  return fetchRange;
};

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createResumableCache", () => {
  it("leaves a key that is not a URL alone, because that is the local path probe", async () => {
    memoryCaches();

    const fetchRange = rangeServer();
    const cache = createResumableCache({ fetchRange, store: memoryStore() });

    expect(await cache.match("/models/privacy-filter/model.onnx")).toBeUndefined();
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("returns what is already cached without touching the network", async () => {
    const { entries } = memoryCaches();

    entries.set(URL_UNDER_TEST, new Response("cached"));

    const fetchRange = rangeServer();
    const cache = createResumableCache({ fetchRange, store: memoryStore() });
    const hit = await cache.match(URL_UNDER_TEST);

    expect(await hit?.text()).toBe("cached");
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("downloads a file that is not cached and hands back every byte", async () => {
    memoryCaches();

    const cache = createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      store: memoryStore(),
    });
    const response = await cache.match(URL_UNDER_TEST);

    expect(response).toBeDefined();
    expect(await bytesOf(response as Response)).toEqual(BODY);
  });

  // Reading one response must not consume the other. They used to be a response and
  // its clone, which tees the body and buffers a second copy of an 809 MB file.
  it("leaves the cached copy readable after the caller has read theirs", async () => {
    const { entries } = memoryCaches();

    const cache = createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      store: memoryStore(),
    });

    await bytesOf((await cache.match(URL_UNDER_TEST)) as Response);

    expect(await bytesOf(entries.get(URL_UNDER_TEST) as Response)).toEqual(BODY);
  });

  it("still hands back the download when the browser refuses to store it", async () => {
    const { refuseWrites } = memoryCaches();

    refuseWrites();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const cache = createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      store: memoryStore(),
    });
    const response = await cache.match(URL_UNDER_TEST);

    expect(await bytesOf(response as Response)).toEqual(BODY);
  });

  it("says so rather than failing quietly when a file will not fit", async () => {
    const { refuseWrites } = memoryCaches();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    refuseWrites();

    await createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      store: memoryStore(),
    }).match(URL_UNDER_TEST);

    expect(warn).toHaveBeenCalled();
  });

  // The second tab waits on the lock, and by the time it runs the first tab has put
  // the file in the cache. Downloading it again would clear the chunks from under it.
  it("takes the file another tab finished while it waited for the lock", async () => {
    const { entries } = memoryCaches();
    const fetchRange = rangeServer();

    vi.stubGlobal("navigator", {
      locks: {
        request: (_name: string, run: () => Promise<Response>) => {
          entries.set(URL_UNDER_TEST, new Response("downloaded by the other tab"));

          return run();
        },
      },
    });

    const cache = createResumableCache({ fetchRange, store: memoryStore() });
    const hit = await cache.match(URL_UNDER_TEST);

    expect(await hit?.text()).toBe("downloaded by the other tab");
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("reports progress that reaches the whole file", async () => {
    memoryCaches();

    const onProgress = vi.fn<(fraction: number) => void>();

    await createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      onProgress,
      store: memoryStore(),
    }).match(URL_UNDER_TEST);

    expect(onProgress.mock.calls.at(-1)).toEqual([1]);
  });

  it("writes a small file straight through without downloading anything", async () => {
    const { puts } = memoryCaches();

    await createResumableCache({ fetchRange: rangeServer(), store: memoryStore() }).put(
      URL_UNDER_TEST,
      new Response("tokenizer.json"),
    );

    expect(puts).toEqual([URL_UNDER_TEST]);
  });

  it("does not write a local path into the cache", async () => {
    const { puts } = memoryCaches();

    await createResumableCache({ fetchRange: rangeServer(), store: memoryStore() }).put(
      "/models/tokenizer.json",
      new Response("tokenizer.json"),
    );

    expect(puts).toEqual([]);
  });
});
