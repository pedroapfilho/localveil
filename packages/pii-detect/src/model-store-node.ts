import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { warnRecoverable } from "@repo/redact-core";

import type { ModelSpec } from "./catalog";
import type { FileProgress, Persistence } from "./model-files";
import { CATALOGUED, downloadInOrder, keptStatus, openInOrder, ownedUrls } from "./model-files";
import type { ModelStatus, OpenModel, PlatformModelStore } from "./model-status";
import { settleAll } from "./settle-all";

const MODEL_CACHE_DIR = path.join(homedir(), ".cache", "localveil", "models");

const MODEL_FILE = /\.(?:json|onnx)$/v;

const nameFor = (url: string) => {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return `${digest}-${path.basename(new URL(url).pathname)}`;
};

const CATALOGUED_NAMES: ReadonlySet<string> = new Set([...CATALOGUED].map(nameFor));

const isMissingFile = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const warnNotKept = (file: string, cause: unknown) => {
  warnRecoverable(`Could not keep the model at ${file}`, cause);
};

const readBytes = async (response: Response, onProgress: FileProgress): Promise<Uint8Array> => {
  if (!response.ok) {
    throw new Error(`The model download answered ${String(response.status)}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const body = response.body;

  if (body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    onProgress(1);

    return bytes;
  }

  const reader = body.getReader();
  const parts: Array<Uint8Array> = [];
  let loaded = 0;

  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    parts.push(step.value);
    loaded += step.value.length;

    if (total > 0) {
      onProgress(Math.min(loaded / total, 1));
    }
  }

  const bytes = new Uint8Array(loaded);
  let at = 0;

  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }

  onProgress(1);

  return bytes;
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

const createNodeModelStore = (directory: string): PlatformModelStore => {
  const pathFor = (url: string) => path.join(directory, nameFor(url));

  const sizeOnDisk = async (url: string) => {
    try {
      const { size } = await stat(pathFor(url));

      return size;
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }

      throw error;
    }
  };

  const ensureOnDisk = async (
    url: string,
    persistence: Persistence,
    onProgress: FileProgress,
    signal?: AbortSignal,
  ): Promise<Uint8Array | undefined> => {
    signal?.throwIfAborted();

    // Inspecting the file avoids reading nearly a gigabyte just to confirm it is already kept.
    if ((await sizeOnDisk(url)) !== undefined) {
      return undefined;
    }

    const bytes = await readBytes(await fetch(url, { signal }), onProgress);

    try {
      await keepOnDisk(pathFor(url), bytes);
    } catch (error) {
      if (persistence === "required") {
        throw error;
      }

      warnNotKept(pathFor(url), error);
    }

    return bytes;
  };

  const readFromDisk = async (url: string, onProgress: FileProgress, signal?: AbortSignal) => {
    const fetched = await ensureOnDisk(url, "best-effort", onProgress, signal);

    if (fetched !== undefined) {
      return fetched;
    }

    const kept = await readFile(pathFor(url), { signal });

    return new Uint8Array(kept.buffer, kept.byteOffset, kept.byteLength);
  };

  // Every revision hashes to its own name, so a revision bump leaves the old files behind.
  const sweepStale = async () => {
    const names = await readdir(directory);
    const stale = names.filter((name) => MODEL_FILE.test(name) && !CATALOGUED_NAMES.has(name));

    await settleAll(stale.map((name) => rm(path.join(directory, name), { force: true })));
  };

  /* Each file is written whole, through a temporary name and a rename, so a file on disk is either
     complete or absent, and nothing is ever banked. */
  const inspectModel = (model: ModelSpec): Promise<ModelStatus> =>
    keptStatus(model, sizeOnDisk, () => Promise.resolve(0));

  const downloadModel = async (
    model: ModelSpec,
    onProgress: FileProgress,
    signal?: AbortSignal,
  ): Promise<void> => {
    await downloadInOrder(model, onProgress, (url, progress) =>
      ensureOnDisk(url, "required", progress, signal),
    );
  };

  const openModel: OpenModel = (model, onProgress, signal) =>
    openInOrder(
      model,
      onProgress,
      (url, progress) => readFromDisk(url, progress, signal),
      sweepStale,
    );

  const removeModel = async (model: ModelSpec): Promise<void> => {
    await Promise.all(ownedUrls(model).map((url) => rm(pathFor(url), { force: true })));
  };

  return { downloadModel, inspectModel, openModel, removeModel };
};

const modelStore = createNodeModelStore(MODEL_CACHE_DIR);

export { createNodeModelStore, MODEL_CACHE_DIR, modelStore };
