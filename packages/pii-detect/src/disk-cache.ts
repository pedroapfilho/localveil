import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  await mkdir(path.dirname(file), { recursive: true });

  const part = `${file}.part-${globalThis.crypto.randomUUID()}`;

  try {
    await writeFile(part, bytes);
    await rename(part, file);
  } finally {
    await rm(part, { force: true });
  }
};

const sizeOnDisk = async (url: string) => {
  try {
    const { size } = await stat(cachePathFor(url));

    return size;
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }

    throw error;
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

  try {
    await keepOnDisk(file, bytes);
  } catch (error) {
    warnNotKept(file, error);
  }

  return bytes;
};

const downloadToDisk = async (
  url: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  signal?.throwIfAborted();

  // Inspecting the file avoids reading nearly a gigabyte just to confirm it is already kept.
  if ((await sizeOnDisk(url)) !== undefined) {
    onProgress(1);

    return;
  }

  const bytes = await readBytes(await fetch(url, { signal }), onProgress);

  await keepOnDisk(cachePathFor(url), bytes);
};

export { cachePathFor, downloadToDisk, fetchKept, MODEL_CACHE_DIR, sizeOnDisk };
