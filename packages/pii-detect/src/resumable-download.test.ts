import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChunkStore, Manifest } from "./chunk-store.ts";
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

const parseRange = (init?: RequestInit) => {
  const header = new Headers(init?.headers).get("Range") ?? "";
  const [start, end] = header.replace("bytes=", "").split("-");

  return { end: Number(end), start: Number(start) };
};

// A server that answers ranges out of one in-memory body, the way the real CDN does.
const rangeServer = (body: Uint8Array, etag = "v1") => {
  const calls: Array<{ end: number; start: number }> = [];

  const fetchRange: typeof fetch = (_input, init) => {
    const range = parseRange(init);

    calls.push(range);

    const slice = body.slice(range.start, range.end + 1);

    return Promise.resolve(
      new Response(slice, {
        headers: {
          "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(body.length)}`,
          etag,
        },
        status: 206,
      }),
    );
  };

  return { calls, fetchRange };
};

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
  chunkSize = 4,
  onProgress = vi.fn<(loaded: number, total: number) => void>(),
) => downloadResumable(URL_UNDER_TEST, { chunkSize, fetchRange, onProgress, store });

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

  it("asks for one chunk at a time, plus the size probe", async () => {
    const { calls, fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, memoryStore().store);

    expect(calls).toEqual([
      { end: 0, start: 0 },
      { end: 3, start: 0 },
      { end: 7, start: 4 },
      { end: 9, start: 8 },
    ]);
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

  it("reports progress that climbs to the full size", async () => {
    const onProgress = vi.fn<(loaded: number, total: number) => void>();
    const { fetchRange } = rangeServer(bodyOf(10));

    await run(fetchRange, memoryStore().store, 4, onProgress);

    expect(onProgress.mock.calls).toEqual([
      [0, 10],
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
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
