import type { ChunkStore, Manifest } from "./chunk-store";

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

export { memoryStore };
