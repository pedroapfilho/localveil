import type { ChunkStore } from "./chunk-store.ts";

type Probe = { etag: string; total: number };

type DownloadOptions = {
  chunkSize: number;
  fetchRange: typeof fetch;
  onProgress: (loaded: number, total: number) => void;
  store: ChunkStore;
};

const CONTENT_RANGE = /^bytes \d+-\d+\/(?<total>\d+)$/v;

const rangeHeader = (start: number, endInclusive: number) => ({
  Range: `bytes=${String(start)}-${String(endInclusive)}`,
});

// A one-byte range doubles as the size probe: `HEAD` would need its own CORS
// preflight, while this is the exact request the rest of the download makes.
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

  // Without a validator there is no way to tell a resumed file from a changed one,
  // so the URL itself becomes the only identity we have.
  return { etag: response.headers.get("etag") ?? url, total: Number(total) };
};

const startingPoint = async (url: string, etag: string, store: ChunkStore) => {
  const manifest = await store.readManifest(url);

  if (manifest === undefined) {
    return 0;
  }

  if (manifest.etag !== etag) {
    await store.clear(url);

    return 0;
  }

  return manifest.loaded;
};

const downloadResumable = async (url: string, options: DownloadOptions): Promise<Blob> => {
  const { chunkSize, fetchRange, onProgress, store } = options;
  const { etag, total } = await probe(url, fetchRange);

  let loaded = await startingPoint(url, etag, store);

  onProgress(loaded, total);

  while (loaded < total) {
    const end = Math.min(loaded + chunkSize, total) - 1;
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    const response = await fetchRange(url, { headers: rangeHeader(loaded, end) });

    if (response.status !== 206) {
      throw new Error(
        `${url} answered ${String(response.status)} partway through, at byte ${String(loaded)}`,
      );
    }

    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    const bytes = await response.arrayBuffer();

    // An empty chunk would leave `loaded` where it is and spin here forever.
    if (bytes.byteLength === 0) {
      throw new Error(`${url} returned an empty chunk at byte ${String(loaded)}`);
    }

    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    await store.append(url, loaded, bytes);

    loaded += bytes.byteLength;

    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    await store.writeManifest(url, { etag, loaded, total });

    onProgress(loaded, total);
  }

  const parts = await store.readAll(url);
  const blob = new Blob(parts);

  if (blob.size !== total) {
    throw new Error(
      `${url} assembled to ${String(blob.size)} bytes but should be ${String(total)}; the stored chunks are corrupt`,
    );
  }

  await store.clear(url);

  return blob;
};

export { downloadResumable };
export type { DownloadOptions };
