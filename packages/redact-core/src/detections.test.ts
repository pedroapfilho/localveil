import { describe, expect, it } from "vitest";

import { APPLY_SCORE, defaultDecisions } from "./detections";
import type { Detection } from "./types";

const detection = (id: string, confidence: number): Detection => ({
  confidence,
  end: 4,
  id,
  label: "private_person",
  preview: "Ana",
  start: 0,
});

describe("defaultDecisions", () => {
  it("covers everything at or above the apply floor", () => {
    const found = [detection("floor", APPLY_SCORE), detection("sure", 0.9)];

    expect(defaultDecisions(found).covered).toEqual(["floor", "sure"]);
  });

  it("leaves a detection under the floor uncovered", () => {
    expect(defaultDecisions([detection("unsure", 0.2)]).covered).toEqual([]);
  });
});
