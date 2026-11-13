import { describe, expect, it } from "vitest";

import { redactFile } from "./redact-file";
import type { FileStageKey } from "./stages";
import type { Redactor } from "./types";

const redactor: Redactor = {
  analyse: (_file, _detect, onProgress) => {
    onProgress("stage.reading");
    onProgress("stage.extracting", 0.5);
    onProgress("stage.recognising", 0.5);
    onProgress("stage.detecting");
    onProgress("stage.detecting", 1);

    return Promise.resolve({ detections: [], units: [], warnings: [] });
  },
  apply: ({ onProgress }) => {
    onProgress("stage.redacting");
    onProgress("stage.assembling", 0.8);

    return Promise.resolve({ blob: new Blob(["x"]), name: "a.txt", visible: "", warnings: [] });
  },
};

describe("redactFile", () => {
  it("hands back the output under the name the redactor gave it", async () => {
    const renaming: Redactor = {
      ...redactor,
      apply: () =>
        Promise.resolve({ blob: new Blob(["x"]), name: "a.png", visible: "", warnings: [] }),
    };

    const result = await redactFile({
      detect: () => Promise.resolve([]),
      file: new File(["x"], "a.gif"),
      onProgress: () => undefined,
      redactor: renaming,
    });

    expect(result.name).toBe("a.png");
  });

  it("gives every stage its stretch of one bar that never runs back, and finishes once", async () => {
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
      [0.175, "stage.extracting"],
      [0.175, "stage.recognising"],
      [0.3, "stage.detecting"],
      [0.5, "stage.detecting"],
      [0.5, "stage.redacting"],
      [0.9, "stage.assembling"],
      [1, "stage.finished"],
    ]);
    expect(seen.map(([fraction]) => fraction)).toEqual(
      seen.map(([fraction]) => fraction).toSorted((left, right) => left - right),
    );
  });
});
