import { describe, expect, it } from "vitest";

import { dedupeDetections, describeSpans, keptSpans } from "./detections.ts";
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
    const [detection] = describeSpans({ source: "model", spans: [span(10, 18)], text: TEXT });

    expect(detection.preview).toBe("Ana Lima");
    expect(detection.confidence).toBe(0.9);
    expect(detection.source).toBe("model");
  });

  it("keeps the span offsets so apply can rebuild them", () => {
    const [detection] = describeSpans({ source: "model", spans: [span(10, 18)], text: TEXT });

    expect(detection.start).toBe(10);
    expect(detection.end).toBe(18);
  });

  it("records the page when one is given and leaves it off when not", () => {
    const [withPage] = describeSpans({
      page: 3,
      source: "model",
      spans: [span(10, 18)],
      text: TEXT,
    });
    const [without] = describeSpans({ source: "model", spans: [span(10, 18)], text: TEXT });

    expect(withPage.page).toBe(3);
    expect(without.page).toBeUndefined();
  });

  it("gives the same span on different pages different ids", () => {
    const [first] = describeSpans({ page: 0, source: "model", spans: [span(0, 4)], text: TEXT });
    const [second] = describeSpans({ page: 1, source: "model", spans: [span(0, 4)], text: TEXT });

    expect(first.id).not.toBe(second.id);
  });

  it("truncates a long preview to eighty graphemes", () => {
    const long = "a".repeat(200);
    const [detection] = describeSpans({ source: "model", spans: [span(0, 200)], text: long });

    expect(detection.preview).toHaveLength(80);
  });
});

describe("dedupeDetections", () => {
  it("keeps one entry when two layers found the same span", () => {
    const found = [
      ...describeSpans({ source: "model", spans: [span(10, 18, 0.6)], text: TEXT }),
      ...describeSpans({ source: "pattern", spans: [span(10, 18, 1)], text: TEXT }),
    ];

    expect(dedupeDetections(found)).toHaveLength(1);
  });

  it("keeps the higher confidence of the two", () => {
    const found = [
      ...describeSpans({ source: "model", spans: [span(10, 18, 0.6)], text: TEXT }),
      ...describeSpans({ source: "pattern", spans: [span(10, 18, 1)], text: TEXT }),
    ];

    expect(dedupeDetections(found)[0].confidence).toBe(1);
  });

  it("orders by page and then by position", () => {
    const found = [
      ...describeSpans({ page: 1, source: "model", spans: [span(0, 4)], text: TEXT }),
      ...describeSpans({ page: 0, source: "model", spans: [span(10, 18)], text: TEXT }),
      ...describeSpans({ page: 0, source: "model", spans: [span(0, 6)], text: TEXT }),
    ];

    expect(dedupeDetections(found).map((entry) => [entry.page, entry.start])).toEqual([
      [0, 0],
      [0, 10],
      [1, 0],
    ]);
  });
});

describe("keptSpans", () => {
  const detections: Array<Detection> = describeSpans({
    source: "model",
    spans: [span(0, 6), span(10, 18)],
    text: TEXT,
  });

  it("returns every span when nothing was dismissed", () => {
    expect(keptSpans(detections, { dismissed: [] })).toHaveLength(2);
  });

  it("drops the span whose id was dismissed", () => {
    const kept = keptSpans(detections, { dismissed: [detections[0].id] });

    expect(kept).toEqual([{ end: 18, label: "private_person", score: 0.9, start: 10 }]);
  });

  it("returns nothing when everything was dismissed", () => {
    expect(keptSpans(detections, { dismissed: detections.map((entry) => entry.id) })).toEqual([]);
  });

  it("only returns the detections belonging to the page asked for", () => {
    const paged = [
      ...describeSpans({ page: 0, source: "model", spans: [span(0, 6)], text: TEXT }),
      ...describeSpans({ page: 1, source: "model", spans: [span(10, 18)], text: TEXT }),
    ];

    expect(keptSpans(paged, { dismissed: [] }, 1)).toEqual([
      { end: 18, label: "private_person", score: 0.9, start: 10 },
    ]);
  });

  it("ignores an id that names no detection", () => {
    expect(keptSpans(detections, { dismissed: ["nothing"] })).toHaveLength(2);
  });
});
