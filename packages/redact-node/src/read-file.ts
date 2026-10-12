import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { NODE_FORMATS } from "@repo/redact-formats";

const readFileAsFile = async (path: string) => {
  const source = await readFile(path);

  const bytes = new Uint8Array(source.byteLength);

  bytes.set(source);

  return new File([bytes], basename(path), {
    type: NODE_FORMATS.get(extname(path).toLowerCase()) ?? "",
  });
};

export { readFileAsFile };
