import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryStore } from "./chunk-store-fixture";
import type { CacheProgress } from "./resumable-cache";
import { createResumableCache } from "./resumable-cache";

const URL_UNDER_TEST = "https://example.com/model.onnx_data";
const OTHER_URL = "https://example.com/tokenizer.json";

const BODY = Uint8Array.from({ length: 12 }, (_entry, index) => index);

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
    allowWrites: () => {
      refuse = false;
    },
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

  it("takes the file another tab finished while it waited for the lock", async () => {
    const { entries } = memoryCaches();
    const fetchRange = rangeServer();

    vi.stubGlobal("navigator", {
      locks: {
        request: (_name: string, _options: LockOptions, run: () => Promise<Response>) => {
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

    const onProgress = vi.fn<(progress: CacheProgress) => void>();

    await createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      onProgress,
      store: memoryStore(),
    }).match(URL_UNDER_TEST);

    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual({
      loaded: BODY.length,
      name: URL_UNDER_TEST,
      total: BODY.length,
    });
  });

  it("reports each file against its own size, not against the ones before it", async () => {
    memoryCaches();

    const onProgress = vi.fn<(progress: CacheProgress) => void>();
    const cache = createResumableCache({
      chunkSize: 5,
      fetchRange: rangeServer(),
      onProgress,
      store: memoryStore(),
    });

    await cache.match(URL_UNDER_TEST);
    await cache.match(OTHER_URL);

    const names = new Set(onProgress.mock.calls.map(([progress]) => progress.name));

    expect(names).toEqual(new Set([URL_UNDER_TEST, OTHER_URL]));

    for (const [progress] of onProgress.mock.calls) {
      expect(progress.total).toBe(BODY.length);
    }
  });

  it("rejects an explicit download when storage fails and resumes without fetching its chunks again", async () => {
    const { allowWrites, entries, refuseWrites } = memoryCaches();
    const store = memoryStore();
    const fetchRange = rangeServer();
    const cache = createResumableCache({ chunkSize: 5, fetchRange, store });

    refuseWrites();
    await expect(cache.download(URL_UNDER_TEST)).rejects.toThrow("QuotaExceededError");
    expect(entries.has(URL_UNDER_TEST)).toBe(false);
    await expect(store.readOffsets(URL_UNDER_TEST)).resolves.toEqual([0, 5, 10]);
    const fetched = fetchRange.mock.calls.length;

    allowWrites();
    await cache.download(URL_UNDER_TEST);

    expect(fetchRange).toHaveBeenCalledTimes(fetched + 1);
    expect(entries.has(URL_UNDER_TEST)).toBe(true);
    await expect(store.readOffsets(URL_UNDER_TEST)).resolves.toEqual([]);
    await expect(store.readManifest(URL_UNDER_TEST)).resolves.toBeUndefined();
  });

  it("refuses an explicit download that is not a URL", async () => {
    const { puts } = memoryCaches();

    await expect(
      createResumableCache({ store: memoryStore() }).download("/models/tokenizer.json"),
    ).rejects.toThrow(/not an HTTP URL/v);

    expect(puts).toEqual([]);
  });
});
