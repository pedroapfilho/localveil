import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { nodeTypeOf } from "../formats/formats";
import { UnsupportedFileError } from "../pipeline/unsupported-file-error";
import { toArrayBuffer } from "../transport/zip";

const readFileAsFile = async (path: string) => {
  const type = nodeTypeOf(basename(path));

  if (type === undefined) {
    throw new UnsupportedFileError(basename(path), "");
  }

  return new File([toArrayBuffer(await readFile(path))], basename(path), { type });
};

export { readFileAsFile };
