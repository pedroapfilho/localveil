import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { NODE_FORMATS } from "@repo/redact-formats";

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

  return iterableFile(bytes, basename(path), NODE_FORMATS.get(extname(path).toLowerCase()) ?? "");
};

export { readFileAsFile };
