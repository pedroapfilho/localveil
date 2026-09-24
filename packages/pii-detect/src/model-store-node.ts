import { rm, stat } from "node:fs/promises";

import type { ModelSpec } from "./catalog";
import { tokenizerUrls, weightsUrl } from "./catalog";
import { cachePathFor, fetchKept, isMissingFile } from "./disk-cache";
import type { ModelStatus } from "./model-status";

const filesOf = (model: ModelSpec) => [...tokenizerUrls(model), weightsUrl(model)];

const sizeOf = async (url: string) => {
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

/* The CLI writes each file whole, through a temporary name and a rename, so a file on disk is either
   complete or absent. Ready means the weights and both tokenizer files are there, so a run makes no
   request; weights without the tokenizer read as partial, since they cannot load offline. */
const inspectModel = async (model: ModelSpec): Promise<ModelStatus> => {
  const sizes = await Promise.all(filesOf(model).map(sizeOf));
  const weights = sizes.at(-1);

  if (weights === undefined) {
    return { state: "absent" };
  }

  return sizes.every((size) => size !== undefined)
    ? { bytes: weights, path: cachePathFor(weightsUrl(model)), state: "ready" }
    : { loaded: weights, state: "partial", total: weights };
};

const ignoreProgress = () => undefined;

const downloadModel = async (
  model: ModelSpec,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  for (const url of tokenizerUrls(model)) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
    if ((await sizeOf(url)) === undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
      await fetchKept(url, ignoreProgress, signal);
    }
  }

  // A kept weights file is not read back into memory just to be thrown away.
  const weights = await sizeOf(weightsUrl(model));

  if (weights !== undefined) {
    onProgress(1);

    return;
  }

  await fetchKept(weightsUrl(model), onProgress, signal);
};

const removeModel = async (model: ModelSpec): Promise<void> => {
  await Promise.all(filesOf(model).map((url) => rm(cachePathFor(url), { force: true })));
};

export { downloadModel, inspectModel, removeModel };
