import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { toArrayBuffer, UnsupportedFileError } from "@repo/redact-core";
import { nodeTypeOf } from "@repo/redact-formats";

const readFileAsFile = async (path: string) => {
  const type = nodeTypeOf(basename(path));

  if (type === undefined) {
    throw new UnsupportedFileError(basename(path), "");
  }

  return new File([toArrayBuffer(await readFile(path))], basename(path), { type });
};

export { readFileAsFile };
