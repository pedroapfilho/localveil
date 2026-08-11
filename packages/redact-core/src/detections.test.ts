import { describe, expect, it } from "vitest";

import { APPLY_SCORE, dedupeDetections, describeSpans, keptSpans } from "./detections.ts";
import type { Detection, Span } from "./types.ts";

const span = (start: number, end: number, score = 0.9): Span => ({
  end,
  label: "private_person",
  score,
  start,
});

const TEXT = "Signed by Ana Lima today";

describe("describeSpans", () => {
  it("previews the covered text", () => {
    const [detection] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(10, 18)],
      text: TEXT,
    });

    expect(detection.preview).toBe("Ana Lima");
    expect(detection.confidence).toBe(0.9);
    expect(detection.source).toBe("model");
  });

  it("keeps the span offsets so apply can rebuild them", () => {
    const [detection] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(10, 18)],
      text: TEXT,
    });

    expect(detection.start).toBe(10);
    expect(detection.end).toBe(18);
  });

  it("records the page when one is given and leaves it off when not", () => {
    const [withPage] = describeSpans({
      applyAbove: APPLY_SCORE,
      page: 3,
      source: "model",
      spans: [span(10, 18)],
      text: TEXT,
    });
    const [without] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(10, 18)],
      text: TEXT,
    });

    expect(withPage.page).toBe(3);
    expect(without.page).toBeUndefined();
  });

  it("gives the same span on different pages different ids", () => {
    const [first] = describeSpans({
      applyAbove: APPLY_SCORE,
      page: 0,
      source: "model",
      spans: [span(0, 4)],
      text: TEXT,
    });
    const [second] = describeSpans({
      applyAbove: APPLY_SCORE,
      page: 1,
      source: "model",
      spans: [span(0, 4)],
      text: TEXT,
    });

    expect(first.id).not.toBe(second.id);
  });

  it("truncates a long preview to eighty graphemes", () => {
    const long = "a".repeat(200);
    const [detection] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 200)],
      text: long,
    });

    expect(detection.preview).toHaveLength(80);
  });
});

describe("dedupeDetections", () => {
  it("keeps one entry when two layers found the same span", () => {
    const found = [
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        source: "model",
        spans: [span(10, 18, 0.6)],
        text: TEXT,
      }),
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        source: "pattern",
        spans: [span(10, 18, 1)],
        text: TEXT,
      }),
    ];

    expect(dedupeDetections(found)).toHaveLength(1);
  });

  it("keeps the higher confidence of the two", () => {
    const found = [
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        source: "model",
        spans: [span(10, 18, 0.6)],
        text: TEXT,
      }),
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        source: "pattern",
        spans: [span(10, 18, 1)],
        text: TEXT,
      }),
    ];

    expect(dedupeDetections(found)[0].confidence).toBe(1);
  });

  it("orders by page and then by position", () => {
    const found = [
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        page: 1,
        source: "model",
        spans: [span(0, 4)],
        text: TEXT,
      }),
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        page: 0,
        source: "model",
        spans: [span(10, 18)],
        text: TEXT,
      }),
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        page: 0,
        source: "model",
        spans: [span(0, 6)],
        text: TEXT,
      }),
    ];

    expect(dedupeDetections(found).map((entry) => [entry.page, entry.start])).toEqual([
      [0, 0],
      [0, 10],
      [1, 0],
    ]);
  });
});

describe("suggestions", () => {
  it("marks a span under the apply floor as a suggestion", () => {
    const [low] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 6, 0.2)],
      text: TEXT,
    });
    const [high] = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 6, 0.9)],
      text: TEXT,
    });

    expect(low.suggested).toBe(true);
    expect(high.suggested).toBe(false);
  });

  it("treats a span exactly on the floor as certain", () => {
    const [edge] = describeSpans({
      applyAbove: 0.65,
      source: "model",
      spans: [span(0, 6, 0.65)],
      text: TEXT,
    });

    expect(edge.suggested).toBe(false);
  });

  it("leaves a suggestion out unless it was explicitly kept", () => {
    const found = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 6, 0.2)],
      text: TEXT,
    });

    expect(keptSpans(found, { dismissed: [], kept: [] })).toEqual([]);
    expect(keptSpans(found, { dismissed: [], kept: [found[0].id] })).toHaveLength(1);
  });

  it("still drops a kept suggestion that was also dismissed", () => {
    const found = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 6, 0.2)],
      text: TEXT,
    });

    expect(keptSpans(found, { dismissed: [found[0].id], kept: [found[0].id] })).toEqual([]);
  });

  it("does not need a certain span to be kept", () => {
    const found = describeSpans({
      applyAbove: APPLY_SCORE,
      source: "model",
      spans: [span(0, 6, 0.9)],
      text: TEXT,
    });

    expect(keptSpans(found, { dismissed: [], kept: [] })).toHaveLength(1);
  });
});

describe("keptSpans", () => {
  const detections: Array<Detection> = describeSpans({
    applyAbove: APPLY_SCORE,
    source: "model",
    spans: [span(0, 6), span(10, 18)],
    text: TEXT,
  });

  it("returns every span when nothing was dismissed", () => {
    expect(keptSpans(detections, { dismissed: [], kept: [] })).toHaveLength(2);
  });

  it("drops the span whose id was dismissed", () => {
    const kept = keptSpans(detections, { dismissed: [detections[0].id], kept: [] });

    expect(kept).toEqual([{ end: 18, label: "private_person", score: 0.9, start: 10 }]);
  });

  it("returns nothing when everything was dismissed", () => {
    expect(
      keptSpans(detections, { dismissed: detections.map((entry) => entry.id), kept: [] }),
    ).toEqual([]);
  });

  it("only returns the detections belonging to the page asked for", () => {
    const paged = [
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        page: 0,
        source: "model",
        spans: [span(0, 6)],
        text: TEXT,
      }),
      ...describeSpans({
        applyAbove: APPLY_SCORE,
        page: 1,
        source: "model",
        spans: [span(10, 18)],
        text: TEXT,
      }),
    ];

    expect(keptSpans(paged, { dismissed: [], kept: [] }, 1)).toEqual([
      { end: 18, label: "private_person", score: 0.9, start: 10 },
    ]);
  });

  it("ignores an id that names no detection", () => {
    expect(keptSpans(detections, { dismissed: ["nothing"], kept: [] })).toHaveLength(2);
  });
});
