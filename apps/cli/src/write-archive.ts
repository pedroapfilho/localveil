import { link, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ARCHIVE_NAME, uniqueFilename } from "@repo/redact";

const writeArchive = async (
  blob: Blob,
  directory: string,
  signal: AbortSignal,
): Promise<string> => {
  const temporary = join(directory, `.localveil-${globalThis.crypto.randomUUID()}.part`);
  const taken = new Set<string>();

  try {
    await writeFile(temporary, new Uint8Array(await blob.arrayBuffer()), { flag: "wx", signal });

    for (;;) {
      signal.throwIfAborted();
      const name = uniqueFilename(ARCHIVE_NAME, taken);
      const target = join(directory, name);

      try {
        await link(temporary, target);

        return target;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }

        taken.add(name);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

export { writeArchive };
