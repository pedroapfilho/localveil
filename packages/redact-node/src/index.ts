import { createDetector } from "@repo/pii-detect";
import type { Detect, DocumentLanguage } from "@repo/redact-core";

import type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path.ts";
import { redactPath } from "./redact-path.ts";

type NodeRedactorOptions = {
  language?: DocumentLanguage;
  onModelProgress?: (fraction: number) => void;
};

type NodeRedactor = {
  redactFile: (path: string, onProgress: NodeRedactionProgress) => Promise<NodeRedactionOutput>;
};

// The weights take a while to load, so they are paid for once and the
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

// The pool needs the two halves apart: one detector on the main thread, and the
// per-file work in a thread that reaches it over a port.
const createNodeDetector = (options: NodeRedactorOptions = {}): Promise<Detect> =>
  createDetector({
    onProgress: (fraction) => {
      options.onModelProgress?.(fraction);
    },
    resumableCache: false,
  });

export { createNodeDetector, createNodeRedactor };
export { SUPPORTED_EXTENSIONS } from "./read-file.ts";
export type { DocumentLanguage } from "@repo/redact-core";
export { redactPath } from "./redact-path.ts";
export type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path.ts";
export type { NodeRedactor };
