import type { Detect } from "@repo/redact-core";
import { createRedactorRegistry } from "@repo/redact-core";
import { imageRedactor } from "@repo/redact-image";
import { pdfRedactor } from "@repo/redact-pdf";
import { textRedactor } from "@repo/redact-text";

import { installCanvas } from "./canvas.ts";
import { readFileAsFile } from "./read-file.ts";

type NodeRedactionProgress = (fraction: number, stage: string) => void;

type NodeRedactionOutput = {
  bytes: Uint8Array;
  redactionCount: number;
  warnings: Array<string>;
};

// The three predicates are disjoint (text/*, application/pdf, image/*), so the order
// only decides which one is asked first.
const registry = createRedactorRegistry([textRedactor, pdfRedactor, imageRedactor]);

const redactPath = async (
  path: string,
  detect: Detect,
  onProgress: NodeRedactionProgress,
): Promise<NodeRedactionOutput> => {
  // Before the redactor runs rather than at import: pdf.js and the image redactor read
  // these globals when they draw, and both are loaded lazily.
  installCanvas();

  const file = await readFileAsFile(path);
  const redactor = registry.resolve(file);
  const { blob, redactionCount, warnings } = await redactor.redact(file, detect, onProgress);

  return { bytes: new Uint8Array(await blob.arrayBuffer()), redactionCount, warnings };
};

export { redactPath };
export type { NodeRedactionOutput, NodeRedactionProgress };
