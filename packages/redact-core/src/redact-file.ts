import type { Detect, FileProgress, RedactionResult, RedactOptions, Redactor } from "./types.ts";

const NOTHING_DISMISSED = { dismissed: [], kept: [] };

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

  return redactor.apply({ analysis, decisions: NOTHING_DISMISSED, detect, file, onProgress });
};

export { NOTHING_DISMISSED, redactFile };
export type { WholeFile };
