import type { Detect } from "@repo/redact-core";

import { resolveRedactor } from "../formats/redactors";
import { redactFile } from "../pipeline/redact-file";
import type { FileProgress, WarningKey } from "../pipeline/types";

import { installCanvas } from "./canvas";
import { readFileAsFile } from "./read-file";

type NodeRedactionOutput = {
  bytes: Uint8Array;
  name: string;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

const redactPath = async (
  path: string,
  detect: Detect,
  onProgress: FileProgress,
): Promise<NodeRedactionOutput> => {
  installCanvas();

  const file = await readFileAsFile(path);
  const redactor = resolveRedactor(file);

  const { blob, name, redactionCount, warnings } = await redactFile({
    detect,
    file,
    onProgress,
    redactor,
  });

  return { bytes: new Uint8Array(await blob.arrayBuffer()), name, redactionCount, warnings };
};

export { redactPath };

export type { NodeRedactionOutput };
