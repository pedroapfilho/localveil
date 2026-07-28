import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChunkStore, Manifest } from "./chunk-store.ts";
import type { DownloadOptions } from "./resumable-download.ts";
import { downloadResumable } from "./resumable-download.ts";

const URL_UNDER_TEST = "https://example.com/model.onnx_data";

const memoryStore = () => {
  const chunks = new Map<string, Map<number, ArrayBuffer>>();
  const manifests = new Map<string, Manifest>();

  const store: ChunkStore = {
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
    readOffsets: (url) =>
      Promise.resolve([...(chunks.get(url) ?? new Map<number, ArrayBuffer>()).keys()]),
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

  return { chunks, manifests, store };
};

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

// A server that answers ranges out of one in-memory body, the way the real CDN does.
// `delayFor` decides how long each range takes, which is how a test makes the answers
// come back in an order other than the one they were asked in.
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
  it("assembles the whole body from several ranges", async () => {
    const body = bodyOf(10);
    const { fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, memoryStore().store);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("asks for every range once, plus the size probe", async () => {
    const { calls, fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, memoryStore().store);

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
    const blob = await run(fetchRange, memoryStore().store);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("keeps several ranges in flight at the same time", async () => {
    const { fetchRange, peak } = rangeServer(bodyOf(40), "v1", () => 5);

    await run(fetchRange, memoryStore().store);

    expect(peak()).toBe(6);
  });

  it("holds the number of ranges in flight to the concurrency it was given", async () => {
    const { fetchRange, peak } = rangeServer(bodyOf(40), "v1", () => 5);

    await run(fetchRange, memoryStore().store, { concurrency: 2 });

    expect(peak()).toBe(2);
  });

  it("picks up from the byte a previous run reached", async () => {
    const body = bodyOf(10);
    const { store } = memoryStore();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 4).buffer);
    await store.writeManifest(URL_UNDER_TEST, { etag: "v1", loaded: 4, total: 10 });

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
    const { store } = memoryStore();

    await store.append(URL_UNDER_TEST, 0, body.slice(0, 4).buffer);
    await store.append(URL_UNDER_TEST, 8, body.slice(8, 12).buffer);
    await store.writeManifest(URL_UNDER_TEST, { etag: "v1", loaded: 8, total: 20 });

    const { calls, fetchRange } = rangeServer(body);
    const blob = await run(fetchRange, store);

    expect(startsOf(calls)).toEqual([4, 12, 16]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("throws away every stored chunk when the file changed and fetches them all again", async () => {
    const body = bodyOf(20);
    const { store } = memoryStore();
    const stale = Uint8Array.from({ length: 4 }, () => 9);

    await store.append(URL_UNDER_TEST, 0, stale.buffer);
    await store.append(URL_UNDER_TEST, 12, stale.buffer);
    await store.writeManifest(URL_UNDER_TEST, { etag: "stale", loaded: 8, total: 20 });

    const { calls, fetchRange } = rangeServer(body, "v2");
    const blob = await run(fetchRange, store);

    expect(startsOf(calls)).toEqual([0, 4, 8, 12, 16]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("starts over when the file changed under a resumed download", async () => {
    const body = bodyOf(10);
    const { store } = memoryStore();

    await store.append(URL_UNDER_TEST, 0, new Uint8Array([9, 9, 9, 9]).buffer);
    await store.writeManifest(URL_UNDER_TEST, { etag: "stale", loaded: 4, total: 10 });

    const { calls, fetchRange } = rangeServer(body, "v2");
    const blob = await run(fetchRange, store);

    expect(calls.at(1)).toEqual({ end: 3, start: 0 });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
  });

  it("keeps a manifest that a later run can resume from", async () => {
    const { manifests, store } = memoryStore();
    let served = 0;

    const fetchRange: typeof fetch = (_input, init) => {
      const range = parseRange(init);

      served += 1;

      // Fail on the second real chunk, leaving the first one banked.
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

    expect(manifests.get(URL_UNDER_TEST)).toEqual({ etag: "v1", loaded: 4, total: 10 });
  });

  it("drops the stored chunks once the file is complete", async () => {
    const { chunks, manifests, store } = memoryStore();
    const { fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, store);

    expect(chunks.get(URL_UNDER_TEST)).toBeUndefined();
    expect(manifests.get(URL_UNDER_TEST)).toBeUndefined();
  });

  it("reports progress that never drops back, and ends on the full size", async () => {
    const onProgress = vi.fn<(loaded: number, total: number) => void>();
    const { fetchRange } = rangeServer(bodyOf(40), "v1", ({ start }) => 40 - start);

    await run(fetchRange, memoryStore().store, { onProgress });

    const reported = onProgress.mock.calls.map(([loaded]) => loaded);

    expect(reported.at(0)).toBe(0);
    expect(reported).toEqual(reported.toSorted((left, right) => left - right));
    expect(onProgress.mock.calls.at(-1)).toEqual([40, 40]);
  });

  it("hangs on to the chunks that arrived when one of them fails", async () => {
    const { chunks, store } = memoryStore();
    const { fetchRange } = rangeServer(bodyOf(20));

    await expect(run(failingAt(8, fetchRange), store)).rejects.toThrow(/connection lost/v);

    const banked = [...(chunks.get(URL_UNDER_TEST) ?? new Map<number, ArrayBuffer>()).keys()];

    expect(banked.toSorted((left, right) => left - right)).toEqual([0, 4, 12, 16]);
  });

  it("refuses a server that ignores the range request", async () => {
    await expect(run(ignoresRange, memoryStore().store)).rejects.toThrow(/cannot be resumed/v);
  });

  it("refuses a range response with no total size", async () => {
    await expect(run(totalless, memoryStore().store)).rejects.toThrow(/without a total size/v);
  });

  it("stops rather than spinning when a chunk comes back empty", async () => {
    await expect(run(emptyAfterProbe, memoryStore().store)).rejects.toThrow(/empty chunk/v);
  });

  it("refuses to hand back an assembly that is the wrong size", async () => {
    const { store } = memoryStore();
    const short: ChunkStore = {
      ...store,
      readParts: () => Promise.resolve([new Blob([bodyOf(3)])]),
    };
    const { fetchRange } = rangeServer(bodyOf(10));

    await expect(run(fetchRange, short)).rejects.toThrow(/chunks are corrupt/v);
  });
});
