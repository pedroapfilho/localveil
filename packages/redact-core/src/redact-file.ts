import { defaultDecisions } from "./detections.ts";
import type { Detect, FileProgress, RedactionResult, RedactOptions, Redactor } from "./types.ts";

type WholeFile = {
  detect: Detect;
  file: File;
  onProgress: FileProgress;
  options?: RedactOptions;
  redactor: Redactor;
};

const redactFile = async ({
  detect,
  file,
  onProgress,
  options,
  redactor,
}: WholeFile): Promise<RedactionResult> => {
  const analysis = await redactor.analyse(file, detect, onProgress, options);

  return redactor.apply({
    analysis,
    decisions: defaultDecisions(analysis.detections),
    detect,
    file,
    onProgress,
  });
};

export { redactFile };
export type { WholeFile };
