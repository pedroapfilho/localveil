import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

// Every redactor asks the MIME type first and the file name second, and a path off a
// disk carries neither, so the extension has to answer for both. The list is the
// three redactors' own extensions minus the ones no node image decoder reads: .heic
// and .tiff route to the image redactor in a browser but cannot be opened here.
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

// tesseract.js picks its image loader at resolution time, and the node one ends in
// `new Uint8Array(image)` with no branch for a File: only the browser loader knows to
// read a Blob out first. An iterator over the bytes is the one shape that call reads,
// so this is how an image reaches the recogniser without redact-image having to know
// which runtime it is in.
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
