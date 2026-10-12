import type { Detect, FileStageKey, WarningKey } from "@repo/redact-core";
import { redactFile } from "@repo/redact-core";
import { resolveRedactor } from "@repo/redact-formats/redactors";

import { installCanvas } from "./canvas";
import { readFileAsFile } from "./read-file";

type NodeRedactionProgress = (fraction: number, stage: FileStageKey) => void;

type NodeRedactionOutput = {
  bytes: Uint8Array;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

const redactPath = async (
  path: string,
  detect: Detect,
  onProgress: NodeRedactionProgress,
): Promise<NodeRedactionOutput> => {
  installCanvas();

  const file = await readFileAsFile(path);
  const redactor = resolveRedactor(file);
  const { blob, redactionCount, warnings } = await redactFile({
    detect,
    file,
    onProgress,
    redactor,
  });

  return { bytes: new Uint8Array(await blob.arrayBuffer()), redactionCount, warnings };
};

export { redactPath };
export type { NodeRedactionOutput, NodeRedactionProgress };
