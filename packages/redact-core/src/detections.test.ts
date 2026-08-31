import { describe, expect, it } from "vitest";

import {
  APPLY_SCORE,
  dedupeDetections,
  defaultDecisions,
  describeSpans,
  keptSpans,
} from "./detections";
import type { Detection, Span } from "./types";

const span = (start: number, end: number, score = 0.9): Span => ({
  end,
  label: "private_person",
  score,
  start,
});

const TEXT = "Signed by Ana Lima today";

describe("describeSpans", () => {
  it("previews the covered text", () => {
    const [detection] = describeSpans([span(10, 18)], TEXT);

    expect(detection.preview).toBe("Ana Lima");
    expect(detection.confidence).toBe(0.9);
  });

  it("keeps the span offsets so apply can rebuild them", () => {
    const [detection] = describeSpans([span(10, 18)], TEXT);

    expect(detection.start).toBe(10);
    expect(detection.end).toBe(18);
  });

  it("records the page when one is given and leaves it off when not", () => {
    const [withPage] = describeSpans([span(10, 18)], TEXT, 3);
    const [without] = describeSpans([span(10, 18)], TEXT);

    expect(withPage.page).toBe(3);
    expect(without.page).toBeUndefined();
  });

  it("gives the same span on different pages different ids", () => {
    const [first] = describeSpans([span(0, 4)], TEXT, 0);
    const [second] = describeSpans([span(0, 4)], TEXT, 1);

    expect(first.id).not.toBe(second.id);
  });

  it("truncates a long preview to eighty graphemes", () => {
    const long = "a".repeat(200);
    const [detection] = describeSpans([span(0, 200)], long);

    expect(detection.preview).toHaveLength(80);
  });
});

describe("dedupeDetections", () => {
  it("keeps one entry when two layers found the same span", () => {
    const found = [
      ...describeSpans([span(10, 18, 0.6)], TEXT),
      ...describeSpans([span(10, 18, 1)], TEXT),
    ];

    expect(dedupeDetections(found)).toHaveLength(1);
  });

  it("keeps the higher confidence of the two", () => {
    const found = [
      ...describeSpans([span(10, 18, 0.6)], TEXT),
      ...describeSpans([span(10, 18, 1)], TEXT),
    ];

    expect(dedupeDetections(found)[0].confidence).toBe(1);
  });

  it("folds a nested span into the one that encloses it", () => {
    const found = describeSpans([span(10, 22, 0.7), span(14, 22, 1)], TEXT);
    const deduped = dedupeDetections(found);

    expect(deduped).toHaveLength(1);
    expect([deduped[0].start, deduped[0].end]).toEqual([10, 22]);
  });

  it("carries the better score of the pair onto the survivor", () => {
    const found = describeSpans([span(10, 22, 0.7), span(14, 22, 1)], TEXT);

    expect(dedupeDetections(found)[0].confidence).toBe(1);
  });

  it("leaves a partial overlap as two detections", () => {
    const found = describeSpans([span(0, 10), span(6, 18)], TEXT);

    expect(dedupeDetections(found)).toHaveLength(2);
  });

  it("does not fold across labels", () => {
    const found = [
      ...describeSpans([span(10, 22)], TEXT),
      ...describeSpans([{ end: 22, label: "private_email", score: 1, start: 14 }], TEXT),
    ];

    expect(dedupeDetections(found)).toHaveLength(2);
  });

  it("does not fold across pages", () => {
    const found = [
      ...describeSpans([span(10, 22)], TEXT, 0),
      ...describeSpans([span(14, 22)], TEXT, 1),
    ];

    expect(dedupeDetections(found)).toHaveLength(2);
  });

  it("orders by page and then by position", () => {
    const found = [
      ...describeSpans([span(0, 4)], TEXT, 1),
      ...describeSpans([span(10, 18)], TEXT, 0),
      ...describeSpans([span(0, 6)], TEXT, 0),
    ];

    expect(dedupeDetections(found).map((entry) => [entry.page, entry.start])).toEqual([
      [0, 0],
      [0, 10],
      [1, 0],
    ]);
  });
});

describe("defaultDecisions", () => {
  it("covers everything at or above the apply floor", () => {
    const found = describeSpans([span(0, 6, APPLY_SCORE), span(10, 18, 0.9)], TEXT);

    expect(defaultDecisions(found).covered).toEqual(found.map((entry) => entry.id));
  });

  it("leaves a span under the floor uncovered", () => {
    const found = describeSpans([span(0, 6, 0.2)], TEXT);

    expect(defaultDecisions(found).covered).toEqual([]);
  });
});

describe("keptSpans", () => {
  const detections: Array<Detection> = describeSpans([span(0, 6), span(10, 18)], TEXT);

  it("returns every span named in the covered set", () => {
    expect(keptSpans(detections, defaultDecisions(detections))).toHaveLength(2);
  });

  it("returns nothing when the covered set is empty", () => {
    expect(keptSpans(detections, { covered: [] })).toEqual([]);
  });

  it("returns only the span whose id was covered", () => {
    const kept = keptSpans(detections, { covered: [detections[1].id] });

    expect(kept).toEqual([{ end: 18, label: "private_person", score: 0.9, start: 10 }]);
  });

  it("covers a low-confidence span when it was explicitly ticked", () => {
    const found = describeSpans([span(0, 6, 0.2)], TEXT);

    expect(keptSpans(found, defaultDecisions(found))).toEqual([]);
    expect(keptSpans(found, { covered: [found[0].id] })).toHaveLength(1);
  });

  it("only returns the detections belonging to the page asked for", () => {
    const paged = [
      ...describeSpans([span(0, 6)], TEXT, 0),
      ...describeSpans([span(10, 18)], TEXT, 1),
    ];

    expect(keptSpans(paged, defaultDecisions(paged), 1)).toEqual([
      { end: 18, label: "private_person", score: 0.9, start: 10 },
    ]);
  });

  it("ignores an id that names no detection", () => {
    expect(keptSpans(detections, { covered: ["nothing"] })).toEqual([]);
  });
});
