import type { Detect } from "@repo/redact-core";

import { redactionCount } from "./analysis";
import { defaultDecisions } from "./detections";
import { fractionAt } from "./stages";
import type { ApplyRequest, FileProgress, RedactionResult, Redactor, StageProgress } from "./types";
import { verifyOutput } from "./verify";

const staged =
  (onProgress: FileProgress): StageProgress =>
  (stage, done) => {
    onProgress(fractionAt(stage, done), stage);
  };

type WholeFile = { detect: Detect; file: File; onProgress: FileProgress; redactor: Redactor };

const analyseFile = ({ detect, file, onProgress, redactor }: WholeFile) =>
  redactor.analyse(file, detect, staged(onProgress));

type Decided = Omit<ApplyRequest, "onProgress"> & {
  detect: Detect;
  onProgress: FileProgress;
  redactor: Redactor;
};

// Every format is counted and read back the same way, so no redactor can ship without the check.
const applyDecisions = async ({
  detect,
  redactor,
  ...request
}: Decided): Promise<RedactionResult> => {
  const { analysis, decisions } = request;
  const onProgress = staged(request.onProgress);
  const { blob, name, visible, warnings } = await redactor.apply({ ...request, onProgress });

  const verified = await verifyOutput(visible, detect, [...analysis.warnings, ...warnings]);

  onProgress("stage.finished");

  return {
    blob,
    name,
    redactionCount: redactionCount(analysis.units, decisions),
    warnings: verified,
  };
};

const redactFile = async (whole: WholeFile): Promise<RedactionResult> => {
  const analysis = await analyseFile(whole);

  return applyDecisions({ ...whole, analysis, decisions: defaultDecisions(analysis.detections) });
};

export { analyseFile, applyDecisions, redactFile };
