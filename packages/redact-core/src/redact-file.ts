import { redactionCount } from "./analysis";
import { defaultDecisions } from "./detections";
import type { ApplyRequest, Detect, FileProgress, RedactionResult, Redactor } from "./types";
import { verifyOutput } from "./verify";

type Phase = "analysing" | "applying";

/* A file is analysed and then applied, often on two different workers, so each phase owns half of
   one bar and the bar never runs back between them. */
const PHASE_SHARES = {
  analysing: { from: 0, to: 0.5 },
  applying: { from: 0.5, to: 1 },
} as const satisfies Record<Phase, { from: number; to: number }>;

const overallProgress = (phase: Phase, fraction: number) => {
  const { from, to } = PHASE_SHARES[phase];

  return from + (to - from) * Math.min(Math.max(fraction, 0), 1);
};

const inPhase =
  (phase: Phase, onProgress: FileProgress): FileProgress =>
  (fraction, stage) => {
    onProgress(overallProgress(phase, fraction), stage);
  };

type WholeFile = { detect: Detect; file: File; onProgress: FileProgress; redactor: Redactor };

const analyseFile = ({ detect, file, onProgress, redactor }: WholeFile) =>
  redactor.analyse(file, detect, inPhase("analysing", onProgress));

type Decided = ApplyRequest & { detect: Detect; redactor: Redactor };

// Every format is counted and read back the same way, so no redactor can ship without the check.
const applyDecisions = async ({
  detect,
  redactor,
  ...request
}: Decided): Promise<RedactionResult> => {
  const { analysis, decisions } = request;
  const onProgress = inPhase("applying", request.onProgress);
  const { blob, visible, warnings } = await redactor.apply({ ...request, onProgress });

  const verified = await verifyOutput(visible, detect, [...analysis.warnings, ...warnings]);

  onProgress(1, "stage.finished");

  return { blob, redactionCount: redactionCount(analysis.units, decisions), warnings: verified };
};

const redactFile = async (whole: WholeFile): Promise<RedactionResult> => {
  const analysis = await analyseFile(whole);

  return applyDecisions({ ...whole, analysis, decisions: defaultDecisions(analysis.detections) });
};

export { analyseFile, applyDecisions, overallProgress, redactFile };
