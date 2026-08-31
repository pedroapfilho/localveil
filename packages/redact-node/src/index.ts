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
export { SUPPORTED_EXTENSIONS } from "./read-file";
export { redactPath } from "./redact-path";
export type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path";
