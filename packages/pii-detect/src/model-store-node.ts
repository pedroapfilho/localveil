import { rm, stat } from "node:fs/promises";

import type { ModelSpec } from "./catalog";
import { weightsUrl } from "./catalog";
import { cachePathFor, fetchKept, isMissingFile } from "./disk-cache";
import type { ModelStatus } from "./model-status";

/* The CLI writes weights whole, through a temporary name and a rename, so a file on disk is either
   complete or absent; there is no partial state to report. */
const inspectModel = async (model: ModelSpec): Promise<ModelStatus> => {
  const file = cachePathFor(weightsUrl(model));

  try {
    const { size } = await stat(file);

    return { bytes: size, path: file, state: "ready" };
  } catch (error) {
    if (isMissingFile(error)) {
      return { state: "absent" };
    }

    throw error;
  }
};

const downloadModel = async (
  model: ModelSpec,
  onProgress: (fraction: number) => void,
): Promise<void> => {
  // A kept file is not read back into memory just to be thrown away.
  const kept = await inspectModel(model);

  if (kept.state === "ready") {
    onProgress(1);

    return;
  }

  await fetchKept(weightsUrl(model), onProgress);
};

const removeModel = async (model: ModelSpec): Promise<void> => {
  await rm(cachePathFor(weightsUrl(model)), { force: true });
};

export { downloadModel, inspectModel, removeModel };
