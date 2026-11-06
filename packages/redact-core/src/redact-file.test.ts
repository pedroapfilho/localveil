import { describe, expect, it } from "vitest";

import { redactFile } from "./redact-file";
import type { FileStageKey, Redactor } from "./types";

const redactor: Redactor = {
  analyse: (_file, _detect, onProgress) => {
    onProgress(0, "stage.reading");
    onProgress(1, "stage.detecting");

    return Promise.resolve({ detections: [], units: [], warnings: [] });
  },
  apply: ({ onProgress }) => {
    onProgress(0, "stage.redacting");
    onProgress(0.8, "stage.redacting");

    return Promise.resolve({ blob: new Blob(["x"]), visible: "", warnings: [] });
  },
};

describe("redactFile", () => {
  it("runs both phases along one bar that never runs back, and finishes once", async () => {
    const seen: Array<[number, FileStageKey]> = [];

    await redactFile({
      detect: () => Promise.resolve([]),
      file: new File(["x"], "a.txt"),
      onProgress: (fraction, stage) => {
        seen.push([fraction, stage]);
      },
      redactor,
    });

    expect(seen).toEqual([
      [0, "stage.reading"],
      [0.5, "stage.detecting"],
      [0.5, "stage.redacting"],
      [0.9, "stage.redacting"],
      [1, "stage.finished"],
    ]);
  });
});
