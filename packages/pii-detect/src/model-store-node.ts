import { rm } from "node:fs/promises";

import type { ModelSpec } from "./catalog";
import { tokenizerUrls, weightsUrl } from "./catalog";
import { cachePathFor, downloadToDisk, sizeOnDisk } from "./disk-cache";
import type { ModelStatus } from "./model-status";
import { settleAll } from "./settle-all";

const filesOf = (model: ModelSpec) => [...tokenizerUrls(model), weightsUrl(model)];

/* The CLI writes each file whole, through a temporary name and a rename, so a file on disk is either
   complete or absent. Ready means the weights and both tokenizer files are there, so a run makes no
   request; weights without the tokenizer read as partial, since they cannot load offline. */
const inspectModel = async (model: ModelSpec): Promise<ModelStatus> => {
  const sizes = await Promise.all(filesOf(model).map(sizeOnDisk));
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
  await settleAll(tokenizerUrls(model).map((url) => downloadToDisk(url, ignoreProgress, signal)));
  await downloadToDisk(weightsUrl(model), onProgress, signal);
};

const removeModel = async (model: ModelSpec): Promise<void> => {
  await Promise.all(filesOf(model).map((url) => rm(cachePathFor(url), { force: true })));
};

export { downloadModel, inspectModel, removeModel };
