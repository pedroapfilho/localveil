import { defaultDecisions } from "./detections";
import type { Detect, FileProgress, RedactionResult, Redactor } from "./types";

type WholeFile = {
  detect: Detect;
  file: File;
  onProgress: FileProgress;
  redactor: Redactor;
};

const redactFile = async ({
  detect,
  file,
  onProgress,
  redactor,
}: WholeFile): Promise<RedactionResult> => {
  const analysis = await redactor.analyse(file, detect, onProgress);

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
