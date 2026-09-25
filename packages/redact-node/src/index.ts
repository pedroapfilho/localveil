import { createDetector } from "@repo/pii-detect";
import type { ModelId } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";

type NodeRedactorOptions = {
  model?: ModelId;
  onModelProgress?: (fraction: number) => void;
};

const createNodeDetector = (options: NodeRedactorOptions = {}): Promise<Detect> =>
  createDetector({
    model: options.model,
    onProgress: (fraction) => {
      options.onModelProgress?.(fraction);
    },
    resumableCache: false,
  });

export { createNodeDetector };
export { SUPPORTED_EXTENSIONS } from "./read-file";
export { redactPath } from "./redact-path";
export type { NodeRedactionOutput, NodeRedactionProgress } from "./redact-path";
