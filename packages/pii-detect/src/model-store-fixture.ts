import { vi } from "vitest";

import type { ChunkStore, Manifest } from "./chunk-store";

const memoryChunks = (): ChunkStore => {
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
    listUrls: () => Promise.resolve([...manifests.keys()]),
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
};

const sized = (body: Uint8Array<ArrayBuffer>) =>
  new Response(body, { headers: { "content-length": String(body.byteLength) } });

// Each match hands back a fresh body, the way Cache Storage does, so a read never drains the entry.
const memoryCaches = () => {
  const entries = new Map<string, Response>();
  const refused = new Set<string>();
  const cache = {
    delete: (request: Request) => Promise.resolve(entries.delete(request.url)),
    keys: () => Promise.resolve([...entries.keys()].map((url) => new Request(url))),
    match: (url: string) => Promise.resolve(entries.get(url)?.clone()),
    put: async (url: string, response: Response) => {
      if (refused.has(url)) {
        throw new DOMException("The cache is full", "QuotaExceededError");
      }

      entries.set(url, new Response(await response.arrayBuffer(), { headers: response.headers }));
    },
  };

  vi.stubGlobal("caches", { open: () => Promise.resolve(cache) });

  return {
    allow: (url: string) => {
      refused.delete(url);
    },
    entries,
    keep: (urls: ReadonlyArray<string>, body = new Uint8Array(1234)) => {
      for (const url of urls) {
        entries.set(url, sized(body));
      }
    },
    refuse: (url: string) => {
      refused.add(url);
    },
  };
};

const TOKENIZER_BODY = new TextEncoder().encode('{"model":{}}');
const WEIGHTS_BODY = Uint8Array.from({ length: 40 }, (_entry, index) => index);

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

// Answers the way the hub does: JSON for the tokenizer files and bytes for the weights, whole or by range.
const serveFiles = () => {
  const asked: Array<string> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      const url = urlOf(input);
      const body = url.endsWith(".json") ? TOKENIZER_BODY : WEIGHTS_BODY;
      const range = new Headers(init?.headers).get("Range");

      asked.push(url);

      if (range === null) {
        return Promise.resolve(sized(body));
      }

      const [start = 0, end = 0] = range.replace("bytes=", "").split("-").map(Number);

      return Promise.resolve(
        new Response(body.slice(start, end + 1), {
          headers: {
            "content-range": `bytes ${String(start)}-${String(end)}/${String(body.length)}`,
            etag: url,
          },
          status: 206,
        }),
      );
    }),
  );

  return asked;
};

export { memoryCaches, memoryChunks, serveFiles, TOKENIZER_BODY, urlOf, WEIGHTS_BODY };
