import type { FileStageKey } from "./types";

type ProgressEvent = { fraction: number; stage: FileStageKey; type: "progress" };

const isProgressEvent = (payload: unknown): payload is ProgressEvent =>
  typeof payload === "object" &&
  payload !== null &&
  "type" in payload &&
  payload.type === "progress" &&
  "fraction" in payload &&
  typeof payload.fraction === "number" &&
  "stage" in payload &&
  typeof payload.stage === "string";

export { isProgressEvent };
export type { ProgressEvent };
