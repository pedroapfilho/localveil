import type { Detect, FileStageKey, WarningKey } from "@repo/redact-core";
import { createRedactorRegistry, redactFile } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";

import { installCanvas } from "./canvas.ts";
import { readFileAsFile } from "./read-file.ts";

type NodeRedactionProgress = (fraction: number, stage: FileStageKey) => void;

type NodeRedactionOutput = {
  bytes: Uint8Array;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

const redactPath = async (
  path: string,
  detect: Detect,
  onProgress: NodeRedactionProgress,
): Promise<NodeRedactionOutput> => {
  installCanvas();

  const file = await readFileAsFile(path);
  const redactor = registry.resolve(file);
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
