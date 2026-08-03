import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".log", "text/plain"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
]);

const SUPPORTED_EXTENSIONS: ReadonlyArray<string> = [...MIME_TYPES.keys()];

const iterableFile = (bytes: Uint8Array<ArrayBuffer>, name: string, type: string) =>
  Object.assign(new File([bytes], name, { type }), {
    *[Symbol.iterator]() {
      yield* bytes;
    },
  });

const readFileAsFile = async (path: string) => {
  const source = await readFile(path);

  const bytes = new Uint8Array(source.byteLength);

  bytes.set(source);

  return iterableFile(bytes, basename(path), MIME_TYPES.get(extname(path).toLowerCase()) ?? "");
};

export { readFileAsFile, SUPPORTED_EXTENSIONS };
