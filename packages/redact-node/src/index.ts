import { createDetector } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";

type NodeRedactorOptions = {
  onModelProgress?: (fraction: number) => void;
};

const createNodeDetector = (options: NodeRedactorOptions = {}): Promise<Detect> =>
  createDetector({
    onProgress: (fraction) => {
      options.onModelProgress?.(fraction);
    },
    resumableCache: false,
  });

export { createNodeDetector };
export { SUPPORTED_EXTENSIONS } from "./read-file.ts";
export type { DocumentLanguage } from "@repo/redact-core";
export { redactPath } from "./redact-path.ts";
export type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path.ts";
