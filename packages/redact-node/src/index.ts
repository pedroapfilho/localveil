import { createDetector } from "@repo/pii-detect";
import type { DocumentLanguage } from "@repo/redact-core";

import type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path.ts";
import { redactPath } from "./redact-path.ts";

type NodeRedactorOptions = {
  language?: DocumentLanguage;
  onModelProgress?: (fraction: number) => void;
};

type NodeRedactor = {
  redactFile: (path: string, onProgress: NodeRedactionProgress) => Promise<NodeRedactionOutput>;
};

// The weights are 349 MB and take a while to load, so they are paid for once and the
// detector is handed to every file after that.
const createNodeRedactor = async (options: NodeRedactorOptions = {}): Promise<NodeRedactor> => {
  const { language, onModelProgress } = options;

  const detect = await createDetector({
    onProgress: (fraction) => {
      onModelProgress?.(fraction);
    },
    // The resumable cache is built on the Cache API and IndexedDB. transformers.js
    // keeps the weights on disk here instead, and resumes there itself.
    resumableCache: false,
  });

  return {
    redactFile: (path, onProgress) => redactPath(path, detect, onProgress, { language }),
  };
};

export { createNodeRedactor };
export { SUPPORTED_EXTENSIONS } from "./read-file.ts";
export type { DocumentLanguage } from "@repo/redact-core";
export type { NodeRedactionProgress } from "./redact-path.ts";
export type { NodeRedactor };
