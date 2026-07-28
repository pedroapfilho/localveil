import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

// The redactors ask the MIME type first, and a path off a disk carries none, so the
// extension answers for both. Narrower than the browser's list: .heic and .tiff route
// to the image redactor there but no node decoder opens them.
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

// A byte iterator for tesseract.js's node image loader: see canvas.ts.
const iterableFile = (bytes: Uint8Array<ArrayBuffer>, name: string, type: string) =>
  Object.assign(new File([bytes], name, { type }), {
    *[Symbol.iterator]() {
      yield* bytes;
    },
  });

const readFileAsFile = async (path: string) => {
  const source = await readFile(path);
  // Copied out of the Buffer rather than wrapped around it: node hands back a view
  // into a pool it reuses, and these bytes outlive the read.
  const bytes = new Uint8Array(source.byteLength);

  bytes.set(source);

  return iterableFile(bytes, basename(path), MIME_TYPES.get(extname(path).toLowerCase()) ?? "");
};

export { readFileAsFile, SUPPORTED_EXTENSIONS };
