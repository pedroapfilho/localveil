import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChunkStore } from "./chunk-store";
import { memoryChunks } from "./model-store-fixture";
import type { DownloadOptions } from "./resumable-download";
import { downloadResumable } from "./resumable-download";

const URL_UNDER_TEST = "https://example.com/model.onnx_data";

type Span = { end: number; start: number };

const parseRange = (init?: RequestInit) => {
  const header = new Headers(init?.headers).get("Range") ?? "";
  const [start, end] = header.replace("bytes=", "").split("-");

  return { end: Number(end), start: Number(start) };
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const startsOf = (calls: Array<Span>) =>
  calls
    .slice(1)
    .map(({ start }) => start)
    .toSorted((left, right) => left - right);

const rangeServer = (body: Uint8Array, etag = "v1", delayFor?: (span: Span) => number) => {
  const calls: Array<Span> = [];
  let inFlight = 0;
  let highWater = 0;

  const fetchRange: typeof fetch = async (_input, init) => {
    const range = parseRange(init);

    calls.push(range);
    inFlight += 1;
    highWater = Math.max(highWater, inFlight);

    await delay(delayFor?.(range) ?? 0);

    inFlight -= 1;

    return new Response(body.slice(range.start, range.end + 1), {
      headers: {
        "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(body.length)}`,
        etag,
      },
      status: 206,
    });
  };

  return { calls, fetchRange, peak: () => highWater };
};

const failingAt =
  (offset: number, fetchRange: typeof fetch): typeof fetch =>
  (input, init) =>
    parseRange(init).start === offset
      ? Promise.reject(new Error("connection lost"))
      : fetchRange(input, init);

const bodyOf = (length: number) => Uint8Array.from({ length }, (_entry, index) => index % 251);

const ignoresRange: typeof fetch = () => Promise.resolve(new Response("whole file"));

const totalless: typeof fetch = () => Promise.resolve(new Response("", { status: 206 }));

const emptyAfterProbe: typeof fetch = (_input, init) => {
  const range = parseRange(init);
  const body = range.start === 0 && range.end === 0 ? bodyOf(1) : new Uint8Array();

  return Promise.resolve(
    new Response(body, {
      headers: { "content-range": "bytes 0-0/10", etag: "v1" },
      status: 206,
    }),
  );
};

const run = (
  fetchRange: typeof fetch,
  store: ChunkStore,
  overrides: Partial<DownloadOptions> = {},
) =>
  downloadResumable(URL_UNDER_TEST, {
    chunkSize: 4,
    fetchRange,
    onProgress: vi.fn<(loaded: number, total: number) => void>(),
    store,
    ...overrides,
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("downloadResumable", () => {
  it("stops when told to and keeps what it banked for the next attempt", async () => {
    const body = bodyOf(16);
    const first = rangeServer(body);
    const controller = new AbortController();
    const store = memoryChunks();

    const stoppingAfterSecond: typeof fetch = async (input, init) => {
      const response = await first.fetchRange(input, init);

      if (parseRange(init).start === 4) {
        controller.abort();
      }

      return response;
    };

    await expect(
      run(stoppingAfterSecond, store, { concurrency: 1, signal: controller.signal }),
    ).rejects.toThrow(/abort/iv);
    await expect(store.readOffsets(URL_UNDER_TEST)).resolves.toEqual([0, 4]);

    const second = rangeServer(body);
    const blob = await run(second.fetchRange, store);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
    expect(startsOf(second.calls)).toEqual([8, 12]);
  });

  it("assembles the whole body from several ranges", async () => {
    const body = bodyOf(10);
    const { fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, memoryChunks());

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("asks for every range once, plus the size probe", async () => {
    const { calls, fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, memoryChunks());

    expect(calls).toEqual([
      { end: 0, start: 0 },
      { end: 3, start: 0 },
      { end: 7, start: 4 },
      { end: 9, start: 8 },
    ]);
  });

  it("assembles the whole body from ranges that come back out of order", async () => {
    const body = bodyOf(40);
    const { fetchRange } = rangeServer(body, "v1", ({ start }) => 40 - start);
    const blob = await run(fetchRange, memoryChunks());

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("keeps several ranges in flight at the same time", async () => {
    const { fetchRange, peak } = rangeServer(bodyOf(40), "v1", () => 5);

    await run(fetchRange, memoryChunks());

    expect(peak()).toBe(6);
  });

  it("holds the number of ranges in flight to the concurrency it was given", async () => {
    const { fetchRange, peak } = rangeServer(bodyOf(40), "v1", () => 5);

    await run(fetchRange, memoryChunks(), { concurrency: 2 });

    expect(peak()).toBe(2);
  });

  it("picks up from the byte a previous run reached", async () => {
    const body = bodyOf(10);
    const store = memoryChunks();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 4).buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 4, etag: "v1", total: 10 });

    const { calls, fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, store);

    expect(calls).toEqual([
      { end: 0, start: 0 },
      { end: 7, start: 4 },
      { end: 9, start: 8 },
    ]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("asks only for the ranges a half-finished store is missing, gap and all", async () => {
    const body = bodyOf(20);
    const store = memoryChunks();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 4).buffer);
    await store.append(URL_UNDER_TEST, 8, body.slice(8, 12).buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 4, etag: "v1", total: 20 });

    const { calls, fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, store);

    expect(startsOf(calls)).toEqual([4, 12, 16]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("throws away every stored chunk when the file changed and fetches them all again", async () => {
    const body = bodyOf(20);
    const store = memoryChunks();
    const stale = Uint8Array.from({ length: 4 }, () => 9);

    await store.append(URL_UNDER_TEST, 0, stale.buffer);
    await store.append(URL_UNDER_TEST, 12, stale.buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 4, etag: "stale", total: 20 });

    const { calls, fetchRange } = rangeServer(body, "v2");
    const blob = await run(fetchRange, store);

    expect(startsOf(calls)).toEqual([0, 4, 8, 12, 16]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("starts over when the file changed under a resumed download", async () => {
    const body = bodyOf(10);
    const store = memoryChunks();

    await store.append(URL_UNDER_TEST, 0, new Uint8Array([9, 9, 9, 9]).buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 4, etag: "stale", total: 10 });

    const { calls, fetchRange } = rangeServer(body, "v2");
    const blob = await run(fetchRange, store);

    expect(calls.at(1)).toEqual({ end: 3, start: 0 });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("keeps a manifest that a later run can resume from", async () => {
    const store = memoryChunks();
    let served = 0;

    const fetchRange: typeof fetch = (_input, init) => {
      const range = parseRange(init);

      served += 1;

      if (served > 2) {
        return Promise.reject(new Error("connection lost"));
      }

      return Promise.resolve(
        new Response(bodyOf(10).slice(range.start, range.end + 1), {
          headers: {
            "content-range": `bytes ${String(range.start)}-${String(range.end)}/10`,
            etag: "v1",
          },
          status: 206,
        }),
      );
    };

    await expect(run(fetchRange, store)).rejects.toThrow(/connection lost/v);

    await expect(store.readManifest(URL_UNDER_TEST)).resolves.toEqual({
      chunkSize: 4,
      etag: "v1",
      total: 10,
    });
  });

  it("keeps completed chunks until the caller has saved the assembled file", async () => {
    const store = memoryChunks();
    const { fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, store);

    await expect(store.readOffsets(URL_UNDER_TEST)).resolves.not.toEqual([]);
    await expect(store.readManifest(URL_UNDER_TEST)).resolves.toBeDefined();
  });

  it("reports progress that never drops back, and ends on the full size", async () => {
    const onProgress = vi.fn<(loaded: number, total: number) => void>();
    const { fetchRange } = rangeServer(bodyOf(40), "v1", ({ start }) => 40 - start);

    await run(fetchRange, memoryChunks(), { onProgress });

    const reported = onProgress.mock.calls.map(([loaded]) => loaded);

    expect(reported.at(0)).toBe(0);
    expect(reported).toEqual(reported.toSorted((left, right) => left - right));
    expect(onProgress.mock.calls.at(-1)).toEqual([40, 40]);
  });

  it("hangs on to the chunks that arrived when one of them fails", async () => {
    const store = memoryChunks();
    const { fetchRange } = rangeServer(bodyOf(20));

    await expect(run(failingAt(8, fetchRange), store)).rejects.toThrow(/connection lost/v);

    const banked = await store.readOffsets(URL_UNDER_TEST);

    expect(banked.toSorted((left, right) => left - right)).toEqual([0, 4, 12, 16]);
  });

  it("refuses a server that ignores the range request", async () => {
    await expect(run(ignoresRange, memoryChunks())).rejects.toThrow(/cannot be resumed/v);
  });

  it("refuses a range response with no total size", async () => {
    await expect(run(totalless, memoryChunks())).rejects.toThrow(/without a total size/v);
  });

  it("stops rather than spinning when a chunk comes back empty", async () => {
    await expect(run(emptyAfterProbe, memoryChunks())).rejects.toThrow(/empty chunk/v);
  });

  it("refuses to hand back an assembly that is the wrong size", async () => {
    const store = memoryChunks();

    const short: ChunkStore = {
      ...store,
      readParts: () => Promise.resolve([new Blob([bodyOf(3)])]),
    };

    const { fetchRange } = rangeServer(bodyOf(10));

    await expect(run(fetchRange, short)).rejects.toThrow(/chunks are corrupt/v);
  });

  it("refetches everything when the chunk size changed under a stored download", async () => {
    const body = bodyOf(20);
    const store = memoryChunks();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 8).buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 8, etag: "v1", total: 20 });

    const { calls, fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, store);

    expect(startsOf(calls)).toEqual([0, 4, 8, 12, 16]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("clears the store when the chunks assemble to the wrong size, so a retry can work", async () => {
    const body = bodyOf(10);
    const store = memoryChunks();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 4).buffer);
    await store.append(URL_UNDER_TEST, 4, body.slice(4, 8).buffer);
    await store.append(URL_UNDER_TEST, 8, new Uint8Array([]).buffer);
    await store.writeManifest(URL_UNDER_TEST, { chunkSize: 4, etag: "v1", total: 10 });

    const { fetchRange } = rangeServer(body);

    await expect(run(fetchRange, store)).rejects.toThrow(/corrupt/v);
    expect(await store.readOffsets(URL_UNDER_TEST)).toEqual([]);
    await expect(store.readManifest(URL_UNDER_TEST)).resolves.toBeUndefined();

    const second = rangeServer(body);
    const blob = await run(second.fetchRange, store);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("writes the manifest once rather than after every chunk", async () => {
    const body = bodyOf(20);
    const store = memoryChunks();
    const writes = vi.spyOn(store, "writeManifest");
    const { fetchRange } = rangeServer(body);

    await run(fetchRange, store);

    expect(writes).toHaveBeenCalledTimes(1);
  });
});
