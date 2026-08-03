type Manifest = { etag: string; loaded: number; total: number };

type ChunkStore = {
  append: (url: string, start: number, bytes: ArrayBuffer) => Promise<void>;
  clear: (url: string) => Promise<void>;
  readManifest: (url: string) => Promise<Manifest | undefined>;
  readOffsets: (url: string) => Promise<Array<number>>;
  readParts: (url: string) => Promise<Array<Blob>>;
  writeManifest: (url: string, manifest: Manifest) => Promise<void>;
};

const DB_NAME = "localveil-models";
const DB_VERSION = 1;
const CHUNKS = "chunks";
const MANIFESTS = "manifests";

type ChunkRecord = { bytes: ArrayBuffer; start: number; url: string };

const promisify = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("The chunk store rejected a request"));
    });
  });

const settled = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("The chunk store aborted a transaction"));
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("The chunk store failed a transaction"));
    });
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(CHUNKS)) {
        database.createObjectStore(CHUNKS, { keyPath: ["url", "start"] });
      }

      if (!database.objectStoreNames.contains(MANIFESTS)) {
        database.createObjectStore(MANIFESTS, { keyPath: "url" });
      }
    });

    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Could not open the chunk store"));
    });
  });

const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "etag") === "string" &&
  typeof Reflect.get(value, "loaded") === "number" &&
  typeof Reflect.get(value, "total") === "number";

const isChunkRecord = (value: unknown): value is ChunkRecord =>
  typeof value === "object" &&
  value !== null &&
  Reflect.get(value, "bytes") instanceof ArrayBuffer &&
  typeof Reflect.get(value, "url") === "string";

const isChunkKey = (key: unknown): key is [string, number] =>
  Array.isArray(key) && typeof key.at(0) === "string" && typeof key.at(1) === "number";

const rangeFor = (url: string) =>
  IDBKeyRange.bound([url, Number.NEGATIVE_INFINITY], [url, Number.POSITIVE_INFINITY]);

const createIndexedDbChunkStore = (): ChunkStore => {
  let pending: Promise<IDBDatabase> | undefined;

  const database = () => {
    pending ??= openDatabase();

    return pending;
  };

  return {
    append: async (url, start, bytes) => {
      const db = await database();
      const transaction = db.transaction(CHUNKS, "readwrite");
      const record: ChunkRecord = { bytes, start, url };

      transaction.objectStore(CHUNKS).put(record);

      await settled(transaction);
    },
    clear: async (url) => {
      const db = await database();
      const transaction = db.transaction([CHUNKS, MANIFESTS], "readwrite");

      transaction.objectStore(CHUNKS).delete(rangeFor(url));
      transaction.objectStore(MANIFESTS).delete(url);

      await settled(transaction);
    },
    readManifest: async (url) => {
      const db = await database();
      const transaction = db.transaction(MANIFESTS, "readonly");
      const record: unknown = await promisify(transaction.objectStore(MANIFESTS).get(url));

      return isManifest(record) ? record : undefined;
    },

    readOffsets: async (url) => {
      const db = await database();
      const transaction = db.transaction(CHUNKS, "readonly");
      const request = transaction.objectStore(CHUNKS).openKeyCursor(rangeFor(url));
      const offsets: Array<number> = [];

      await new Promise<void>((resolve, reject) => {
        request.addEventListener("success", () => {
          const cursor = request.result;

          if (cursor === null) {
            resolve();

            return;
          }

          const { key } = cursor;

          if (isChunkKey(key) && key[0] === url) {
            offsets.push(key[1]);
          }

          cursor.continue();
        });

        request.addEventListener("error", () => {
          reject(request.error ?? new Error("The chunk store could not be read"));
        });
      });

      return offsets;
    },

    readParts: async (url) => {
      const db = await database();
      const transaction = db.transaction(CHUNKS, "readonly");
      const request = transaction.objectStore(CHUNKS).openCursor(rangeFor(url));
      const parts: Array<Blob> = [];

      await new Promise<void>((resolve, reject) => {
        request.addEventListener("success", () => {
          const cursor = request.result;

          if (cursor === null) {
            resolve();

            return;
          }

          const record: unknown = cursor.value;

          if (isChunkRecord(record) && record.url === url) {
            parts.push(new Blob([record.bytes]));
          }

          cursor.continue();
        });

        request.addEventListener("error", () => {
          reject(request.error ?? new Error("The chunk store could not be read"));
        });
      });

      return parts;
    },
    writeManifest: async (url, manifest) => {
      const db = await database();
      const transaction = db.transaction(MANIFESTS, "readwrite");

      transaction.objectStore(MANIFESTS).put({ url, ...manifest });

      await settled(transaction);
    },
  };
};

export { createIndexedDbChunkStore };
export type { ChunkStore, Manifest };
