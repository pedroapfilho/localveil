import type { FileStageKey } from "../pipeline/stages";

type ProgressEvent = { fraction: number; stage: FileStageKey; type: "progress" };

const progressEvent = (fraction: number, stage: FileStageKey): ProgressEvent => ({
  fraction,
  stage,
  type: "progress",
});

const isProgressEvent = (payload: unknown): payload is ProgressEvent =>
  typeof payload === "object" &&
  payload !== null &&
  "type" in payload &&
  payload.type === "progress" &&
  "fraction" in payload &&
  typeof payload.fraction === "number" &&
  "stage" in payload &&
  typeof payload.stage === "string";

export { isProgressEvent, progressEvent };

export type { ProgressEvent };
