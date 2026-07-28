type Manifest = { etag: string; loaded: number; total: number };

type ChunkStore = {
  append: (url: string, start: number, bytes: ArrayBuffer) => Promise<void>;
  clear: (url: string) => Promise<void>;
  readAll: (url: string) => Promise<Array<ArrayBuffer>>;
  readManifest: (url: string) => Promise<Manifest | undefined>;
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

const rangeFor = (url: string) =>
  IDBKeyRange.bound([url, Number.NEGATIVE_INFINITY], [url, Number.POSITIVE_INFINITY]);

// Chunks are keyed by their own start offset rather than appended to one growing
// record: rewriting an 800 MB value on every 8 MB that arrives would cost more than
// the download.
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
    readAll: async (url) => {
      const db = await database();
      const transaction = db.transaction(CHUNKS, "readonly");
      const records: Array<unknown> = await promisify(
        transaction.objectStore(CHUNKS).getAll(rangeFor(url)),
      );

      return records
        .filter((record): record is ChunkRecord => Reflect.get(record ?? {}, "url") === url)
        .toSorted((left, right) => left.start - right.start)
        .map((record) => record.bytes);
    },
    readManifest: async (url) => {
      const db = await database();
      const transaction = db.transaction(MANIFESTS, "readonly");
      const record: unknown = await promisify(transaction.objectStore(MANIFESTS).get(url));

      return isManifest(record) ? record : undefined;
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
