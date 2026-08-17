import type { ChunkStore } from "./chunk-store.ts";

type Probe = { etag: string; total: number };

type Resume = { chunkSize: number; etag: string; store: ChunkStore; total: number; url: string };

type DownloadOptions = {
  chunkSize: number;
  concurrency?: number;
  fetchRange: typeof fetch;
  onProgress: (loaded: number, total: number) => void;
  store: ChunkStore;
};

const CONTENT_RANGE = /^bytes \d+-\d+\/(?<total>\d+)$/v;
const DEFAULT_CONCURRENCY = 6;

const rangeHeader = (start: number, endInclusive: number) => ({
  Range: `bytes=${String(start)}-${String(endInclusive)}`,
});

const probe = async (url: string, fetchRange: typeof fetch): Promise<Probe> => {
  const response = await fetchRange(url, { headers: rangeHeader(0, 0) });

  if (response.status !== 206) {
    throw new Error(
      `${url} answered ${String(response.status)} to a range request, so it cannot be resumed`,
    );
  }

  const total = CONTENT_RANGE.exec(response.headers.get("content-range") ?? "")?.groups?.total;

  if (total === undefined) {
    throw new Error(`${url} returned a range without a total size`);
  }

  return { etag: response.headers.get("etag") ?? url, total: Number(total) };
};

const isRejected = (outcome: PromiseSettledResult<void>): outcome is PromiseRejectedResult =>
  outcome.status === "rejected";

const chunkStarts = (total: number, chunkSize: number) =>
  Array.from({ length: Math.ceil(total / chunkSize) }, (_entry, index) => index * chunkSize);

const storedOffsets = async ({ chunkSize, etag, store, total, url }: Resume) => {
  const manifest = await store.readManifest(url);

  if (manifest?.etag === etag && manifest.chunkSize === chunkSize && manifest.total === total) {
    const stored = await store.readOffsets(url);

    if (stored.every((start) => start % chunkSize === 0 && start < total)) {
      return new Set(stored);
    }
  }

  await store.clear(url);

  return new Set<number>();
};

const downloadResumable = async (url: string, options: DownloadOptions): Promise<Blob> => {
  const { chunkSize, concurrency = DEFAULT_CONCURRENCY, fetchRange, onProgress, store } = options;
  const { etag, total } = await probe(url, fetchRange);
  const held = await storedOffsets({ chunkSize, etag, store, total, url });
  const spanOf = (start: number) => Math.min(chunkSize, total - start);
  const queue = chunkStarts(total, chunkSize).filter((start) => !held.has(start));

  let loaded = [...held].reduce((sum, start) => sum + spanOf(start), 0);
  let stopped = false;

  await store.writeManifest(url, { chunkSize, etag, total });

  onProgress(loaded, total);

  const bank = async (start: number) => {
    const response = await fetchRange(url, {
      headers: rangeHeader(start, start + spanOf(start) - 1),
    });

    if (response.status !== 206) {
      throw new Error(
        `${url} answered ${String(response.status)} partway through, at byte ${String(start)}`,
      );
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
      throw new Error(`${url} returned an empty chunk at byte ${String(start)}`);
    }

    await store.append(url, start, bytes);

    loaded += bytes.byteLength;

    onProgress(loaded, total);
  };

  const worker = async () => {
    while (!stopped) {
      const start = queue.shift();

      if (start === undefined) {
        return;
      }

      try {
        // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
        await bank(start);
      } catch (error) {
        stopped = true;

        throw error;
      }
    }
  };

  const workers = Math.min(Math.max(concurrency, 1), queue.length);
  const outcomes = await Promise.allSettled(Array.from({ length: workers }, worker));
  const failure = outcomes.find(isRejected);

  if (failure !== undefined) {
    const reason: unknown = failure.reason;

    throw reason instanceof Error
      ? reason
      : new Error(`${url} failed partway through: ${String(reason)}`);
  }

  const parts = await store.readParts(url);
  const blob = new Blob(parts);

  if (blob.size !== total) {
    await store.clear(url);

    throw new Error(
      `${url} assembled to ${String(blob.size)} bytes but should be ${String(total)}; the stored chunks are corrupt`,
    );
  }

  await store.clear(url);

  return blob;
};

export { downloadResumable };
export type { DownloadOptions };
