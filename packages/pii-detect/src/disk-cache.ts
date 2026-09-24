import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { readBytes } from "./fetch-bytes";

const MODEL_CACHE_DIR = path.join(homedir(), ".cache", "localveil", "models");

const cachePathFor = (url: string) => {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return path.join(MODEL_CACHE_DIR, `${digest}-${path.basename(new URL(url).pathname)}`);
};

const isMissingFile = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const warnNotKept = (file: string, cause: unknown) => {
  // oxlint-disable-next-line eslint/no-console
  console.warn(`Could not keep the model at ${file}`, cause);
};

const keepOnDisk = async (file: string, bytes: Uint8Array) => {
  try {
    await mkdir(path.dirname(file), { recursive: true });

    const part = `${file}.part-${globalThis.crypto.randomUUID()}`;

    await writeFile(part, bytes);
    await rename(part, file);
  } catch (error) {
    warnNotKept(file, error);
  }
};

const readKept = async (file: string) => {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }

    throw error;
  }
};

const fetchKept = async (
  url: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const file = cachePathFor(url);
  const kept = await readKept(file);

  if (kept !== undefined) {
    onProgress(1);

    return new Uint8Array(kept.buffer, kept.byteOffset, kept.byteLength);
  }

  const bytes = await readBytes(await fetch(url, { signal }), onProgress);

  await keepOnDisk(file, bytes);

  return bytes;
};

export { cachePathFor, fetchKept, isMissingFile, MODEL_CACHE_DIR };
