import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { nodeTypeOf } from "../formats/formats";
import { unsupportedFile } from "../pipeline/failure";
import { toArrayBuffer } from "../transport/zip";

const readFileAsFile = async (path: string) => {
  const type = nodeTypeOf(basename(path));

  if (type === undefined) {
    throw unsupportedFile(basename(path), "");
  }

  return new File([toArrayBuffer(await readFile(path))], basename(path), { type });
};

export { readFileAsFile };
